import '../style.css';
import { footer } from '../footer';

// Good Music: albums I like, drifting around. Move the mouse (or a finger) and the
// ones near it swell and say what they are.

type Album = { cover: string; title: string; artist: string };

const ALBUMS: Album[] = [
  { cover: 'yeezus', title: 'Yeezus', artist: 'Kanye West' },
  { cover: 'oshin', title: 'Oshin', artist: 'DIIV' },
  { cover: 'gemini', title: 'Gemini', artist: 'Wild Nothing' },
  { cover: 'pray-for-paris', title: 'Pray for Paris', artist: 'Westside Gunn' },
  { cover: 'wwcd', title: 'WWCD', artist: 'Griselda' },
  { cover: 'paradise', title: 'The Essence', artist: 'Kareem Ali' },
  { cover: 'scenery', title: 'Scenery', artist: 'Ryo Fukui' },
  { cover: 'slowdive', title: 'Slowdive', artist: 'Slowdive' },
  { cover: 'forca-bruta', title: 'Força Bruta', artist: 'Jorge Ben Jor' },
  { cover: 'headache', title: 'Headache', artist: 'Headache' },
  { cover: 'blue-rev', title: 'Blue Rev', artist: 'Alvvays' },
  { cover: 'boxer', title: 'Boxer', artist: 'The National' },
  { cover: 'stillmatic', title: 'Stillmatic', artist: 'Nas' },
  { cover: 'hatful', title: 'Hatful of Hollow', artist: 'The Smiths' },
  { cover: 'operation-doomsday', title: 'Operation: Doomsday', artist: 'MF DOOM' },
  { cover: 'heaven-or-las-vegas', title: 'Heaven or Las Vegas', artist: 'Cocteau Twins' },
  { cover: 'graduation', title: 'Graduation', artist: 'Kanye West' },
  { cover: 'live-love-asap', title: 'Live.Love.A$AP', artist: 'A$AP Rocky' },
  { cover: 'the-unseen', title: 'The Unseen', artist: 'Quasimoto' },
  { cover: 'ecstatic', title: 'The Ecstatic', artist: 'Mos Def' },
  { cover: 'any-other-city', title: 'Any Other City', artist: 'Life Without Buildings' },
  { cover: 'unknown-death', title: 'Unknown Death 2002', artist: 'Yung Lean' },
  { cover: 'a-different-arrangement', title: 'A Different Arrangement', artist: 'Black Marble' },
  { cover: 'splendour-of-fear', title: 'The Splendour of Fear', artist: 'Felt' },
  { cover: 'playboi-carti', title: 'Playboi Carti', artist: 'Playboi Carti' },
  { cover: 'damn', title: 'DAMN.', artist: 'Kendrick Lamar' },
  { cover: 'burnt-out-by-3pm', title: 'Burnt Out by 3PM', artist: 'Witch Coast' },
  { cover: 'idle-labor', title: 'Idle Labor', artist: 'Craft Spells' },
  { cover: 'bloom', title: 'Bloom', artist: 'Beach House' },
  { cover: 'birds-in-the-trap', title: 'Birds in the Trap Sing McKnight', artist: 'Travis Scott' },
  { cover: 'daytona', title: 'Daytona', artist: 'Pusha T' },
  { cover: 'agent-intellect', title: 'The Agent Intellect', artist: 'Protomartyr' },
  { cover: 'shrines', title: 'Shrines', artist: 'Armand Hammer' },
  { cover: 'power-corruption-lies', title: 'Power, Corruption & Lies', artist: 'New Order' },
  { cover: 'mista-thug-isolation', title: 'Mista Thug Isolation', artist: 'Lil Ugly Mane' },
  { cover: 'giant-steps', title: 'Giant Steps', artist: 'John Coltrane' },
  { cover: 'lord-willin', title: "Lord Willin'", artist: 'Clipse' },
  { cover: 'budding-ornithologists', title: 'Budding Ornithologists Are Tired of Early Analogies', artist: 'Milo' },
  { cover: 'alps', title: 'Alps', artist: 'Motorama' },
  { cover: 'rough-travel', title: 'Rough Travel for a Rare Thing', artist: 'Bill Callahan' },
  { cover: 'college-dropout', title: 'The College Dropout', artist: 'Kanye West' },
  { cover: 'by-the-hedge', title: 'By the Hedge', artist: 'Minks' },
];
const root = document.querySelector<HTMLElement>('#music')!;
root.innerHTML = `
  <a class="pill back" href="/">Hush Money</a>
  <div class="gm-stage">
    <div class="gm-field" aria-hidden="true"></div>
    <h1>Good Music</h1>
    <p class="gm-label" aria-hidden="true"><span></span></p>
    <ul class="sr">${ALBUMS.map((a) => `<li>${a.title} by ${a.artist}</li>`).join('')}</ul>
  </div>
`;
const stage = root.querySelector<HTMLElement>('.gm-stage')!;
const field = root.querySelector<HTMLElement>('.gm-field')!;
const label = root.querySelector<HTMLElement>('.gm-label')!;
const labelText = label.querySelector<HTMLElement>('span')!;

