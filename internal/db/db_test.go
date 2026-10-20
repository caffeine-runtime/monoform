package db

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "shop.db")
	d, err := sql.Open("sqlite", "file:"+p)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	for _, q := range []string{
		`CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT, note BLOB)`,
		`CREATE TABLE tags (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID`,
		`CREATE INDEX idx_city ON customers(city)`,
		`CREATE VIEW warsaw AS SELECT name FROM customers WHERE city = 'Warsaw'`,
		`CREATE TABLE log (msg TEXT)`,
		`CREATE TRIGGER t_ins AFTER INSERT ON customers BEGIN INSERT INTO log VALUES ('added ' || new.name); END`,
		`INSERT INTO customers (name, city, note) VALUES ('Ala', 'Warsaw', NULL), ('Bob', 'Berlin', x'00ff'), ('Cyd', 'Warsaw', 'hi'), ('Dan', NULL, NULL)`,
		`INSERT INTO tags VALUES ('a', '1')`,
	} {
		if _, err := d.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	return p
}

func TestSchemaAndRows(t *testing.T) {
	ctx := context.Background()
	c, err := Open(fixture(t), false)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	objs, err := c.Schema(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, o := range objs {
		names = append(names, o.Type+":"+o.Name)
	}
	if got := strings.Join(names, ","); got != "table:customers,table:log,table:tags,view:warsaw,index:idx_city,trigger:t_ins" {
		t.Fatalf("schema %s", got)
	}
	cu := objs[0]
	if cu.Rows != 4 || !cu.RowID || len(cu.Columns) != 4 || cu.Columns[0].PK != 1 || !cu.Columns[1].NotNull {
		t.Errorf("customers %+v", cu)
	}
	if objs[2].RowID || objs[2].Rows != 1 {
		t.Errorf("WITHOUT ROWID table %+v", objs[2])
	}

	p, err := c.Rows(ctx, RowsQuery{Table: "customers", Order: "name", Desc: true, Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if p.Total != 4 || len(p.Rows) != 2 || p.Rows[0][1] != "Dan" || p.Rows[0][2] != nil || len(p.Keys) != 2 || strings.Join(p.Columns, ",") != "id,name,city,note" {
		t.Errorf("page %+v", p)
	}
	p, _ = c.Rows(ctx, RowsQuery{Table: "customers", Offset: 1, Limit: 1})
	if s, _ := p.Rows[0][3].(string); !strings.HasPrefix(s, "[BLOB 2 bytes: 00ff") {
		t.Errorf("blob shown as %v", p.Rows[0][3])
	}
	p, _ = c.Rows(ctx, RowsQuery{Table: "customers", Where: "city = 'Warsaw'", Search: "cy", Limit: 10})
	if p.Total != 1 || p.Rows[0][1] != "Cyd" {
		t.Errorf("filtered %+v", p)
	}
	if _, err := c.Rows(ctx, RowsQuery{Table: "customers", Where: "nonsense ==="}); err == nil {
		t.Error("bad filter accepted")
	}
	p, _ = c.Rows(ctx, RowsQuery{Table: "warsaw", Limit: 10})
	if p.Total != 2 || p.Keys != nil {
		t.Errorf("view %+v", p)
	}
}

func TestExecAndApply(t *testing.T) {
	ctx := context.Background()
	path := fixture(t)
	c, _ := Open(path, false)
	defer c.Close()
	res := c.Exec(ctx, "-- count\nSELECT count(*) AS n FROM customers; UPDATE customers SET city = 'Krakow' WHERE name = 'Dan'; SELECT * FROM nope; SELECT 1", 100)
	if len(res) != 3 || res[0].Rows[0][0] != int64(4) || res[0].Columns[0] != "n" || res[1].Affected != 1 || res[2].Error == "" {
		t.Fatalf("exec %+v", res)
	}
	big := c.Exec(ctx, "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 50) SELECT i FROM n", 10)
	if len(big[0].Rows) != 10 || !big[0].More {
		t.Errorf("row cap %+v", big[0])
	}
	// Edits in one transaction; a failing one rolls all back.
	err := c.Apply(ctx, []Change{
		{Table: "customers", Kind: "update", RowID: int64(1), Values: map[string]any{"name": "Alicja", "city": nil}},
		{Table: "customers", Kind: "insert", Values: map[string]any{"name": "Eve"}},
		{Table: "customers", Kind: "delete", RowID: int64(2)},
	})
	if err != nil {
		t.Fatal(err)
	}
	r := c.Exec(ctx, "SELECT group_concat(name || ':' || coalesce(city, '-'), ',') FROM customers; SELECT count(*) FROM log", 10)
	if r[0].Rows[0][0] != "Alicja:-,Cyd:Warsaw,Dan:Krakow,Eve:-" || r[1].Rows[0][0] != int64(5) { // 4 fixture rows + Eve, logged by the trigger
		t.Errorf("after apply %v / log %v", r[0].Rows, r[1].Rows)
	}
	err = c.Apply(ctx, []Change{
		{Table: "customers", Kind: "update", RowID: int64(1), Values: map[string]any{"name": "X"}},
		{Table: "customers", Kind: "insert", Values: map[string]any{"city": "no name"}}, // NOT NULL fails
	})
	if err == nil || c.Exec(ctx, "SELECT name FROM customers WHERE rowid = 1", 1)[0].Rows[0][0] != "Alicja" {
		t.Errorf("not rolled back: %v", err)
	}
	ro, _ := Open(path, true)
	defer ro.Close()
	if err := ro.Apply(ctx, []Change{{Table: "customers", Kind: "delete", RowID: int64(1)}}); err == nil {
		t.Error("read-only accepted a change")
	}
	if r := ro.Exec(ctx, "DELETE FROM customers", 1); r[0].Error == "" {
		t.Error("read-only connection wrote")
	}
}

func TestExportAndSplit(t *testing.T) {
	ctx := context.Background()
	c, _ := Open(fixture(t), false)
	defer c.Close()
	var b strings.Builder
	n, err := c.ExportCSV(ctx, RowsQuery{Table: "customers", Order: "name"}, "", &b)
	if err != nil || n != 4 || !strings.HasPrefix(b.String(), "id,name,city,note\n1,Ala,Warsaw,\n") {
		t.Errorf("csv %d %v %q", n, err, b.String())
	}
	got := SplitStatements("SELECT ';' AS a; -- x; y\nCREATE TRIGGER t AFTER INSERT ON c BEGIN SELECT 1; SELECT 2; END; /* ; */ SELECT \"a;b\"")
	if len(got) != 3 || !strings.HasSuffix(got[1], "END") || !strings.Contains(got[2], `"a;b"`) {
		t.Errorf("split %q", got)
	}
	if !IsSQLite(c.Path) || IsSQLite("db.go") {
		t.Error("IsSQLite")
	}
}
