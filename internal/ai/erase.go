package ai

import (
	"context"
	"fmt"
	"math"
	"math/rand/v2"
)

// EraseSize is the side of the square Moebius paints (its cross-attention
// is tied to this size): the caller crops around the selection, scales the
// crop to it and pastes the result back.
const EraseSize = 512

// EraseSteps is the number of denoising steps. The reference pipeline uses
// 19 with classifier-free guidance (38 UNet passes, ~2 minutes on 4 CPU
// cores). 5 steps without guidance give the same removals in our tests in
// ~25 s, provided the first step starts at the noisiest level (999): steps
// spaced the reference way start lower (750 for 4 steps), which the model
// can't do from pure noise, and it paints a new object into the gap.
const EraseSteps = 5

const (
	latent     = EraseSize / 8
	vaeScale   = 0.13025 // Moebius's VAE, not Stable Diffusion's 0.18215
	trainSteps = 1000
	betaStart  = 0.00085
	betaEnd    = 0.012
)

// Erase fills the masked area of a picture: rgb is EraseSize² pixels (3
// bytes each), mask one byte per pixel (≥128: remove). It returns the
// repainted square (the caller keeps the original outside the mask).
// progress gets units done/total; seed picks the noise (another seed gives
// another fill).
func (e *Engine) Erase(ctx context.Context, rgb, mask []byte, seed uint64, progress func(done, total int)) ([]byte, error) {
	const n = EraseSize * EraseSize
	if len(rgb) != 3*n || len(mask) != n {
		return nil, fmt.Errorf("expected %d bytes of RGB and %d of mask", 3*n, n)
	}
	stop, end := e.begin(ctx)
	defer end()
	// Cost units, roughly seconds on 4 cores: encode 4, each step 3, decode 8.
	total := 4 + 3*EraseSteps + 8
	report := func(d int) {
		if progress != nil {
			progress(d, total)
		}
	}
	report(0)
	enc, err := e.session(Eraser, "vae_encoder.onnx")
	if err != nil {
		return nil, err
	}
	// The picture with the area to remove blanked (grey), in [-1, 1], CHW.
	masked := make([]float32, 3*n)
	for i := 0; i < n; i++ {
		keep := float32(1)
		if mask[i] >= 128 {
			keep = 0
		}
		for c := 0; c < 3; c++ {
			masked[c*n+i] = (float32(rgb[3*i+c])/127.5 - 1) * keep
		}
	}
	out, err := enc.Run(map[string]Tensor{"image": {Shape: []int64{1, 3, EraseSize, EraseSize}, Float32: masked}}, []string{"moments"}, stop)
	if err != nil {
		return nil, cancelled(ctx, err)
	}
	const ln = latent * latent
	maskedLatent := make([]float32, 4*ln)
	for i := range maskedLatent { // the mean half of the moments
		maskedLatent[i] = out["moments"].Float32[i] * vaeScale
	}
	// The mask at latent size: a latent pixel is masked if any of its 8×8 is.
	m64 := make([]float32, ln)
	for y := 0; y < EraseSize; y++ {
		for x := 0; x < EraseSize; x++ {
			if mask[y*EraseSize+x] >= 128 {
				m64[(y/8)*latent+x/8] = 1
			}
		}
	}
	report(4)

	unet, err := e.session(Eraser, "unet.onnx")
	if err != nil {
		return nil, err
	}
	rng := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
	lat := make([]float32, 4*ln)
	for i := range lat {
		lat[i] = float32(rng.NormFloat64())
	}
	ac := alphasCumprod()
	ts := timesteps(EraseSteps)
	ids := make([]int64, 10) // the conditional embedding rows 0..9
	for i := range ids {
		ids[i] = int64(i)
	}
	nine := make([]float32, 9*ln)
	for k, t := range ts {
		copy(nine, lat)
		copy(nine[4*ln:], m64)
		copy(nine[5*ln:], maskedLatent)
		o, err := unet.Run(map[string]Tensor{
			"latent":    {Shape: []int64{1, 9, latent, latent}, Float32: nine},
			"timesteps": {Shape: []int64{1}, Int64: []int64{int64(t)}},
			"input_ids": {Shape: []int64{1, 10}, Int64: ids},
		}, []string{"noise"}, stop)
		if err != nil {
			return nil, cancelled(ctx, err)
		}
		eps := o["noise"].Float32
		a := ac[t]
		ap := 1.0
		if k+1 < len(ts) {
			ap = ac[ts[k+1]]
		}
		// DDIM (eta 0): predicted clean latent, then step to the next noise level.
		sa, s1a, sap, s1ap := math.Sqrt(a), math.Sqrt(1-a), math.Sqrt(ap), math.Sqrt(1-ap)
		for i := range lat {
			x0 := (float64(lat[i]) - s1a*float64(eps[i])) / sa
			lat[i] = float32(sap*x0 + s1ap*float64(eps[i]))
		}
		report(4 + 3*(k+1))
	}

	dec, err := e.session(Eraser, "vae_decoder.onnx")
	if err != nil {
		return nil, err
	}
	for i := range lat {
		lat[i] /= vaeScale
	}
	o, err := dec.Run(map[string]Tensor{"latent": {Shape: []int64{1, 4, latent, latent}, Float32: lat}}, []string{"image"}, stop)
	if err != nil {
		return nil, cancelled(ctx, err)
	}
	img := o["image"].Float32
	res := make([]byte, 3*n)
	for i := 0; i < n; i++ {
		for c := 0; c < 3; c++ {
			v := (float64(img[c*n+i]) + 1) * 127.5
			res[3*i+c] = byte(math.Max(0, math.Min(255, math.Round(v))))
		}
	}
	report(total)
	return res, nil
}

// alphasCumprod is the scaled-linear noise schedule's ᾱ for every step.
func alphasCumprod() []float64 {
	out := make([]float64, trainSteps)
	p := 1.0
	for i := 0; i < trainSteps; i++ {
		b := math.Sqrt(betaStart) + (math.Sqrt(betaEnd)-math.Sqrt(betaStart))*float64(i)/float64(trainSteps-1)
		p *= 1 - b*b
		out[i] = p
	}
	return out
}

// timesteps spaces n steps evenly from the noisiest (999) to 0.
func timesteps(n int) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = int(math.Round(float64(trainSteps-1) * (1 - float64(i)/float64(n-1))))
	}
	return out
}
