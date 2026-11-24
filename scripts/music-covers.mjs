// Fetches cover art for the Good Music page into public/music/ (MusicBrainz + Cover Art Archive).
// Run: node scripts/music-covers.mjs [slug ...]   Needs network and cwebp (brew install webp); the covers are committed.
// Covers are kept as WebP, 500 px at most: they show at 230 px, and JPEGs straight from the archive ran to 1.4 MB.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
// [slug, artist, album]
const albums = [
  ['yeezus', 'Kanye West', 'Yeezus'],
  ['oshin', 'DIIV', 'Oshin'],
  ['gemini', 'Wild Nothing', 'Gemini'],
  ['pray-for-paris', 'Westside Gunn', 'Pray for Paris'],
  ['wwcd', 'Griselda', 'WWCD'],
  ['paradise', 'Kareem Ali', 'The Essence'],
  ['scenery', 'Ryo Fukui', 'Scenery'],
  ['slowdive', 'Slowdive', 'Slowdive'],
  ['forca-bruta', 'Jorge Ben', 'Força Bruta'],
  ['blue-rev', 'Alvvays', 'Blue Rev'],
  ['boxer', 'The National', 'Boxer'],
  ['stillmatic', 'Nas', 'Stillmatic'],
  ['hatful', 'The Smiths', 'Hatful of Hollow'],
  ['operation-doomsday', 'MF DOOM', 'Operation: Doomsday'],
  ['heaven-or-las-vegas', 'Cocteau Twins', 'Heaven or Las Vegas'],
  ['graduation', 'Kanye West', 'Graduation'],
  ['live-love-asap', 'A$AP Rocky', 'Live.Love.A$AP'],
  ['the-unseen', 'Quasimoto', 'The Unseen'],
  ['ecstatic', 'Mos Def', 'The Ecstatic'],
  ['any-other-city', 'Life Without Buildings', 'Any Other City'],
  ['unknown-death', 'Yung Lean', 'Unknown Death 2002'],
  ['a-different-arrangement', 'Black Marble', 'A Different Arrangement'],
  ['splendour-of-fear', 'Felt', 'The Splendour of Fear'],
  ['playboi-carti', 'Playboi Carti', 'Playboi Carti'],
  ['damn', 'Kendrick Lamar', 'DAMN.'],
  ['burnt-out-by-3pm', 'Witch Coast', 'Burnt Out by 3PM'],
  ['idle-labor', 'Craft Spells', 'Idle Labor'],
  ['bloom', 'Beach House', 'Bloom'],
  ['birds-in-the-trap', 'Travis Scott', 'Birds in the Trap Sing McKnight'],
  ['daytona', 'Pusha T', 'Daytona'],
  ['agent-intellect', 'Protomartyr', 'Agent Intellect'],
];
import { existsSync } from 'node:fs';
const only = process.argv.slice(2);
const get = (u) => fetch(u, { headers: { 'User-Agent': 'good-music-covers/1.0' } });
for (const [slug, artist, album] of albums) {
  if (only.length ? !only.includes(slug) : existsSync(`public/music/${slug}.webp`)) continue;
  try {
  const q = encodeURIComponent(`releasegroup:"${album}" AND artist:"${artist}" AND primarytype:album`);
  const r = await (await get(`https://musicbrainz.org/ws/2/release-group?query=${q}&fmt=json&limit=5`)).json();
  let done = false;
  for (const g of r['release-groups'] ?? []) {
    const img = await get(`https://coverartarchive.org/release-group/${g.id}/front-500`);
    if (!img.ok) continue;
    const raw = `public/music/${slug}.download`;
    await writeFile(raw, Buffer.from(await img.arrayBuffer()));
    try {
      // -resize 500 0 would enlarge a smaller cover, so the size is only capped when it's over.
      const wide = Number(execFileSync('sips', ['-g', 'pixelWidth', raw]).toString().match(/pixelWidth: (\d+)/)?.[1] ?? 0) > 500;
      execFileSync('cwebp', ['-quiet', '-q', '82', ...(wide ? ['-resize', '500', '0'] : []), raw, '-o', `public/music/${slug}.webp`]);
    } finally {
      rmSync(raw);
    }
    console.log(slug.padEnd(22), '→', g['artist-credit']?.[0]?.name, '-', g.title);
    done = true;
    break;
  }
  if (!done) console.log('MISS', slug);
  } catch (e) { console.log('ERR ', slug, e.cause?.code ?? e.message); }
  await new Promise((r) => setTimeout(r, 1100));
}
