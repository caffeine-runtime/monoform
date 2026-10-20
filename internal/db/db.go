// Package db opens SQLite database files for browsing and editing: schema,
// paged table rows with sorting and filtering, SQL queries, edits applied in
// one transaction, and CSV export. It uses modernc.org/sqlite (pure Go, no
// cgo, BSD-3-Clause), so it works offline on every platform.
package db

import (
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	_ "modernc.org/sqlite"
)

// Conn is an open database file.
type Conn struct {
	mu       sync.Mutex
	db       *sql.DB
	Path     string
	ReadOnly bool
}

// IsSQLite reports whether the file starts with the SQLite header.
func IsSQLite(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	b := make([]byte, 16)
	n, _ := io.ReadFull(f, b)
	return n == 16 && string(b) == "SQLite format 3\x00"
}

// Open opens a database file (never creates one).
func Open(path string, readOnly bool) (*Conn, error) {
	if !IsSQLite(path) {
		return nil, errors.New("not an SQLite database")
	}
	mode := "rw"
	if readOnly {
		mode = "ro"
	}
	u := url.URL{Scheme: "file", Path: path, RawQuery: "mode=" + mode + "&_pragma=busy_timeout(3000)&_pragma=foreign_keys(1)"}
	d, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	d.SetMaxOpenConns(1) // one connection: transactions and temp state stay together
	if err := d.Ping(); err != nil {
		d.Close()
		return nil, err
	}
	return &Conn{db: d, Path: path, ReadOnly: readOnly}, nil
}

func (c *Conn) Close() error { return c.db.Close() }

// Column describes a table column.
type Column struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	NotNull bool   `json:"notNull"`
	Default string `json:"default,omitempty"`
	PK      int    `json:"pk"` // position in the primary key, 0 = not part of it
}

// SchemaObject is a table, view, index or trigger.
type SchemaObject struct {
	Type      string   `json:"type"`
	Name      string   `json:"name"`
	Table     string   `json:"table,omitempty"` // for indexes and triggers
	SQL       string   `json:"sql"`
	Columns   []Column `json:"columns,omitempty"`
	Rows      int64    `json:"rows"` // -1 when not counted
	RowID     bool     `json:"rowid"`
	Generated []string `json:"generated,omitempty"`
}

// Quote an identifier for SQL.
func Quote(name string) string { return `"` + strings.ReplaceAll(name, `"`, `""`) + `"` }

// Schema lists the objects (tables with columns and row counts).
func (c *Conn) Schema(ctx context.Context) ([]SchemaObject, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	rows, err := c.db.QueryContext(ctx, `SELECT type, name, tbl_name, coalesce(sql, '') FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END, name`)
	if err != nil {
		return nil, err
	}
	var out []SchemaObject
	for rows.Next() {
		var o SchemaObject
		if err := rows.Scan(&o.Type, &o.Name, &o.Table, &o.SQL); err != nil {
			rows.Close()
			return nil, err
		}
		if o.Table == o.Name {
			o.Table = ""
		}
		o.Rows = -1
		out = append(out, o)
	}
	rows.Close()
	for i := range out {
		o := &out[i]
		if o.Type != "table" && o.Type != "view" {
			continue
		}
		cols, err := c.columns(ctx, o.Name)
		if err != nil {
			return nil, err
		}
		o.Columns = cols
		o.RowID = o.Type == "table" && !strings.Contains(strings.ToUpper(o.SQL), "WITHOUT ROWID")
		if o.Type == "table" {
			cctx, cancel := context.WithTimeout(ctx, 2*time.Second)
			_ = c.db.QueryRowContext(cctx, "SELECT count(*) FROM "+Quote(o.Name)).Scan(&o.Rows)
			cancel()
		}
	}
	return out, nil
}

