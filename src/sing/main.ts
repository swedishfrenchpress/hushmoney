import '../style.css';
import type { Proof, Wallet } from '@cashu/cashu-ts';
import { qrBlob } from '../qrblob';
import { fromHex, unpackSong, type SongResult } from '../../shared/song';
import { air } from '../air';
import { api } from '../api';
import { tuneNotes, withMelody } from '../melody';
import { chime, chimeNotes, chimeSeconds, withChime } from '../chime';
import { encode, warmGgwave, type Mode } from '../ggwave';
import { humanToken, prepare } from '../human';
import { Backdrop } from './backdrop';
import { BTC_MARK } from '../btc';
import { footer } from '../footer';
import { intro } from './intro';
import { Goo } from './goo';
import { SingOrb } from './singorb';
import { makeOrb, type Orb } from '../listen/orb';
import { splitTitle } from './letters';
import { TitleBells } from './titlebells';
import { scoreOf } from './score';
import { notesOf, Stave } from './stave';

// The laptop: a QR code that opens the listener on a phone, and a button that
// sings. Each song opens with a three-note chime, and its real tones scroll
// across a stave as it sings. It sings the same song every couple of seconds
// until a phone claims the coins, which it sees at the mint the moment it
// happens (NUT-17).

const GAP_MS = 1800;
const GIVE_UP_MS = 3 * 60_000;
const POLL_MS = 3000;
// ?modes=alt: every other repeat sings in ggwave's slower normal mode. Off by default.
const MODES: Mode[] = new URLSearchParams(location.search).get('modes') === 'alt' ? ['fast', 'normal'] : ['fast'];

interface Current {
  song: string;
  sats: number;
  mint: string;
  proofs: Proof[];
}

const qr = (text: string) => qrBlob(text);

// The Cashu library is only needed once a song is asked for, so it loads after the page is up.
const cashu = () => import('@cashu/cashu-ts');