// A value on a spring: where it is and how fast it's going. Springs keep their speed when
// the target changes, so a cover the cursor crosses quickly never snaps or restarts.
type Spring = { v: number; s: number };
const spring = (v = 0): Spring => ({ v, s: 0 });
const pull = (sp: Spring, to: number, stiff: number, damp: number, dt: number) => {
  sp.s += ((to - sp.v) * stiff - sp.s * damp) * dt;
  sp.v += sp.s * dt;
};

type Item = {
  el: HTMLElement;
  a: Album;
  x: number;
  y: number;
  // How fast it's moving now, and the slow drift it settles back to after a throw.
  vx: number;
  vy: number;
  driftX: number;
  driftY: number;
  size: number;
  tilt: number;
  phase: number;
  base: number;
  z: number;
  // What the cursor adds: a nudge aside, a swell, a lean toward the pointer, a press.
  ox: Spring;
  oy: Spring;
  grow: Spring;
  leanX: Spring;
  leanY: Spring;
  press: Spring;
  // Arriving: waits for its picture and its turn, then comes up from slightly small.
  show: Spring;
  wait: number;
  ready: boolean;
  landed: boolean;
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
let W = stage.clientWidth;
let H = stage.clientHeight;

// A phone's screen holds far fewer covers before they hide the title.
const shown = W < 600 ? ALBUMS.filter((_, i) => i % 2 === 0) : ALBUMS;

const items: Item[] = shown.map((a, i) => {
  const el = document.createElement('div');
  el.className = 'gm-album';
  el.style.opacity = '0';
  const img = document.createElement('img');
  img.alt = ''; // the covers drift and can't be reached in order: the list beside them names every album
  img.draggable = false;
  el.append(img);
  field.append(el);
  // Size is set once; all the motion is transform, so nothing re-lays out. Bigger ones
  // drift slower, like they're nearer.
  const size = rand(110, 230) * Math.min(1, Math.max(0.5, W / 1100));
  el.style.width = el.style.height = `${size}px`;
  const speed = (calm ? 0 : 16) / (size / 110);
  const dir = rand(0, Math.PI * 2);
  const driftX = Math.cos(dir) * speed;
  const driftY = Math.sin(dir) * speed;
  const it: Item = {
    el, a, x: rand(0, W), y: rand(0, H), vx: driftX, vy: driftY, driftX, driftY, size,
    tilt: rand(-6, 6), phase: rand(0, Math.PI * 2), base: i, z: -1,
    ox: spring(), oy: spring(), grow: spring(), leanX: spring(), leanY: spring(), press: spring(),
    show: spring(), wait: 0, ready: false, landed: false,
  };
  // A cover shows only once its picture is decoded, so none of them paint in halves.
  img.onload = () => (it.ready = true);
  // No cover file yet: a plain tile with the title.
  img.onerror = () => {
    el.replaceChildren(Object.assign(document.createElement('span'), { className: 'gm-blank', textContent: a.title }));
    it.ready = true;
  };
  img.src = `/music/${a.cover}.webp`;
  return it;
});
const byEl = new Map(items.map((it) => [it.el, it]));

// They arrive from the title outward, quickly at first and then closer and closer
// together, so it reads as one wave and not a queue.
const ARRIVE = calm ? 0 : 0.65;
[...items]
  .sort((p, q) => Math.hypot(p.x - W / 2, p.y - H / 2) - Math.hypot(q.x - W / 2, q.y - H / 2))
  .forEach((it, i, all) => (it.wait = ARRIVE * (1 - (1 - i / all.length) ** 2)));

let mx = -9999;
let my = -9999;
// The cover in the hand (mouse only: a finger scrolls the page), where it was taken hold
// of, and the pointer's last few positions, which become the throw.
let held: Item | null = null;
let gripX = 0;
let gripY = 0;
let trail: { x: number; y: number; t: number }[] = [];
let lifted: ReturnType<typeof setTimeout> | undefined;
const point = (e: PointerEvent) => {
  clearTimeout(lifted);
  const r = stage.getBoundingClientRect();
  mx = e.clientX - r.left;
  my = e.clientY - r.top;
  if (held) {
    trail.push({ x: mx, y: my, t: e.timeStamp });
    while (trail.length > 2 && e.timeStamp - trail[0].t > 90) trail.shift();
  }
};
addEventListener('pointermove', point);
// A finger doesn't hover: a tap or a press on the stage counts as pointing there.
stage.addEventListener('pointerdown', (e) => e.pointerType !== 'mouse' && point(e));
const letGo = () => (clearTimeout(lifted), held || ((mx = -9999), (my = -9999)));
// (A lifting finger also 'leaves'; that one is pointerup's to handle.)
document.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && letGo());
// A finger that lifts leaves the album it touched up for a moment, long enough to read
// its name; one that turns into a scroll leaves nothing under it.
addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse') return;
  clearTimeout(lifted);
  lifted = setTimeout(letGo, 1800);
});
addEventListener('pointercancel', letGo);
new ResizeObserver(() => ((W = stage.clientWidth), (H = stage.clientHeight))).observe(stage);

