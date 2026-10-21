// Package ai runs the optional image models (better subject selection,
// object removal) with ONNX Runtime's native library, downloaded with the
// models on request. The library is loaded at run time through its C API
// (purego: no cgo), so the app builds and runs without it.
package ai

import (
	"errors"
	"fmt"
	"runtime"
	"sync"
	"unsafe"

	"github.com/ebitengine/purego"
)

// Indices into the OrtApi function table (onnxruntime_c_api.h). The table
// only ever grows at the end, so these hold for every version ≥ apiVersion.
const (
	apiVersion = 17

	fnGetErrorMessage                  = 2
	fnCreateEnv                        = 3
	fnDisableTelemetryEvents           = 6
	fnCreateSession                    = 7
	fnRun                              = 9
	fnCreateSessionOptions             = 10
	fnSetSessionGraphOptimizationLevel = 23
	fnSetIntraOpNumThreads             = 24
	fnCreateRunOptions                 = 39
	fnRunOptionsSetTerminate           = 46
	fnCreateTensorWithDataAsOrtValue   = 49
	fnGetTensorMutableData             = 51
	fnGetDimensionsCount               = 61
	fnGetDimensions                    = 62
	fnGetTensorTypeAndShape            = 65
	fnCreateCpuMemoryInfo              = 69
	fnReleaseEnv                       = 92
	fnReleaseStatus                    = 93
	fnReleaseMemoryInfo                = 94
	fnReleaseSession                   = 95
	fnReleaseValue                     = 96
	fnReleaseRunOptions                = 97
	fnReleaseTensorTypeAndShapeInfo    = 99
	fnReleaseSessionOptions            = 100

	loggingLevelError = 3
	graphOptimizeAll  = 99
	allocatorArena    = 1
	memTypeDefault    = 0
	elementFloat      = 1
	elementInt64      = 7
)

// Runtime is a loaded ONNX Runtime library with one environment.
type Runtime struct {
	api  uintptr // *OrtApi
	env  uintptr
	mem  uintptr // CPU memory info for input tensors
	mu   sync.Mutex
	open int
}

var (
	rtMu sync.Mutex
	rts  = map[string]*Runtime{}
)

// LoadRuntime loads the library at path (once per path) and creates its
// environment, with telemetry off.
func LoadRuntime(path string) (*Runtime, error) {
	rtMu.Lock()
	defer rtMu.Unlock()
	if rt := rts[path]; rt != nil {
		return rt, nil
	}
	getAPIBase, err := openLibrary(path)
	if err != nil {
		return nil, fmt.Errorf("loading ONNX Runtime: %w", err)
	}
	base, _, _ := purego.SyscallN(getAPIBase)
	if base == 0 {
		return nil, errors.New("ONNX Runtime: no API base")
	}
	// struct OrtApiBase { const OrtApi* (*GetApi)(uint32_t); const char* (*GetVersionString)(void); }
	getAPI := *(*uintptr)(cptr(base))
	api, _, _ := purego.SyscallN(getAPI, apiVersion)
	if api == 0 {
		return nil, errors.New("ONNX Runtime is too old")
	}
	rt := &Runtime{api: api}
	logID := cstr("hold-it-all")
	if err := rt.status(rt.call(fnCreateEnv, loggingLevelError, uintptr(unsafe.Pointer(&logID[0])), ptr(&rt.env))); err != nil {
		return nil, err
	}
	runtime.KeepAlive(logID)
	rt.call(fnDisableTelemetryEvents, rt.env)
	if err := rt.status(rt.call(fnCreateCpuMemoryInfo, allocatorArena, memTypeDefault, ptr(&rt.mem))); err != nil {
		return nil, err
	}
	rts[path] = rt
	return rt, nil
}

func (rt *Runtime) fn(i int) uintptr {
	return *(*uintptr)(cptr(rt.api + uintptr(i)*unsafe.Sizeof(uintptr(0))))
}

func (rt *Runtime) call(i int, args ...uintptr) uintptr {
	r, _, _ := purego.SyscallN(rt.fn(i), args...)
	return r
}

