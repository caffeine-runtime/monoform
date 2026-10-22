#!/usr/bin/env python3
"""The bundled click-to-select model: EfficientSAM-Ti (Apache-2.0) from its
authors' ONNX export, with the weights of its matrix products stored as 8-bit
integers (dynamic quantization). That keeps it as small as the model it
replaced (14 MB) with the same masks; the convolutions stay float, because
8-bit convolutions are slow in ONNX Runtime's WebAssembly build.

  pip install onnx onnxruntime
  python3 scripts/efficientsam.py   ->  frontend/src/modules/image/models/efficientsam-ti-*.onnx
"""
import hashlib
import os
import sys
import tempfile
import urllib.request

from onnxruntime.quantization import QuantType, quantize_dynamic

REPO = 'https://huggingface.co/yunyangx/EfficientSAM/resolve/1cf49585c39567bfc49e991ab8eb31f491ad4877/'
FILES = {
    'efficientsam_ti_encoder.onnx': ('84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951', 'efficientsam-ti-encoder-q8.onnx'),
    'efficientsam_ti_decoder.onnx': ('a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11', 'efficientsam-ti-decoder-q8.onnx'),
}
OUT = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'src', 'modules', 'image', 'models')


def main():
    with tempfile.TemporaryDirectory() as tmp:
        for name, (sha, out) in FILES.items():
            src = os.path.join(tmp, name)
            urllib.request.urlretrieve(REPO + name, src)
            got = hashlib.sha256(open(src, 'rb').read()).hexdigest()
            if got != sha:
                sys.exit(f'{name}: checksum {got}, expected {sha}')
            dst = os.path.join(OUT, out)
            quantize_dynamic(src, dst, weight_type=QuantType.QUInt8, op_types_to_quantize=['MatMul', 'Gemm'])
            print(f'{out}  {os.path.getsize(dst) / 1e6:.1f} MB  {hashlib.sha256(open(dst, "rb").read()).hexdigest()}')


if __name__ == '__main__':
    main()
