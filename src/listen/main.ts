import '../style.css';
import { normalizeProofAmounts } from '@cashu/cashu-ts';
import { audio, playTune } from '../bell';
import { btc } from '../btc';
import { songTune } from '../melody';
import { ladder } from '../tuneLadder';
import { DestinationError, nameOf, parseDestination, type Destination } from '../../shared/destination';
import { LnurlError } from '../../shared/lnurl';
import { MINTS, fromHex, packSong, unpackSong, type Song } from '../../shared/song';
import { air, type AirSong } from '../air';
import { api } from '../api';
import { BLOCK, decoder, warmGgwave, type Decoder } from '../ggwave';
import { NotSent, sendToRequest } from './forward';
import { Lightning, MIN_LIGHTNING, type LnOp } from './lightning';
import { openMic, type Mic } from './mic';
import { makeOrb, type Look, type Orb, type Sound } from './orb';
import { Vault, VaultError } from './vault';
import { PhoneWallet } from './wallet';

// The phone: one big button. Tap it, hold the phone near the laptop, and the
// song turns into sats held in this browser, ready to send on to a wallet.

// The real mint, Minibits. The test mint (testnut) only for development and the tests: VITE_TEST_MINT=1.
const MINT = import.meta.env.VITE_TEST_MINT ? MINTS[1] : MINTS[2];
const LISTEN_MS = 30_000;
const params = new URLSearchParams(location.search);
// Off on testnut, whose Lightning is fake: the page would say "sent" and nothing
// would arrive. In development, ?ln turns it on for the fake addresses.
const LIGHTNING = !MINT.includes('testnut') || (import.meta.env.DEV && params.has('ln'));
const LN_ADDRESS = 't3:lnaddress';
const DESTINATION = 't3:dest'; // where every catch goes on to, set in the gear

const wallet = new PhoneWallet(MINT, Vault.browser());
const lightning = new Lightning(wallet, { limits: api.lnLimits, invoice: api.lnInvoice });

const root = document.querySelector<HTMLElement>('#listen')!;
root.innerHTML = `
  <button class="gear" type="button" aria-label="Settings" aria-haspopup="dialog">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><path d="M10.3 2.8h3.4l.5 2.3 1.9.8 2-1.3 2.4 2.4-1.3 2 .8 1.9 2.3.5v3.4l-2.3.5-.8 1.9 1.3 2-2.4 2.4-2-1.3-1.9.8-.5 2.3h-3.4l-.5-2.3-1.9-.8-2 1.3-2.4-2.4 1.3-2-.8-1.9-2.3-.5v-3.4l2.3-.5.8-1.9-1.3-2 2.4-2.4 2 1.3 1.9-.8z" /></svg>
    <span class="gear-text"></span>
  </button>
  <button class="balance amount" type="button" hidden aria-haspopup="dialog"></button>
  <h1 class="wordmark" aria-label="Hush Money"><span>Hush</span><span>Money</span></h1>
  <button class="ear" type="button"><span class="glow" aria-hidden="true"></span><span class="rings" aria-hidden="true"></span><span class="disc" aria-hidden="true"></span><span class="face"></span></button>
  <p class="note main" role="status"></p>
  <p class="note desk">This is the phone's page. The song plays from <a href="/">the laptop's</a>.</p>
  <a class="quiet how-link" href="/how">How it works</a>
  <div class="keepsake" hidden>
    <svg class="kladder" viewBox="0 0 300 96" role="img" aria-label="The tune of your song"></svg>
    <button class="quiet hear" type="button">Hear your song</button>
  </div>
  <div class="actions main" hidden>
    <a class="pill primary open" href="#">Open in Cashu.me</a>
    <button class="pill copy" type="button">Copy</button>
    <button class="quiet again" type="button">Listen again</button>
    <p class="note fine nowallet">No wallet yet? <a class="web" href="#" target="_blank" rel="noopener noreferrer">Open the web wallet</a>. Until then, these sats stay in this browser.</p>
  </div>
  <dialog class="sheet" aria-label="Your sats">
    <p class="amount total"></p>
    <p class="note split"></p>
    <p class="note stamp" role="status"></p>
    <div class="actions">
      <a class="pill primary open" href="#">Open in Cashu.me</a>
      <button class="pill copy" type="button">Copy</button>
    </div>
    <form class="ln" hidden>
      <label class="note" for="ln-address">or send it to your Lightning address</label>
      <div class="ln-row">
        <input id="ln-address" name="address" type="email" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="you@wallet.com" />
        <button class="pill" type="submit">Send</button>
      </div>
      <p class="note ln-status" role="status"></p>
    </form>
    <p class="note fine">Until you send them on, these sats only exist in this browser.</p>
    <button class="quiet close" type="button">Close</button>
  </dialog>
  <dialog class="sheet settings" aria-label="Settings">
    <h2 class="settings-title">Send my sats to</h2>
    <form class="dest">
      <label class="note dest-label" for="dest"></label>
      <input id="dest" name="dest" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">
      <p class="note dest-status" role="status"></p>
      <div class="dest-row">
        <button class="pill close-settings" type="button">Close</button>
        <button class="pill primary" type="submit">Save</button>
      </div>
    </form>
  </dialog>
`;
const $ = <T extends HTMLElement>(sel: string, from: ParentNode = root) => from.querySelector<T>(sel)!;
const ear = $<HTMLButtonElement>('.ear');
// Only the flat disc reads the room from the stylesheet, so the room is written on the disc
// alone. Written on the page, it would restyle everything in it on every frame.
const disc = $('.disc', ear);
const face = $('.face');
const note = $('.note.main');
const pill = $<HTMLButtonElement>('.balance');
const actions = $('.actions.main');
const keepsake = $('.keepsake');
const kladder = root.querySelector<SVGSVGElement>('.kladder')!;
const again = $<HTMLButtonElement>('.again', actions);
const sheet = $<HTMLDialogElement>('.sheet');
const lnForm = $<HTMLFormElement>('.ln', sheet);
const lnInput = $<HTMLInputElement>('input', lnForm);
const lnStatus = $('.ln-status', lnForm);

