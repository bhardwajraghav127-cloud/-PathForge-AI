// R7: polish — 390px mobile flow, keyboard operability, and the full
// demo loop with every external host blocked (offline pack proof).
import { expect, test } from '@playwright/test';

test.setTimeout(240000);

test.describe('mobile 390px', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('hamburger nav drives a full demo on a phone viewport', async ({ page }) => {
    await page.goto('/#/real');
    await expect(page.getByTestId('realmap-canvas').locator('canvas')).toBeVisible({ timeout: 30000 });
    // Map fits the phone screen instead of overflowing it.
    const box = await page.getByTestId('realmap-canvas').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(390);
    expect(box!.height).toBeLessThanOrEqual(420);
    // Hamburger reveals nav; Real Demo is reachable and runnable.
    await page.getByTestId('nav-toggle').click();
    await page.getByRole('link', { name: 'Real Demo' }).click();
    await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
    await page.getByTestId('realdemo-speed').selectOption('60');
    await page.getByTestId('realdemo-start').click();
    await expect(page.getByTestId('realdemo-decision')).toBeVisible({ timeout: 120000 });
    // Panel toggle collapses the panel; the map stays visible.
    await expect(page.getByTestId('panel-toggle')).toHaveAttribute('aria-expanded', 'true');
    await page.getByTestId('panel-toggle').click();
    await expect(page.getByTestId('panel-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('realmap-canvas').locator('canvas')).toBeVisible();
  });
});

test.describe('keyboard', () => {
  test('panel toggle and lab scrubber are keyboard operable', async ({ page }) => {
    await page.goto('/#/real-lab');
    await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
    await page.getByTestId('panel-toggle').focus();
    await expect(page.getByTestId('panel-toggle')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('panel-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('panel-toggle')).toHaveAttribute('aria-expanded', 'true');
    // Race, then drive the scrubber with arrow keys only.
    await page.getByTestId('reallab-run').click();
    await page.getByTestId('reallab-table').waitFor({ timeout: 120000 });
    await page.getByTestId('reallab-scrub').focus();
    await page.keyboard.press('Home');
    await expect(page.getByTestId('reallab-step')).toContainText('Dijkstra 0 /');
    await page.keyboard.press('End');
    await expect(page.getByTestId('reallab-step')).not.toContainText('Dijkstra 0 /');
  });
});

test.describe('offline pack', () => {
  test('full demo loop runs with external hosts blocked', async ({ page }) => {
    const blocked: string[] = [];
    const external: string[] = [];
    await page.context().route(/https?:\/\/(?!localhost|127\.0\.0\.1).*/, (r) => {
      blocked.push(r.request().url());
      return r.abort();
    });
    page.on('request', (r) => {
      if (!r.url().startsWith('http://localhost:')) external.push(r.url());
    });
    await page.goto('/#/real-demo');
    await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
    await page.getByTestId('realdemo-speed').selectOption('60');
    await page.getByTestId('realdemo-start').click();
    await expect(page.getByTestId('realdemo-decision')).toBeVisible({ timeout: 120000 });
    await expect(page.getByTestId('realdemo-decision-text')).toContainText('REROUTE_REQUIRED');
    // Accept the diversion while still offline: engine roundtrip is local.
    await page.getByTestId('realdemo-accept').click();
    await expect(page.getByTestId('realdemo-receipt-action')).toHaveText('accept', { timeout: 60000 });
    await expect(page.getByTestId('realdemo-status')).toContainText('resumed', { timeout: 60000 });
    expect(external).toEqual([]);
  });
});
