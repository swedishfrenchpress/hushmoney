import '../style.css';
import { bell, playTune } from '../bell';
import { btc } from '../btc';
import { footer } from '../footer';
import { makeOrb } from '../listen/orb';
import { degreeHz, NOTE_NAMES, tune } from '../melody';
import { ladder as ladderMarkup } from '../tuneLadder';

// How Hush Money works, as a picture book: four short chapters, each with a
// drawing. The bytes rolled in chapter 1 are the very ones the tune in chapter 2
// is made from.
//
// Two ways to read it. Simple, the default, is the picture book. Advanced adds the
// technical detail under each chapter (the song's format, ggwave's tones, the Cashu
// steps); /how#advanced opens it that way.

const root = document.querySelector<HTMLElement>('#how')!;

const NAME = (d: number) => NOTE_NAMES[d % 5]!;
// A song as it really is: the format byte (format 3, mint 2), then 16 random bytes of seed.
const HEAD = 0x32;
const rollBytes = () => {
  const b = crypto.getRandomValues(new Uint8Array(17));
  b[0] = HEAD;
  return b;
};
const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ');
let bytes = rollBytes();

// ---- the page ----
root.innerHTML = `
  <a class="pill back" href="/">Hush Money</a>
  <h1>How it works</h1>
  <div class="mode" role="group" aria-label="How much detail">
    <button class="pill" type="button" data-mode="simple" aria-pressed="true">Simple</button>
    <button class="pill" type="button" data-mode="advanced" aria-pressed="false">Advanced</button>
  </div>

  <section class="chap" id="c1">
    <p class="num">1</p>
    <div class="say"><h2>A secret is made.</h2><p>17 bytes. That is the whole song.</p>
      <div class="deep">
        <p>The first byte is 0x32: format 3, mint 2 (Minibits). The other 16 are a random seed.</p>
        <p>Before the song is ever sung, 21 sats of ecash are made from that seed. Each coin's secret and blinding factor are derived from it (NUT-13), so whoever holds the seed can rebuild the coins. The song is the money.</p>
      </div>
    </div>
    <div class="art">
      <svg class="bytes" viewBox="0 0 340 84" role="img" aria-label="The song's 17 bytes, each drawn as a bar">
        ${Array.from({ length: 17 }, (_, i) => `<rect class="bar${i === 0 ? ' head' : ''}" x="${i * 20 + 1}" width="8" rx="4" />`).join('')}
      </svg>
      <p class="hex deep" aria-label="The 17 bytes in hex"></p>
      <button class="pill roll" type="button">Roll another</button>
    </div>
  </section>

  <section class="chap" id="c2">
    <p class="num">2</p>
    <div class="say"><h2>The laptop sings it.</h2><p>The secret becomes sound, with a tune laid under it. Each byte nudges the tune up or down. It always ends on E, home.</p>
      <div class="deep">
        <p>The secret travels as ggwave's audible fast mode: 96 tones, 46.875 Hz apart, from 1,875 Hz up. Each beat plays six at once, one from each band of 16, so a beat carries three bytes. Error-correcting bytes ride along, and the whole song lasts under two seconds.</p>
        <p>A three-note chime (E5, G♯5, B5) opens it, and the tune sits below 1.8 kHz, under the data, so the decoder never takes it for bytes. The tune is a walk on E major pentatonic: the low three bits of each byte step it up or down.</p>
      </div>
    </div>
    <div class="art">
      <svg class="ladder" viewBox="0 0 360 200" role="img" aria-label="The tune as steps up and down the scale"></svg>
      <button class="pill play" type="button">Play the tune</button>
      <div class="keys" role="group" aria-label="The five notes, two octaves">
        ${Array.from({ length: 10 }, (_, d) => `<button class="key" type="button" data-d="${d}" aria-label="${NAME(d)}">${NAME(d)}</button>`).join('')}
      </div>
      <p class="hint">Only five notes, so any order sounds right. Press them.</p>
    </div>
  </section>

  <section class="chap" id="c3">
    <p class="num">3</p>
    <div class="say"><h2>The phone listens.</h2><p>It hears the notes and reads the secret back.</p>
      <div class="deep">
        <p>The mic's sound is resampled to 48 kHz and handed to ggwave in frames of 1,024 samples, all on the phone. Nothing is recorded and no sound leaves it.</p>
        <p>When 17 bytes come out and the first says format 3, the phone has the seed. It asks the mint which coins that seed made (a restore, NUT-09) and gets them back, signed.</p>
      </div>
    </div>
    <div class="art">
      <div class="air-row">
        <svg class="air-art" viewBox="14 8 128 124" role="img" aria-label="Sound spreading out from a laptop">
          <circle class="src" cx="26" cy="70" r="7" />
          ${[22, 44, 66, 88, 110]
            .map((r, i) => {
              const x = (a: number) => (26 + r * Math.cos(a)).toFixed(1);
              const y = (a: number) => (70 + r * Math.sin(a)).toFixed(1);
              const t = 0.55;
              return `<path class="arc" style="--i:${i}" d="M${x(-t)} ${y(-t)} A${r} ${r} 0 0 1 ${x(t)} ${y(t)}" />`;
            })
            .join('')}
        </svg>
        <canvas class="how-phone" aria-hidden="true"></canvas>
      </div>
    </div>
  </section>

  <section class="chap" id="c4">
    <p class="num">4</p>
    <div class="say"><h2>The coins are yours.</h2><p>Open them in a Cashu wallet.</p>
      <div class="deep">
        <p>Everyone in the room heard the same seed, so the phone swaps the coins at once for new ones whose secrets only it knows. The mint honours the first swap; anyone later finds the coins spent.</p>
        <p>The swap is written down before it is sent, so a lost connection or a closed tab can't lose it: the phone asks again (NUT-19), then asks what the mint signed (NUT-09). The laptop watches the same coins at the mint (NUT-17) and says Caught the moment they are spent.</p>
      </div>
    </div>
    <div class="art">
      <div class="coin" role="img" aria-label="21 sats"><span class="disc"></span><span class="face">${btc(21)}</span></div>
    </div>
  </section>

  <p class="hush">Anyone within earshot can catch it. The first phone wins. Hush.</p>
`;

