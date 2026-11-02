// V3 fleet vertical slice: two independent vehicles, shared SIMULATED
// incident affects only the vehicle whose future plan uses the closed road,
// per-vehicle accept/stay, pause/resume/reset, selection, honest KPIs.
import { expect, test, type Page } from '@playwright/test';

test.setTimeout(240000);

async function startFleet(page: Page) {
  await page.goto('/#/fleet');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('fleet-speed').selectOption('3600');
  await page.getByTestId('fleet-start').click();
  await expect(page.getByTestId('fleet-vehicle-V1')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('fleet-vehicle-V2')).toBeVisible({ timeout: 30000 });
}

test('two vehicles progress independently', async ({ page }) => {
  await startFleet(page);
  await expect(page.getByTestId('fleet-vstatus-V1')).toHaveText('enroute');
  await expect(page.getByTestId('fleet-vstatus-V2')).toHaveText('enroute');
  // Both markers render on the map.
  await expect(page.getByTestId('fleet-marker-V1')).toBeVisible();
  await expect(page.getByTestId('fleet-marker-V2')).toBeVisible();
  // Independent progress: V2 (2 short arcs) finishes before V1 (7 arcs).
  await expect(page.getByTestId('fleet-vstatus-V2')).toHaveText('completed', { timeout: 120000 });
  expect(await page.getByTestId('fleet-kpi-completed').textContent()).toContain('1');
  // V1 still en route with its own ETA.
  await expect(page.getByTestId('fleet-vstatus-V1')).toHaveText('enroute');
});

test('shared incident affects only the relevant vehicle', async ({ page }) => {
  await startFleet(page);
  // V1 (chandigarh→delhi) is selected by default; incident closes a road
  // ahead on V1's future plan only.
  await page.getByTestId('fleet-incident').click();
  await expect(page.getByTestId('fleet-vdecision-V1')).toBeVisible({ timeout: 60000 });
  // V2's western-corridor plan shares no road with the closure: no decision.
  await expect(page.getByTestId('fleet-vdecision-V2')).toHaveCount(0);
  await expect(page.getByTestId('fleet-vstatus-V2')).toHaveText(/enroute|completed/);
  await expect(page.getByTestId('fleet-kpi-affected')).toHaveText('1');
  // Accept for V1 only: reroute counted once, V2 untouched.
  await page.getByTestId('fleet-accept-V1').click();
  await expect(page.getByTestId('fleet-vstatus-V1')).toHaveText('enroute', { timeout: 30000 });
  await expect(page.getByTestId('fleet-kpi-reroutes')).toHaveText('1');
  await expect(page.getByTestId('fleet-vdecision-V2')).toHaveCount(0);
});

test('pause, resume, select and reset work', async ({ page }) => {
  await startFleet(page);
  await page.getByTestId('fleet-select-V2').click();
  await expect(page.getByTestId('fleet-select-V2')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('fleet-pause').click();
  await expect(page.getByTestId('fleet-status')).toContainText('paused');
  const p1 = await page.getByTestId('fleet-vprogress-V1').textContent();
  await page.waitForTimeout(1500);
  const p2 = await page.getByTestId('fleet-vprogress-V1').textContent();
  expect(p1).toEqual(p2);
  await page.getByTestId('fleet-resume').click();
  await expect(page.getByTestId('fleet-status')).toContainText('running');
  await page.getByTestId('fleet-reset').click();
  await expect(page.getByTestId('fleet-status')).toContainText('idle');
  await expect(page.getByTestId('fleet-vehicle-V1')).toHaveCount(0);
});
