import type { Proof } from '@cashu/cashu-ts';
import { generateSecretKey } from 'nostr-tools';
import { wrapEvent } from 'nostr-tools/nip17';
import { SimplePool } from 'nostr-tools/pool';
import type { Destination } from '../../shared/destination';

// Sends everything this phone holds to a Cashu request, the way a wallet pays
// one (NUT-18 over NIP-17), with a throwaway key for each message.

const PUBLISH_MS = 8000;

export type Sent = 'ok' | 'maybe';
export class NotSent extends Error {}

// 'ok': a relay took it. 'maybe': no relay answered in time, so it may still turn up. Throws NotSent when every relay refused.
export async function sendToRequest(to: Extract<Destination, { kind: 'creq' }>, proofs: Proof[], mint: string): Promise<Sent> {
  const payload = {
    ...(to.requestId && { id: to.requestId }),
    memo: 'Hush Money',
    mint,
    unit: 'sat',
    proofs: proofs.map((p) => ({ id: p.id, amount: p.amount.toNumber(), secret: p.secret, C: p.C, ...(p.dleq && { dleq: p.dleq }) })),
  };
  const event = wrapEvent(generateSecretKey(), { publicKey: to.pubkey, relayUrl: to.relays[0] }, JSON.stringify(payload));
  const pool = new SimplePool();
  try {
    const answers = to.relays.map(() => 'none');
    const published = pool.publish(to.relays, event).map((attempt, i) =>
      attempt.then(
        () => void (answers[i] = 'ok'),
        (reason) => {
          // A publish that timed out or lost its connection may still have gone out.
          if (!(reason instanceof Error && /publish timed out|relay connection/.test(reason.message))) answers[i] = 'refused';
        },
      ),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all(published), new Promise((r) => (timer = setTimeout(r, PUBLISH_MS)))]);
    clearTimeout(timer);
    if (answers.includes('ok')) return 'ok';
    if (answers.includes('none')) return 'maybe';
    throw new NotSent('No relay took it. Your sats are still here.');
  } finally {
    pool.close(to.relays);
  }
}
