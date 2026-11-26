import { hashToCurve, Wallet } from '@cashu/cashu-ts';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { fakeDescription, writeInvoice } from '../../shared/bolt11';
import { checkPayMeta } from '../../shared/lnurl';
import { songCoins, split, sum } from '../../shared/fees';
import { MINTS, SEED_BYTES, SONG_SATS, packSong, toHex } from '../../shared/song';
import { MemoryKv } from '../../src/listen/vault';
import { FakeMint } from './fakemint';

// The phone's page with the data a kind demo never has. Development only, at
// tests/support/break-listen.html?data=demo | worst | empty | one.
//
// This runs before src/listen/main.ts and swaps what that page reads, never the
// page itself: its storage (in memory, seeded below), the mint (fakemint.ts, in
// the page), the server's Lightning lookups, and the clipboard. Nothing here
// reaches a real mint, a real Lightning address, or the sats and settings this
// browser really holds. The small grey bar at the bottom is the fixture's, not
// the page's.

if (!import.meta.env.DEV) throw new Error('worstcase.ts is for the dev server only');

interface Dataset {
  label: string;
  held: number; // sats here
  out: number; // sats handed to a wallet app a day ago and never claimed
  destination: string; // the gear's "Send my sats to" (t3:dest)
  address: string; // what the sheet's Lightning field remembers (t3:lnaddress)
  refuses: Record<string, string>; // Lightning addresses whose own server answers with an error, and its words
  copies: boolean; // whether this browser lets a page write to the clipboard
}

// A node's public key in the middle of an error is what Lightning servers really send back,
// and it is 66 characters with nowhere to break. The server keeps about 140 characters of it.
const NO_ROUTE =
  'unable to route payment to destination 02f6725f9c1c40333b67faea92fd211c183050f28df32cac3f9d69685fe9665432: FAILURE_REASON_NO_ROUTE (insufficient inbound liquidity)';

const LONG = 'bartholomew.fitzgerald@northwind-industries-holdings.example.com';

const DATA: Record<string, Dataset> = {
  // What the page was drawn against: one earlier catch, a short address that pays.
  demo: { label: 'Demo data', held: 21, out: 0, destination: 'sam@example.com', address: 'sam@example.com', refuses: {}, copies: true },
  // Three months of the daily most (105 a day, server/guard.ts), never sent on; yesterday's
  // five songs handed to a wallet app that never claimed them; a long address whose server
  // refuses; another long one, in the sheet, that pays; an in-app browser that won't copy.
  worst: {
    label: 'Worst case',
    held: 9975,
    out: 105,
    destination: LONG,
    address: 'first.last+billing-notifications@example.com',
    refuses: { [LONG]: NO_ROUTE },
    copies: false,
  },
  // A first visit: nothing held, nothing saved.
  empty: { label: 'Empty', held: 0, out: 0, destination: '', address: '', refuses: {}, copies: true },
  // The single sat of change a Lightning send leaves behind, and the shortest address there is.
  one: { label: 'One', held: 1, out: 0, destination: '', address: 'a@b.co', refuses: {}, copies: true },
};

const params = new URLSearchParams(location.search);
const chosen = DATA[params.get('data') ?? ''] ? params.get('data')! : 'demo';
const data = DATA[chosen];

// The mint the page will ask for, as src/listen/main.ts picks it.
const MINT = import.meta.env.VITE_TEST_MINT ? MINTS[1] : MINTS[2];
const fake = new FakeMint();
fake.delayMs = 150; // long enough for "Catching…" to be seen

// --- Storage: in memory, so the real localStorage is neither read nor written ---

const DAY = 86_400_000;
const kv = new MemoryKv();
const coins = [...fake.issue(split(data.held)), ...fake.issue(split(data.out)).map((c) => ({ ...c, out: Date.now() - DAY }))];
if (coins.length) kv.setItem(`t3:coins:${MINT}`, JSON.stringify(coins));
if (data.destination) kv.setItem('t3:dest', data.destination);
if (data.address) kv.setItem('t3:lnaddress', data.address);
Object.defineProperty(window, 'localStorage', { configurable: true, value: kv });

// --- The network: the mint and the server's Lightning lookups, answered here ---