// `landed`: a wallet app has claimed what was caught, so it's gone from here.
type State = 'idle' | 'listening' | 'heard' | 'catching' | 'sending' | 'caught' | 'landed';
// What the idle screen says before the phone asks for the mic. The song is decoded on the phone; no sound leaves it.
const IDLE = 'It listens for the laptop\'s song. Nothing is recorded.';
const WEB_WALLET = 'https://wallet.cashu.me/';
const FACES: Record<State, string> = { idle: 'Tap to listen', listening: 'Listening…', heard: 'Hearing something…', catching: 'Catching…', sending: 'Sending…', caught: '', landed: '' };
let state: State = 'idle';
// The tune of the song just caught, which this phone can show and play again.
let lastTune: number[] | null = null;
const buzz = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not every browser can.
  }
};
let stop: (() => void) | null = null;
let orb: Orb | null = null;
// The room right now, for the orb, the rings and the glow: how loud, and how
// sudden (a chirp or a beat is the level jumping above where it's been lately).
const sound: Sound = { level: 0, kick: 0 };
const STILL = matchMedia('(prefers-reduced-motion: reduce)');

// `mood` gives an idle orb the look of what just happened: gone, timeout or denied.
function show(next: State, text = '', bad = false, mood?: Look) {
  state = next;
  const look = mood ?? next;
  ear.dataset.state = next;
  ear.dataset.look = look;
  orb?.look(look);
  face.className = 'face label';
  face.textContent = FACES[next];
  note.textContent = text || (next === 'idle' ? IDLE : '');
  note.classList.toggle('bad', bad);
  note.classList.remove('waiting');
  actions.hidden = next !== 'caught' && next !== 'landed';
  keepsake.hidden = !lastTune || (next !== 'caught' && next !== 'landed');
  // Once it's landed there's nothing left here to send, only another song to catch.
  for (const a of actions.querySelectorAll<HTMLElement>('.open, .copy, .nowallet')) a.hidden = next === 'landed';
  again.className = next === 'landed' ? 'pill primary again' : 'pill again';
}

// The pill, and the sheet when it's open, from what the wallet holds right now.
function refresh(stamp = '') {
  const b = wallet.balance();
  pill.hidden = b.total <= 0;
  pill.textContent = `₿${b.total}`;
  $('.total', sheet).textContent = `₿${b.total}`;
  $('.split', sheet).textContent = b.out ? `₿${b.held} here · ₿${b.out} on their way` : '';
  if (stamp) $('.stamp', sheet).textContent = stamp;
  for (const a of root.querySelectorAll<HTMLElement>('.open, .copy')) a.toggleAttribute('disabled', b.total <= 0);
  refreshLightning();
}

