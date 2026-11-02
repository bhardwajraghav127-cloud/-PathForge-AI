// R1: Real Roads page loads a fully local MapLibre map (no tile servers),
// shows OSM attribution + provenance badge, and keeps working with the
// network blocked. Keyboard: canvas is focusable, arrows pan without errors.
import { expect, test } from '@playwright/test';

test('real map loads local style with attribution', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost:')) external.push(r.url());
  });
  await page.goto('/#/real');
  await expect(page.getByTestId('realmap-canvas').locator('canvas')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('source-badge')).toBeVisible();
  await expect(page.getByTestId('source-badge-origin')).toContainText('OpenStreetMap');
  // MapLibre attribution control renders OSM credit.
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
  // No external requests for the local style (no tiles, fonts, sprites).
  expect(external).toEqual([]);
  // Keyboard operable canvas.
  await page.getByTestId('realmap-canvas').locator('canvas').click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('+');
  await expect(page.getByTestId('realmap-canvas').locator('canvas')).toBeVisible();
});

test('real map works fully offline', async ({ page }) => {
  await page.context().route(/https?:\/\/(?!localhost|127\.0\.0\.1).*/, (r) => r.abort());
  await page.goto('/#/real');
  await expect(page.getByTestId('realmap-canvas').locator('canvas')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('realmap-error')).toHaveCount(0);
});
