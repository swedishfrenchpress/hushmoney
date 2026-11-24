// Funds and fills the song pool. Runs on the admin's machine, never on the server.
//
// Paying is all it takes: once an invoice is paid, every sat becomes a song on the server.
// The server is out of songs only when the money is.
//
//   npx tsx scripts/songs.mjs invoice 100     an invoice for 100 songs (2,100 sats); once paid, the songs are made and sent
//   npx tsx scripts/songs.mjs claim <quote>   the same, for an invoice that was paid after the script stopped
//   npx tsx scripts/songs.mjs make            turn everything in the stash into songs and send them (or `make 20` for just 20)
//   npx tsx scripts/songs.mjs push            send songs the server hasn't got yet (it was down during make)
//   npx tsx scripts/songs.mjs reclaim         songs that were handed out and never caught: put them back in the pool
//   npx tsx scripts/songs.mjs reclaim --sweep  or swap their coins into the stash instead
//   npx tsx scripts/songs.mjs reclaim --all  empty the server's pool, then swap every unspent song's coins into the stash
//   npx tsx scripts/songs.mjs restore         get the stash back from ADMIN_SEED alone, after a crash
//   npx tsx scripts/songs.mjs testpool 20    20 free testnut songs in the local dev server's pool (no seed, no sats)
//   npx tsx scripts/songs.mjs balance         the stash, and the songs waiting in the pool
//
// Environment: ADMIN_SEED (32 bytes hex, made for you the first time), MINT_URL
// (default Minibits), and for make, push and balance: BASE (default
// http://localhost:5173) and ADMIN_SECRET (the same one the server has).
// State is kept in .data/songs-journal.json and every song in .data/songs-backup.json.
// Keep both: they are money.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { claimQuote, connect, Journal, makeSong, newInvoice, pushSongs, restoreStash, songDone, stashSats, strandedSongs, sweepSongs, writeJson } from './lib/make-songs.ts';
import { fillPool } from './lib/fill-pool.ts';
import { PRODUCT_MINT, SONG_SATS } from '../shared/song.ts';

const JOURNAL = '.data/songs-journal.json';
const BACKUP = '.data/songs-backup.json';
const say = (line) => console.log(line);
const fail = (line) => {
  console.error(line);
  process.exit(1);
};

const [cmd, arg] = process.argv.slice(2);
const mint = process.env.MINT_URL ?? PRODUCT_MINT;
const base = process.env.BASE ?? 'http://localhost:5173';
const secret = process.env.ADMIN_SECRET ?? '';

if (cmd === 'testpool') {
  await fillPool(base, Number(arg) || 10);
  say(`Added ${Number(arg) || 10} testnut songs to ${base}.`);
  process.exit(0);
}

if (!['invoice', 'claim', 'make', 'push', 'reclaim', 'restore', 'balance'].includes(cmd)) fail('Usage: songs.mjs invoice <songs> | claim <quote> | make [n] | push | reclaim [--sweep] | restore | balance | testpool <n>');

if (!process.env.ADMIN_SEED) {
  if (cmd === 'balance' && existsSync(JOURNAL)) {
    // The stash can be read from the journal without the seed.
  } else {
    const seed = randomBytes(32).toString('hex');
    console.log('ADMIN_SEED is not set, so here is a new one. This is the ONLY time it is shown.');
    console.log('SAVE IT NOW (a password manager). It is the key to every sat in the stash.');
    console.log('');
    console.log(`    ADMIN_SEED=${seed}`);
    console.log('');
    console.log('Then run the command again with it set. Nothing was created or spent.');
    process.exit(0);
  }
}

const backup = () => (existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : []);

async function flush(journal) {
  if (!secret) fail('Set ADMIN_SECRET to send songs to the server.');
  const todo = backup().slice(journal.data.posted);
  if (!todo.length) return say('Nothing waiting to be sent.');
  const added = await pushSongs(base, secret, todo);
  journal.data.posted += added;
  journal.save();
  say(`Sent ${added} songs to ${base}.`);
}

