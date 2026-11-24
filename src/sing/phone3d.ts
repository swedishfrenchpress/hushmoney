import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// A phone floating beside the QR code, running the real listener: screenshots
// of the app itself (tap to listen, listening, caught) cross-fade on its
// screen. Titanium frame lit by a soft room, a thin black bezel, a glass
// sheen over the top. It sways and bobs and leans toward the pointer. Reduced
// motion draws it once, on the first screen.

const W = 1;
const H = 2.1;
const D = 0.1;
const BEZEL = 0.026; // black glass around the screen
const SCREENS = ['/phone/idle.jpg', '/phone/listening.jpg', '/phone/caught.jpg'];
const HOLD_S = 3;
const FADE_S = 0.7;
const CYCLE_S = SCREENS.length * (HOLD_S + FADE_S);

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

// White where the glass is, black in the rounded corners, so the sheen has the phone's outline.
function roundedMask() {
  const c = document.createElement('canvas');
  c.width = 270;
  c.height = 570;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.beginPath();
  g.roundRect(0, 0, c.width, c.height, 33);
  g.fill();
  return new CanvasTexture(c);
}

// The front face: bezel, the app, the island and the status bar, on one canvas.
function makeScreen(images: HTMLImageElement[]) {
  const faceW = W - 0.02;
  const faceH = H - 0.02;
  const w = 540;
  const h = Math.round((w * faceH) / faceW);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const pad = Math.round((BEZEL / faceW) * w);
  const sw = w - pad * 2;
  const sh = h - pad * 2;
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;

  const draw = (from: number, to: number, mix: number) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#050505';
    g.beginPath();
    g.roundRect(0, 0, w, h, 66);
    g.fill();
    g.save();
    g.beginPath();
    g.roundRect(pad, pad, sw, sh, 52);
    g.clip();
    // The app sits under a status bar, as on a real phone: green above, the app below.
    const inset = Math.round(sh * 0.055);
    g.fillStyle = '#7bfb70';
    g.fillRect(pad, pad, sw, inset);
    g.globalAlpha = 1;
    g.drawImage(images[from]!, pad, pad + inset, sw, sh - inset);
    if (mix > 0) {
      g.globalAlpha = mix;
      g.drawImage(images[to]!, pad, pad + inset, sw, sh - inset);
    }
    g.globalAlpha = 1;
    // Status bar: the time, signal and battery.
    g.fillStyle = '#202020';
    g.font = '600 25px Inter Display, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('9:41', pad + 46, pad + 36);
    for (let i = 0; i < 4; i++) g.fillRect(w - pad - 130 + i * 9, pad + 42 - (i + 1) * 5, 6, (i + 1) * 5);
    g.beginPath();
    g.roundRect(w - pad - 78, pad + 25, 44, 22, 7);
    g.fill();
    g.fillRect(w - pad - 32, pad + 31, 4, 10);
    // The island.
    g.fillStyle = '#000000';
    g.beginPath();
    g.roundRect(w / 2 - 60, pad + 18, 120, 36, 18);
    g.fill();
    g.restore();
    texture.needsUpdate = true;
  };
  return { texture, draw };
}

// `loop` (seconds) makes the sway close on itself, and `screen` pins one app screen, for the
// navigation avatar's clip; `manual` returns draw(t) to step the frames by hand.
export interface PhoneOptions {
  loop?: number;
  screen?: number;
  manual?: boolean;
}

export async function phone(canvas: HTMLCanvasElement, opts: PhoneOptions = {}) {
  const images = await Promise.all(SCREENS.map(loadImage));
  await document.fonts.ready;
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new PerspectiveCamera(24, 1, 0.1, 50);
  camera.position.set(0, 0, 7.2);

  const titanium = new MeshStandardMaterial({ color: '#b9b8b4', metalness: 1, roughness: 0.3 });
  const screen = makeScreen(images);
  const face = new MeshBasicMaterial({ map: screen.texture, transparent: true, toneMapped: false });
  // Glass over the app: dark, glossy, mostly clear, so the room slides across it as the phone turns.
  const glass = new MeshStandardMaterial({ alphaMap: roundedMask(), color: '#000000', metalness: 0.9, roughness: 0.07, transparent: true, opacity: 0.16, depthWrite: false });

  const group = new Group();
  group.add(new Mesh(new RoundedBoxGeometry(W, H, D, 10, 0.16), titanium));
  const front = new Mesh(new PlaneGeometry(W - 0.02, H - 0.02), face);
  front.position.z = D / 2 + 0.001;
  group.add(front);
  const sheen = new Mesh(new PlaneGeometry(W - 0.02, H - 0.02), glass);
  sheen.position.z = D / 2 + 0.003;
  group.add(sheen);
  // Side buttons: action, volume pair, and power on the other edge.
  for (const [y, len, side] of [
    [0.72, 0.1, -1],
    [0.5, 0.2, -1],
    [0.2, 0.2, -1],
    [0.46, 0.34, 1],
  ] as const) {
    const b = new Mesh(new RoundedBoxGeometry(0.03, len, 0.045, 2, 0.012), titanium);
    b.position.set(side * (W / 2 + 0.006), y, 0);
    group.add(b);
  }
  scene.add(group);

  const fit = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lx = 0;
  let ly = 0;
  let tx = 0;
  let ty = 0;
  addEventListener('pointermove', (e) => {
    tx = (e.clientX / innerWidth - 0.5) * 2;
    ty = (e.clientY / innerHeight - 0.5) * 2;
  });

  // Which screen is showing, and how far it has faded into the next.
  let shown = '';
  const showScreen = (t: number) => {
    if (opts.screen !== undefined) {
      if (shown === '') screen.draw(opts.screen, opts.screen, 0);
      shown = 'pinned';
      return;
    }
    const at = t % CYCLE_S;
    const slot = Math.floor(at / (HOLD_S + FADE_S));
    const into = at - slot * (HOLD_S + FADE_S);
    const mix = into < HOLD_S ? 0 : (into - HOLD_S) / FADE_S;
    const key = `${slot}:${mix.toFixed(2)}`;
    if (key === shown) return;
    shown = key;
    screen.draw(slot, (slot + 1) % SCREENS.length, mix);
  };

  const pose = (t: number) => {
    lx += (tx - lx) * 0.04;
    ly += (ty - ly) * 0.04;
    // With a loop, every sway is a whole number of turns of it.
    const w = opts.loop ? (2 * Math.PI) / opts.loop : null;
    group.rotation.y = -0.3 + Math.sin(w ? t * w : t * 0.55) * 0.38 + lx * 0.25;
    group.rotation.x = 0.06 + Math.sin(w ? t * w * 2 : t * 0.42) * 0.08 + ly * 0.15;
    group.rotation.z = -0.07 + Math.sin(w ? t * w : t * 0.5) * 0.035;
    group.position.y = Math.sin(w ? t * w * 2 : t * 0.9) * 0.08;
  };
  const draw = (t: number) => {
    fit();
    showScreen(t);
    pose(t);
    renderer.render(scene, camera);
  };
  if (opts.manual) return draw;
  if (still) return draw(0);
  const tick = (ms: number) => {
    requestAnimationFrame(tick);
    if (!document.hidden) draw(ms / 1000);
  };
  requestAnimationFrame(tick);
}
