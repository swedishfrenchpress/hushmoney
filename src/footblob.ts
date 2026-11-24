import { FRAGMENT, type Look, type Sound } from './listen/orb';

// The footer's full stop, shouting: the orb's liquid chrome, rippled by rings of sound that
// travel out from the front and crackling around its middle, harder while the laptop sings.
// A sphere as a grid of latitude and longitude, shaped every frame in the vertex shader and
// lit by the orb's own liquid chrome.

const VERTEX = /* glsl */ `
uniform float uTime, uLevel;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vFlat;
varying vec3 vTile;
const float PI = 3.14159265;
// Where a point of the grid ends up. u runs -1 to 1 from pole to pole, th around.
vec3 shape(float u, float th) {
  float pol = (u * 0.5 + 0.5) * PI;
  vec3 n = vec3(sin(pol) * cos(th), cos(pol), sin(pol) * sin(th));
  float a = acos(clamp(n.z, -1.0, 1.0));
  float rings = sin(a * 10.0 - uTime * 6.0) * 0.6 + sin(a * 23.0 - uTime * 11.0) * 0.25;
  float crackle = sin(th * 9.0 + uTime * 2.6) * sin(pol * 7.0 - uTime * 3.7);
  return n * (1.0 + (0.045 + uLevel * 0.13) * rings + (0.02 + uLevel * 0.07) * crackle);
}
void main() {
  float u = position.x;
  float th = position.y;
  vec3 p = shape(u, th);
  // The normal from two nearby points of the grid, so every ripple lights smoothly.
  vec3 du = shape(min(u + 0.002, 1.0), th) - shape(max(u - 0.002, -1.0), th);
  vec3 dt = shape(u, th + 0.01) - shape(u, th - 0.01);
  vec3 nrm = cross(du, dt);
  nrm = length(nrm) > 1e-9 ? normalize(nrm) : normalize(p);
  if (dot(nrm, p) < 0.0) nrm = -nrm;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vPos = world.xyz;
  vLocal = normalize(p);
  vNormal = normalize(mat3(modelMatrix) * nrm);
  vFlat = vNormal;
  vTile = vLocal;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

export interface Blob {
  look(next: Look): void;
}

// Draws the blob in `host`, on a canvas 1.6 times its size so it has room to ripple. Without
// WebGL, or with reduced motion, it returns null and the host's flat disc stays.
export async function makeBlob(host: HTMLElement, sound: () => Sound): Promise<Blob | null> {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  let THREE: typeof import('./listen/three');
  try {
    THREE = await import('./listen/three');
  } catch {
    return null;
  }
  let renderer: import('three').WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'orb';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);

  const camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 20);
  camera.position.z = 6;
  const uniforms = {
    uTime: { value: 0 },
    uLevel: { value: 0 },
    uGold: { value: 0 },
    uDim: { value: 0 },
    uWarn: { value: 0 },
    uTint: { value: [1, 1, 1] },
    uTintAmt: { value: 0 },
    uFacet: { value: 0 },
    uLiquid: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, side: THREE.DoubleSide });
  const geometry = new THREE.PlaneGeometry(2, Math.PI * 2, 160, 160);
  const mesh = new THREE.Mesh(geometry, material);
  const scene = new THREE.Scene();
  scene.add(mesh);

  const resize = () => renderer.setSize(host.clientWidth * 1.6, host.clientHeight * 1.6, false);
  resize();
  new ResizeObserver(resize).observe(host);

  let current: Look = 'drift';
  let level = 0;
  let last = performance.now();
  const tick = (now: number) => {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const s = sound();
    const want = current === 'listening' ? s.level * 1.5 : s.level;
    level += (want - level) * Math.min(1, dt * 8);
    uniforms.uTime.value += dt * (0.6 + level * 0.8);
    uniforms.uLevel.value = level;
    const t = uniforms.uTime.value;
    // Turning slowly, so the highlights slide across the chrome.
    mesh.rotation.set(Math.sin(t * 0.4) * 0.25, t * 0.3, 0);
    renderer.render(scene, camera);
  };
  requestAnimationFrame(tick);
  host.classList.add('gl');

  return {
    look(next) {
      current = next;
    },
  };
}
