// R4: real-road smart demo — deterministic SIMULATED closure on the true
// OSM route, real diversion evaluation, accept/stay, receipt + summary.
// Determinism: same target road (r01105) and policy on every run.
import { expect, test, type Page } from '@playwright/test';

test.setTimeout(240000);

async function startRealDemo(page: Page) {
  await page.goto('/#/real-demo');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('realdemo-speed').selectOption('60');
  await page.getByTestId('realdemo-start').click();
  await expect(page.getByTestId('realdemo-plan')).toBeVisible({ timeout: 60000 });
}

test('real demo accept path with deterministic incident', async ({ page }) => {
  await startRealDemo(page);
  await expect(page.getByTestId('realdemo-decision')).toBeVisible({ timeout: 90000 });
  await expect(page.getByTestId('realdemo-decision-text')).toContainText('REROUTE_REQUIRED');
  // Deterministic script: always r01105, always the same policy.
  await expect(page.getByTestId('realdemo-incident')).toContainText('r01105');
  await expect(page.getByTestId('realdemo-vehicle')).toBeVisible();
  await page.getByTestId('realdemo-accept').click();
  await expect(page.getByTestId('realdemo-receipt')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('realdemo-receipt-action')).toHaveText('accept');
  await expect(page.getByTestId('realdemo-receipt-overlay')).toHaveText('v3');
  await expect(page.getByTestId('realdemo-status')).toContainText('resumed', { timeout: 30000 });
  await expect(page.getByTestId('realdemo-summary')).toBeVisible({ timeout: 120000 });
  await expect(page.getByTestId('realdemo-summary-text')).toContainText('1 accepted, 0 stays');
});

test('real demo stay path', async ({ page }) => {
  await startRealDemo(page);
  await expect(page.getByTestId('realdemo-decision')).toBeVisible({ timeout: 90000 });
  await expect(page.getByTestId('realdemo-incident')).toContainText('r01105');
  await page.getByTestId('realdemo-stay').click();
  await expect(page.getByTestId('realdemo-receipt-action')).toHaveText('stay');
  await expect(page.getByTestId('realdemo-status')).toContainText('resumed', { timeout: 30000 });
});
