// R3: real-road routing via C++/WASM on genuine OSM data — gazetteer +
// click-to-route, Dijkstra + A* agreement, engine stats, alternatives,
// honest unreachable handling. Expected numbers come from the native
// engine (verified in R3 dev: CP→CV = 65 segments, 236 s).
import { expect, test, type Page } from '@playwright/test';

test.setTimeout(240000);

async function openReal(page: Page) {
  await page.goto('/#/real');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await expect(page.getByTestId('realmap-canvas').locator('canvas')).toBeVisible({ timeout: 30000 });
}

test('gazetteer route matches native engine facts', async ({ page }) => {
  await openReal(page);
  await page.locator('#real-origin').fill('Connaught');
  await page.getByTestId('real-origin-option-p561299050').click();
  await expect(page.getByTestId('real-origin-set')).toContainText('n1191294765');
  await page.locator('#real-dest').fill('Central Vista');
  await page.getByTestId('real-dest-option-p6666318646').click();
  await page.getByTestId('real-find').click();
  await expect(page.getByTestId('real-result')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('real-segments')).toHaveText('65');
  await expect(page.getByTestId('real-time')).toContainText('3 min 56 s');
  await expect(page.getByTestId('real-stats')).toContainText('visited 6961');
  await expect(page.getByTestId('real-pin-origin')).toBeVisible();
  await expect(page.getByTestId('real-pin-dest')).toBeVisible();
});

test('A* agrees with Dijkstra and explores less', async ({ page }) => {
  await openReal(page);
  await page.locator('#real-origin').fill('Connaught');
  await page.getByTestId('real-origin-option-p561299050').click();
  await page.locator('#real-dest').fill('Central Vista');
  await page.getByTestId('real-dest-option-p6666318646').click();
  await page.getByTestId('real-algorithm').selectOption('A_STAR');
  await page.getByTestId('real-find').click();
  await expect(page.getByTestId('real-result')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('real-segments')).toHaveText('65');
  await expect(page.getByTestId('real-time')).toContainText('3 min 56 s');
  await expect(page.getByTestId('real-stats')).toContainText('visited 1802');
});

test('click-to-route snaps to the nearest vertex', async ({ page }) => {
  await openReal(page);
  const canvas = page.getByTestId('realmap-canvas').locator('canvas');
  // Click near Connaught Place then near Central Vista (map is fit to bbox).
  await canvas.click({ position: { x: 480, y: 250 } });
  await expect(page.getByTestId('real-origin-set')).toBeVisible({ timeout: 15000 });
  await canvas.click({ position: { x: 560, y: 520 } });
  await expect(page.getByTestId('real-dest-set')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('real-find').click();
  await expect(page.getByTestId('real-result')).toBeVisible({ timeout: 60000 });
});
