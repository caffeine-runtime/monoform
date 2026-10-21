// three.js viewer: orbit controls, studio lighting from a baked room
// environment, wireframe / unlit / grid toggles and animation playback.
// Frames are rendered only while something changes (camera damping,
// animation) and the tab is visible, so an idle model costs no CPU.
//
// All 3D tabs share one WebGL renderer: its canvas moves to whichever tab is
// showing. Creating a context, compiling shaders and uploading the
// environment then happen once per session instead of once per tab (each is
// tens to hundreds of milliseconds on software GL), and only one GPU context
// is held however many models are open.
import * as THREE from 'three';
import { roomEnvironment } from './env';
import { FloorGrid } from './grid';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface ModelStats {
  meshes: number;
  triangles: number;
  vertices: number;
  points: number;
  materials: number;
  textures: number;
  bones: number;
  size: [number, number, number];
}

export interface AnimState {
  index: number; // -1 = none
  playing: boolean;
  time: number;
  duration: number;
  speed: number;
}

interface Shared {
  renderer: THREE.WebGLRenderer;
  env: Promise<THREE.Texture> | null;
  users: number;
  owner: ModelViewer | null;
  idle: ReturnType<typeof setTimeout> | undefined;
}
let shared: Shared | null = null;
/** Keep the renderer (and its compiled shaders) this long after the last 3D tab closes. */
const KEEP_MS = 60_000;

function acquire(): Shared {
  if (shared) {
    clearTimeout(shared.idle);
    shared.users++;
    return shared;
  }
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  shared = { renderer, env: null, users: 1, owner: null, idle: undefined };
  return shared;
}

function release() {
  const s = shared;
  if (!s || --s.users > 0) return;
  s.idle = setTimeout(() => {
    if (shared !== s || s.users > 0) return;
    void s.env?.then((t) => t.dispose()).catch(() => {});
    s.renderer.dispose();
    s.renderer.forceContextLoss();
    s.renderer.domElement.remove();
    shared = null;
  }, KEEP_MS);
}