// Makes up to `n` songs from the stash (all it can afford when `n` is left out) and sends them.
async function makeAndSend(a, n = Infinity) {
  if (a.journal.data.song) say('Finishing the song the last run stopped in.');
  let made = 0;
  try {
    while (made < n && (a.journal.data.song || stashSats(a.journal) >= SONG_SATS)) {
      let entry;
      try {
        entry = await makeSong(a);
      } catch (e) {
        // The last few sats can fall short of a song plus the mint's fee: that is the end, not a fault.
        if (/run out/.test(e.message)) break;
        throw e;
      }
      writeJson(BACKUP, [...backup(), entry]); // written down before anything else
      songDone(a);
      say(`song ${++made}${n === Infinity ? '' : ` of ${n}`}`);
      // A breath between songs: a long run of quick requests can get an address shut out by the mint.
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally {
    // If the mint drops out partway, the songs already made still go to the server.
    await flush(a.journal);
    const left = stashSats(a.journal);
    say(`Stash left: ${left} sats.${left >= SONG_SATS ? ' Run `make` again to finish.' : ''}`);
  }
}

const journal = new Journal(JOURNAL, mint);
try {
  if (cmd === 'balance') {
    say(`Stash: ${stashSats(journal)} sats (${Math.floor(stashSats(journal) / SONG_SATS)} songs' worth) in ${journal.data.stash.length} coins.`);
    say(`Made: ${backup().length} songs, ${backup().length - journal.data.posted} not yet sent.`);
    if (secret) {
      const res = await fetch(`${base}/api/admin/pool`, { headers: { authorization: `Bearer ${secret}` } });
      if (!res.ok) fail(`The server said ${res.status}.`);
      const { count, sats } = await res.json();
      say(`Pool on ${base}: ${count} songs, ${sats} sats.`);
    } else say('Set ADMIN_SECRET to see the pool.');
    process.exit(0);
  }

  // Sending needs the server, not the mint, so it works even when the mint is not answering.
  if (cmd === 'push') {
    await flush(journal);
    process.exit(0);
  }

  const a = await connect(mint, process.env.ADMIN_SEED, journal, say);

  if (cmd === 'invoice') {
    const songs = Number(arg);
    if (!Number.isInteger(songs) || songs < 1) fail('How many songs? For example: invoice 100');
    const q = await newInvoice(a, songs);
    say(`Pay this invoice for ${q.amount} sats from any Lightning wallet:\n\n${q.request}\n\nQuote ${q.id}. If this stops before it is paid, run: claim ${q.id}`);
    say('Waiting for payment...');
    await claimQuote(a, q.id);
    say('Paid and minted. Making the songs...');
    await makeAndSend(a);
  } else if (cmd === 'claim') {
    if (!arg) fail('Which quote? For example: claim <quote>');
    await claimQuote(a, arg);
    say('Minted. Making the songs...');
    await makeAndSend(a);
  } else if (cmd === 'restore') {
    say(`Restored from ADMIN_SEED. Stash: ${await restoreStash(a)} sats.`);
  } else if (cmd === 'make') {
    const n = arg === undefined ? Infinity : Number(arg);
    if (n !== Infinity && (!Number.isInteger(n) || n < 1)) fail('How many songs? For example: make 100, or just make for all of them');
    await makeAndSend(a, n);
  } else if (cmd === 'reclaim') {
    if (!secret) fail('Set ADMIN_SECRET to see which songs are in the pool.');
    if (process.argv.includes('--all')) {
      // Empty the pool first, so nobody catches a song whose coins are about to be spent.
      const gone = await fetch(`${base}/api/admin/pool`, { method: 'DELETE', headers: { authorization: `Bearer ${secret}` } });
      if (!gone.ok) fail(`The server said ${gone.status}.`);
      say(`Emptied the pool (${(await gone.json()).removed} songs).`);
      const sent = backup().slice(0, journal.data.posted);
      const unspent = await strandedSongs(a, sent, new Set());
      say(`${sent.length} songs sent, ${unspent.length} still unspent.`);
      if (unspent.length) say(`Swept ${await sweepSongs(a, unspent)} sats into the stash. Stash: ${stashSats(journal)} sats.`);
      process.exit(0);
    }
    const res = await fetch(`${base}/api/admin/pool?songs=1`, { headers: { authorization: `Bearer ${secret}` } });
    if (!res.ok) fail(`The server said ${res.status}.`);
    const { songs: waiting } = await res.json();
    // Songs not yet sent to the server are `push`'s to send, not stranded.
    const sent = backup().slice(0, journal.data.posted);
    const stranded = await strandedSongs(a, sent, new Set(waiting));
    say(`${sent.length} songs sent, ${waiting.length} waiting in the pool, ${stranded.length} handed out and never caught.`);
    if (!stranded.length) process.exit(0);
    if (process.argv.includes('--sweep')) {
      say(`Swept ${await sweepSongs(a, stranded)} sats into the stash. Stash: ${stashSats(journal)} sats.`);
    } else {
      await pushSongs(base, secret, stranded);
      say(`Put ${stranded.length} songs back in the pool.`);
    }
  }
} catch (e) {
  fail(`Stopped: ${e.message}`);
}