// status turns an OrtStatus* into an error (and releases it).
func (rt *Runtime) status(st uintptr) error {
	if st == 0 {
		return nil
	}
	msg := gostr(rt.call(fnGetErrorMessage, st))
	rt.call(fnReleaseStatus, st)
	return errors.New("ONNX Runtime: " + msg)
}

// Session is one loaded model.
type Session struct {
	rt *Runtime
	s  uintptr
}

// Open loads a model file. threads is the number of threads one inference
// uses (0: ONNX Runtime's default, the physical cores).
func (rt *Runtime) Open(model string, threads int) (*Session, error) {
	var opts uintptr
	if err := rt.status(rt.call(fnCreateSessionOptions, ptr(&opts))); err != nil {
		return nil, err
	}
	defer rt.call(fnReleaseSessionOptions, opts)
	if err := rt.status(rt.call(fnSetSessionGraphOptimizationLevel, opts, graphOptimizeAll)); err != nil {
		return nil, err
	}
	if threads > 0 {
		if err := rt.status(rt.call(fnSetIntraOpNumThreads, opts, uintptr(threads))); err != nil {
			return nil, err
		}
	}
	p := pathArg(model)
	var s uintptr
	err := rt.status(rt.call(fnCreateSession, rt.env, p.ptr(), opts, ptr(&s)))
	runtime.KeepAlive(p)
	if err != nil {
		return nil, err
	}
	return &Session{rt: rt, s: s}, nil
}

// Close frees the model's memory.
func (s *Session) Close() {
	if s.s != 0 {
		s.rt.call(fnReleaseSession, s.s)
		s.s = 0
	}
}

// Tensor is an input or output: float32 or int64 data with its shape.
type Tensor struct {
	Shape   []int64
	Float32 []float32
	Int64   []int64
}

func (t Tensor) count() int64 {
	n := int64(1)
	for _, d := range t.Shape {
		n *= d
	}
	return n
}

// Stop ends a running Run early (from another goroutine).
type Stop struct {
	mu   sync.Mutex
	rt   *Runtime
	opts uintptr
	done bool
}

// Terminate asks ONNX Runtime to stop the run as soon as it can.
func (st *Stop) Terminate() {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.done = true
	if st.opts != 0 {
		st.rt.call(fnRunOptionsSetTerminate, st.opts)
	}
}