field.addEventListener('pointerdown', (e) => {
  const it = byEl.get((e.target as HTMLElement).closest<HTMLElement>('.gm-album')!);
  if (!it || held || e.pointerType === 'touch' || e.button !== 0) return;
  e.preventDefault();
  point(e);
  // The nudge it had becomes part of where it is, so it doesn't jump when taken.
  it.x += it.ox.v;
  it.y += it.oy.v;
  it.ox = spring();
  it.oy = spring();
  held = it;
  gripX = it.x - mx;
  gripY = it.y - my;
  trail = [{ x: mx, y: my, t: e.timeStamp }];
  it.el.setPointerCapture(e.pointerId);
  stage.classList.add('is-holding');
});
const release = (e: PointerEvent) => {
  if (!held) return;
  point(e);
  // It leaves the hand at the speed the hand was moving, then eases back to its drift.
  const a = trail[0];
  const b = trail[trail.length - 1];
  const dt = (b.t - a.t) / 1000;
  if (!calm && dt > 0.01) {
    const vx = (b.x - a.x) / dt;
    const vy = (b.y - a.y) / dt;
    const fast = Math.min(1, 2600 / (Math.hypot(vx, vy) || 1));
    held.vx = vx * fast;
    held.vy = vy * fast;
  }
  held = null;
  stage.classList.remove('is-holding');
};
field.addEventListener('pointerup', release);
field.addEventListener('pointercancel', release);

const REACH = W < 600 ? 170 : 300;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
// Frame-rate independent easing toward a target: k is how quickly (per second) it settles.
const ease = (k: number, dt: number) => 1 - Math.exp(-k * dt);
let last = performance.now();
let began = 0;
let current: Item | null = null;

