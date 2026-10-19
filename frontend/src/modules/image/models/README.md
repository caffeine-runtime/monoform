# Bundled image models

Loaded on demand by `../vision/visionWorker.ts` (never at startup). Both are Apache-2.0.

| File | Source | Revision | License | Use |
|---|---|---|---|---|
| `u2netp.onnx` | [BritishWerewolf/U-2-Netp](https://huggingface.co/BritishWerewolf/U-2-Netp) (ONNX of U²-Netp by Xuebin Qin et al., [xuebinqin/U-2-Net](https://github.com/xuebinqin/U-2-Net)) | `7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8` | Apache-2.0 | Remove background / select subject |
| `slimsam-77-vision_encoder_quantized.onnx`, `slimsam-77-prompt_encoder_mask_decoder_quantized.onnx` | [Xenova/slimsam-77-uniform](https://huggingface.co/Xenova/slimsam-77-uniform) (ONNX of SlimSAM by Zigeng Chen et al., [czg1225/SlimSAM](https://github.com/czg1225/SlimSAM), derived from Meta's Segment Anything, Apache-2.0) | `5850ab45f587c112167512ffef949107115e26a0` | Apache-2.0 | Click to select an object |

SHA-256:

```
cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2  slimsam-77-prompt_encoder_mask_decoder_quantized.onnx
cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971  slimsam-77-vision_encoder_quantized.onnx
309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8  u2netp.onnx
```
