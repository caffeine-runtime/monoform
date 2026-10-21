package ai

import (
	"context"
	"fmt"
	"math"
)

// SubjectSize is the side of the square picture BiRefNet takes.
const SubjectSize = 1024

// SubjectMask finds the main subject: rgb is SubjectSize² pixels (3 bytes
// each, the picture stretched to the square); the result is one byte of
// opacity per pixel (255: subject).
func (e *Engine) SubjectMask(ctx context.Context, rgb []byte) ([]byte, error) {
	const n = SubjectSize * SubjectSize
	if len(rgb) != 3*n {
		return nil, fmt.Errorf("expected %d bytes of RGB, got %d", 3*n, len(rgb))
	}
	stop, end := e.begin(ctx)
	defer end()
	s, err := e.session(Subject, "birefnet-lite-1024.onnx")
	if err != nil {
		return nil, err
	}
	// ImageNet normalisation, CHW.
	mean := [3]float32{0.485, 0.456, 0.406}
	std := [3]float32{0.229, 0.224, 0.225}
	x := make([]float32, 3*n)
	for i := 0; i < n; i++ {
		for c := 0; c < 3; c++ {
			x[c*n+i] = (float32(rgb[3*i+c])/255 - mean[c]) / std[c]
		}
	}
	out, err := s.Run(map[string]Tensor{"input_image": {Shape: []int64{1, 3, SubjectSize, SubjectSize}, Float32: x}}, []string{"output_image"}, stop)
	if err != nil {
		return nil, cancelled(ctx, err)
	}
	logits := out["output_image"].Float32
	if len(logits) != n {
		return nil, fmt.Errorf("unexpected output size %d", len(logits))
	}
	mask := make([]byte, n)
	for i, v := range logits {
		mask[i] = byte(math.Round(255 / (1 + math.Exp(-float64(v)))))
	}
	return mask, nil
}
