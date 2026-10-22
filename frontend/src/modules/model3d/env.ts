// The viewer's reflection environment: three's RoomEnvironment pre-filtered
// by PMREM, baked once (see test/bakeenv.ts) and shipped as half floats.
// Loading it is a texture upload; running PMREM here would compile shaders
// that block the main thread for ~0.5 s on software GL.
import * as THREE from 'three';
import envUrl from './room-env.bin?url';
import { fetchBytes } from '../../core/fetchbytes';

/** Cube face size the environment is baked at. */
export const ENV_SIZE = 64;

let cached: Promise<{ width: number; height: number; data: Uint16Array }> | null = null;

/** A fresh texture (one per renderer) of the baked environment. */
export async function roomEnvironment(): Promise<THREE.DataTexture> {
  cached ??= fetchBytes(envUrl).then((b) => {
    const head = new Uint32Array(b.buffer, b.byteOffset, 4);
    if (head[0] !== 0x564e4548) throw new Error('bad environment file'); // i18n-ignore: internal check of a bundled asset
    return { width: head[1], height: head[2], data: new Uint16Array(b.buffer, b.byteOffset + 16, head[1] * head[2] * 4) };
  });
  const { width, height, data } = await cached;
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.CubeUVReflectionMapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
