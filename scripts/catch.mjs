// A fake phone, for trying a running dev server against testnut without a
// speaker or a mic. Songs come from the server's pool; when it is empty a few
// testnut songs are made for it (see scripts/lib/fill-pool.ts). It uses the phone page's own wallet code.
//
//   npm run catch                                  every scenario, against http://localhost:5173
//   npm run catch -- http://localhost:5191 race    one scenario, against another port
//   npm run catch -- http://localhost:5173 caps    the per-connection cap (about 80 songs; opt-in)
//
// Scenarios:
//   happy  a song from /api/song, sung through ggwave and heard back, caught for exactly its amount
//   race   two phones catch the same song at once: exactly one wins
//   spent  a song caught once is gone for the next phone
//   lost   the first answer to the claim is lost; the swap is sent again and testnut repeats it (NUT-19)
//   caps   songs until the server says 429 (makes 201 testnut songs first), and the total stays within the cap

import { decoder, encode } from '../src/ggwave.ts';
import { fromHex, unpackSong } from '../shared/song.ts';
import { fillPool } from './lib/fill-pool.ts';
import { MemoryKv, Vault } from '../src/listen/vault.ts';
import { PhoneWallet } from '../src/listen/wallet.ts';

const args = process.argv.slice(2);
const base = args[0]?.startsWith('http') ? args.shift() : 'http://localhost:5173';
const wanted = args.length ? args : ['happy', 'race', 'spent', 'lost'];
const realFetch = globalThis.fetch;
let MINT = '';
const phone = () => new PhoneWallet(MINT, Vault.of(new MemoryKv()));

// The dev server checks Turnstile with Cloudflare's test secret, which passes any token.
// Songs come from the pool: when it is empty, a few testnut songs are made and added.
async function askForSong(ip = '127.0.0.1', refilled = false) {
  const res = await realFetch(`${base}/api/song`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify({ human: 'XXXX.DUMMY.TOKEN.XXXX' }),
  });
  const body = await res.json();
  if (res.status === 503 && !refilled) {
    await fillPool(base, 4);
    return askForSong(ip, true);
  }
  if (!res.ok) return { status: res.status, error: body.error };
  const song = unpackSong(fromHex(body.song));
  if (!song) throw new Error('the server sent something that is not a song');
  MINT = song.mint;
  return { status: 200, sats: body.sats, song, hex: body.song };
}

const check = (ok, what) => {
  if (!ok) throw new Error(what);
};

const scenarios = {
  async happy() {
    const s = await askForSong();
    const samples = await encode(fromHex(s.hex), 48_000);
    const dec = await decoder(48_000);
    let heard = null;
    for (let i = 0; i < samples.length + 48_000 && !heard; i += 1024) {
      heard = dec.push(i < samples.length ? samples.slice(i, i + 1024) : new Float32Array(1024));
    }
    dec.free();
    const song = heard && unpackSong(heard);
    check(song, 'ggwave lost the song');
    const r = await phone().catch(song);
    check(r.status === 'caught' && r.sats === s.sats, `expected to catch ₿${s.sats}, got ${JSON.stringify(r)}`);
    return `₿${s.sats}, sung in ${(samples.length / 48_000).toFixed(2)} s and caught exactly`;
  },

  async race() {
    const s = await askForSong();
    const results = await Promise.all([phone().catch(s.song), phone().catch(s.song)]);
    const won = results.filter((r) => r.status === 'caught');
    check(won.length === 1 && won[0].sats === s.sats, `expected one winner, got ${JSON.stringify(results)}`);
    return `₿${s.sats}: one phone caught it, the other heard "someone else"`;
  },

  async spent() {
    const s = await askForSong();
    await phone().catch(s.song);
    const r = await phone().catch(s.song);
    check(r.status === 'gone', `expected gone, got ${JSON.stringify(r)}`);
    return `₿${s.sats}: gone for the second phone`;
  },

  async lost() {
    const s = await askForSong();
    let lose = 1;
    let swaps = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/v1/swap')) {
        swaps++;
        if (lose-- > 0) {
          await realFetch(input, init);
          throw new TypeError('fetch failed');
        }
      }
      return realFetch(input, init);
    };
    try {
      const r = await phone().catch(s.song);
      check(r.status === 'caught' && r.sats === s.sats, `expected to catch ₿${s.sats}, got ${JSON.stringify(r)}`);
      check(swaps === 2, `expected the swap to be sent twice, it was sent ${swaps} times`);
    } finally {
      globalThis.fetch = realFetch;
    }
    return `₿${s.sats}: the first answer was lost, and the second try got it back`;
  },

  async caps() {
    const ip = `198.51.100.${Math.floor(Math.random() * 250)}`;
    let total = 0;
    await fillPool(base, 6); // ₿105 a connection is 5 songs
    for (let i = 0; i < 10; i++) {
      const s = await askForSong(ip);
      if (s.status === 429) {
        check(total === 105, `paid ₿${total}, over the cap`);
        return `turned away after ₿${total} to one connection`;
      }
      total += s.sats;
    }
    throw new Error('never hit the cap');
  },
};

let failed = 0;
for (const name of wanted) {
  const run = scenarios[name];
  if (!run) {
    console.log(`?    ${name}: no such scenario (${Object.keys(scenarios).join(', ')})`);
    failed++;
    continue;
  }
  try {
    console.log(`ok   ${name}: ${await run()}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${String(e.message).slice(0, 300)}`);
  }
}
process.exit(failed ? 1 : 0);