// ---- chapters 1 and 2: the bytes, and the tune made from them ----
const cells = root.querySelector<SVGSVGElement>('.bytes')!;
const ladder = root.querySelector<SVGSVGElement>('.ladder')!;
const NOTES = 9;

const hexLine = root.querySelector<HTMLElement>('.hex')!;

function drawBytes() {
  hexLine.textContent = hex(bytes);
  const bars = cells.querySelectorAll<SVGRectElement>('.bar');
  bytes.forEach((v, i) => {
    const h = 14 + (v / 255) * 62;
    bars[i]!.style.height = `${h}px`;
    bars[i]!.style.y = `${80 - h}px`;
  });
}

function drawLadder(lit = -1) {
  ladder.innerHTML = ladderMarkup(tune(bytes, NOTES), 360, 200, lit);
}

function rollAgain() {
  bytes = rollBytes();
  drawBytes();
  drawLadder();
}

function playThisTune() {
  playTune(tune(bytes, NOTES), (i) => drawLadder(i));
  setTimeout(() => drawLadder(), NOTES * 220 + 400);
}

root.querySelector('.roll')!.addEventListener('click', rollAgain);
root.querySelector('.play')!.addEventListener('click', playThisTune);
drawBytes();
drawLadder();

// ---- chapter 2: the five notes ----
for (const key of root.querySelectorAll<HTMLButtonElement>('.key')) {
  key.addEventListener('click', () => {
    bell(degreeHz(Number(key.dataset.d)));
    key.classList.add('on');
    setTimeout(() => key.classList.remove('on'), 450);
  });
}

// The same floating phone as the home page, showing the listener while it listens.
void import('../sing/phone3d').then((m) => m.phone(root.querySelector<HTMLCanvasElement>('.how-phone')!, { screen: 1 })).catch(() => root.querySelector('.how-phone')?.setAttribute('hidden', ''));

// ---- simple or advanced ----
const modeButtons = [...root.querySelectorAll<HTMLButtonElement>('.mode .pill')];
function setMode(mode: 'simple' | 'advanced', remember = true) {
  root.dataset.mode = mode;
  for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  if (remember) history.replaceState(null, '', mode === 'advanced' ? '#advanced' : location.pathname + location.search);
}
for (const b of modeButtons) b.addEventListener('click', () => setMode(b.dataset.mode === 'advanced' ? 'advanced' : 'simple'));
addEventListener('hashchange', () => setMode(location.hash === '#advanced' ? 'advanced' : 'simple', false));
setMode(location.hash === '#advanced' ? 'advanced' : 'simple', false);

footer(root);

// Chapter 4's coin is the listener app's silver coin: it turns over once when it scrolls into view.
// Without WebGL, or with reduced motion, the flat silver disc stays.
const coin = root.querySelector<HTMLElement>('.coin')!;
void makeOrb(coin, () => ({ level: 0, kick: 0 }), { faceted: false }).then((orb) => {
  if (!orb) return;
  const seen = new IntersectionObserver(([e]) => {
    if (!e?.isIntersecting) return;
    seen.disconnect();
    orb.look('caught');
    coin.classList.add('turned');
  }, { threshold: 0.6 });
  seen.observe(coin);
});