export class ModelViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  readonly controls: OrbitControls;
  private model: THREE.Object3D | null = null;
  private clips: THREE.AnimationClip[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private action: THREE.AnimationAction | null = null;
  private grid = new FloorGrid();
  private lights: THREE.Group;
  private envTexture: THREE.Texture | null = null;
  private shared: Shared;
  private clock = new THREE.Clock();
  private raf = 0;
  private dirty = true;
  private ro: ResizeObserver;
  private unlit = new Map<THREE.Mesh | THREE.Points | THREE.Line, THREE.Material | THREE.Material[]>();
  wireframe = false;
  lighting = true;
  anim: AnimState = { index: -1, playing: false, time: 0, duration: 0, speed: 1 };
  onAnim: (a: AnimState) => void = () => {};

  constructor(private host: HTMLElement) {
    this.shared = acquire();
    this.renderer = this.shared.renderer;
    this.lights = new THREE.Group();
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    const fill = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    this.lights.add(key, fill);
    this.scene.add(this.lights);
    this.scene.add(this.grid);
    this.controls = new OrbitControls(this.camera);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.kick());
    this.setBackground('dark');
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.attach();
  }

  private get attached(): boolean {
    return this.shared.owner === this;
  }

  /** Take the shared canvas (when this tab is shown). */
  attach() {
    const s = this.shared;
    if (s.owner !== this) {
      const prev = s.owner;
      if (prev) {
        // In split view the other 3D tab stays visible: leave it a still of its last frame.
        prev.freeze();
        prev.controls.disconnect();
      }
      s.owner = this;
      this.still?.remove();
      this.still = null;
      this.host.appendChild(this.renderer.domElement);
      this.controls.connect(this.renderer.domElement);
    }
    this.resize();
  }

  private still: HTMLCanvasElement | null = null;

  /** Copy the current view into a plain canvas that stays when the shared canvas moves away. */
  private freeze() {
    const src = this.renderer.domElement;
    if (!this.host.clientWidth || !src.width) return;
    this.renderer.render(this.scene, this.camera); // the drawing buffer isn't preserved between frames
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d')!.drawImage(src, 0, 0);
    c.className = 'still';
    c.title = 'Click to move and rotate this model';
    Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    this.still?.remove();
    this.still = c;
    this.host.appendChild(c);
  }

  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h || !this.attached) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.kick();
  }

  setBackground(bg: 'dark' | 'light') {
    this.scene.background = new THREE.Color(bg === 'dark' ? 0x1e1d1b : 0xeceae6);
    this.kick();
  }

  /** Reflections for PBR materials, loaded only when a model needs them. */
  private async ensureEnv(model: THREE.Object3D) {
    if (this.envTexture) return;
    let pbr = false;
    model.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m && (Array.isArray(m) ? m : [m]).some((x) => (x as THREE.MeshStandardMaterial).isMeshStandardMaterial)) pbr = true;
    });
    if (pbr) this.envTexture = await (this.shared.env ??= roomEnvironment());
  }

  /** Show a model. Shaders compile off the main thread where the GPU allows. */
  async setModel(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.clear();
    await this.ensureEnv(model);
    this.scene.environment = this.lighting ? this.envTexture : null;
    try {
      await this.renderer.compileAsync(model, this.camera, this.scene);
    } catch {
      /* compiled on first render instead */
    }
    this.model = model;
    this.clips = clips;
    this.scene.add(model);
    if (clips.length) this.mixer = new THREE.AnimationMixer(model);
    this.applyMaterials();
    this.frame();
    this.kick();
  }

  /** Put the camera where the whole model is visible. */
  frame() {
    if (!this.model) return;
    const box = new THREE.Box3().setFromObject(this.model);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1e-6);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.1;
    this.camera.near = Math.max(dist / 1000, radius / 1000);
    this.camera.far = dist * 100;
    this.camera.position.copy(centre).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(dist));
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(centre);
    this.controls.update();
    // Grid on the model's floor: cells of a round size, fading out around it.
    const g = Math.pow(10, Math.ceil(Math.log10(Math.max(size.x, size.z, 1e-6) * 2)));
    this.grid.fit(centre.x, box.min.y, centre.z, g / 20, g * 0.75);
    this.kick();
  }

  stats(): ModelStats {
    const s: ModelStats = { meshes: 0, triangles: 0, vertices: 0, points: 0, materials: 0, textures: 0, bones: 0, size: [0, 0, 0] };
    if (!this.model) return s;
    const mats = new Set<THREE.Material>();
    const texs = new Set<THREE.Texture>();
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) s.bones++;
      const m = o as THREE.Mesh;
      if (!m.geometry) return;
      const g = m.geometry;
      const n = g.getAttribute('position')?.count ?? 0;
      if ((o as THREE.Points).isPoints) s.points += n;
      else if (m.isMesh) {
        s.meshes++;
        s.vertices += n;
        s.triangles += (g.index ? g.index.count : n) / 3;
      }
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (!mat) continue;
        mats.add(mat);
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) texs.add(v);
      }
    });
    s.materials = mats.size;
    s.textures = texs.size;
    s.triangles = Math.round(s.triangles);
    const size = new THREE.Box3().setFromObject(this.model).getSize(new THREE.Vector3());
    s.size = [size.x, size.y, size.z];
    return s;
  }

  get animations(): { name: string; duration: number }[] {
    return this.clips.map((c, i) => ({ name: c.name || `Animation ${i + 1}`, duration: c.duration }));
  }

  play(index: number) {
    if (!this.mixer || !this.clips[index]) return;
    if (this.anim.index === index && this.action) {
      this.togglePause();
      return;
    }
    this.mixer.stopAllAction();
    this.action = this.mixer.clipAction(this.clips[index]);
    this.action.reset().play();
    this.anim = { index, playing: true, time: 0, duration: this.clips[index].duration, speed: this.anim.speed };
    this.mixer.timeScale = this.anim.speed;
    this.clock.getDelta();
    this.kick();
    this.onAnim({ ...this.anim });
  }

  togglePause() {
    if (!this.action) return;
    this.anim.playing = !this.anim.playing;
    this.action.paused = !this.anim.playing;
    this.clock.getDelta();
    this.kick();
    this.onAnim({ ...this.anim });
  }

  stopAnimation() {
    this.mixer?.stopAllAction();
    this.action = null;
    this.anim = { ...this.anim, index: -1, playing: false, time: 0, duration: 0 };
    this.kick();
    this.onAnim({ ...this.anim });
  }

  seek(t: number) {
    if (!this.action) return;
    this.action.time = Math.max(0, Math.min(this.anim.duration, t));
    this.mixer!.update(0);
    this.anim.time = this.action.time;
    this.kick();
    this.onAnim({ ...this.anim });
  }

  setSpeed(s: number) {
    this.anim.speed = s;
    if (this.mixer) this.mixer.timeScale = s;
    this.onAnim({ ...this.anim });
  }

  setWireframe(on: boolean) {
    this.wireframe = on;
    this.applyMaterials();
  }

  /** Off = unlit: every surface shows its base colour/texture, no shading. */
  setLighting(on: boolean) {
    this.lighting = on;
    this.applyMaterials();
  }

  setGrid(on: boolean) {
    this.grid.visible = on;
    this.kick();
  }

  private applyMaterials() {
    if (!this.model) return;
    this.scene.environment = this.lighting ? this.envTexture : null;
    this.lights.visible = this.lighting;
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.material || !(m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine)) return;
      if (!this.unlit.has(m)) this.unlit.set(m, m.material);
      const original = this.unlit.get(m)!;
      const toBasic = (mat: THREE.Material): THREE.Material => {
        if (!(m.isMesh && !(mat instanceof THREE.MeshBasicMaterial))) return mat;
        const src = mat as THREE.MeshStandardMaterial;
        const basic = new THREE.MeshBasicMaterial({ color: src.color ?? 0xffffff, map: src.map ?? null, vertexColors: src.vertexColors, transparent: src.transparent, opacity: src.opacity, alphaTest: src.alphaTest, side: src.side, alphaMap: src.alphaMap ?? null });
        basic.userData.mfUnlit = true;
        return basic;
      };
      const current = this.lighting ? original : Array.isArray(original) ? original.map(toBasic) : toBasic(original);
      // Free the unlit copies we made earlier.
      const prev = m.material;
      for (const p of Array.isArray(prev) ? prev : [prev]) if (p.userData.mfUnlit && !(Array.isArray(current) ? current.includes(p) : current === p)) p.dispose();
      m.material = current;
      for (const mat of Array.isArray(current) ? current : [current]) {
        if ('wireframe' in mat) (mat as THREE.MeshBasicMaterial).wireframe = this.wireframe;
        mat.needsUpdate = true;
      }
    });
    this.kick();
  }

  /** Render frames until nothing moves. */
  kick() {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.loop());
  }

  private loop() {
    this.raf = 0;
    // Hidden (another tab shows, or this one is in the background): stop;
    // attach() on show starts again.
    if (!this.attached || !this.host.clientWidth) {
      this.clock.getDelta();
      return;
    }
    const dt = this.clock.getDelta();
    const moving = this.controls.update();
    if (this.mixer && this.anim.playing) {
      this.mixer.update(dt);
      if (this.action) {
        const t = this.action.time;
        if (Math.abs(t - this.anim.time) > 0.05 || t < this.anim.time) {
          this.anim.time = t;
          this.onAnim({ ...this.anim });
        }
      }
    }
    if (this.dirty || moving || this.anim.playing) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
    // controls.update() above fires 'change', which may already have queued
    // the next frame through kick(); queue it only once, or every camera move
    // would add another loop (and another render) per frame.
    if ((moving || this.anim.playing) && !this.raf) this.raf = requestAnimationFrame(() => this.loop());
  }

  /** PNG of the current view. */
  screenshot(): Promise<Blob> {
    this.attach();
    this.renderer.render(this.scene, this.camera);
    return new Promise((res, rej) => this.renderer.domElement.toBlob((b) => (b ? res(b) : rej(new Error('screenshot failed'))), 'image/png'));
  }

  private clear() {
    this.stopAnimation();
    if (this.model) {
      this.scene.remove(this.model);
      dispose(this.model);
    }
    for (const m of this.unlit.keys()) {
      const cur = m.material;
      for (const p of Array.isArray(cur) ? cur : [cur]) if (p.userData.mfUnlit) p.dispose();
    }
    this.unlit.clear();
    this.model = null;
    this.mixer = null;
    this.clips = [];
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.clear();
    this.controls.dispose();
    this.grid.dispose();
    if (this.attached) {
      this.shared.owner = null;
      this.renderer.domElement.remove();
    }
    release();
  }
}

function dispose(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
}
