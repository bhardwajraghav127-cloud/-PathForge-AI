// R6: real lab — Dijkstra-vs-A* race on OSM streets, expansion
// playback, road inspector, viva walkthrough.
import { expect, test, type Page } from '@playwright/test';

test.setTimeout(240000);

async function runRace(page: Page) {
  await page.goto('/#/real-lab');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('reallab-run').click();
  await page.getByTestId('reallab-table').waitFor({ timeout: 120000 });
}

test('race compares both algorithms on the real graph', async ({ page }) => {
  await runRace(page);
  const dVisited = Number(await page.getByTestId('reallab-d-visited').textContent());
  const aVisited = Number(await page.getByTestId('reallab-a-visited').textContent());
  expect(dVisited).toBeGreaterThan(1000);
  expect(aVisited).toBeGreaterThan(0);
  expect(aVisited).toBeLessThan(dVisited);
  await expect(page.getByTestId('reallab-verdict')).toContainText('Identical optimal path');
  await expect(page.getByTestId('reallab-why')).toBeVisible();
  await expect(page.getByTestId('reallab-receipt-d')).toContainText('DIJKSTRA');
});

test('expansion playback scrubs the settled order', async ({ page }) => {
  await runRace(page);
  await expect(page.getByTestId('reallab-step')).toContainText('/');
  await page.getByTestId('reallab-scrub').fill('0');
  await expect(page.getByTestId('reallab-step')).toContainText('Dijkstra 0 /');
  await page.getByTestId('reallab-play').click();
  await expect(page.getByTestId('reallab-pause')).toBeVisible({ timeout: 5000 });
  await page.getByTestId('reallab-pause').click();
});

test('inspector reports real road facts', async ({ page }) => {
  await page.goto('/#/real-lab');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  const canvas = page.getByTestId('realmap-canvas').locator('canvas');
  await canvas.click({ position: { x: 400, y: 300 } });
  await expect(page.getByTestId('reallab-road')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('reallab-road-id')).toHaveText(/^r\d+$/);
  await expect(page.getByTestId('reallab-road-class')).not.toBeEmpty();
  await expect(page.getByTestId('reallab-road-state')).toContainText('open');
});

test('viva walkthrough reveals model answers', async ({ page }) => {
  await page.goto('/#/real-lab');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('reallab-viva-reveal-0').click();
  await expect(page.getByTestId('reallab-viva-answer-0')).toContainText('60-second threshold');
  await page.getByTestId('reallab-viva-reveal-5').click();
  await expect(page.getByTestId('reallab-viva-answer-5')).toContainText('SIMULATION');
});
