package app

import (
	"path/filepath"
	"strings"

	"github.com/caffeine-runtime/hold-it-all/internal/office"
)

// --- spreadsheets ---

func (a *App) SheetOpen(path string) (office.BookInfo, error) { return a.books.Open(path) }
func (a *App) SheetRows(id, sheet string, start, end, cols int) ([][]string, error) {
	return a.books.Rows(id, sheet, start, end, cols)
}
func (a *App) SheetCell(id, sheet string, row, col int) (office.CellInfo, error) {
	return a.books.Cell(id, sheet, row, col)
}
func (a *App) SheetSet(id, sheet string, row, col int, input string) (string, error) {
	return a.books.SetCell(id, sheet, row, col, input)
}
func (a *App) SheetSetCells(id, sheet string, cells []office.CellEdit, clear []office.CellRange) ([]office.CellEdit, error) {
	return a.books.SetCells(id, sheet, cells, clear)
}
func (a *App) SheetInputs(id, sheet string, r0, r1, c0, c1 int) ([][]string, error) {
	return a.books.Inputs(id, sheet, r0, r1, c0, c1)
}
func (a *App) SheetComplete(id, sheet string, col int, typed string) (string, error) {
	return a.books.Complete(id, sheet, col, typed)
}
func (a *App) SheetInsertRow(id, sheet string, row int) error {
	return a.books.InsertRow(id, sheet, row)
}
func (a *App) SheetDeleteRow(id, sheet string, row int) error {
	return a.books.DeleteRow(id, sheet, row)
}
func (a *App) SheetAddSheet(id, name string) error        { return a.books.AddSheet(id, name) }
func (a *App) SheetRenameSheet(id, from, to string) error { return a.books.RenameSheet(id, from, to) }
func (a *App) SheetClose(id string)                       { a.books.Close(id) }

func (a *App) SheetSave(id, path string) error {
	if err := a.books.Save(id, path); err != nil {
		return err
	}
	if a.watcher != nil {
		a.watcher.NoteOwnWrite(path)
	}
	return nil
}

// --- word documents ---

// DocOpenResult is a document ready for the editor. For legacy .doc files
// SaveAs names the .docx that saving will create.
type DocOpenResult struct {
	Document string                `json:"document"`
	Styles   map[string]string     `json:"styles"`
	Rels     []office.Relationship `json:"rels"`
	SaveAs   string                `json:"saveAs"`
	Note     string                `json:"note"`
	Template bool                  `json:"template"` // saving builds a new package (no source .docx)
}

func (a *App) DocOpen(path string) (DocOpenResult, error) {
	if strings.EqualFold(filepath.Ext(path), ".doc") {
		paras, err := office.ReadDoc(path)
		if err != nil {
			return DocOpenResult{}, err
		}
		doc := office.ParagraphsToDocument(paras)
		return DocOpenResult{
			Document: doc,
			Styles:   map[string]string{"Normal": "normal", "Heading1": "heading 1", "Heading2": "heading 2", "Heading3": "heading 3"},
			SaveAs:   strings.TrimSuffix(path, filepath.Ext(path)) + ".docx",
			Note:     "Legacy .doc: the text is editable, and saving creates a new .docx next to it (images, tables and most formatting from the .doc are not carried over).",
			Template: true,
		}, nil
	}
	pkg, err := office.ReadDocx(path)
	return DocOpenResult{Document: pkg.Document, Styles: pkg.Styles, Rels: pkg.Rels}, err
}

// DocSave writes document.xml into a .docx at dst. src is the package to
// copy the other parts from ("" builds a new package).
func (a *App) DocSave(dst, src, document string) error {
	if src != "" && filepath.Clean(src) == filepath.Clean(dst) {
		// Reading and replacing the same file: copy the source aside first.
		tmp := a.TempPath(filepath.Base(src))
		if err := copyAtomic(src, tmp); err != nil {
			return err
		}
		defer a.RemoveTemp(tmp)
		src = tmp
	}
	if err := office.WriteDocx(dst, src, document); err != nil {
		return err
	}
	if a.watcher != nil {
		a.watcher.NoteOwnWrite(dst)
	}
	return nil
}