// Run computes the named outputs from the named inputs. stop may be nil.
func (s *Session) Run(inputs map[string]Tensor, outputs []string, stop *Stop) (map[string]Tensor, error) {
	rt := s.rt
	var runOpts uintptr
	if err := rt.status(rt.call(fnCreateRunOptions, ptr(&runOpts))); err != nil {
		return nil, err
	}
	defer rt.call(fnReleaseRunOptions, runOpts)
	if stop != nil {
		stop.mu.Lock()
		stop.rt, stop.opts = rt, runOpts
		cancelled := stop.done
		stop.mu.Unlock()
		defer func() {
			stop.mu.Lock()
			stop.opts = 0
			stop.mu.Unlock()
		}()
		if cancelled {
			return nil, errCancelled
		}
	}

	var keep []any // Go memory ONNX Runtime points into, kept alive until the run ends
	inNames := make([]uintptr, 0, len(inputs))
	inValues := make([]uintptr, 0, len(inputs))
	defer func() {
		for _, v := range inValues {
			rt.call(fnReleaseValue, v)
		}
	}()
	for name, t := range inputs {
		if t.count() != int64(max(len(t.Float32), len(t.Int64))) {
			return nil, fmt.Errorf("input %s: shape %v doesn't match its data", name, t.Shape)
		}
		var data unsafe.Pointer
		var bytes uintptr
		elem := elementFloat
		if t.Int64 != nil {
			data, bytes, elem = unsafe.Pointer(&t.Int64[0]), uintptr(len(t.Int64)*8), elementInt64
		} else {
			data, bytes = unsafe.Pointer(&t.Float32[0]), uintptr(len(t.Float32)*4)
		}
		var v uintptr
		err := rt.status(rt.call(fnCreateTensorWithDataAsOrtValue, rt.mem, uintptr(data), bytes, uintptr(unsafe.Pointer(&t.Shape[0])), uintptr(len(t.Shape)), uintptr(elem), ptr(&v)))
		if err != nil {
			return nil, err
		}
		n := cstr(name)
		keep = append(keep, t.Float32, t.Int64, t.Shape, n)
		inNames = append(inNames, uintptr(unsafe.Pointer(&n[0])))
		inValues = append(inValues, v)
	}
	outNames := make([]uintptr, len(outputs))
	for i, name := range outputs {
		n := cstr(name)
		keep = append(keep, n)
		outNames[i] = uintptr(unsafe.Pointer(&n[0]))
	}
	outValues := make([]uintptr, len(outputs))
	err := rt.status(rt.call(fnRun, s.s, runOpts, uintptr(unsafe.Pointer(&inNames[0])), uintptr(unsafe.Pointer(&inValues[0])), uintptr(len(inValues)),
		uintptr(unsafe.Pointer(&outNames[0])), uintptr(len(outNames)), uintptr(unsafe.Pointer(&outValues[0]))))
	runtime.KeepAlive(keep)
	runtime.KeepAlive(inNames)
	runtime.KeepAlive(outNames)
	if err != nil {
		if stop != nil && stop.isDone() {
			return nil, errCancelled
		}
		return nil, err
	}
	out := map[string]Tensor{}
	for i, v := range outValues {
		t, err := rt.readFloat(v)
		rt.call(fnReleaseValue, v)
		if err != nil {
			return nil, fmt.Errorf("output %s: %w", outputs[i], err)
		}
		out[outputs[i]] = t
	}
	return out, nil
}

func (st *Stop) isDone() bool {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.done
}

var errCancelled = errors.New("cancelled")

// readFloat copies a float32 output tensor into Go memory.
func (rt *Runtime) readFloat(v uintptr) (Tensor, error) {
	var info uintptr
	if err := rt.status(rt.call(fnGetTensorTypeAndShape, v, ptr(&info))); err != nil {
		return Tensor{}, err
	}
	defer rt.call(fnReleaseTensorTypeAndShapeInfo, info)
	var n uintptr
	if err := rt.status(rt.call(fnGetDimensionsCount, info, ptr(&n))); err != nil {
		return Tensor{}, err
	}
	shape := make([]int64, n)
	if n > 0 {
		if err := rt.status(rt.call(fnGetDimensions, info, uintptr(unsafe.Pointer(&shape[0])), n)); err != nil {
			return Tensor{}, err
		}
	}
	t := Tensor{Shape: shape}
	var data uintptr
	if err := rt.status(rt.call(fnGetTensorMutableData, v, ptr(&data))); err != nil {
		return Tensor{}, err
	}
	t.Float32 = make([]float32, t.count())
	if len(t.Float32) > 0 {
		copy(t.Float32, unsafe.Slice((*float32)(cptr(data)), len(t.Float32)))
	}
	return t, nil
}

// ---- C interop helpers ----

func ptr[T any](p *T) uintptr { return uintptr(unsafe.Pointer(p)) }

// cptr turns an address ONNX Runtime returned into a pointer (C memory,
// which the Go garbage collector neither moves nor frees).
func cptr(p uintptr) unsafe.Pointer { return *(*unsafe.Pointer)(unsafe.Pointer(&p)) }

// cstr is s as a NUL-terminated C string (keep it alive while C uses it).
func cstr(s string) []byte { return append([]byte(s), 0) }

// gostr copies a NUL-terminated C string.
func gostr(p uintptr) string {
	if p == 0 {
		return ""
	}
	var b []byte
	for i := uintptr(0); i < 4096; i++ {
		c := *(*byte)(cptr(p + i))
		if c == 0 {
			break
		}
		b = append(b, c)
	}
	return string(b)
}