function refreshLightning() {
  lnForm.hidden = !LIGHTNING;
  if (!LIGHTNING) return;
  const total = wallet.balance().held;
  const op = lightning.op;
  const busy = op?.state === 'paying' || op?.state === 'pending' || op?.state === 'unknown';
  const small = total < MIN_LIGHTNING;
  lnInput.disabled = busy || small;
  $<HTMLButtonElement>('button', lnForm).disabled = busy || small;
  lnStatus.classList.remove('bad');
  if (op) lnStatus.textContent = describe(op);
  else lnStatus.textContent = small && total > 0 ? `Lightning needs at least ₿${MIN_LIGHTNING}, for the mint's fee.` : '';
  if (op?.state === 'failed' || op?.state === 'unknown') lnStatus.classList.add('bad');
}

function describe(op: LnOp): string {
  switch (op.state) {
    case 'paying':
      return 'Sending over Lightning…';
    case 'pending':
      return 'On its way over Lightning. This can take a minute.';
    case 'paid':
      return `Sent ⚡ ₿${op.sats} to ${op.address}.${op.change ? ` ₿${op.change} came back as change.` : ''}`;
    default:
      return op.error ?? "Couldn't send it.";
  }
}

// Where each catch goes on to, if the gear has one saved.
function destination(): Destination | null {
  const raw = localStorage.getItem(DESTINATION);
  if (!raw) return null;
  try {
    return parseDestination(raw, MINT);
  } catch {
    return null;
  }
}

// The gear's label says where catches go, so it is never a mystery.
function showGear() {
  const to = destination();
  const label = $('.gear-text');
  const text = to ? `Sends to ${nameOf(to)}` : 'Send my sats to…';
  if (label.textContent === text) return;
  const first = label.textContent === '';
  label.textContent = text;
  // The label changes under the sheet as it closes; a short fade keeps it from jumping.
  if (!first) label.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
}

// Sends what this browser holds to the saved destination, by itself, right after a catch.
// The orb melts while it goes (at least a moment, so it's seen even when the answer is quick).
async function forward() {
  const to = destination();
  const sats = wallet.balance().held;
  if (!to || sats <= 0) return;
  const name = nameOf(to);
  if (to.kind === 'ln' && !LIGHTNING) {
    note.textContent = "Practice sats can't go over Lightning, so they're still on this phone. Use a Cashu request instead.";
    return;
  }
  show('sending', `Sending ₿${sats} to ${name}…`);
  const moment = new Promise((r) => setTimeout(r, 2200));
  try {
    if (to.kind === 'ln') {
      const op = await lightning.pay(to.address);
      await moment;
      refresh();
      if (op.state === 'paid') return showLanded(op.sats, `Sent ₿${op.sats} to ${op.address}.`);
      showCaught(sats);
      note.textContent = describe(op);
      return;
    }
    const coins = wallet.heldCoins();
    const sent = await sendToRequest(to, normalizeProofAmounts(coins), MINT);
    await moment;
    // Marked as on its way; the mint says when the wallet claims it.
    wallet.markOut(new Set(coins.map((c) => c.secret)));
    showCaught(sats);
    handedOut();
    if (sent === 'maybe') note.textContent = `Sent to ${name}. No relay confirmed it yet, so it may take a moment to show up.`;
  } catch (e) {
    await moment;
    refresh();
    showCaught(sats);
    const why = e instanceof NotSent || e instanceof LnurlError || e instanceof Error ? e.message : "it didn't go through";
    note.textContent = `Couldn't send it to ${name}: ${why} The sats are still on this phone.`;
    note.classList.add('bad');
  }
}

// The catch, and everything this browser holds going out together, so nothing is left behind.
function showCaught(sats: number) {
  const held = wallet.balance().total;
  show('caught', held > sats ? `Sends all ₿${held} this browser holds.` : "Don't tell anyone.");
  face.className = 'face amount';
  face.innerHTML = btc(sats);
  $('.copy', actions).textContent = 'Copy';
}

// A wallet app claimed it: the coin turns over once more and sends out gold rings.
function showLanded(sats: number, text = `₿${sats} landed in your wallet.`) {
  show('landed', text);
  face.className = 'face amount';
  face.innerHTML = btc(sats);
  // The amount is stamped on again as the coin comes back around, not left floating while it turns.
  face.style.animation = 'none';
  void face.offsetWidth;
  face.style.animation = '';
  for (let i = 0; i < 3; i++) setTimeout(() => ring(0.5, true), i * 150);
}

