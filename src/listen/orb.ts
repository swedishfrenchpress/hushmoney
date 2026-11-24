// The listening orb: a silver disco ball, magical.cash's material, that
// ripples with what the mic hears and turns into a pale chrome coin when a song lands.
// Three.js, loaded after the page is up so the button works at once. Without
// WebGL, or with reduced motion, the page keeps its flat disc instead.

export type Look = 'idle' | 'listening' | 'drift' | 'sending' | 'heard' | 'catching' | 'caught' | 'landed' | 'gone' | 'timeout' | 'denied';

export interface Orb {
  look(next: Look): void;
  destroy(): void;
}

// The room, 0 to 1: how loud, and how sudden (the level jumping above where it's been lately).
export interface Sound {
  level: number;
  kick: number;
}
const QUIET: Sound = { level: 0, kick: 0 };

// Where each look takes the shader, eased toward by springs.
const TARGETS: Record<Look, { lock: number; swirl: number; coin: number; gold: number; dim: number; warn: number; scale: number; melt: number }> = {
  idle: { lock: 0, swirl: 0, coin: 0, gold: 0.08, dim: 0, warn: 0, scale: 1, melt: 0 },
  listening: { lock: 0.35, swirl: 0.55, coin: 0, gold: 0.12, dim: 0, warn: 0, scale: 1.02, melt: 0 },
  // A slow swirl and nothing else: the footer's dot.
  drift: { lock: 0, swirl: 1.3, coin: 0, gold: 0, dim: 0, warn: 0, scale: 1, melt: 0 },
  sending: { lock: 0, swirl: 1.2, coin: 0, gold: 1, dim: 0, warn: 0, scale: 0.95, melt: 1 },
  heard: { lock: 1, swirl: 0, coin: 0, gold: 0.55, dim: 0, warn: 0, scale: 1.03, melt: 0 },
  catching: { lock: 0.35, swirl: 1, coin: 0, gold: 0.8, dim: 0, warn: 0, scale: 1, melt: 0 },
  caught: { lock: 0, swirl: 0, coin: 1, gold: 1, dim: 0, warn: 0, scale: 1, melt: 0 },
  landed: { lock: 0, swirl: 0, coin: 1, gold: 1, dim: 0, warn: 0, scale: 1, melt: 0 },
  gone: { lock: 0, swirl: 0, coin: 0, gold: 0, dim: 0.85, warn: 0, scale: 0.9, melt: 0 },
  timeout: { lock: 0, swirl: 0, coin: 0, gold: 0, dim: 0.45, warn: 0, scale: 0.96, melt: 0 },
  denied: { lock: 0, swirl: 0, coin: 0, gold: 0, dim: 0.6, warn: 1, scale: 0.94, melt: 0 },
};

