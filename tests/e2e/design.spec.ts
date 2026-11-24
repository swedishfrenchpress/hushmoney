import { expect, test } from '@playwright/test';
import { CAPTURE_AUDIO, phoneBrowser, phonePage, writeWav } from './support';

// The design branch's own promises: a real 3D orb that moves through every
// state of a catch, a flat disc when motion is reduced, and a stave that draws.

test('the orb loads, and a sung song takes it through heard, catching and caught', async ({ page: laptop }) => {
  await laptop.addInitScript(CAPTURE_AUDIO);
  await laptop.goto('/');
  await laptop.getByRole('button', { name: 'Sing', exact: true }).click();
  await laptop.waitForFunction(() => (window as unknown as { __sung: unknown[] }).__sung.length > 0);
  const sung = await laptop.evaluate(() => (window as unknown as { __sung: { rate: number; data: number[] }[] }).__sung[0]);
  const pad = new Array(Math.round(sung.rate * 1)).fill(0);
  const wav = writeWav('design-song', [...pad, ...sung.data, ...pad], sung.rate);

  const browser = await phoneBrowser({ wav });
  try {
    const phone = await phonePage(browser);
    await expect(phone.locator('.ear.gl canvas.orb')).toBeAttached({ timeout: 15_000 });
    await phone.evaluate(() => {
      const w = window as unknown as { __states: string[] };
      w.__states = [];
      new MutationObserver(() => w.__states.push(document.querySelector<HTMLElement>('.ear')!.dataset.state!)).observe(document.querySelector('.ear')!, { attributes: true, attributeFilter: ['data-state'] });
    });
    await phone.getByRole('button', { name: 'Tap to listen' }).click();
    await expect(phone.locator('.ear')).toHaveAttribute('data-state', 'caught', { timeout: 30_000 });
    const states = await phone.evaluate(() => (window as unknown as { __states: string[] }).__states);
    const order = ['listening', 'heard', 'catching', 'caught'].map((s) => states.indexOf(s));
    expect(order.every((i) => i >= 0), `states seen: ${states.join(' ')}`).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    await expect(phone.locator('.face.amount')).toContainText(/\d+ sats/);
  } finally {
    await browser.close();
  }
});

test('with reduced motion the flat disc stands in for the 3D orb', async () => {
  const browser = await phoneBrowser({});
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', baseURL: 'http://localhost:5193' });
    const phone = await context.newPage();
    await phone.goto('/listen');
    await phone.waitForTimeout(1500);
    await expect(phone.locator('.ear')).not.toHaveClass(/gl/);
    await expect(phone.locator('.ear .disc')).toBeVisible();
    await expect(phone.locator('canvas.orb')).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test('the stave draws dark notes while the laptop sings', async ({ page: laptop }) => {
  await laptop.goto('/?air');
  await laptop.getByRole('button', { name: 'Sing', exact: true }).click();
  await expect(laptop.locator('.stop')).toBeVisible({ timeout: 30_000 });
  await laptop.waitForTimeout(1800);
  const dark = await laptop.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.stave')!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 60 && d[i + 1]! < 60 && d[i + 2]! < 60 && d[i + 3]! > 100) n++;
    return n;
  });
  expect(dark).toBeGreaterThan(50);
});

test('listening sends rings out to the edges and the glow follows the room; reduced motion sends none', async () => {
  // A room: soft noise that swells and falls, so the level moves.
  const room = Array.from({ length: 48_000 * 12 }, (_, i) => (Math.random() * 2 - 1) * 0.08 * (0.6 + 0.4 * Math.sin(i / 9000)));
  const browser = await phoneBrowser({ wav: writeWav('room', room, 48_000) });
  try {
    const phone = await phonePage(browser);
    await phone.getByRole('button', { name: 'Tap to listen' }).click();
    await expect.poll(() => phone.locator('.ear .ring').count(), { timeout: 5_000 }).toBeGreaterThan(0);
    // A ring reaches past the orb, at least twice its width.
    const reach = await phone.locator('.ear .ring').first().evaluate((r) => Number(getComputedStyle(r).getPropertyValue('--reach')));
    expect(reach).toBeGreaterThanOrEqual(2);
    await expect
      .poll(() => phone.locator('.ear .disc').evaluate((el) => Number((el as HTMLElement).style.getPropertyValue('--level') || 0)), { timeout: 10_000 })
      .toBeGreaterThan(0);
    // Stopping clears the room.
    await phone.locator('.ear').click();
    await expect(phone.locator('.ear')).toHaveAttribute('data-state', 'idle');
    expect(await phone.locator('.ear .disc').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--level'))).toBe('0');

    const still = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', baseURL: 'http://localhost:5193' });
    const calm = await still.newPage();
    await calm.goto('/listen');
    await calm.getByRole('button', { name: 'Tap to listen' }).click();
    await calm.waitForTimeout(2500);
    await expect(calm.locator('.ear .ring')).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test('the laptop page links to its own How it works page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'How it works' }).click();
  await expect(page).toHaveURL(/\/how$/);
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  await page.getByRole('link', { name: 'Hush Money' }).click();
  await expect(page.locator('.title')).toBeVisible();
});

test('How it works is a picture book you can play: the notes, and a tune made from the song bytes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/how');
  await expect(page.locator('.chap')).toHaveCount(4);
  await expect(page.locator('.bar')).toHaveCount(17);
  const heights = () => page.locator('.bar').evaluateAll((bars) => bars.map((b) => (b as SVGElement).style.height).join());
  const before = await heights();
  await page.getByRole('button', { name: 'Roll another' }).click();
  expect(await heights()).not.toBe(before);
  await expect(page.locator('.tdot')).toHaveCount(9);
  await page.getByRole('button', { name: 'F♯' }).first().click();
  await page.getByRole('button', { name: 'Play the tune' }).click();
  // Simple is the default; Advanced adds the technical detail, and its link opens that way.
  await expect(page.locator('.deep').first()).toBeHidden();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.locator('#c1 .deep').first()).toContainText('NUT-13');
  await expect(page.locator('.hex')).toHaveText(/^32( [0-9a-f]{2}){16}$/);
  await expect(page).toHaveURL(/#advanced$/);
  await page.getByRole('button', { name: 'Simple' }).click();
  await expect(page.locator('.deep').first()).toBeHidden();
  expect(errors).toEqual([]);
});

test('the sound check rings the chime and the letters, without a song', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?air');
  await page.waitForFunction(() => !document.querySelector('#sing')!.hasAttribute('data-intro'), null, { timeout: 15_000 });
  await page.locator('.title').click();
  await page.locator('.title').click();
  // The letters are each in their own mask, so they can move one at a time.
  await expect(page.locator('.title .ch:not(.sp) > span')).toHaveCount(9);
  expect(errors).toEqual([]);
});