function drawKeepsake(lit = -1) {
  if (lastTune) kladder.innerHTML = ladder(lastTune, 300, 96, lit);
}

$('.hear', keepsake).addEventListener('click', () => {
  if (!lastTune) return;
  audio();
  playTune(lastTune, (i) => drawKeepsake(i));
  setTimeout(() => drawKeepsake(), lastTune.length * 220 + 400);
});

async function caught(song: Song) {
  stop?.();
  show('catching');
  try {
    const result = await wallet.catch(song);
    refresh();
    if (result.status === 'gone') return show('idle', 'Someone got there first. Hush.', false, 'gone');
    lastTune = songTune(packSong(song.mint, song.seed));
    drawKeepsake();
    showCaught(result.sats);
    buzz([30, 50, 70]);
    void forward();
  } catch (e) {
    console.error(e);
    refresh();
    if (e instanceof VaultError) return show('idle', "This browser can't save anything, so it can't hold sats. Try a regular window, not a private one.", true);
    if (wallet.pendingClaims()) return show('idle', "Lost the connection. Your catch is saved and lands when you're back online.");
    show('idle', "Couldn't reach the mint. Check your connection and try again.", true);
  }
}

// Feeds blocks to ggwave and acts on the first song of ours it hears, while `alive`.
const hear = (dec: Decoder, alive: () => boolean) => (block: Float32Array) => {
  if (!alive()) return;
  const bytes = dec.push(block);
  const song = bytes && unpackSong(bytes);
  if (song) void caught(song);
};

// Dev only (?air): hears the laptop tab's songs over a BroadcastChannel instead of the mic.
function listenToAir(alive: () => boolean) {
  const handler = async (e: MessageEvent<AirSong>) => {
    const dec = await decoder(e.data.sampleRate);
    const push = hear(dec, alive);
    for (let i = 0; i + BLOCK <= e.data.samples.length && alive(); i += BLOCK) push(e.data.samples.subarray(i, i + BLOCK));
    dec.free();
  };
  air!.onmessage = handler;
  return () => {
    if (air!.onmessage === handler) air!.onmessage = null;
  };
}

async function listen() {
  stop?.();
  // Made inside the tap: phones only start audio from a gesture.
  const context = new AudioContext();
  show('listening', 'Quiet now. Hold the phone close to the laptop.');
  // Each session cleans up only what it made, so a slow mic prompt or a late
  // timer can't reach into the session after it.
  let ended = false;
  let mic: Mic | null = null;
  let dec: Decoder | null = null;
  let leaveAir: (() => void) | null = null;
  let frame = 0;
  let timer = 0;
  const alive = () => !ended && (state === 'listening' || state === 'heard');
  const cleanup = () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    mic?.close();
    mic = null;
    dec?.free();
    dec = null;
    leaveAir?.();
    if (context.state !== 'closed') void context.close();
    sound.level = sound.kick = 0;
    disc.style.setProperty('--level', '0');
    disc.style.setProperty('--kick', '0');
  };
  const end = () => {
    ended = true;
    if (stop === end) stop = null;
    cleanup();
  };
  stop = end;
  try {
    if (air && params.has('air')) leaveAir = listenToAir(alive);
    else {
      // The decoder needs the mic's sample rate, so blocks that come before it are dropped.
      let push: ((block: Float32Array) => void) | null = null;
      mic = await openMic(context, (block) => push?.(block));
      // Tapped away while the phone was asking about the mic.
      if (ended) return cleanup();
      dec = await decoder(mic.sampleRate);
      if (ended) return cleanup();
      push = hear(dec, alive);
    }
  } catch (e) {
    const wasEnded = ended;
    end();
    if (wasEnded) return;
    const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    return show('idle', denied ? "The mic is blocked for this page. Open the site settings from the address bar, allow the microphone, then tap again." : "Couldn't start the mic.", true, 'denied');
  }
  // Every frame: the room for the orb, the rings and the glow, and whether a song
  // is in the air (its tones stand above everything else) before it's decoded.
  let tonal = 0;
  let lastRing = 0;
  let lastBuzz = 0;
  let lately = 0; // the level, slowed down
  const draw = (now: number) => {
    frame = requestAnimationFrame(draw);
    const level = mic?.level() ?? 0;
    lately += (level - lately) * 0.06;
    sound.level = level;
    sound.kick = Math.max(0, level - lately * 1.25);
    disc.style.setProperty('--level', level.toFixed(3));
    disc.style.setProperty('--kick', sound.kick.toFixed(3));
    if (mic) {
      tonal = mic.tones() > 4 && level > 0.01 ? Math.min(tonal + 1, 90) : Math.max(tonal - 1, 0);
      if (state === 'heard' && now - lastBuzz > 220) {
        lastBuzz = now;
        buzz(8);
      }
      if (state === 'listening' && tonal >= 4) show('heard', 'Hold still.');
      else if (state === 'heard' && tonal === 0) show('listening', 'Quiet now. Hold the phone close to the laptop.');
    }
    // Rings go out the whole time, like a pulse: quicker and brighter as the room
    // gets louder, one at once on a sudden sound, and gold and quick for a song.
    const every = state === 'heard' ? 230 : 1150 - Math.min(level, 1) * 850;
    if (alive() && (now - lastRing > every || (sound.kick > 0.06 && now - lastRing > 140))) {
      lastRing = now;
      ring(Math.max(level, sound.kick * 2));
    }
  };
  frame = requestAnimationFrame(draw);
  timer = window.setTimeout(() => {
    end();
    show('idle', 'No song heard. Turn the laptop up, hold the phone close, and tap again.', false, 'timeout');
  }, LISTEN_MS);
}

