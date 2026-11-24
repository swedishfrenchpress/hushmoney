import { expect, test } from '@playwright/test';
import { CAPTURE_AUDIO, phoneBrowser, phonePage, songFromApi, writeWav } from './support';

test('the laptop sings, a phone hears it through its mic and claims it, and the laptop says caught', async ({ page: laptop }) => {
  await laptop.addInitScript(CAPTURE_AUDIO);
  let loads = 0;
  laptop.on('load', () => loads++);
  await laptop.goto('/');
  await expect(laptop.locator('.scan .qr svg')).toBeVisible();
  await laptop.getByRole('button', { name: 'Sing', exact: true }).click();
  await expect(laptop.locator('.stop')).toBeVisible({ timeout: 30_000 });

  // What the laptop played, as a WAV for the phone's fake mic, with a little room either side.
  await laptop.waitForFunction(() => (window as unknown as { __sung: unknown[] }).__sung.length > 0);
  const sung = await laptop.evaluate(() => (window as unknown as { __sung: { rate: number; data: number[] }[] }).__sung[0]);
  const pad = new Array(Math.round(sung.rate * 0.5)).fill(0);
  const wav = writeWav('song', [...pad, ...sung.data, ...pad], sung.rate);

  const browser = await phoneBrowser({ wav });
  try {
    const phone = await phonePage(browser);
    await phone.getByRole('button', { name: 'Tap to listen' }).click();
    await expect(phone.locator('.face')).toContainText(/\d+ sats/, { timeout: 30_000 });
    const sats = (await phone.locator('.face .val').textContent())!;
    await expect(phone.getByRole('link', { name: 'Open in Cashu.me' })).toBeVisible();
    // Someone with no wallet app has a way on too.
    await expect(phone.getByRole('link', { name: 'Open the web wallet' })).toBeVisible();
    await expect(phone.locator('.balance')).toHaveText(`₿${sats}`);
    // The keepsake: the song's own tune, and a way to hear it.
    await expect(phone.locator('.keepsake .tdot')).toHaveCount(7);
    await expect(phone.getByRole('button', { name: 'Hear your song' })).toBeVisible();

    await expect(laptop.locator('.status')).toHaveText('Caught.', { timeout: 15_000 });
    expect(loads, 'the laptop page never reloads').toBe(1);
    await expect(laptop.locator('.amount .n')).toHaveText(sats);
    await expect(laptop.getByRole('button', { name: 'Sing another' })).toBeVisible();
  } finally {
    await browser.close();
  }
});

test('mic denied: the phone says how to turn it on', async () => {
  const browser = await phoneBrowser({ micAllowed: false });
  try {
    const phone = await phonePage(browser);
    await phone.getByRole('button', { name: 'Tap to listen' }).click();
    await expect(phone.locator('.note.main')).toHaveText("The mic is blocked for this page. Open the site settings from the address bar, allow the microphone, then tap again.");
    await expect(phone.locator('.face')).toHaveText('Tap to listen');
  } finally {
    await browser.close();
  }
});

test('30 s of silence: the phone gives up and says so', async () => {
  const wav = writeWav('silence', new Float32Array(48_000 * 2), 48_000);
  const browser = await phoneBrowser({ wav });
  try {
    const phone = await phonePage(browser);
    await phone.getByRole('button', { name: 'Tap to listen' }).click();
    await expect(phone.locator('.face')).toHaveText('Listening…');
    await expect(phone.locator('.note.main')).toHaveText('No song heard. Turn the laptop up, hold the phone close, and tap again.', { timeout: 40_000 });
    await expect(phone.locator('.face')).toHaveText('Tap to listen');
  } finally {
    await browser.close();
  }
});

test('the fallback QR link claims the song, the balance survives a reload, and a second phone finds it gone', async () => {
  const { song, sats } = await songFromApi();
  const browser = await phoneBrowser({});
  try {
    const phone = await phonePage(browser, `/listen#${song}`);
    await expect(phone.locator('.face')).toContainText(`${sats} sats`, { timeout: 30_000 });
    await expect(phone).toHaveURL(/\/listen$/); // the fragment is cleared
    await phone.reload();
    await expect(phone.locator('.balance')).toHaveText(`₿${sats}`);
    await phone.locator('.balance').click();
    await expect(phone.locator('.sheet .total')).toHaveText(`₿${sats}`);

    const other = await phonePage(browser, `/listen#${song}`);
    await expect(other.locator('.note.main')).toHaveText('Someone got there first. Hush.', { timeout: 30_000 });
  } finally {
    await browser.close();
  }
});

test('Copy hands everything out, and the sheet shows it as on its way', async () => {
  const { song, sats } = await songFromApi();
  const browser = await phoneBrowser({});
  try {
    const phone = await phonePage(browser, `/listen#${song}`);
    await phone.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await expect(phone.locator('.face')).toContainText(`${sats} sats`, { timeout: 30_000 });
    await phone.locator('.actions.main .copy').click();
    await expect(phone.locator('.actions.main .copy')).toHaveText('Copied');
    expect(await phone.evaluate(() => navigator.clipboard.readText())).toMatch(/^cashuB/);
    await phone.locator('.balance').click();
    await expect(phone.locator('.sheet .split')).toHaveText(`₿0 here · ₿${sats} on their way`);
  } finally {
    await browser.close();
  }
});