func (c *Conn) columns(ctx context.Context, table string) ([]Column, error) {
	rows, err := c.db.QueryContext(ctx, "SELECT name, type, \"notnull\", coalesce(dflt_value, ''), pk FROM pragma_table_info(?)", table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Column
	for rows.Next() {
		var col Column
		var nn int
		if err := rows.Scan(&col.Name, &col.Type, &nn, &col.Default, &col.PK); err != nil {
			return nil, err
		}
		col.NotNull = nn != 0
		out = append(out, col)
	}
	return out, rows.Err()
}

// Value conversion: text stays text, numbers stay numbers, NULL is nil, blobs
// become a short readable form (not editable as text).
func display(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case []byte:
		if utf8.Valid(x) && len(x) < 4096 {
			return string(x)
		}
		n := min(len(x), 16)
		return fmt.Sprintf("[BLOB %d bytes: %s%s]", len(x), hex.EncodeToString(x[:n]), map[bool]string{true: "…", false: ""}[len(x) > n])
	case time.Time:
		return x.Format(time.RFC3339Nano)
	case float64:
		// Keep REAL values recognisable (37.0, not 37 after JSON).
		if x == math.Trunc(x) && math.Abs(x) < 1e15 {
			return strconv.FormatFloat(x, 'f', 1, 64)
		}
		return strconv.FormatFloat(x, 'g', -1, 64)
	case int64, string, bool:
		return x
	default:
		return fmt.Sprint(x)
	}
}

// Page is a window of rows.
type Page struct {
	Columns []string `json:"columns"`
	Rows    [][]any  `json:"rows"`
	Keys    []any    `json:"keys,omitempty"` // rowid per row (tables with rowids)
	Total   int64    `json:"total"`          // rows matching the filter (-1 when unknown)
	Millis  int64    `json:"millis"`
}

// RowsQuery selects a page of a table or view.
type RowsQuery struct {
	Table  string `json:"table"`
	Where  string `json:"where,omitempty"`  // SQL condition typed by the user
	Search string `json:"search,omitempty"` // text to find in any column
	Order  string `json:"order,omitempty"`  // column name
	Desc   bool   `json:"desc,omitempty"`
	Offset int    `json:"offset"`
	Limit  int    `json:"limit"`
}

func (c *Conn) filter(ctx context.Context, q RowsQuery) (string, []any, error) {
	var conds []string
	var args []any
	if strings.TrimSpace(q.Where) != "" {
		conds = append(conds, "("+q.Where+")")
	}
	if q.Search != "" {
		cols, err := c.columns(ctx, q.Table)
		if err != nil {
			return "", nil, err
		}
		var ors []string
		for _, col := range cols {
			ors = append(ors, "CAST("+Quote(col.Name)+" AS TEXT) LIKE ? ESCAPE '\\'")
			args = append(args, "%"+strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q.Search)+"%")
		}
		if len(ors) > 0 {
			conds = append(conds, "("+strings.Join(ors, " OR ")+")")
		}
	}
	if len(conds) == 0 {
		return "", nil, nil
	}
	return " WHERE " + strings.Join(conds, " AND "), args, nil
}

// Rows returns a page of a table (with rowids when it has them) or view.
func (c *Conn) Rows(ctx context.Context, q RowsQuery) (*Page, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	t0 := time.Now()
	where, args, err := c.filter(ctx, q)
	if err != nil {
		return nil, err
	}
	var withRowID bool
	var sqlText string
	if err := c.db.QueryRowContext(ctx, "SELECT coalesce(sql,'') FROM sqlite_schema WHERE name = ? AND type = 'table'", q.Table).Scan(&sqlText); err == nil {
		withRowID = !strings.Contains(strings.ToUpper(sqlText), "WITHOUT ROWID")
	}
	sel := "*"
	if withRowID {
		sel = "rowid AS \"__hia_rowid\", *"
	}
	order := ""
	if q.Order != "" {
		order = " ORDER BY " + Quote(q.Order)
		if q.Desc {
			order += " DESC"
		}
	} else if withRowID {
		order = " ORDER BY rowid"
	}
	limit := q.Limit
	if limit <= 0 || limit > 5000 {
		limit = 500
	}
	text := "SELECT " + sel + " FROM " + Quote(q.Table) + where + order + " LIMIT ? OFFSET ?"
	rows, err := c.db.QueryContext(ctx, text, append(args, limit, q.Offset)...)
	if err != nil {
		return nil, err
	}
	p, err := collect(rows, withRowID, limit)
	if err != nil {
		return nil, err
	}
	p.Total = -1
	_ = c.db.QueryRowContext(ctx, "SELECT count(*) FROM "+Quote(q.Table)+where, args...).Scan(&p.Total)
	p.Millis = time.Since(t0).Milliseconds()
	return p, nil
}

func collect(rows *sql.Rows, withRowID bool, limit int) (*Page, error) {
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	p := &Page{Columns: cols, Rows: [][]any{}}
	if withRowID {
		p.Columns = cols[1:]
	}
	for rows.Next() && len(p.Rows) < limit {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		for i := range vals {
			vals[i] = display(vals[i])
		}
		if withRowID {
			p.Keys = append(p.Keys, vals[0])
			vals = vals[1:]
		}
		p.Rows = append(p.Rows, vals)
	}
	return p, rows.Err()
}

