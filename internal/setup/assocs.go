package setup

//go:generate go run ./gen

// Assocs are the file types from wails.json (info.fileAssociations); kept in
// sync by go generate and checked by TestAssocsMatchWailsJSON.
var Assocs = assocs
