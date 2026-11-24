// Where this browser keeps its money: the secrets of coins it's about to receive, the coins it has,
// and what each operation was doing when the page last closed. Every write is read back and compared
// before anything is sent to the mint; if the browser can't store (private modes with no storage,
// quota full, storage disabled), the page refuses to move money at all rather than risk losing it.

export interface Kv {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  key(i: number): string | null;
  readonly length: number;
}

export class VaultError extends Error {}

export class Vault {
  private constructor(private kv: Kv | null) {}

  static of(kv: Kv | null): Vault {
    return new Vault(kv);
  }

  static browser(): Vault {
    try {
      const kv = globalThis.localStorage;
      const probe = `t2:probe:${Math.random()}`;
      kv.setItem(probe, '1');
      const ok = kv.getItem(probe) === '1';
      kv.removeItem(probe);
      return new Vault(ok ? kv : null);
    } catch {
      return new Vault(null);
    }
  }

  get ok() {
    return !!this.kv;
  }

  read<T>(key: string): T | null {
    if (!this.kv) return null;
    try {
      const raw = this.kv.getItem(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  // Saves and proves it: the stored value must read back exactly. Throws VaultError otherwise.
  write(key: string, value: unknown) {
    if (!this.kv) throw new VaultError("this browser can't save anything here");
    const json = JSON.stringify(value);
    try {
      this.kv.setItem(key, json);
    } catch {
      throw new VaultError("this browser's storage is full or switched off");
    }
    if (this.kv.getItem(key) !== json) throw new VaultError("this browser didn't keep what it was given");
  }

  remove(key: string) {
    this.kv?.removeItem(key);
  }

  keys(prefix: string): string[] {
    if (!this.kv) return [];
    const out: string[] = [];
    for (let i = 0; i < this.kv.length; i++) {
      const k = this.kv.key(i);
      if (k?.startsWith(prefix)) out.push(k);
    }
    return out;
  }
}

// A plain in-memory Kv, for tests and for Node.
export class MemoryKv implements Kv {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  get length() {
    return this.m.size;
  }
}

// One operation on one coin at a time, across every tab of this browser. Web Locks where the browser
// has them; otherwise a lease in storage that each tab claims and then re-reads to be sure it won.
const local = new Map<string, Promise<unknown>>();

export async function exclusive<T>(name: string, vault: Vault, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks?.request) return locks.request(`t2:${name}`, { mode: 'exclusive' }, fn) as Promise<T>;
  // Within this tab, queue behind whoever has it.
  const before = local.get(name) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  local.set(name, before.then(() => mine));
  await before.catch(() => {});
  try {
    if (vault.ok) await leaseAcrossTabs(name, vault);
    return await fn();
  } finally {
    if (vault.ok) vault.remove(`t2:lease:${name}`);
    release();
  }
}

async function leaseAcrossTabs(name: string, vault: Vault) {
  const me = Math.random().toString(36).slice(2);
  const key = `t2:lease:${name}`;
  for (let i = 0; i < 200; i++) {
    const cur = vault.read<{ who: string; until: number }>(key);
    if (!cur || cur.until < Date.now()) {
      vault.write(key, { who: me, until: Date.now() + 60_000 });
      await new Promise((r) => setTimeout(r, 30));
      if (vault.read<{ who: string }>(key)?.who === me) return;
    }
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
  }
  throw new VaultError('another tab is busy with this coin');
}