function start() {
  const root = document.querySelector<HTMLElement>('#sing')!;
  const listenUrl = `${location.origin}/listen`;
  root.innerHTML = `
    <div class="stage">
      <canvas class="backdrop" aria-hidden="true"></canvas>
      <h1 class="title" aria-label="Hush Money">Hush Money</h1>
      <p class="lede reveal">Money you can hear.</p>
      <a class="pill phone-go reveal" href="/listen">Open the listener</a>
      <p class="phone-go-note reveal">On a laptop, open this page there to play the song.</p>
      <div class="score reveal">
        <canvas class="stave" aria-hidden="true"></canvas>
      </div>
      <div class="received reveal">
        <div class="coin">
          <span class="disc"></span>
          <p class="amount">${BTC_MARK}<span class="n"></span></p>
        </div>
        <div class="received-side">
          <p class="received-line"><span>Money talked.</span> <span>You don't.</span></p>
          <button class="pill again" type="button">Sing another</button>
        </div>
      </div>
      <div class="steps reveal">
        <section class="step scan">
          <div class="step-copy">
            <span class="num">1</span>
            <p class="step-text">Open this on your phone. Set it down beside this screen.</p>
          </div>
          <div class="step-art">
            ${qr(listenUrl)}
            <canvas class="phone" aria-hidden="true"></canvas>
          </div>
          <a class="pill listen-link" href="/listen">On this phone? Tap to listen</a>
        </section>
        <section class="step press">
          <div class="step-copy">
            <span class="num">2</span>
            <p class="step-text">Press this button to hear the money.</p>
          </div>
          <div class="sing-row">
            <div class="actions">
              <span class="orb-host" aria-hidden="true"><span class="disc"></span><span class="goo"></span></span>
              <button class="sing" type="button"><span class="sing-label">Sing</span></button>
              <button class="stop" type="button" hidden><span class="sing-label">Stop</span></button>
            </div>
            <div class="sing-side">
              <p class="note status" role="status"></p>
              <button class="quiet volume" type="button">Test the sound</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
  // A touch screen with no hover is a phone: it is the one that listens, so it gets the listen button first.
  if (matchMedia('(pointer: coarse) and (hover: none) and (max-width: 820px)').matches) root.dataset.phone = '';
  if ('phone' in root.dataset) mirrorButton(root.querySelector<HTMLAnchorElement>('.phone-go')!);
  const foot = footer(root);
  const title = root.querySelector<HTMLElement>('.title')!;
  const bells = new TitleBells(splitTitle(title), () => context?.currentTime ?? 0);
  const goo = new Goo(root.querySelector<HTMLElement>('.goo')!);
  const orb = new SingOrb(root.querySelector<HTMLElement>('.orb-host')!, root.querySelector<HTMLElement>('.actions')!, () => context?.currentTime ?? 0);
  const scan = root.querySelector<HTMLElement>('.scan')!;
  const stave = new Stave(root.querySelector<HTMLCanvasElement>('.stave')!, () => context?.currentTime ?? 0);
  const backdrop = new Backdrop(root.querySelector<HTMLCanvasElement>('.backdrop')!, () => context?.currentTime ?? 0);
  const amount = root.querySelector<HTMLElement>('.amount')!;
  const status = root.querySelector<HTMLElement>('.status')!;
  const singButton = root.querySelector<HTMLButtonElement>('.sing')!;
  const stopButton = root.querySelector<HTMLButtonElement>('.stop')!;
  const volume = root.querySelector<HTMLButtonElement>('.volume')!;
  const singLabel = singButton.querySelector<HTMLElement>('.sing-label')!;
  root.querySelector('.again')!.addEventListener('click', () => singButton.click());

  // The caught screen's coin is the phone's: the same ball, turning into the same pale coin.
  // It is made when a song is caught and thrown away when the next one starts.
  const coinHost = root.querySelector<HTMLElement>('.coin')!;
  let coin: Orb | null = null;
  let coinShown = false;
  let coinMade = 0;
  function showCoin(on: boolean) {
    if (on === coinShown) return;
    coinShown = on;
    const made = ++coinMade;
    coin?.destroy();
    coin = null;
    if (!on) return;
    void makeOrb(coinHost, () => ({ level: 0, kick: 0 })).then((o) => {
      if (made !== coinMade) return o?.destroy();
      coin = o;
      o?.look('caught');
    });
  }

  type View = 'ready' | 'asking' | 'singing' | 'caught';
  function view(next: View, text = '', bad = false) {
    scan.hidden = next === 'singing' || next === 'caught';
    root.dataset.view = next;
    foot.look(next === 'singing' ? 'heard' : next === 'caught' ? 'caught' : 'listening');
    showCoin(next === 'caught');
    goo.set(next === 'singing' ? 'pause' : 'play');
    orb.loading(next === 'asking');
    goo.load(next === 'asking');
    stopButton.hidden = next !== 'singing';
    singButton.hidden = next === 'singing';
    singButton.disabled = next === 'asking';
    // Before a song: the one thing that makes it fail, said where the button is.
    status.textContent = text || (next === 'ready' ? 'Volume up, no headphones.' : '');
    status.classList.toggle('bad', bad);
    volume.hidden = next !== 'ready';
  }

  let current: Current | null = null;
  let context: AudioContext | null = null;
  let quit: (() => void) | null = null;
  const stopSinging = () => quit?.();

  const wallets = new Map<string, Promise<Wallet>>();
  function walletFor(mint: string): Promise<Wallet> {
    let wallet = wallets.get(mint);
    if (!wallet) {
      wallet = (async () => {
        const { Wallet } = await cashu();
        const w = new Wallet(mint, { unit: 'sat' });
        await w.loadMint();
        return w;
      })();
      wallet.catch(() => wallets.delete(mint));
      wallets.set(mint, wallet);
    }
    return wallet;
  }

  // Calls `onSpent` once the phone's claim lands. The mint pushes it (NUT-17);
  // if the socket fails, asking every few seconds (NUT-07) takes over.
  async function watch(c: Current, onSpent: () => void): Promise<() => void> {
    const wallet = await walletFor(c.mint);
    let poll = 0;
    let cancel: (() => void) | null = null;
    const pollInstead = () => {
      poll ||= window.setInterval(async () => {
        const states = await wallet.checkProofsStates(c.proofs).catch(() => []);
        if (states.some((s) => s.state === 'SPENT')) onSpent();
      }, POLL_MS);
    };
    try {
      cancel = await wallet.on.proofStateUpdates(c.proofs, (p) => p.state === 'SPENT' && onSpent(), pollInstead);
    } catch {
      pollInstead();
    }
    return () => {
      cancel?.();
      clearInterval(poll);
    };
  }

  async function sing(c: Current) {
    context ??= new AudioContext();
    await context.resume();
    const ctx = context;
    const raw = await Promise.all(MODES.map((m) => encode(fromHex(c.song)!, ctx.sampleRate, m)));
    const songs = raw.map((samples) => withChime(withMelody(samples, ctx.sampleRate, fromHex(c.song)!), ctx.sampleRate));
    const scores = await Promise.all(MODES.map(async (m) => notesOf(await scoreOf(fromHex(c.song)!, m), chimeSeconds(), chimeNotes())));
    const tunes = raw.map((samples) => tuneNotes(fromHex(c.song)!, samples.length / ctx.sampleRate).map((n) => ({ t: n.t + chimeSeconds(), degree: n.degree })));
    let caught = false;
    // Listening for the claim starts now but isn't waited for: it needs the mint's keys and a
    // socket, which takes seconds, and the song should not wait on it. A phone can only claim
    // once it has heard the song, which is longer than that.
    const watching = watch(c, () => {
      if (caught) return;
      caught = true;
      quit?.();
      current = null;
      amount.querySelector('.n')!.textContent = String(c.sats);
      amount.setAttribute('aria-label', `${c.sats} sats`);
      stave.caught();
      backdrop.caught();
      bells.settle();
      orb.rest();
      view('caught', 'Caught.');
      singLabel.textContent = 'Sing another';
    });
    const stopWatching = () => void watching.then((stop) => stop(), () => {});

    const buffers = songs.map((samples) => {
      const b = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      b.copyToChannel(samples, 0);
      return b;
    });
    // Dev only: ?air sings to the other tab alone, and keeps the speakers quiet.
    const out = ctx.createGain();
    if (air && new URLSearchParams(location.search).has('air')) out.gain.value = 0;
    out.connect(ctx.destination);

    view('singing', 'Singing. Hold the phone close.');
    let source: AudioBufferSourceNode | null = null;
    let gap = 0;
    let round = 0;
    const once = () => {
      const i = round++ % buffers.length;
      source = ctx.createBufferSource();
      source.buffer = buffers[i];
      source.connect(out);
      source.onended = () => (gap = window.setTimeout(once, GAP_MS));
      // A moment ahead, so the stave and the sound start together.
      const at = ctx.currentTime + 0.05;
      stave.loop(at, scores[i]);
      bells.loop(at, tunes[i]);
      orb.loop(at, tunes[i]);
      backdrop.loop(at, tunes[i]);
      source.start(at);
      air?.postMessage({ samples: songs[i], sampleRate: ctx.sampleRate });
    };
    const giveUp = window.setTimeout(() => {
      quit?.();
      view('ready', 'Nobody caught it. Sing it again?');
      singLabel.textContent = 'Sing again';
    }, GIVE_UP_MS);
    quit = () => {
      quit = null;
      if (source) source.onended = null;
      source?.stop();
      clearTimeout(gap);
      clearTimeout(giveUp);
      stave.rest();
      backdrop.rest();
      bells.rest();
      orb.rest();
      stopWatching();
      out.disconnect();
    };
    once();
    // If the mint can't be reached the laptop could never say "Caught", so say so instead of singing on.
    watching.catch((e) => {
      console.error(e);
      if (!quit) return; // already stopped or caught
      quit();
      view('ready', "Couldn't sing. Try again.", true);
    });
  }

  // The sound check: the chime on its own, so the volume is right before the song. The title rings it too.
  const soundCheck = () => {
    if (quit) return;
    context ??= new AudioContext();
    const ctx = context;
    void ctx.resume();
    const samples = chime(ctx.sampleRate);
    const b = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    b.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(ctx.destination);
    src.start();
    bells.chime();
  };
  title.addEventListener('click', soundCheck);
  volume.addEventListener('click', soundCheck);

  // One song at a time: a second click while the first is starting is ignored.
  let starting = false;
  singButton.addEventListener('click', async () => {
    if (starting || quit) return;
    starting = true;
    // Made inside the click: browsers only play sound after one.
    context ??= new AudioContext();
    // From the press until the song starts (fetching it, then making its sound) the ball is loading.
    view('asking');
    try {
      if (!current) {
        try {
          const r: SongResult = await api.song(await humanToken());
          const song = unpackSong(fromHex(r.song)!);
          if (!song) throw new Error("That song didn't come out right.");
          const { normalizeProofAmounts } = await cashu();
          current = { song: r.song, sats: r.sats, mint: song.mint, proofs: normalizeProofAmounts(r.proofs) };
        } catch (e) {
          return view('ready', (e as Error).message, true);
        } finally {
          prepare();
        }
      }
      await sing(current);
    } catch (e) {
      console.error(e);
      stopSinging();
      view('ready', "Couldn't sing. Try again.", true);
    } finally {
      starting = false;
    }
  });

  stopButton.addEventListener('click', () => {
    quit?.();
    view('ready');
    singLabel.textContent = 'Sing';
  });

  view('ready');
  warmGgwave();
  void cashu().catch(() => {}); // fetched now, so it's there by the first press
  prepare();
  void intro(root);
  import('./phone3d').then((m) => m.phone(root.querySelector<HTMLCanvasElement>('.phone')!)).catch(() => root.querySelector('.phone')?.setAttribute('hidden', ''));
}

start();

// The phone's button is a little mirror ball: flat square tiles in a few dark greys, a few of
// them catching the light now and then. A tap sends a flash outward from the finger, then goes:
// about a third of a second in all, so the page doesn't feel slow to answer.
function mirrorButton(btn: HTMLAnchorElement) {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const label = btn.textContent;
  const TILE = 12;
  const build = () => {
    btn.querySelector('.mirror')?.remove();
    const { width, height } = btn.getBoundingClientRect();
    if (!width) return;
    const cols = Math.ceil(width / TILE);
    const rows = Math.ceil(height / TILE);
    const grid = document.createElement('span');
    grid.className = 'mirror';
    grid.setAttribute('aria-hidden', 'true');
    grid.style.gridTemplateColumns = `repeat(${cols}, ${TILE}px)`;
    grid.style.gridTemplateRows = `repeat(${rows}, ${TILE}px)`;
    for (let i = 0; i < cols * rows; i++) {
      const t = document.createElement('i');
      t.dataset.shade = String(Math.floor(Math.random() * 3));
      if (!calm) {
        if (Math.random() < 0.2) {
          // Flickers on its own, quick and uneven
          t.className = 'glint';
          t.style.animationDuration = `${0.9 + Math.random() * 2}s`;
          t.style.animationDelay = `${-Math.random() * 3}s`;
        } else {
          // A slow diagonal sheen: each tile lights as the band passes it
          t.className = 'sheen';
          t.style.animationDelay = `${((i % cols) * 14 + Math.floor(i / cols) * 40) / 1000}s`;
        }
      }
      grid.append(t);
    }
    btn.prepend(grid);
  };
  btn.innerHTML = `<span class="phone-go-label">${label}</span>`;
  build();
  new ResizeObserver(build).observe(btn);

  btn.addEventListener('click', (e) => {
    if (calm || e.metaKey || e.ctrlKey || e.shiftKey || btn.classList.contains('went')) return;
    e.preventDefault();
    btn.classList.add('went');
    const r = btn.getBoundingClientRect();
    const x = e.clientX ? e.clientX - r.left : r.width / 2;
    const y = e.clientY ? e.clientY - r.top : r.height / 2;
    btn.querySelectorAll<HTMLElement>('.mirror i').forEach((t) => {
      const d = Math.hypot(t.offsetLeft + TILE / 2 - x, t.offsetTop + TILE / 2 - y);
      t.style.animation = `tile-flash 0.3s steps(1, end) ${Math.round(d * 0.5)}ms both`;
    });
    setTimeout(() => (location.href = btn.href), 360);
  });
}