// One ring out from the orb toward the edges of the screen, as bright and as far
// as the room is loud. None with reduced motion: a ring that can't move never leaves.
function ring(strength: number, gold = false) {
  if (STILL.matches) return;
  const r = document.createElement('span');
  r.className = gold ? 'ring gold' : 'ring';
  r.style.setProperty('--o', String(Math.min(0.7, 0.14 + strength * 1.6)));
  r.style.setProperty('--reach', String(2.1 + Math.min(strength, 1) * 1.5));
  r.addEventListener('animationend', () => r.remove());
  $('.rings', ear).append(r);
}

ear.addEventListener('click', () => {
  if (state === 'idle') void listen();
  else if (state === 'listening' || state === 'heard') {
    stop?.();
    show('idle');
  }
});

$('.again').addEventListener('click', () => void listen());

// The link is made at the moment of the tap, so it carries everything held right then.
for (const open of root.querySelectorAll<HTMLAnchorElement>('.open')) {
  open.addEventListener('click', (e) => {
    const token = wallet.handOut();
    if (!token) return e.preventDefault();
    open.href = `cashu:${token}`;
    handedOut();
  });
}

// No wallet app to open it: the same coins, handed to the wallet that runs in a browser tab.
$<HTMLAnchorElement>('.web', actions).addEventListener('click', (e) => {
  const token = wallet.handOut();
  if (!token) return e.preventDefault();
  (e.currentTarget as HTMLAnchorElement).href = `${WEB_WALLET}#token=${token}`;
  handedOut();
});

for (const copy of root.querySelectorAll<HTMLButtonElement>('.copy')) {
  copy.addEventListener('click', async () => {
    const token = wallet.handOut();
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = "Couldn't copy. Use Open in Cashu.me.";
    }
    handedOut();
  });
}

// The sats are on their way: the caught screen says it's waiting, and the page
// watches the mint for the wallet app's claim.
function handedOut() {
  refresh();
  if (state === 'caught') {
    note.textContent = 'Waiting for your wallet to claim it…';
    note.classList.add('waiting');
  }
  watchOut(true);
}

pill.addEventListener('click', () => {
  lightning.dismiss();
  $('.stamp', sheet).textContent = '';
  $('.copy', sheet).textContent = 'Copy';
  lnInput.value = localStorage.getItem(LN_ADDRESS) ?? '';
  refresh();
  sheet.showModal();
  void settle();
});
$('.close', sheet).addEventListener('click', () => sheet.close());
// A tap on the backdrop closes the sheet.
sheet.addEventListener('click', (e) => e.target === sheet && sheet.close());

lnForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const address = lnInput.value.trim();
  localStorage.setItem(LN_ADDRESS, address);
  lnStatus.classList.remove('bad');
  lnStatus.textContent = 'Sending over Lightning…';
  try {
    await lightning.pay(address);
    refresh();
  } catch (err) {
    refresh();
    lnStatus.textContent = err instanceof LnurlError || err instanceof Error ? err.message : "Couldn't send it.";
    lnStatus.classList.add('bad');
  }
});

