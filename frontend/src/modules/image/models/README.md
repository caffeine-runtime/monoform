# Bundled image models

Loaded on demand by `../vision/visionWorker.ts` (never at startup). Both are Apache-2.0.

| File | Source | Revision | License | Use |
|---|---|---|---|---|
| `u2netp.onnx` | [BritishWerewolf/U-2-Netp](https://huggingface.co/BritishWerewolf/U-2-Netp) (ONNX of U²-Netp by Xuebin Qin et al., [xuebinqin/U-2-Net](https://github.com/xuebinqin/U-2-Net)) | `7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8` | Apache-2.0 | Remove background / select subject |
| `efficientsam-ti-encoder-q8.onnx`, `efficientsam-ti-decoder-q8.onnx` | [yunyangx/EfficientSAM](https://huggingface.co/yunyangx/EfficientSAM) (the authors' ONNX export of EfficientSAM-Ti by Yunyang Xiong et al., [yformer/EfficientSAM](https://github.com/yformer/EfficientSAM)), matrix-product weights quantized to 8 bits by `scripts/efficientsam.py` | `1cf49585c39567bfc49e991ab8eb31f491ad4877` | Apache-2.0 | Click to select an object |

SHA-256:

```
e2d115b3d6cb0f51a888444a680bf7cc9af41eaf99ecc19b6156ff0bb8cd7402  efficientsam-ti-decoder-q8.onnx
af86c8ea00dbd6b08a9e55167c45bf997811a5947d3e4ba8824cf37db382f82c  efficientsam-ti-encoder-q8.onnx
309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8  u2netp.onnx
```
