// R5: real fleet — 5 independent vehicles on OSM streets, shared
// incident relevance, priority/SLA, sandbox closures, emergency drill,
// replay timeline, KPI reconcile.
import { expect, test, type Page } from '@playwright/test';

test.setTimeout(240000);

async function startRealFleet(page: Page, speed = '10') {
  await page.goto('/#/real-fleet');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('realfleet-speed').selectOption(speed);
  await page.getByTestId('realfleet-start').click();
  for (const id of ['F1', 'F2', 'F3', 'F4', 'F5']) {
    await expect(page.getByTestId(`realfleet-vehicle-${id}`)).toBeVisible({ timeout: 90000 });
  }
  await page.getByTestId('realfleet-status').filter({ hasText: 'running' }).waitFor({ timeout: 60000 });
}

test('five real vehicles run independently with SLA tracking', async ({ page }) => {
  await startRealFleet(page);
  for (const id of ['F1', 'F2', 'F3', 'F4', 'F5']) {
    await expect(page.getByTestId(`realfleet-vstatus-${id}`)).toHaveText('enroute');
    await expect(page.getByTestId(`realfleet-marker-${id}`)).toBeVisible();
    await expect(page.getByTestId(`realfleet-vsla-${id}`)).toContainText('on-time');
  }
  await expect(page.getByTestId('realfleet-counts')).toContainText('Active 5');
  // Priority is a real control with a documented cadence effect.
  await page.getByTestId('realfleet-vprio-F1').selectOption('high');
  await expect(page.getByTestId('realfleet-vprio-F1')).toHaveValue('high');
});

test('shared real incident affects only relevant vehicles', async ({ page }) => {
  await startRealFleet(page, '5');
  await page.getByTestId('realfleet-incident').click();
  await expect(page.getByTestId('realfleet-vdecision-F1')).toBeVisible({ timeout: 60000 });
  // Accept for F1: reroute counted once with a receipt.
  await page.getByTestId('realfleet-accept-F1').click();
  await expect(page.getByTestId('realfleet-vstatus-F1')).toHaveText('enroute', { timeout: 30000 });
  await expect(page.getByTestId('realfleet-kpi-reroutes')).toHaveText('1');
  await expect(page.getByTestId('realfleet-receipt')).toBeVisible();
  await expect(page.getByTestId('realfleet-receipt-action')).toHaveText('accept');
});

test('sandbox closes and reopens a clicked real road', async ({ page }) => {
  await startRealFleet(page, '1');
  const canvas = page.getByTestId('realmap-canvas').locator('canvas');
  await canvas.click({ position: { x: 400, y: 300 } });
  await expect(page.getByTestId('realfleet-road')).toBeVisible({ timeout: 15000 });
  const roadId = await page.getByTestId('realfleet-road-id').textContent();
  expect(roadId).toMatch(/^r\d+$/);
  await page.getByTestId('realfleet-road-close').click();
  await expect(page.getByTestId('realfleet-road-state')).toContainText('CLOSED');
  await page.getByTestId('realfleet-road-open').click();
  await expect(page.getByTestId('realfleet-road-state')).toContainText('open');
});

test('emergency drill escalates priority and disrupts', async ({ page }) => {
  await startRealFleet(page, '5');
  await page.getByTestId('realfleet-emergency').click();
  await expect(page.getByTestId('realfleet-vprio-F1')).toHaveValue('high');
  await expect(page.getByTestId('realfleet-events')).toContainText('emergency drill');
});

test('replay timeline scrubs recorded positions', async ({ page }) => {
  await startRealFleet(page, '60');
  // Let the recording accumulate, then freeze and scrub.
  await page.waitForTimeout(4000);
  await page.getByTestId('realfleet-replay').click();
  await expect(page.getByTestId('realfleet-scrub')).toBeVisible();
  await page.getByTestId('realfleet-scrub').fill('0');
  await page.getByTestId('realfleet-replay').click();
  await expect(page.getByTestId('realfleet-scrub')).toHaveCount(0);
});

test('real fleet completes with reconciled KPIs', async ({ page }) => {
  await startRealFleet(page, '60');
  await expect(page.getByTestId('realfleet-status')).toContainText('completed', { timeout: 120000 });
  for (const id of ['F1', 'F2', 'F3', 'F4', 'F5']) {
    await expect(page.getByTestId(`realfleet-vstatus-${id}`)).toHaveText('completed');
    // Final SLA is terminal (met/missed): the progress mirror must never
    // overwrite it with a stale projected value after completion.
    await expect(page.getByTestId(`realfleet-vsla-${id}`)).toHaveText(/SLA (met|missed)/);
  }
  await expect(page.getByTestId('realfleet-kpi-completed')).toHaveText('5');
  await expect(page.getByTestId('realfleet-kpi-sla')).toHaveText('5/0');
});
