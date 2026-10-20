package pdf

// PDF tools beyond page operations: compress (recompress images, clean up),
// stamp images into pages (signatures), replace pages with an image of
// themselves (redaction that really removes the content) and build a PDF
// from images.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"os"
	"sort"
	"strconv"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
	"golang.org/x/image/draw"
)

func readCtx(c context.Context, path string) (*model.Context, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	cf := conf()
	return api.ReadValidateAndOptimize(c, f, cf, nil)
}

func writeCtx(c context.Context, ctx *model.Context, dst string) error {
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	if err := api.Write(c, ctx, f, ctx.Conf); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// ---------- compress ----------

// CompressResult reports what Compress did.
type CompressResult struct {
	Before       int64 `json:"before"`
	After        int64 `json:"after"`
	Images       int   `json:"images"`
	Recompressed int   `json:"recompressed"`
}

// Compress rewrites src to dst with images recompressed as JPEG at quality
// (1–100), downscaled so their long edge is at most maxPx (0 = keep size),
// and the file structure cleaned up (duplicate objects merged, unused ones
// dropped, object streams). quality 0 only cleans up (lossless). An image is
// replaced only when the result is clearly smaller.
func Compress(c context.Context, src, dst string, quality, maxPx int) (CompressResult, error) {
	var res CompressResult
	if st, err := os.Stat(src); err == nil {
		res.Before = st.Size()
	}
	ctx, err := readCtx(c, src)
	if err != nil {
		return res, fmt.Errorf("reading PDF: %w", err)
	}
	if quality > 0 {
		nums := make([]int, 0, len(ctx.XRefTable.Table))
		for n := range ctx.XRefTable.Table {
			nums = append(nums, n)
		}
		sort.Ints(nums)
		for _, n := range nums {
			if err := c.Err(); err != nil {
				return res, err
			}
			e := ctx.XRefTable.Table[n]
			if e == nil || e.Free || e.Object == nil {
				continue
			}
			sd, ok := e.Object.(types.StreamDict)
			if !ok || sd.Dict.NameEntry("Subtype") == nil || *sd.Dict.NameEntry("Subtype") != "Image" {
				continue
			}
			res.Images++
			if out, ok := recompress(ctx.XRefTable, sd, quality, maxPx); ok {
				e.Object = out
				res.Recompressed++
			}
		}
	}
	ctx.Conf.WriteObjectStream = true
	ctx.Conf.WriteXRefStream = true
	if err := api.OptimizeContext(c, ctx); err != nil {
		return res, err
	}
	if err := writeCtx(c, ctx, dst); err != nil {
		return res, err
	}
	if st, err := os.Stat(dst); err == nil {
		res.After = st.Size()
	}
	return res, nil
}

// recompress returns sd as a smaller JPEG image stream, or false when it
// can't be decoded safely or wouldn't get smaller.
func recompress(xt *model.XRefTable, sd types.StreamDict, quality, maxPx int) (types.StreamDict, bool) {
	d := sd.Dict
	if b := d.BooleanEntry("ImageMask"); b != nil && *b {
		return sd, false
	}
	if bpc := d.IntEntry("BitsPerComponent"); bpc == nil || *bpc != 8 {
		return sd, false
	}
	w, h := d.IntEntry("Width"), d.IntEntry("Height")
	if w == nil || h == nil || *w < 16 || *h < 16 || *w > 20000 || *h > 20000 {
		return sd, false
	}
	comps := components(xt, d)
	if comps != 1 && comps != 3 {
		return sd, false // CMYK, Indexed, Lab, DeviceN… are left alone
	}
	if len(sd.FilterPipeline) != 1 {
		return sd, false
	}
	var img image.Image
	switch sd.FilterPipeline[0].Name {
	case "DCTDecode":
		if d.ArrayEntry("Decode") != nil {
			return sd, false
		}
		m, err := jpeg.Decode(bytes.NewReader(sd.Raw))
		if err != nil {
			return sd, false
		}
		img = m
	case "FlateDecode":
		if err := sd.Decode(); err != nil || len(sd.Content) < *w**h*comps {
			return sd, false
		}
		img = samples(sd.Content, *w, *h, comps)
	default:
		return sd, false
	}
	b := img.Bounds()
	if long := max(b.Dx(), b.Dy()); maxPx > 0 && long > maxPx {
		nw := max(1, b.Dx()*maxPx/long)
		nh := max(1, b.Dy()*maxPx/long)
		var dstImg draw.Image
		if comps == 1 {
			dstImg = image.NewGray(image.Rect(0, 0, nw, nh))
		} else {
			dstImg = image.NewRGBA(image.Rect(0, 0, nw, nh))
		}
		draw.CatmullRom.Scale(dstImg, dstImg.Bounds(), img, b, draw.Src, nil)
		img = dstImg
	} else if comps == 1 {
		if _, gray := img.(*image.Gray); !gray {
			g := image.NewGray(b)
			draw.Draw(g, b, img, b.Min, draw.Src)
			img = g
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return sd, false
	}
	if int64(buf.Len()) > int64(len(sd.Raw))*9/10 {
		return sd, false
	}
	out := sd
	out.Dict = d.Clone().(types.Dict)
	out.Raw = buf.Bytes()
	out.Content = nil
	out.FilterPipeline = []types.PDFFilter{{Name: "DCTDecode"}}
	out.Dict["Filter"] = types.Name("DCTDecode")
	delete(out.Dict, "DecodeParms")
	nb := img.Bounds()
	out.Dict["Width"] = types.Integer(nb.Dx())
	out.Dict["Height"] = types.Integer(nb.Dy())
	l := int64(buf.Len())
	out.StreamLength = &l
	out.StreamLengthObjNr = nil
	out.Dict["Length"] = types.Integer(l)
	return out, true
}

// components of an image's colour space (0 when unsupported).
func components(xt *model.XRefTable, d types.Dict) int {
	o, err := xt.Dereference(d["ColorSpace"])
	if err != nil || o == nil {
		return 0
	}
	switch cs := o.(type) {
	case types.Name:
		switch cs {
		case "DeviceGray", "CalGray":
			return 1
		case "DeviceRGB", "CalRGB":
			return 3
		}
	case types.Array:
		if len(cs) == 2 {
			if n, ok := cs[0].(types.Name); ok && n == "ICCBased" {
				if s, _, err := xt.DereferenceStreamDict(cs[1]); err == nil && s != nil {
					if v := s.Dict.IntEntry("N"); v != nil {
						return *v
					}
				}
			}
		}
	}
	return 0
}

func samples(b []byte, w, h, comps int) image.Image {
	if comps == 1 {
		g := image.NewGray(image.Rect(0, 0, w, h))
		copy(g.Pix, b[:w*h])
		return g
	}
	m := image.NewRGBA(image.Rect(0, 0, w, h))
	for i, j := 0, 0; i < w*h; i, j = i+1, j+3 {
		m.Pix[i*4], m.Pix[i*4+1], m.Pix[i*4+2], m.Pix[i*4+3] = b[j], b[j+1], b[j+2], 255
	}
	return m
}

// ---------- stamping and page replacement ----------

// Stamp places an image (PNG or JPEG file; PNG transparency is kept) on a
// page. M maps the image's unit square to the page's default user space
// (a b c d e f, as for the "cm" operator), so any rotation works.
type Stamp struct {
	Page  int        `json:"page"`
	Image string     `json:"image"`
	M     [6]float64 `json:"m"`
}

func newStream(ctx *model.Context, content string) (*types.IndirectRef, error) {
	sd, err := ctx.XRefTable.NewStreamDictForBuf([]byte(content))
	if err != nil {
		return nil, err
	}
	if err := sd.Encode(); err != nil {
		return nil, err
	}
	return ctx.XRefTable.IndRefForNewObject(*sd)
}

func imageRef(ctx *model.Context, path string) (*types.IndirectRef, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	ref, _, _, err := model.CreateImageResource(ctx.XRefTable, f)
	return ref, err
}

func num(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

func cm(m [6]float64) string {
	return fmt.Sprintf("%s %s %s %s %s %s cm", num(m[0]), num(m[1]), num(m[2]), num(m[3]), num(m[4]), num(m[5]))
}

// StampImages draws images on pages (in front of the existing content).
func StampImages(c context.Context, src, dst string, stamps []Stamp) error {
	if len(stamps) == 0 {
		return errors.New("nothing to place")
	}
	ctx, err := readCtx(c, src)
	if err != nil {
		return fmt.Errorf("reading PDF: %w", err)
	}
	byPage := map[int][]Stamp{}
	for _, s := range stamps {
		if s.Page < 1 || s.Page > ctx.PageCount {
			return fmt.Errorf("page %d out of range (1-%d)", s.Page, ctx.PageCount)
		}
		byPage[s.Page] = append(byPage[s.Page], s)
	}
	seq := 0
	for page, list := range byPage {
		d, _, inh, err := ctx.PageDict(c, page, false)
		if err != nil {
			return err
		}
		xo, err := pageXObjects(ctx, d, inh)
		if err != nil {
			return err
		}
		body := "Q\n"
		for _, s := range list {
			ref, err := imageRef(ctx, s.Image)
			if err != nil {
				return fmt.Errorf("image: %w", err)
			}
			var name string
			for {
				seq++
				name = "HiaImg" + strconv.Itoa(seq)
				if _, taken := xo[name]; !taken {
					break
				}
			}
			xo[name] = *ref
			body += "q " + cm(s.M) + " /" + name + " Do Q\n"
		}
		// Wrap the existing content in q…Q so its graphics state can't leak into ours.
		pre, err := newStream(ctx, "q\n")
		if err != nil {
			return err
		}
		post, err := newStream(ctx, body)
		if err != nil {
			return err
		}
		arr := types.Array{*pre}
		switch v := d["Contents"].(type) {
		case types.IndirectRef:
			o, _ := ctx.Dereference(v)
			if a, ok := o.(types.Array); ok {
				arr = append(arr, a...)
			} else {
				arr = append(arr, v)
			}
		case types.Array:
			arr = append(arr, v...)
		}
		d["Contents"] = append(arr, *post)
	}
	return writeCtx(c, ctx, dst)
}

// pageXObjects returns the page's own XObject resource dict (creating it, and
// the page's own Resources copied from inherited ones, when needed).
func pageXObjects(ctx *model.Context, d types.Dict, inh *model.InheritedPageAttrs) (types.Dict, error) {
	var res types.Dict
	if r, ok := d["Resources"]; ok {
		rd, err := ctx.DereferenceDict(r)
		if err != nil {
			return nil, err
		}
		res = rd
	}
	if res == nil {
		if inh != nil && inh.Resources != nil {
			res = inh.Resources.Clone().(types.Dict)
		} else {
			res = types.NewDict()
		}
		d["Resources"] = res
	}
	xo, err := ctx.DereferenceDict(res["XObject"])
	if err != nil {
		return nil, err
	}
	if xo == nil {
		xo = types.NewDict()
		res["XObject"] = xo
	}
	return xo, nil
}

// PageImage replaces a page's content with an image (M maps the image's unit
// square to user space, normally the page's visible box).
type PageImage struct {
	Page  int        `json:"page"`
	Image string     `json:"image"`
	M     [6]float64 `json:"m"`
}

// ReplaceWithImages replaces the content of pages with images of them —
// redaction that removes the text, images and annotations underneath.
func ReplaceWithImages(c context.Context, src, dst string, pages []PageImage) error {
	if len(pages) == 0 {
		return errors.New("no pages")
	}
	ctx, err := readCtx(c, src)
	if err != nil {
		return fmt.Errorf("reading PDF: %w", err)
	}
	for _, p := range pages {
		if p.Page < 1 || p.Page > ctx.PageCount {
			return fmt.Errorf("page %d out of range (1-%d)", p.Page, ctx.PageCount)
		}
		d, _, _, err := ctx.PageDict(c, p.Page, false)
		if err != nil {
			return err
		}
		ref, err := imageRef(ctx, p.Image)
		if err != nil {
			return fmt.Errorf("image: %w", err)
		}
		content, err := newStream(ctx, "q "+cm(p.M)+" /HiaPage Do Q\n")
		if err != nil {
			return err
		}
		d["Contents"] = *content
		d["Resources"] = types.Dict{"XObject": types.Dict{"HiaPage": *ref}}
		for _, k := range []string{"Annots", "Group", "Thumb", "StructParents", "PieceInfo", "B"} {
			delete(d, k)
		}
	}
	return writeCtx(c, ctx, dst)
}

// ---------- images → PDF ----------

// FromImages builds a PDF with one page per image (JPEG, PNG, TIFF, WebP).
// size is "image" (pages the size of each image at 72 dpi, or at the image's
// own dpi when it has one), or a paper size like "A4" / "Letter" (images
// centred and fitted with a margin).
func FromImages(c context.Context, files []string, dst, size string) error {
	if len(files) == 0 {
		return errors.New("no images")
	}
	var imp *pdfcpu.Import
	if size == "" || size == "image" {
		imp = api.DefaultImportConfig()
		imp.Pos = types.Full
	} else {
		var err error
		imp, err = api.Import("form:"+size+", pos:c, sc:0.92 rel", types.POINTS)
		if err != nil {
			return err
		}
	}
	return api.ImportImagesFile(c, files, dst, imp, conf())
}