test('a phone that opens the laptop page can tap through to the listener', async () => {
  const browser = await phoneBrowser({});
  try {
    const phone = await phonePage(browser, '/');
    await phone.getByRole('link', { name: 'Open the listener', exact: true }).click();
    await expect(phone).toHaveURL(/\/listen$/);
    await expect(phone.getByRole('button', { name: 'Tap to listen' })).toBeVisible();
  } finally {
    await browser.close();
  }
});

test('a tab closed mid-claim, after the mint did the swap: the next visit finds the sats', async () => {
  const { song, sats } = await songFromApi();
  const browser = await phoneBrowser({});
  try {
    const first = await phonePage(browser, '/listen');
    let swapped = false;
    await first.route('**/v1/swap', async (route) => {
      await route.fetch(); // the mint does the swap
      swapped = true;
      await new Promise(() => {}); // and the answer never arrives
    });
    await first.evaluate((s) => (location.hash = s), song);
    await expect.poll(() => swapped, { timeout: 30_000 }).toBe(true);
    await expect(first.locator('.face')).toHaveText('Catching…');
    const context = first.context();
    await first.close(); // the tab dies

    const next = await context.newPage();
    await next.goto('/listen');
    await expect(next.locator('.balance')).toHaveText(`₿${sats}`, { timeout: 30_000 });
  } finally {
    await browser.close();
  }
});

test('sats on their way leave the balance once a wallet app claims them', async () => {
  const { song, sats } = await songFromApi();
  const browser = await phoneBrowser({});
  try {
    const phone = await phonePage(browser, `/listen#${song}`);
    await phone.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await expect(phone.locator('.face')).toContainText(`${sats} sats`, { timeout: 30_000 });
    await phone.locator('.actions.main .copy').click();
    const token = await phone.evaluate(() => navigator.clipboard.readText());

    const { Wallet } = await import('@cashu/cashu-ts');
    const app = new Wallet('https://testnut.cashu.space', { unit: 'sat' });
    await app.loadMint();
    await app.receive(token); // the wallet app claims it

    await phone.reload();
    await expect(phone.locator('.note.main')).toHaveText(`₿${sats} landed in your wallet.`, { timeout: 30_000 });
    await expect(phone.locator('.balance')).toBeHidden();
  } finally {
    await browser.close();
  }
});

test('a wallet app claiming the sats turns the caught screen over, with the page left open', async () => {
  const { song, sats } = await songFromApi();
  const browser = await phoneBrowser({});
  try {
    const phone = await phonePage(browser, `/listen#${song}`);
    await phone.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await expect(phone.locator('.face')).toContainText(`${sats} sats`, { timeout: 30_000 });
    await phone.locator('.actions.main .copy').click();
    await expect(phone.locator('.note.main')).toHaveText('Waiting for your wallet to claim it…');
    const token = await phone.evaluate(() => navigator.clipboard.readText());

    const { Wallet } = await import('@cashu/cashu-ts');
    const app = new Wallet('https://testnut.cashu.space', { unit: 'sat' });
    await app.loadMint();
    await app.receive(token); // the wallet app claims it; the page is never reloaded

    await expect(phone.locator('.ear')).toHaveAttribute('data-state', 'landed', { timeout: 20_000 });
    await expect(phone.locator('.note.main')).toHaveText(`₿${sats} landed in your wallet.`);
    await expect(phone.locator('.face.amount')).toContainText(`${sats} sats`);
    await expect(phone.locator('.actions.main .copy')).toBeHidden();
    await expect(phone.locator('.actions.main .open')).toBeHidden();
    await expect(phone.locator('.balance')).toBeHidden();
    await phone.getByRole('button', { name: 'Listen again' }).click();
    await expect(phone.locator('.ear')).toHaveAttribute('data-state', 'listening');
  } finally {
    await browser.close();
  }
});

test('the gear saves where catches go on to, and says so when it is not usable', async () => {
  const browser = await phoneBrowser({});
  try {
    const phone = await phonePage(browser);
    await phone.getByRole('button', { name: 'Settings' }).click();
    const box = phone.getByRole('textbox');
    await box.fill('not an address');
    await phone.getByRole('button', { name: 'Save' }).click();
    await expect(phone.locator('.dest-status')).toContainText("doesn't look like a Lightning address");
    // Practice sats can't go over Lightning, so the sheet says so and stays open.
    await box.fill('you@wallet.com');
    await phone.getByRole('button', { name: 'Save' }).click();
    await expect(phone.locator('.dest-status')).toHaveText('Practice sats can only go to a Cashu request.');
    await expect(phone.locator('dialog.settings')).toBeVisible();
    await phone.goto('/listen?ln');
    await phone.getByRole('button', { name: 'Settings' }).click();
    await phone.getByRole('textbox').fill('you@wallet.com');
    await phone.getByRole('button', { name: 'Save' }).click();
    await expect(phone.locator('dialog.settings')).not.toBeVisible();
    await expect(phone.locator('.gear')).toContainText('you@wallet.com');
    await phone.reload();
    await phone.getByRole('button', { name: 'Settings' }).click();
    await expect(phone.getByRole('textbox')).toHaveValue('you@wallet.com');
    await phone.getByRole('textbox').fill('');
    await phone.getByRole('button', { name: 'Save' }).click();
    await expect(phone.locator('dialog.settings')).not.toBeVisible();
    await expect(phone.locator('.gear')).toContainText('Send my sats to…');
  } finally {
    await browser.close();
  }
});
