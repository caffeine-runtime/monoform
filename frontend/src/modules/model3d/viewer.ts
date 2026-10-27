// three.js viewer: orbit controls, studio lighting from a baked room
// environment, wireframe / unlit / grid toggles, animation playback, and
// parts: picking under the pointer, a highlight on the selected ones, hiding
// and see-through (the Parts panel decides which; see parts.ts).
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
import { t } from '../../core/i18n';
import { FloorGrid } from './grid';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { boundsOf, drawn, showing } from './parts';

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
  /** Drawn objects the file itself hides (they stay hidden whatever the panel says). */
  private fileHidden = new Set<THREE.Object3D>();
  private ghosted = new Set<THREE.Object3D>();
  private ghostMats: Record<'lit' | 'flat' | 'line', THREE.Material> | null = null;
  private overlays: THREE.Object3D[] = [];
  private highlight: THREE.MeshBasicMaterial | null = null;
  private down: { x: number; y: number; button: number } | null = null;
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;
  wireframe = false;
  lighting = true;
  anim: AnimState = { index: -1, playing: false, time: 0, duration: 0, speed: 1 };
  onAnim: (a: AnimState) => void = () => {};
  /** A click (not a drag) on the model: what was under the pointer, or null for empty space. */
  onPick: (o: THREE.Object3D | null, e: PointerEvent) => void = () => {};
  /** The pointer rested over something (or nothing). */
  onHover: (o: THREE.Object3D | null, e: PointerEvent) => void = () => {};

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
    host.addEventListener('pointerdown', this.pointerDown);
    host.addEventListener('pointerup', this.pointerUp);
    host.addEventListener('pointermove', this.pointerMove);
    host.addEventListener('pointerleave', this.pointerLeave);
    this.attach();
  }

  // ---------- parts: picking ----------

  private pointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, button: e.button };
  };

  private pointerUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    // A click, not the end of a turn or a pan.
    if (!d || d.button !== e.button || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || !this.attached || !this.model) return;
    if (e.button === 0) this.onPick(this.pick(e.clientX, e.clientY), e);
    // A right-click that didn't pan: the app's menu. (The controls cancel the
    // canvas's own contextmenu event, so it comes from the stage instead.)
    else if (e.button === 2) this.host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 2 }));
  };

  private pointerMove = (e: PointerEvent) => {
    clearTimeout(this.hoverTimer);
    if (e.buttons || !this.attached || !this.model) return this.onHover(null, e);
    // Only when the pointer rests: a pick on a big model takes a few milliseconds.
    this.hoverTimer = setTimeout(() => this.onHover(this.pick(e.clientX, e.clientY), e), 90);
  };

  private pointerLeave = (e: PointerEvent) => {
    clearTimeout(this.hoverTimer);
    this.onHover(null, e);
  };

  /** The drawn object under a point of the window (shown, solid meshes only), or null. */
  pick(clientX: number, clientY: number): THREE.Object3D | null {
    if (!this.model || !this.attached) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const targets: THREE.Object3D[] = [];
    this.model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && drawn(o) && !this.ghosted.has(o) && showing(o)) targets.push(o);
    });
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.intersectObjects(targets, false)[0]?.object ?? null;
  }

  // ---------- parts: what is shown, and how ----------

  /** Hide these drawn objects; show every other one (unless the file hides it). */
  setHidden(hidden: ReadonlySet<THREE.Object3D>) {
    this.model?.traverse((o) => {
      if (drawn(o)) o.visible = !hidden.has(o) && !this.fileHidden.has(o);
    });
    this.kick();
  }

  /** Draw these objects as faint glass (the parts around the ones being looked at). */
  setGhosted(objs: ReadonlySet<THREE.Object3D>) {
    this.ghosted = new Set(objs);
    this.applyMaterials();
  }

  /** Tint these drawn objects in the accent colour (the selection). */
  setSelected(objs: readonly THREE.Object3D[]) {
    for (const o of this.overlays) o.removeFromParent();
    this.overlays = [];
    if (!this.highlight) {
      const accent = getComputedStyle(this.host).getPropertyValue('--accent').trim() || '#d97757';
      let colour: THREE.Color;
      try {
        colour = new THREE.Color(accent);
      } catch {
        colour = new THREE.Color(0xd97757);
      }
      // Drawn over the part (a little in front of it), seen through by half.
      this.highlight = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    }
    for (const o of objs) {
      const m = o as THREE.Mesh;
      if (!m.isMesh) continue;
      const skinned = m as THREE.SkinnedMesh;
      let tint: THREE.Mesh;
      if (skinned.isSkinnedMesh) {
        const s = new THREE.SkinnedMesh(m.geometry, this.highlight);
        s.bind(skinned.skeleton, skinned.bindMatrix);
        tint = s;
      } else tint = new THREE.Mesh(m.geometry, this.highlight);
      tint.userData.mfOverlay = true;
      tint.renderOrder = 10;
      tint.raycast = () => {};
      m.add(tint); // inherits the part's place and visibility
      this.overlays.push(tint);
    }
    this.kick();
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
    c.title = t('Click to move and rotate this model');
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
    model.traverse((o) => {
      if (drawn(o) && !o.visible) this.fileHidden.add(o);
    });
    this.scene.add(model);
    if (clips.length) this.mixer = new THREE.AnimationMixer(model);
    this.applyMaterials();
    this.frame();
    this.kick();
  }

  /** Put the camera where the model — what is showing of it, or of these objects — is in view. */
  frame(objects?: THREE.Object3D[]) {
    if (!this.model) return;
    let box = boundsOf(objects?.length ? objects : [this.model]);
    if (box.isEmpty()) box = boundsOf([this.model]);
    if (box.isEmpty()) box = boundsOf([this.model], true);
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
    // Grid on the whole model's floor (it stays put when parts are hidden):
    // cells of a round size, fading out around it.
    const whole = boundsOf([this.model], true);
    const ws = whole.getSize(new THREE.Vector3());
    const wc = whole.getCenter(new THREE.Vector3());
    const g = Math.pow(10, Math.ceil(Math.log10(Math.max(ws.x, ws.z, 1e-6) * 2)));
    this.grid.fit(wc.x, whole.min.y, wc.z, g / 20, g * 0.75);
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
      if (!m.geometry || o.userData.mfOverlay) return;
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
    const size = boundsOf([this.model], true).getSize(new THREE.Vector3());
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
      if (!m.material || o.userData.mfOverlay || !(m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine)) return;
      if (!this.unlit.has(m)) this.unlit.set(m, m.material);
      const original = this.unlit.get(m)!;
      const toBasic = (mat: THREE.Material): THREE.Material => {
        if (!(m.isMesh && !(mat instanceof THREE.MeshBasicMaterial))) return mat;
        const src = mat as THREE.MeshStandardMaterial;
        const basic = new THREE.MeshBasicMaterial({ color: src.color ?? 0xffffff, map: src.map ?? null, vertexColors: src.vertexColors, transparent: src.transparent, opacity: src.opacity, alphaTest: src.alphaTest, side: src.side, alphaMap: src.alphaMap ?? null });
        basic.userData.mfUnlit = true;
        return basic;
      };
      const current = this.ghosted.has(m) ? this.ghost(m) : this.lighting ? original : Array.isArray(original) ? original.map(toBasic) : toBasic(original);
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

  /** The faint material of a see-through part (shared; lit like the rest unless lighting is off). */
  private ghost(o: THREE.Object3D): THREE.Material {
    this.ghostMats ??= {
      lit: new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.4, metalness: 0, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }),
      flat: new THREE.MeshBasicMaterial({ color: 0xb8bcc4, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
      line: new THREE.LineBasicMaterial({ color: 0x8a8f98, transparent: true, opacity: 0.15, depthWrite: false }),
    };
    return (o as THREE.Mesh).isMesh ? (this.lighting ? this.ghostMats.lit : this.ghostMats.flat) : this.ghostMats.line;
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
    // The picture of the model, without the selection's tint.
    for (const o of this.overlays) o.visible = false;
    this.renderer.render(this.scene, this.camera);
    for (const o of this.overlays) o.visible = true;
    this.kick();
    return new Promise((res, rej) => this.renderer.domElement.toBlob((b) => (b ? res(b) : rej(new Error(t('screenshot failed')))), 'image/png'));
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
    this.overlays = [];
    this.fileHidden.clear();
    this.ghosted.clear();
    this.model = null;
    this.mixer = null;
    this.clips = [];
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.hoverTimer);
    this.ro.disconnect();
    this.host.removeEventListener('pointerdown', this.pointerDown);
    this.host.removeEventListener('pointerup', this.pointerUp);
    this.host.removeEventListener('pointermove', this.pointerMove);
    this.host.removeEventListener('pointerleave', this.pointerLeave);
    this.clear();
    this.highlight?.dispose();
    if (this.ghostMats) for (const m of Object.values(this.ghostMats)) m.dispose();
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
