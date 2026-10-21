// The floor grid: one large plane whose lines are drawn by its shader, fading
// out around the model. A THREE.GridHelper is line segments, and lines that
// pass behind the camera come out of software OpenGL (llvmpipe: virtual
// machines, computers without GPU drivers) as stray grey triangles; triangles
// are clipped properly everywhere, so the plane can be as big as needed.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
varying vec2 vFloor;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vFloor = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Lines one pixel wide at any distance (fwidth), the two through the centre
// brighter, all fading out between half the radius and the radius.
const fragmentShader = /* glsl */ `
uniform float cell;
uniform vec2 centre;
uniform float radius;
uniform vec3 lineColor;
uniform vec3 axisColor;
uniform float opacity;
varying vec2 vFloor;
float lines(vec2 c) {
  vec2 d = abs(fract(c - 0.5) - 0.5) / fwidth(c);
  return 1.0 - min(min(d.x, d.y), 1.0);
}
void main() {
  vec2 p = vFloor - centre;
  float l = lines(p / cell);
  vec2 a = abs(p) / fwidth(p);
  float axis = 1.0 - min(min(a.x, a.y), 1.0);
  float fade = 1.0 - smoothstep(radius * 0.5, radius, length(p));
  float alpha = max(l, axis) * fade * opacity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(mix(lineColor, axisColor, axis), alpha);
}`;

export class FloorGrid extends THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  constructor() {
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        cell: { value: 0.5 },
        centre: { value: new THREE.Vector2() },
        radius: { value: 5 },
        // Written as is (no tone mapping): the colours GridHelper showed.
        lineColor: { value: new THREE.Color(0x3a3a3a) },
        axisColor: { value: new THREE.Color(0x666666) },
        opacity: { value: 0.8 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    super(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), material);
    this.frustumCulled = false;
  }

  /** Lay the grid on the floor at y, centred on (x, z): square cells of `cell`, out to `radius`. */
  fit(x: number, y: number, z: number, cell: number, radius: number) {
    const u = this.material.uniforms;
    u.cell.value = cell;
    u.centre.value.set(x, z);
    u.radius.value = radius;
    this.position.set(x, y, z);
    this.scale.setScalar(radius);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
