import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SongResult } from '../shared/song.js';
import { DEMO, demoSong } from './demo.js';

// The songs that are ready to sing, made ahead of time by scripts/songs.mjs.
// pop() hands each one out exactly once. With Upstash Redis (Vercel) the pool
// is a list and LPOP is the atomic step. Without it, in development, it is a
// JSON file, with a lock that holds within this process.

const KEY = 'hushmoney:songs';
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const shared = !!(REDIS_URL && REDIS_TOKEN);
const FILE = process.env.POOL_FILE ?? '.data/pool.json';

async function redis(...command: (string | number)[]): Promise<unknown> {
  const res = await fetch(REDIS_URL!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: JSON.stringify(command.map(String)),
  });
  const { result, error } = (await res.json()) as { result?: unknown; error?: string };
  if (error) throw new Error(`[pool] Redis: ${error}`);
  return result;
}

let queue: Promise<unknown> = Promise.resolve();
function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

async function read(): Promise<SongResult[]> {
  try {
    return JSON.parse(await readFile(FILE, 'utf8')) as SongResult[];
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return [];
    throw e;
  }
}

async function write(songs: SongResult[]) {
  await mkdir(dirname(FILE), { recursive: true, mode: 0o700 });
  await writeFile(`${FILE}.tmp`, JSON.stringify(songs), { mode: 0o600 });
  await rename(`${FILE}.tmp`, FILE);
}

export async function push(entries: SongResult[]): Promise<void> {
  if (!entries.length) return;
  if (shared) await redis('RPUSH', KEY, ...entries.map((e) => JSON.stringify(e)));
  else await locked(async () => write([...(await read()), ...entries]));
}

// The next song, or null when there are none. Nobody else gets the same one.
export async function pop(): Promise<SongResult | null> {
  if (DEMO) return demoSong();
  if (shared) {
    const item = await redis('LPOP', KEY);
    return typeof item === 'string' ? (JSON.parse(item) as SongResult) : null;
  }
  return locked(async () => {
    const [first, ...rest] = await read();
    if (!first) return null;
    await write(rest);
    return first;
  });
}

export async function count(): Promise<number> {
  if (DEMO) return 1;
  return shared ? Number(await redis('LLEN', KEY)) : (await locked(read)).length;
}

// The songs waiting, as hex seeds only (never the coins), for the admin's reclaim.
export async function seeds(): Promise<string[]> {
  if (DEMO) return [];
  const all = shared ? ((await redis('LRANGE', KEY, 0, -1)) as string[]).map((i) => JSON.parse(i) as SongResult) : await locked(read);
  return all.map((e) => e.song);
}

// Empties the pool, for the admin taking every song back. Returns how many were waiting.
export async function drain(): Promise<number> {
  if (DEMO) return 0;
  if (shared) {
    const n = Number(await redis('LLEN', KEY));
    await redis('DEL', KEY);
    return n;
  }
  return locked(async () => {
    const n = (await read()).length;
    await write([]);
    return n;
  });
}