const settings = $<HTMLDialogElement>('.settings');
const destForm = $<HTMLFormElement>('.dest', settings);
const destInput = $<HTMLInputElement>('input', destForm);
const destStatus = $('.dest-status', destForm);

$('.gear').addEventListener('click', () => {
  destInput.value = localStorage.getItem(DESTINATION) ?? '';
  $('.dest-label', destForm).textContent = LIGHTNING ? 'A Lightning address or a Cashu request. Every catch goes there by itself.' : 'A Cashu request. Every catch goes there by itself.';
  destInput.placeholder = LIGHTNING ? 'you@wallet.com' : 'creqA…';
  destStatus.classList.remove('bad');
  destStatus.textContent = '';
  settings.showModal();
});
$('.close-settings', settings).addEventListener('click', () => settings.close());
settings.addEventListener('click', (e) => e.target === settings && settings.close());
destForm.addEventListener('submit', (e) => {
  e.preventDefault();
  destStatus.classList.remove('bad');
  if (!destInput.value.trim()) {
    localStorage.removeItem(DESTINATION);
    showGear();
    settings.close();
    return;
  }
  try {
    const to = parseDestination(destInput.value, MINT);
    if (to.kind === 'ln' && !LIGHTNING) {
      destStatus.textContent = 'Practice sats can only go to a Cashu request.';
      destStatus.classList.add('bad');
      return;
    }
    localStorage.setItem(DESTINATION, destInput.value.trim());
    showGear();
    settings.close();
  } catch (err) {
    destStatus.textContent = err instanceof DestinationError ? err.message : "Couldn't save that.";
    destStatus.classList.add('bad');
  }
});

// Drops what a wallet app has claimed since, and says so: on the caught screen
// by turning the coin over, otherwise in a line under the orb.
async function settle() {
  try {
    const { landed, balance } = await wallet.settle();
    const stamp = landed ? `₿${landed} landed in your wallet.` : '';
    refresh(stamp);
    if (!balance.out) stopWatching();
    else if (landed) watchOut(true); // some of it is still out: watch just that
    if (!landed) return;
    if (state === 'caught') showLanded(landed);
    else if (state === 'idle' && note.textContent === IDLE) note.textContent = stamp;
  } catch {
    // Offline: the balance stays as it was until the next look.
  }
}

// While sats are on their way, the mint tells the page when a wallet app claims them.
let watching: Promise<() => void> | null = null;
let soon = 0;
function watchOut(fresh = false) {
  if (fresh) stopWatching();
  if (watching || !wallet.balance().out) return;
  // Every coin of a token reports at once; one look at the mint covers them all.
  const onSpent = () => {
    clearTimeout(soon);
    soon = window.setTimeout(() => void settle(), 250);
  };
  const started: Promise<() => void> = wallet.watch(onSpent).catch(() => {
    if (watching === started) watching = null; // the mint was out of reach: the next look tries again
    return () => {};
  });
  watching = started;
}
function stopWatching() {
  void watching?.then((stop) => stop());
  watching = null;
}

// Picks up whatever the last visit left: claims, and a Lightning payment.
async function resume() {
  await wallet.recover().catch(() => 0);
  if (LIGHTNING) await lightning.resume().catch(() => null);
  await settle();
  watchOut();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void resume();
});
addEventListener('online', () => void resume());

show('idle');
refresh();
showGear();
warmGgwave();
// The 3D orb arrives when it's ready; until then, and without WebGL, the flat disc stands in.
void makeOrb(ear, () => sound).then((o) => {
  orb = o;
  orb?.look((ear.dataset.look as Look | undefined) ?? 'idle');
});
void wallet.load().catch(() => {});
void resume();

// The laptop's "can't hear it?" QR carries the song in the fragment, which
// never reaches a server. With this page already open, scanning it only
// changes the fragment, so that's watched too.
function fromFragment() {
  const bytes = location.hash.length > 1 ? fromHex(location.hash.slice(1)) : null;
  const song = bytes && unpackSong(bytes);
  if (!song) return;
  history.replaceState(null, '', location.pathname + location.search);
  void caught(song);
}
addEventListener('hashchange', fromFragment);
fromFragment();