// Result of one statement in a script.
type Result struct {
	SQL      string `json:"sql"`
	Columns  []string `json:"columns,omitempty"`
	Rows     [][]any  `json:"rows,omitempty"`
	More     bool     `json:"more,omitempty"` // more rows than returned
	Affected int64    `json:"affected"`
	Millis   int64    `json:"millis"`
	Error    string   `json:"error,omitempty"`
}

// Exec runs a script statement by statement (stopping at the first error);
// row-returning statements give up to maxRows rows.
func (c *Conn) Exec(ctx context.Context, script string, maxRows int) []Result {
	c.mu.Lock()
	defer c.mu.Unlock()
	if maxRows <= 0 {
		maxRows = 1000
	}
	var out []Result
	for _, stmt := range SplitStatements(script) {
		t0 := time.Now()
		r := Result{SQL: stmt}
		if returnsRows(stmt) {
			rows, err := c.db.QueryContext(ctx, stmt)
			if err == nil {
				var p *Page
				p, err = collect(rows, false, maxRows+1)
				if err == nil {
					r.Columns = p.Columns
					r.Rows = p.Rows
					if len(r.Rows) > maxRows {
						r.Rows, r.More = r.Rows[:maxRows], true
					}
				}
			}
			if err != nil {
				r.Error = err.Error()
			}
		} else {
			res, err := c.db.ExecContext(ctx, stmt)
			if err != nil {
				r.Error = err.Error()
			} else {
				r.Affected, _ = res.RowsAffected()
			}
		}
		r.Millis = time.Since(t0).Milliseconds()
		out = append(out, r)
		if r.Error != "" {
			break
		}
	}
	return out
}

func returnsRows(stmt string) bool {
	s := strings.ToUpper(strings.TrimLeft(stripComments(stmt), " \t\r\n("))
	for _, p := range []string{"SELECT", "WITH", "PRAGMA", "EXPLAIN", "VALUES"} {
		if strings.HasPrefix(s, p) {
			return true
		}
	}
	return strings.Contains(s, " RETURNING ")
}

func stripComments(s string) string {
	for {
		s = strings.TrimLeft(s, " \t\r\n")
		switch {
		case strings.HasPrefix(s, "--"):
			if i := strings.IndexByte(s, '\n'); i >= 0 {
				s = s[i+1:]
			} else {
				return ""
			}
		case strings.HasPrefix(s, "/*"):
			if i := strings.Index(s, "*/"); i >= 0 {
				s = s[i+2:]
			} else {
				return ""
			}
		default:
			return s
		}
	}
}

