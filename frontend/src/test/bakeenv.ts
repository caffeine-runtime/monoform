// Bakes the viewer's reflection environment (three's RoomEnvironment through
// PMREM) to src/modules/model3d/room-env.bin, so the viewer can load it as a
// texture instead of running PMREM — whose shaders take ~0.5 s to compile on
// software GL. Run: scripts/selftest.sh bakeenv <output path>
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { saveFile } from '../core/backend';
import { assert, log } from './harness';
import { ENV_SIZE } from '../modules/model3d/env';

export default async function bakeenv(out: string) {
  const renderer = new THREE.WebGLRenderer();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(new RoomEnvironment(), 0.04, 0.1, 100, { size: ENV_SIZE });
  const gl = renderer.getContext() as WebGL2RenderingContext;
  assert(!!gl.getExtension('EXT_color_buffer_float'), 'float read-back supported');
  renderer.setRenderTarget(rt);
  const { width, height } = rt;
  const px = new Float32Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, px);
  renderer.setRenderTarget(null);
  const head = new Uint32Array([0x564e4548 /* "HENV" */, width, height, 0]);
  const half = new Uint16Array(px.length);
  for (let i = 0; i < px.length; i++) half[i] = THREE.DataUtils.toHalfFloat(px[i]);
  let max = 0;
  for (const v of px) max = Math.max(max, v);
  assert(max > 0.1, `environment is not black (max ${max})`);
  await saveFile(out, new Blob([head, half]));
  log(`baked ${width}×${height} environment, max ${max.toFixed(2)}, ${16 + half.byteLength} bytes`);
  pmrem.dispose();
  renderer.dispose();
}