const VERTEX = /* glsl */ `
uniform float uTime, uLevel, uLock, uSwirl, uCoin, uMelt;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vFlat;
varying vec3 vTile;
attribute vec3 posB;
attribute vec3 posC;
// Where a point of the unit sphere ends up: the ball, rippled by the room, or the coin.
vec3 shape(vec3 n) {
  float a = acos(clamp(n.z, -1.0, 1.0)); // 0 facing the laptop, pi at the back
  // Calm at the silhouette, so the ball keeps one clean outline.
  float face = smoothstep(1.75, 0.2, a);
  float breath = 0.024 * sin(uTime * 1.6);
  // Sound arriving from the front: rings that travel out over the ball, as loud as the room.
  float listen = uLevel * 0.14 * sin(a * 12.0 - uTime * 7.5) * face;
  // Locked on: tight, even waves, deeper as the song gets louder.
  float lock = uLock * (0.022 + uLevel * 0.03) * sin(a * 20.0 - uTime * 11.0) * face;
  // Claiming: a swirl around the axis.
  float swirl = uSwirl * 0.03 * sin(atan(n.y, n.x + 1e-4) * 6.0 + a * 7.0 - uTime * 9.0) * face;
  vec3 p = n * (1.0 + (breath + listen + lock + swirl) * (1.0 - uCoin));
  // Melting: the lower half sags into lobes that slide around, like the coin is running off to be sent.
  float lobes = 0.45 + 0.55 * sin(atan(n.z, n.x + 1e-4) * 4.0 + uTime * 5.0 + n.y * 3.0);
  p.y -= uMelt * (1.0 - n.y) * 0.25 * lobes;
  p.xz *= 1.0 - uMelt * 0.1 * (1.0 - n.y);
  // A coin: flattened front to back, a little wider.
  p.z *= mix(1.0, 0.12, uCoin);
  p.xy *= mix(1.0, 1.05, uCoin);
  return p;
}
void main() {
  vec3 n = normalize(position);
  // The surface's normal from two nearby points, so the ripples light smoothly.
  vec3 t1 = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(n, t1);
  vec3 p = shape(n);
  vec3 nrm = normalize(cross(shape(normalize(n + t1 * 0.003)) - p, shape(normalize(n + t2 * 0.003)) - p));
  if (dot(nrm, n) < 0.0) nrm = -nrm;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vPos = world.xyz;
  vLocal = n;
  vNormal = normalize(mat3(modelMatrix) * nrm);
  // A faceted ball's flat normal and tile id, from the triangle's three corners (the other two
  // arrive as attributes), so every pixel of a facet agrees and none can come out degenerate.
  vec3 nb = normalize(posB);
  vec3 nc = normalize(posC);
  vec3 fn = cross(shape(nb) - p, shape(nc) - p);
  vFlat = length(fn) > 1e-9 ? normalize(mat3(modelMatrix) * fn) : vNormal;
  vTile = normalize(n + nb + nc);
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

export const FRAGMENT = /* glsl */ `
uniform float uGold, uDim, uWarn, uTintAmt, uFacet, uLiquid;
uniform float uTime;
uniform vec3 uTint;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vFlat;
varying vec3 vTile;
// A dark studio: a dim floor, a bright soft horizon, a key light, a cool rim, and a broad soft front.
vec3 studio(vec3 r) {
  vec3 c = mix(vec3(0.015), vec3(0.07), smoothstep(-0.7, 0.3, r.y));
  c += vec3(1.0) * pow(max(0.0, 1.0 - abs(r.y - 0.12) * 3.2), 7.0) * 0.85;
  c += vec3(1.0) * pow(max(0.0, dot(r, normalize(vec3(-0.55, 0.65, 0.5)))), 48.0) * 1.8;
  c += vec3(0.75, 0.82, 1.0) * pow(max(0.0, dot(r, normalize(vec3(0.75, 0.15, 0.55)))), 16.0) * 0.55;
  c += vec3(1.0) * pow(max(0.0, dot(r, normalize(vec3(0.0, 0.25, 1.0)))), 3.0) * 0.22;
  return c;
}
// Trick 1's liquid chrome: its studio (grey sky, black floor, crisp horizon, softboxes, two coloured
// fills) and its thin-film sheen toward the rim.
float softbox(vec3 d, vec3 l, vec3 up, vec2 size, float soft) {
  float c = dot(d, l);
  if (c <= 0.0) return 0.0;
  vec3 u = normalize(up - l * dot(up, l));
  vec3 v = cross(l, u);
  vec2 q = abs(vec2(dot(d, u), dot(d, v)) / c) - size;
  return 1.0 - smoothstep(-soft, soft, max(q.x, q.y));
}
vec3 goo(vec3 d) {
  vec3 sky = mix(vec3(0.12, 0.125, 0.14), vec3(0.42, 0.44, 0.48), smoothstep(0.0, 0.85, d.y));
  vec3 ground = mix(vec3(0.035, 0.035, 0.04), vec3(0.006), smoothstep(0.0, -0.5, d.y));
  vec3 col = mix(ground, sky, smoothstep(-0.015, 0.015, d.y));
  col += vec3(0.8, 0.85, 0.9) * exp(-abs(d.y - 0.01) * 70.0) * 0.6;
  col += vec3(1.0) * 5.0 * softbox(d, normalize(vec3(0.2, 1.0, 0.35)), vec3(1, 0, 0), vec2(1.4, 0.18), 0.08);
  col += vec3(0.9, 0.95, 1.0) * 3.5 * softbox(d, normalize(vec3(-1.0, 0.15, 0.4)), vec3(0, 1, 0), vec2(0.6, 0.12), 0.06);
  col += vec3(1.0, 0.96, 0.92) * 2.5 * softbox(d, normalize(vec3(1.0, 0.05, -0.2)), vec3(0, 1, 0), vec2(0.8, 0.2), 0.08);
  col += vec3(0.25, 0.45, 1.0) * 0.35 * pow(max(dot(d, normalize(vec3(-0.8, -0.3, 0.5))), 0.0), 3.0);
  col += vec3(1.0, 0.35, 0.6) * 0.28 * pow(max(dot(d, normalize(vec3(0.9, -0.4, 0.3))), 0.0), 3.0);
  return col;
}
void main() {
  vec3 n = normalize(vNormal);
  // Faceted: each triangle's own flat normal, so the ball is a cut gem or a mirror ball.
  if (uFacet > 0.5) n = normalize(vFlat);
  vec3 v = normalize(cameraPosition - vPos);
  if (dot(n, v) < 0.0) n = -n;
  if (uLiquid > 0.5) {
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    vec3 f0 = vec3(0.86, 0.87, 0.9);
    vec3 fr = f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0);
    float thick = 0.5 + 0.5 * sin(dot(vLocal, vec3(2.1, 3.3, 1.7)) * 2.2 + uTime * 0.5);
    vec3 film = 0.5 + 0.5 * cos(6.2831853 * (thick * 1.6 + ndv * 0.9 + vec3(0.0, 0.33, 0.67)));
    float rim = pow(1.0 - ndv, 2.0);
    vec3 lc = goo(reflect(-v, n)) * fr * mix(vec3(1.0), film, 0.08 + 0.4 * rim);
    gl_FragColor = vec4(lc, 1.0);
    return;
  }
  vec3 env = studio(reflect(-v, n));
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 chrome = env * 0.95 + fres * 0.22;
  // The coin is pale chrome on the green page, not gold.
  vec3 gold = env * vec3(1.0, 1.0, 0.96) * 1.3 + vec3(0.34, 0.34, 0.31) + fres * vec3(1.0, 1.0, 0.95) * 0.4;
  vec3 c = mix(chrome, gold, uGold);
  c = mix(c, vec3(dot(c, vec3(0.3, 0.4, 0.3))) * 0.38, uDim);
  c += uWarn * fres * vec3(1.0, 0.36, 0.30) * 0.9;
  // An optional tint: chrome in a colour, the key light staying near white.
  float hi = smoothstep(0.7, 1.5, max(c.r, max(c.g, c.b)));
  c = mix(c, mix(c * uTint * 1.25 + uTint * 0.04, vec3(1.0), hi * 0.55), uTintAmt);
  if (uFacet > 0.5) {
    // Mirror tiles: each one tilted a hair differently, so some are dark and a few flash white.
    // Hashed from the tile's place on the ball (not the view), so each keeps its own shade as it turns.
    vec3 tile = vTile;
    float h = fract(sin(dot(tile, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    c *= 0.8 + 0.4 * h;
  }
  gl_FragColor = vec4(c, 1.0);
}`;

// A spring toward a target: `k` stiffness, `d` damping. Under-damped springs overshoot.
class Spring {
  v = 0;
  constructor(
    public x: number,
    private k = 90,
    private d = 2 * Math.sqrt(90),
  ) {}
  step(target: number, dt: number) {
    this.v += (this.k * (target - this.x) - this.d * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

export interface OrbOptions {
  tint?: [number, number, number]; // chrome in this colour, 0 to 1 each
  speed?: number; // how fast its time runs, 1 is normal
  faceted?: boolean; // silver mirror tiles (the default); false for smooth chrome
  liquid?: boolean; // smooth, in trick 1's liquid chrome and its studio
}

export async function makeOrb(host: HTMLElement, sound: () => Sound, options: OrbOptions = {}): Promise<Orb | null> {
  const opts = { faceted: true, ...options };
  if (opts.liquid) opts.faceted = false;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  let THREE: typeof import('./three');
  try {
    THREE = await import('./three');
  } catch {
    return null;
  }
  let renderer: import('three').WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null; // no WebGL: the flat disc stays
  }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'orb';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);

  const scene = new THREE.Scene();
  // The canvas is 1.6 times the button, so the ball has room to swell and ripple.
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.z = 1.6 / Math.tan((15 * Math.PI) / 180);
  const uniforms = {
    uTime: { value: 0 },
    uLevel: { value: 0 },
    uLock: { value: 0 },
    uSwirl: { value: 0 },
    uCoin: { value: 0 },
    uMelt: { value: 0 },
    uGold: { value: 0 },
    uDim: { value: 0 },
    uWarn: { value: 0 },
    uTint: { value: opts.tint ?? [1, 1, 1] },
    uTintAmt: { value: opts.tint ? 1 : 0 },
    uFacet: { value: opts.faceted ? 1 : 0 },
    uLiquid: { value: opts.liquid ? 1 : 0 },
  };
  const material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms });
  const geometry: import('three').BufferGeometry = new THREE.IcosahedronGeometry(1, opts.faceted ? 5 : 36); // 720 mirror tiles, or about 27k triangles of smooth chrome
  if (opts.faceted) {
    // One flat triangle per facet, each vertex also knowing the triangle's other two corners.
    const flat = geometry; // an icosahedron is already one triangle per three vertices
    const at = flat.getAttribute('position');
    const b = new Float32Array(at.count * 3);
    const c = new Float32Array(at.count * 3);
    for (let i = 0; i < at.count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const o = (i + ((k + 1) % 3)) * 3;
        const q = (i + ((k + 2) % 3)) * 3;
        b.set([at.array[o]!, at.array[o + 1]!, at.array[o + 2]!], (i + k) * 3);
        c.set([at.array[q]!, at.array[q + 1]!, at.array[q + 2]!], (i + k) * 3);
      }
    }
    flat.setAttribute('posB', new THREE.BufferAttribute(b, 3));
    flat.setAttribute('posC', new THREE.BufferAttribute(c, 3));
  } else {
    // Smooth shading never reads them; they just have to be real points.
    const same = Float32Array.from(geometry.getAttribute('position').array);
    geometry.setAttribute('posB', new THREE.BufferAttribute(same, 3));
    geometry.setAttribute('posC', new THREE.BufferAttribute(same, 3));
  }
  const ball = new THREE.Mesh(geometry, material);
  scene.add(ball);

  const resize = () => {
    const size = host.clientWidth * 1.6;
    renderer.setSize(size, size, false);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  let current: Look = 'idle';
  const s = {
    level: new Spring(0, 160),
    lock: new Spring(0, 60),
    swirl: new Spring(0, 50),
    coin: new Spring(0, 140, 9), // under-damped: the coin lands with a little bounce
    gold: new Spring(0, 30),
    dim: new Spring(0, 25),
    warn: new Spring(0, 40),
    melt: new Spring(0, 30, 10),
    scale: new Spring(1, 300, 13), // under-damped: a punch makes the ball bounce
  };
  let flip = 0; // the coin turns once as it forms, and again when it lands in a wallet
  let spin = 0;
  let shake = 0;
  let last = performance.now();
  let frame = 0;
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = TARGETS[current];
    const { level, kick } = current === 'listening' || current === 'heard' ? sound() : QUIET;
    uniforms.uTime.value += dt * (opts.speed ?? 1);
    const time = uniforms.uTime.value;
    uniforms.uLevel.value = Math.max(0, s.level.step(level, dt));
    uniforms.uLock.value = s.lock.step(t.lock, dt);
    uniforms.uSwirl.value = s.swirl.step(t.swirl, dt);
    uniforms.uCoin.value = Math.max(0, s.coin.step(t.coin, dt));
    uniforms.uGold.value = s.gold.step(t.gold, dt);
    uniforms.uDim.value = s.dim.step(t.dim, dt);
    uniforms.uWarn.value = s.warn.step(t.warn, dt);
    uniforms.uMelt.value = Math.max(0, s.melt.step(t.melt, dt));
    // The room pushes the ball out: a loud room swells it, a sudden sound punches it.
    ball.scale.setScalar(s.scale.step(t.scale + level * 0.12 + Math.min(kick, 0.4) * 0.5, dt));
    // And shakes it like a speaker cone: hard on a sudden sound, a tremble while it stays loud.
    const quake = Math.min(1, level * 0.7 + kick * 3);
    shake = quake > shake ? quake : shake * Math.exp(-dt * 5);
    ball.position.set(
      (Math.sin(time * 47) + Math.sin(time * 71 + 2) * 0.5) * shake * 0.022,
      (Math.sin(time * 53 + 1) + Math.sin(time * 83) * 0.5) * shake * 0.022,
      0,
    );
    if (current === 'caught' || current === 'landed') {
      flip = Math.min(1, flip + dt / 0.9);
      ball.rotation.set(0, (1 - (1 - flip) ** 3) * Math.PI * 2, 0);
    } else {
      // A slow drift, so the highlights slide across the chrome.
      spin += dt * (current === 'catching' ? 1.6 : current === 'sending' ? 2.4 : current === 'listening' ? 0.6 : opts.faceted ? 0.55 : 0.18);
      ball.rotation.set(Math.sin(spin * 0.7) * 0.25, spin, Math.sin(time * 37) * shake * 0.05);
    }
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(tick);
  host.classList.add('gl');

  return {
    look(next) {
      if (next === 'caught' && current !== 'caught') flip = 0;
      // Landed: the coin turns over once more, with a pop.
      if (next === 'landed' && current !== 'landed') {
        flip = 0;
        s.scale.v += 4;
      }
      current = next;
    },
    destroy() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      canvas.remove();
      host.classList.remove('gl');
    },
  };
}