// The caption comes up when a cover is under the cursor and goes (quicker) when none is.
// Going from one cover straight to the next it stays put and only the words change, under
// a short blur so the swap doesn't read as two captions.
function caption(it: Item | null) {
  if (!it) return label.removeAttribute('data-on');
  const swap = label.hasAttribute('data-on');
  labelText.textContent = `${it.a.title} 🪩 ${it.a.artist}`;
  label.setAttribute('data-on', '');
  if (swap && !calm) labelText.animate([{ opacity: 0.35, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 180, easing: EASE_OUT });
}

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  began ||= now;
  const t = now / 1000;
  const age = (now - began) / 1000;
  let nearest: Item | null = null;
  let nearestD = REACH;
  for (const it of items) {
    // On top of the drift, a gentle bob and sway, each album on its own slow rhythm.
    const bobX = calm ? 0 : Math.sin(t * 0.31 + it.phase) * 9;
    const bobY = calm ? 0 : Math.sin(t * 0.43 + it.phase * 1.7) * 12;
    const sway = calm ? 0 : Math.sin(t * 0.27 + it.phase * 2.3) * 2.5;
    if (it === held) {
      // In the hand it is the pointer: no easing, no spring.
      it.x = mx + gripX - bobX;
      it.y = my + gripY - bobY;
      it.vx = it.vy = 0;
    } else {
      // A slow straight drift, wrapping once fully off screen. A thrown cover glides and
      // slows back down to it.
      it.vx += (it.driftX - it.vx) * ease(1.9, dt);
      it.vy += (it.driftY - it.vy) * ease(1.9, dt);
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      const m = it.size * 1.2;
      if (it.x < -m) it.x = W + m;
      if (it.x > W + m) it.x = -m;
      if (it.y < -m) it.y = H + m;
      if (it.y > H + m) it.y = -m;
    }
    // Distance is measured from where the album would be without the cursor's push, so
    // pushing it away can't shrink it again (that feedback was the flicker).
    const cx = it.x + bobX;
    const cy = it.y + bobY;
    // The cursor nudges albums aside and swells the near ones; both spring back when it leaves.
    const dx = cx - mx;
    const dy = cy - my;
    const d = Math.hypot(dx, dy);
    const near = it === held ? 1 : Math.max(0, 1 - d / REACH);
    const push = it === held || calm ? 0 : near * near * 38;
    pull(it.ox, d > 1 ? (dx / d) * push : 0, 42, 11, dt);
    pull(it.oy, d > 1 ? (dy / d) * push : 0, 42, 11, dt);
    // The swell overshoots a touch and settles, like something with a little weight.
    pull(it.grow, near * near * (3 - 2 * near), calm ? 90 : 130, calm ? 19 : 17, dt);
    pull(it.press, it === held ? 1 : 0, 320, 30, dt);
    // The one under the cursor leans toward it, as if pressed at that spot.
    const scale = 1 + it.grow.v * 0.8;
    const half = (it.size * scale) / 2;
    const lean = it === current && !calm ? 9 : 0;
    pull(it.leanY, clamp((mx - cx - it.ox.v) / half, -1, 1) * lean, 90, 14, dt);
    pull(it.leanX, clamp((my - cy - it.oy.v) / half, -1, 1) * -lean, 90, 14, dt);
    if (d < nearestD) ((nearest = it), (nearestD = d));

    if (!it.landed && it.ready && age >= it.wait) {
      pull(it.show, 1, 110, 21, dt);
      it.landed = it.show.v > 0.999;
      it.el.style.opacity = it.landed ? '1' : String(clamp(it.show.v * 1.6, 0, 1));
    }
    const arrive = calm || it.landed ? 1 : 0.9 + 0.1 * it.show.v;
    const g = Math.max(0, it.grow.v);
    it.el.style.transform =
      `translate3d(${it.x + bobX + it.ox.v - it.size / 2}px, ${it.y + bobY + it.oy.v - it.size / 2}px, 0) ` +
      `perspective(900px) rotateX(${it.leanX.v}deg) rotateY(${it.leanY.v}deg) ` +
      `rotate(${(it.tilt + sway) * (1 - Math.min(1, g))}deg) scale(${scale * arrive * (1 - it.press.v * 0.04)})`;
    // Stable stacking: a fixed order for every album, with the hovered one on top and ones
    // still shrinking back just above the resting ones. Never re-sorted by grow, so albums
    // passing each other don't swap places frame to frame (that was the flicker).
    const z = it.base + (it === current ? 500 : g > 0.02 ? 200 : 0);
    if (z !== it.z) it.el.style.zIndex = String((it.z = z));
  }
  // Switch the hovered album only when another is clearly nearer, so two close ones
  // don't trade the top spot every frame. The one in the hand always wins.
  if (held) nearest = held;
  const curD = current ? Math.hypot(current.x - mx, current.y - my) : Infinity;
  if (nearest !== current && (held || !current || curD >= REACH || nearestD < curD * 0.8)) {
    current = nearest;
    caption(current);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

footer(root);
