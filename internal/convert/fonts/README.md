# Fonts embedded in converted PDFs

| File | Font | License | Changes |
|---|---|---|---|
| `Inter-Regular.ttf`, `Inter-Bold.ttf`, `Inter-Italic.ttf`, `Inter-BoldItalic.ttf` | [Inter](https://github.com/rsms/inter) 4.1 (static TTFs from `extras/ttf/`) | SIL OFL 1.1 (`Inter-OFL.txt`), no reserved font name | subset (below) |
| `SourceSerif4-Semibold.ttf` | [Source Serif 4](https://github.com/adobe-fonts/source-serif) 4.005 (`TTF/`) | SIL OFL 1.1 (`SourceSerif4-OFL.md`), reserved font name "Source" | **none**: the reserved name means a modified copy would need another name, so the file is the original |
| `JetBrainsMono-Regular.ttf` | [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) 2.304 | SIL OFL 1.1 (`JetBrainsMono-OFL.txt`), no reserved font name | subset (below) |

The PDF writer (`../pdf.go`, go-pdf/fpdf) embeds only the characters a document uses. The subsets keep Latin
(with Vietnamese), Greek, Cyrillic, punctuation, currency, arrows, maths and box drawing, and drop hinting and
OpenType features, which fpdf doesn't use:

```sh
pip install fonttools
U="U+0020-007E,U+00A0-024F,U+0300-036F,U+0370-03FF,U+0400-04FF,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2200-22FF,U+2500-257F,U+25A0-25FF,U+2610-2612,U+2713-2714,U+FFFD"
for f in Inter-Regular Inter-Bold Inter-Italic Inter-BoldItalic JetBrainsMono-Regular; do
  pyftsubset "$f.ttf" --unicodes="$U" --layout-features='' --no-hinting --desubroutinize --name-IDs='*' --output-file="internal/convert/fonts/$f.ttf"
done
```

Text in other scripts (Chinese, Japanese, Korean, Arabic, Hebrew, Indic…) and emoji has no glyphs in these fonts;
the converter says so when a document contains it (`missingGlyphs` in `../pdf.go`).
