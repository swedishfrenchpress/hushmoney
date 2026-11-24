# Hush Money

Your laptop sings for two seconds, and your phone, listening in its browser, catches the song and holds the sats. The song is a 16-byte seed: the phone gets the coins back from the mint (NUT-13, NUT-09) and claims them before anyone else in the room can.

Live at <https://hushmoney.cash>. It started as trick 4 of [magical.cash](https://magical.cash).

```sh
npm install
npm run dev          # http://localhost:5173, API included
npm run songs -- testpool 20   # free testnut songs in the dev server's pool; Sing needs songs in it
npm test             # unit tests, offline, with a fake mint
npm run test:live    # against the real testnut (about 3 minutes)
npm run test:e2e     # browser tests in the preinstalled Chromium
npm run lint         # strict tsc, then scripts/lint.mjs
```

The laptop page is `/`. It shows a QR code for the phone page, `/listen`, and a Sing button. Each song opens with a three-note chime, and its real tones scroll across a stave as it sings. A phone that opens `/` is sent to `/listen`, where a chrome orb listens, locks on, and turns into a gold coin when the song lands.

## Trying it without a phone

- **Two tabs, no speaker or mic:** open `http://localhost:5173/?air` and `http://localhost:5173/listen?air` in the same browser. Tap the orb in the second, then Sing in the first. In dev, the laptop tab posts each song to a BroadcastChannel as well; `?air` keeps its speakers quiet, and the listener hears the channel instead of the mic.
- **A fake phone:** `npm run catch -- http://localhost:5173` runs `happy`, `race`, `spent` and `lost` against the dev server with the phone's own wallet code; add `caps` for the per-connection cap.
- **The decoder through a software room:** `npm run air` prints a pass rate per ggwave mode and condition.
- **Every state, as pictures:** `npm run screens -- http://localhost:5195` (with a dev server on 5195) writes screenshots and recordings to `design/screens/`.

## Funding the songs

Every song is 21 sats from the real Minibits mint, made ahead of time. The server holds no mint and no sats, only the finished songs, so a hacked server gives away at most the pool. Run these on your own machine:

1. `npm run songs` with no `ADMIN_SEED` makes one and shows it once. Save it: it is the key to the stash, and it restores it (`restore`) if the journal is lost. Then set `ADMIN_SEED`.
2. Set `BASE` (the site, default `http://localhost:5173`) and `ADMIN_SECRET`.
3. `BASE=https://hushmoney.cash npm run songs -- invoice 100` prints a Lightning invoice for 100 songs (2,100 sats). Pay it from any wallet; the script waits, mints, makes the songs and sends them to the server. Paying is all it takes: the server is out of songs only when the money is. If the script stops first, `claim <quote>` finishes the job.

Each song is written to `.data/songs-backup.json`, then sent. `push` resends any the server missed, `make` turns anything left in the stash into songs, `balance` shows the stash and the pool.

`.data/` holds the journal and backup. It is money, and it is gitignored: keep it. `MINT_URL=https://testnut.cashu.space` does all of this for free, for tests; the product never makes testnut songs on its own.

On the server: `ADMIN_SECRET` (32 characters or more; without it the admin routes refuse everyone), plus Redis and the Turnstile keys on Vercel. The pool is `hushmoney:songs`. When it is empty, Sing says "The songs have run out for now. Check back soon." The day's limits (`server/guard.ts`) are 2,100 sats in all (100 songs), and 105 (5 songs) to one phone and to one connection. A song that's handed out and never caught is not lost: its coins stay unspent at the mint, and `npm run songs -- reclaim` puts those songs back in the pool (`--sweep` swaps them into the stash instead). A refused Sing costs nothing.

## Flags

- `?modes=alt` on the laptop: every other repeat sings in ggwave's slower normal mode.
- `?ln` on the phone, dev only: the Lightning send, for the fake addresses `paid@fake.testnut`, `failed@`, `pending@`, `pending-paid@` and `pending-failed@`. Real addresses work everywhere; the fake ones are dev only.

## Trying it on your phone

Phones only allow the mic over HTTPS, so the dev server goes out through a tunnel:

```sh
npm run dev
ngrok http 5173
```

Open the `https://…ngrok-free.app` address on the laptop too, so its QR code points at the tunnel. The tunnel makes the dev server reachable from the internet while it runs, so stop it when you're done.

## Layout

- `shared/song.ts`: what gets sung, 17 bytes: a format and mint byte, then the seed.
- `shared/fees.ts`: how a song is split so the phone nets exactly the amount it shows.
- `server/pool.ts`: the songs that are ready, each handed out once (a Redis list, or `.data/pool.json` in dev). `POST /api/song` pops one.
- `scripts/songs.mjs`, `scripts/lib/make-songs.ts`: fund the admin's stash and make the songs, on the admin's machine (below).
- `server/guard.ts`: the daily budget, the caps per phone and per connection, one-time claims and the Turnstile check, counted as `hushmoney:*` in Redis. `server/lnproxy.ts`, `server/fakeln.ts`: the Lightning send's server half.
- `src/ggwave.ts`: ggwave's WASM. The decoder resamples to 48 kHz and feeds whole frames, since ggwave loses the song at 44.1 kHz otherwise.
- `src/chime.ts`: the three notes before the data, under ggwave's band.
- `src/footer.ts`: the footer, SHHHHHHH with a chrome orb for its full stop.
- `src/sing/`: the laptop. `main.ts` sings on repeat and watches the coins at the mint (NUT-17); `score.ts` reads the song's tones; `stave.ts` draws them.
- `src/listen/`: the phone.
  - `mic.ts` and `tap.ts`: raw audio, its level, and whether a song is in the air.
  - `wallet.ts`: the catch, recovery, and handing out.
  - `lightning.ts`: the Lightning send.
  - `vault.ts`: storage.
  - `orb.ts`: the chrome orb, Three.js.
  - `main.ts`: the page.
- `design/og/`: the link preview, a soundwave of lights around the name. With a dev server on 5195, `node design/og/render.mjs e3-refined public --as og` renders `public/og.jpg` and the looping `public/og.mp4`. The other pages there (`a-shh` to `e2-waves`) are the earlier options, kept for reference.
- `tests/unit`, `tests/live`, `tests/e2e`: offline, against testnut, and in a browser. `tests/support/fakemint.ts` is a fake mint.
