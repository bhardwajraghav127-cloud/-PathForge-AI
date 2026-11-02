// V5 explainability: edge-by-edge evidence sums match engine totals,
// alternatives are engine-computed, receipts carry policy + overlay,
// viva mode toggles professor cards, emergency preset is honest.
import { expect, test, type Page } from '@playwright/test';

test.setTimeout(240000);

test('planner evidence sums match engine totals', async ({ page }) => {
  await page.goto('/#/route');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('find-route').click();
  await expect(page.getByTestId('route-result')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('planner-tabs-why').click();
  await page.getByTestId('why-toggle').click();
  await page.getByTestId('why-evidence').click();
  await expect(page.getByTestId('why-drawer')).toBeVisible();
  await expect(page.getByTestId('why-edges')).toBeVisible({ timeout: 30000 });
  // Per-edge effective seconds sum to the engine route total exactly.
  const sums = page.getByTestId('why-sums');
  expect(await sums.getAttribute('data-sum-seconds')).toEqual(await sums.getAttribute('data-total-seconds'));
  expect(await sums.getAttribute('data-sum-metres')).toEqual(await sums.getAttribute('data-total-metres'));
  await expect(page.getByTestId('why-match')).toContainText('match');
  // Genuine Yen alternatives listed with deltas, plus the lab pointer.
  await expect(page.getByTestId('why-alts')).toBeVisible();
  await expect(page.getByTestId('why-drawer')).toContainText('Algorithm Lab');
  await page.getByTestId('why-close').click();
  await expect(page.getByTestId('why-drawer')).toHaveCount(0);
});

test('demo receipt pins overlay version, policy and action', async ({ page }) => {
  await page.goto('/#/demo');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('demo-guided').uncheck();
  await page.getByTestId('demo-speed').selectOption('3600');
  await page.getByTestId('demo-start').click();
  await expect(page.getByTestId('demo-decision')).toBeVisible({ timeout: 90000 });
  await page.getByTestId('demo-stay').click();
  await expect(page.getByTestId('demo-receipt')).toBeVisible({ timeout: 30000 });
  // Fresh overlay: v1 + incident + closure = v3, deterministic.
  await expect(page.getByTestId('demo-receipt-overlay')).toHaveText('v3');
  await expect(page.getByTestId('demo-receipt-policy')).toContainText('REROUTE_REQUIRED');
  await expect(page.getByTestId('demo-receipt-action')).toHaveText('stay');
});

test('fleet receipt pins overlay version, policy and action', async ({ page }) => {
  await page.goto('/#/fleet');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('fleet-speed').selectOption('3600');
  await page.getByTestId('fleet-start').click();
  await expect(page.getByTestId('fleet-vehicle-V1')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('fleet-incident').click();
  await expect(page.getByTestId('fleet-vdecision-V1')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('fleet-accept-V1').click();
  await expect(page.getByTestId('fleet-receipt')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('fleet-receipt-overlay')).toHaveText('v3');
  await expect(page.getByTestId('fleet-receipt-action')).toHaveText('accept');
});

test('viva mode toggles professor cards', async ({ page }: { page: Page }) => {
  await page.goto('/#/settings');
  await expect(page.getByTestId('viva-current')).toContainText('off');
  await page.getByTestId('viva-toggle').click();
  await expect(page.getByTestId('viva-current')).toContainText('on');
  await page.goto('/#/demo');
  await expect(page.getByTestId('viva-card')).toBeVisible();
  await expect(page.getByTestId('viva-sources')).toContainText('engine/src/diversion.cpp');
  await expect(page.getByTestId('viva-complexity')).toContainText('O(');
  await page.goto('/#/settings');
  await page.getByTestId('viva-toggle').click();
  await page.goto('/#/fleet');
  await expect(page.getByTestId('viva-card')).toHaveCount(0);
});

test('emergency drill preset is a labeled fastest-path scenario', async ({ page }) => {
  await page.goto('/#/route');
  await page.getByTestId('emergency-preset').click();
  await expect(page.locator('#origin')).toHaveAttribute('placeholder', /Ambala/);
  await page.getByTestId('find-route').click();
  await expect(page.getByTestId('route-result')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('planner-tabs-steps').click();
  await expect(page.getByTestId('route-steps')).toContainText('Ambala');
});