const KEY = secp256k1.utils.randomSecretKey();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// POST /api/lnurl, as server/app.ts answers it: limits without `msat`, an invoice with it,
// and a refusing address's own words behind "the Lightning address says:".
function lnurl(body: { address?: string; msat?: number }): Response {
  const reason = data.refuses[String(body.address ?? '').trim().toLowerCase()];
  if (reason) {
    try {
      checkPayMeta({ status: 'ERROR', reason }); // the server's own check, so its words are exactly the server's
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  }
  if (body.msat === undefined) return json({ minSendable: 1000, maxSendable: 500_000_000, fake: false });
  return json({ pr: writeInvoice({ sats: body.msat / 1000, description: fakeDescription('PAID'), key: KEY, expiry: 600 }).pr, fake: false });
}

let mintDown = false;
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  const mint = Object.values(MINTS).find((m) => url.startsWith(m));
  if (mint) {
    if (mintDown) throw new TypeError('Failed to fetch'); // what a browser says when it can't reach a server
    return fake.fetch(fake.url + url.slice(mint.length), init);
  }
  if (new URL(url, location.href).pathname === '/api/lnurl') return lnurl(JSON.parse(String(init?.body ?? '{}')));
  return realFetch(input, init);
};

// --- The clipboard: never the real one ---

const writeText = () => (data.copies ? Promise.resolve() : Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')));
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

// --- What happens around the phone ---

// A song lands, the way the laptop's "can't hear it?" QR delivers one: in the address's fragment.
// Made as tests/support/songs.ts makes them, with the browser's own random bytes.
async function songArrives() {
  const ppk = fake.active.ppk;
  const denominations = songCoins(SONG_SATS, ppk);
  const total = sum(denominations);
  const funding = fake.issue(songCoins(total + 1, ppk));
  const seed = crypto.getRandomValues(new Uint8Array(SEED_BYTES));
  const w = new Wallet(MINT, { unit: 'sat', bip39seed: seed });
  await w.loadMint();
  await w.send(total, funding, { includeFees: false }, { send: { type: 'deterministic', counter: 0, denominations }, keep: { type: 'random' } });
  location.hash = toHex(packSong(MINT, seed));
}

// A wallet app claims everything that was handed to it. The page finds out from the mint.
function walletClaims() {
  const held = JSON.parse(kv.getItem(`t3:coins:${MINT}`) ?? '[]') as { secret: string; out?: number }[];
  for (const c of held) if (c.out) fake.spent.set(hashToCurve(new TextEncoder().encode(c.secret)).toHex(true), 'SPENT');
}

// --- The bar: plain on purpose, so it's never mistaken for the page ---

const bar = document.createElement('div');
bar.dataset.breakUi = '';
bar.innerHTML = `
  <style>
    [data-break-ui] { position: fixed; z-index: 2147483647; left: 50%; bottom: max(8px, env(safe-area-inset-bottom)); transform: translateX(-50%);
      display: grid; gap: 4px; justify-items: center; font: 500 11px/1 system-ui, sans-serif; color: #333; }
    [data-break-ui] > div { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: #d9d9d9; box-shadow: 0 1px 4px rgb(0 0 0 / 0.25); }
    [data-break-ui] a, [data-break-ui] button { all: unset; padding: 6px 8px; border-radius: 6px; white-space: nowrap; cursor: pointer; font: inherit; color: inherit; }
    [data-break-ui] [aria-current], [data-break-ui] [aria-pressed='true'] { background: #fff; color: #000; }
    [data-break-ui] button:active { background: #bbb; }
  </style>
  <div role="group" aria-label="Fixture data">
    ${Object.entries(DATA)
      .map(([key, d]) => `<a href="?data=${key}"${key === chosen ? ' aria-current="true"' : ''}>${d.label}</a>`)
      .join('')}
  </div>
  <div role="group" aria-label="Fixture events">
    <button type="button" data-do="song">Song arrives</button>
    <button type="button" data-do="claim">Wallet claims in 4s</button>
    <button type="button" data-do="mint" aria-pressed="false">Mint down</button>
  </div>
`;
bar.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button) return;
  if (button.dataset.do === 'song') void songArrives();
  // Late, so there's time to open the sheet first and watch it land there.
  if (button.dataset.do === 'claim') setTimeout(walletClaims, 4000);
  if (button.dataset.do === 'mint') {
    mintDown = !mintDown;
    button.setAttribute('aria-pressed', String(mintDown));
  }
});
document.body.append(bar);