// SplitStatements splits a script at semicolons outside quotes, comments and
// trigger bodies (BEGIN … END).
func SplitStatements(script string) []string {
	var out []string
	var b strings.Builder
	depth := 0
	word := strings.Builder{}
	flushWord := func() {
		w := strings.ToUpper(word.String())
		word.Reset()
		switch w {
		case "BEGIN":
			// "BEGIN TRANSACTION" alone isn't a block; only count BEGIN inside CREATE TRIGGER.
			if strings.Contains(strings.ToUpper(b.String()), "TRIGGER") {
				depth++
			}
		case "END":
			if depth > 0 {
				depth--
			}
		}
	}
	rs := []rune(script)
	isWord := func(r rune) bool { return r == '_' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' }
	for i := 0; i < len(rs); i++ {
		ch := rs[i]
		// A keyword ends at the first non-word character: count BEGIN/END before acting on it.
		if !isWord(ch) {
			flushWord()
		}
		switch {
		case ch == '\'' || ch == '"' || ch == '`' || ch == '[':
			flushWord()
			end := ch
			if ch == '[' {
				end = ']'
			}
			b.WriteRune(ch)
			for i++; i < len(rs); i++ {
				b.WriteRune(rs[i])
				if rs[i] == end {
					if end != ']' && i+1 < len(rs) && rs[i+1] == end { // doubled quote
						i++
						b.WriteRune(rs[i])
						continue
					}
					break
				}
			}
			continue
		case ch == '-' && i+1 < len(rs) && rs[i+1] == '-':
			flushWord()
			for ; i < len(rs) && rs[i] != '\n'; i++ {
				b.WriteRune(rs[i])
			}
			if i < len(rs) {
				b.WriteRune('\n')
			}
			continue
		case ch == '/' && i+1 < len(rs) && rs[i+1] == '*':
			flushWord()
			b.WriteString("/*")
			for i += 2; i < len(rs); i++ {
				b.WriteRune(rs[i])
				if rs[i] == '/' && rs[i-1] == '*' {
					break
				}
			}
			continue
		case ch == ';' && depth == 0:
			flushWord()
			if s := strings.TrimSpace(b.String()); s != "" && stripComments(s) != "" {
				out = append(out, s)
			}
			b.Reset()
			continue
		}
		if isWord(ch) {
			word.WriteRune(ch)
		}
		b.WriteRune(ch)
	}
	flushWord()
	if s := strings.TrimSpace(b.String()); s != "" && stripComments(s) != "" {
		out = append(out, s)
	}
	return out
}

// Change is one pending edit from the grid.
type Change struct {
	Table  string         `json:"table"`
	Kind   string         `json:"kind"`             // "update", "insert" or "delete"
	RowID  any            `json:"rowid,omitempty"`  // update/delete: the row's rowid
	Values map[string]any `json:"values,omitempty"` // update/insert: column → value (nil = NULL)
}

// Apply writes changes in one transaction (all or nothing).
func (c *Conn) Apply(ctx context.Context, changes []Change) error {
	if c.ReadOnly {
		return errors.New("the database is open read-only")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, ch := range changes {
		var q string
		var args []any
		keys := make([]string, 0, len(ch.Values))
		for k := range ch.Values {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		switch ch.Kind {
		case "update":
			if len(keys) == 0 {
				continue
			}
			var sets []string
			for _, k := range keys {
				sets = append(sets, Quote(k)+" = ?")
				args = append(args, ch.Values[k])
			}
			q = "UPDATE " + Quote(ch.Table) + " SET " + strings.Join(sets, ", ") + " WHERE rowid = ?"
			args = append(args, ch.RowID)
		case "insert":
			if len(keys) == 0 {
				q = "INSERT INTO " + Quote(ch.Table) + " DEFAULT VALUES"
			} else {
				var cols, marks []string
				for _, k := range keys {
					cols = append(cols, Quote(k))
					marks = append(marks, "?")
					args = append(args, ch.Values[k])
				}
				q = "INSERT INTO " + Quote(ch.Table) + " (" + strings.Join(cols, ", ") + ") VALUES (" + strings.Join(marks, ", ") + ")"
			}
		case "delete":
			q = "DELETE FROM " + Quote(ch.Table) + " WHERE rowid = ?"
			args = append(args, ch.RowID)
		default:
			return fmt.Errorf("change %d: unknown kind %q", i+1, ch.Kind)
		}
		if _, err := tx.ExecContext(ctx, q, args...); err != nil {
			return fmt.Errorf("change %d (%s %s): %w", i+1, ch.Kind, ch.Table, err)
		}
	}
	return tx.Commit()
}

// ExportCSV writes a table (with the filter) or a query's rows to w.
func (c *Conn) ExportCSV(ctx context.Context, q RowsQuery, query string, w io.Writer) (int64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var rows *sql.Rows
	var err error
	if query != "" {
		rows, err = c.db.QueryContext(ctx, query)
	} else {
		where, args, ferr := c.filter(ctx, q)
		if ferr != nil {
			return 0, ferr
		}
		order := ""
		if q.Order != "" {
			order = " ORDER BY " + Quote(q.Order)
			if q.Desc {
				order += " DESC"
			}
		}
		rows, err = c.db.QueryContext(ctx, "SELECT * FROM "+Quote(q.Table)+where+order, args...)
	}
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	cw := csv.NewWriter(w)
	if err := cw.Write(cols); err != nil {
		return 0, err
	}
	var n int64
	vals := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	rec := make([]string, len(cols))
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return n, err
		}
		for i, v := range vals {
			switch x := v.(type) {
			case nil:
				rec[i] = ""
			case []byte:
				rec[i] = string(x)
			case float64:
				rec[i] = strconv.FormatFloat(x, 'g', -1, 64)
			default:
				rec[i] = fmt.Sprint(display(x))
			}
		}
		if err := cw.Write(rec); err != nil {
			return n, err
		}
		n++
	}
	cw.Flush()
	return n, cw.Error()
}
