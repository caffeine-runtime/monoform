package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"sync"
	"time"

	"github.com/caffeine-runtime/monoform/internal/db"
	"github.com/caffeine-runtime/monoform/internal/fs"
)

// Open database files, by handle (one per tab).
var dbs = struct {
	sync.Mutex
	m   map[int]*db.Conn
	seq int
}{m: map[int]*db.Conn{}}

func dbConn(id int) (*db.Conn, error) {
	dbs.Lock()
	defer dbs.Unlock()
	c := dbs.m[id]
	if c == nil {
		return nil, errors.New("the database is closed")
	}
	return c, nil
}

// DBOpened is an open database: its handle and schema.
type DBOpened struct {
	ID       int               `json:"id"`
	ReadOnly bool              `json:"readOnly"`
	Objects  []db.SchemaObject `json:"objects"`
}

// DBOpen opens an SQLite file (read-only when asked or when it can't be written).
func (a *App) DBOpen(path string, readOnly bool) (*DBOpened, error) {
	if !filepath.IsAbs(path) {
		return nil, errors.New("absolute path required")
	}
	c, err := db.Open(path, readOnly)
	if err != nil && !readOnly {
		c, err = db.Open(path, true)
	}
	if err != nil {
		return nil, err
	}
	objs, err := c.Schema(context.Background())
	if err != nil {
		c.Close()
		return nil, err
	}
	dbs.Lock()
	dbs.seq++
	id := dbs.seq
	dbs.m[id] = c
	dbs.Unlock()
	return &DBOpened{ID: id, ReadOnly: c.ReadOnly, Objects: objs}, nil
}

func (a *App) DBSchema(id int) ([]db.SchemaObject, error) {
	c, err := dbConn(id)
	if err != nil {
		return nil, err
	}
	return c.Schema(context.Background())
}

func (a *App) DBRows(id int, q db.RowsQuery) (*db.Page, error) {
	c, err := dbConn(id)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return c.Rows(ctx, q)
}

// DBExec runs SQL (statement by statement) and returns each result.
func (a *App) DBExec(id int, script string, maxRows int) ([]db.Result, error) {
	c, err := dbConn(id)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	return c.Exec(ctx, script, maxRows), nil
}

// DBApply writes edits from the grid in one transaction.
func (a *App) DBApply(id int, changes []db.Change) error {
	c, err := dbConn(id)
	if err != nil {
		return err
	}
	if a.watcher != nil {
		a.watcher.NoteOwnWrite(c.Path)
	}
	return c.Apply(context.Background(), changes)
}

// DBExportCSV writes a table (with its filter) or a query to a CSV file; returns the row count.
func (a *App) DBExportCSV(id int, q db.RowsQuery, query, dest string) (int64, error) {
	c, err := dbConn(id)
	if err != nil {
		return 0, err
	}
	if !filepath.IsAbs(dest) {
		return 0, errors.New("absolute path required")
	}
	var n int64
	err = fs.AtomicWrite(dest, func(w io.Writer) error {
		var e error
		n, e = c.ExportCSV(context.Background(), q, query, w)
		return e
	})
	if err != nil {
		return 0, fmt.Errorf("export: %w", err)
	}
	return n, nil
}

func (a *App) DBClose(id int) {
	dbs.Lock()
	c := dbs.m[id]
	delete(dbs.m, id)
	dbs.Unlock()
	if c != nil {
		c.Close()
	}
}
