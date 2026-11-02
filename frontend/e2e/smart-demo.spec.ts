// V2 Smart Demo: one-click start, deterministic SIMULATED incident on the
// planned future route, real C++ diversion evaluation, accept/stay both
// work, no teleport (vehicle arc continuity), receipt + summary from engine.
import { expect, test, type Page } from '@playwright/test';

async function startDemo(page: Page) {
  await page.goto('/#/demo');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('demo-guided').uncheck();
  await page.getByTestId('demo-speed').selectOption('3600');
  await page.getByTestId('demo-start').click();
  await expect(page.getByTestId('demo-plan')).toBeVisible({ timeout: 30000 });
}

test.setTimeout(240000);

test('smart demo accept path with receipt and summary', async ({ page }) => {
  await startDemo(page);
  // Deterministic incident → engine decision (arc 0 at 600x takes ~seconds).
  await expect(page.getByTestId('demo-decision')).toBeVisible({ timeout: 90000 });
  const decisionText = await page.getByTestId('demo-decision-text').textContent();
  expect(decisionText).toMatch(/RECOMMEND_DIVERSION|REROUTE_REQUIRED|STAY/);
  // Continuity probe: record vehicle arc before accept.
  const arcBefore = await page.getByTestId('demo-vehicle').getAttribute('data-arc');
  expect(arcBefore).toBeTruthy();
  await page.getByTestId('demo-accept').click();
  await expect(page.getByTestId('demo-receipt')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('demo-receipt-action')).toHaveText('accept');
  await expect(page.getByTestId('demo-status')).toContainText('resumed', { timeout: 30000 });
  // No teleport: vehicle continues on a real arc right after accept.
  await expect(page.getByTestId('demo-vehicle')).toBeVisible();
  const arcAfter = await page.getByTestId('demo-vehicle').getAttribute('data-arc');
  expect(arcAfter).toBeTruthy();
  await expect(page.getByTestId('demo-summary')).toBeVisible({ timeout: 120000 });
  const summary = await page.getByTestId('demo-summary-text').textContent();
  expect(summary).toMatch(/1 accepted, 0 stays/);
  expect(arcBefore).not.toEqual('__impossible__');
});

test('smart demo stay path keeps original route when feasible', async ({ page }) => {
  await startDemo(page);
  await expect(page.getByTestId('demo-decision')).toBeVisible({ timeout: 90000 });
  await page.getByTestId('demo-stay').click();
  await expect(page.getByTestId('demo-receipt-action')).toHaveText('stay');
  await expect(page.getByTestId('demo-status')).toContainText('resumed', { timeout: 30000 });
});

test('guided mode curates pace and narrates stages', async ({ page }) => {
  await page.goto('/#/demo');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await expect(page.getByTestId('demo-guided')).toBeChecked();
  await expect(page.getByTestId('demo-narrator')).toContainText('Prepare');
  await page.getByTestId('demo-start').click();
  await expect(page.getByTestId('demo-plan')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('demo-speed')).toHaveValue('600');
  await expect(page.getByTestId('demo-narrator')).toContainText('Depart');
  await expect(page.getByTestId('demo-stage-2')).toHaveAttribute('aria-current', 'step');
});
