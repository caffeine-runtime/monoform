package app

import (
	"context"
	"time"

	"github.com/caffeine-runtime/monoform/internal/notes"
)

// NoteIndex lists the Markdown notes under root with their links and
// headings, for the editor's backlinks, outline of other notes and
// [[wiki link]] resolution. Unchanged notes come from memory.
func (a *App) NoteIndex(root string) (notes.Index, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	show := false
	if a.Settings != nil {
		show = a.Settings.Get().ShowHidden
	}
	return a.notes.Scan(ctx, root, show)
}
