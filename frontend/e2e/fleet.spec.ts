// V4 fleet: five independent vehicles, shared SIMULATED incidents affect
// only relevant vehicles, per-vehicle accept/stay, blocked handling,
// add/remove, presets, traffic cleanup, honest KPIs.
import { expect, test, type Page } from '@playwright/test';

test.setTimeout(240000);

async function startFleet(page: Page, speed = '600') {
  await page.goto('/#/fleet');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('fleet-speed').selectOption(speed);
  await page.getByTestId('fleet-start').click();
  for (const id of ['V1', 'V2', 'V3', 'V4', 'V5']) {
    await expect(page.getByTestId(`fleet-vehicle-${id}`)).toBeVisible({ timeout: 60000 });
  }
}

test('five vehicles progress independently', async ({ page }) => {
  await startFleet(page);
  for (const id of ['V1', 'V2', 'V3', 'V4', 'V5']) {
    await expect(page.getByTestId(`fleet-vstatus-${id}`)).toHaveText('enroute');
    await expect(page.getByTestId(`fleet-marker-${id}`)).toBeVisible();
  }
  // Independent positions on different roads at the same wall-clock time.
  await expect(page.getByTestId('fleet-vroad-V1')).toContainText('ex01');
  await expect(page.getByTestId('fleet-vroad-V2')).toContainText('wr04');
  // KPIs derive from live state: 5 active, nothing decided yet.
  await expect(page.getByTestId('fleet-counts')).toContainText('Active 5');
  await expect(page.getByTestId('fleet-kpi-reroutes')).toHaveText('0');
});

test('shared incident affects only the relevant vehicle', async ({ page }) => {
  await startFleet(page, '3600');
  // V1 (chandigarh→delhi) is selected by default; incident closes a road
  // ahead on V1's future plan only (ex02, unused by V2..V5 plans).
  await page.getByTestId('fleet-incident').click();
  await expect(page.getByTestId('fleet-vdecision-V1')).toBeVisible({ timeout: 60000 });
  for (const id of ['V2', 'V3', 'V4', 'V5']) {
    await expect(page.getByTestId(`fleet-vdecision-${id}`)).toHaveCount(0);
  }
  await expect(page.getByTestId('fleet-kpi-affected')).toHaveText('1');
  // Accept for V1 only: reroute counted once, others untouched.
  await page.getByTestId('fleet-accept-V1').click();
  await expect(page.getByTestId('fleet-vstatus-V1')).toHaveText('enroute', { timeout: 30000 });
  await expect(page.getByTestId('fleet-kpi-reroutes')).toHaveText('1');
  for (const id of ['V2', 'V3', 'V4', 'V5']) {
    await expect(page.getByTestId(`fleet-vdecision-${id}`)).toHaveCount(0);
  }
});

test('major closure hits every corridor vehicle at once', async ({ page }) => {
  await startFleet(page, '60');
  await page.getByTestId('fleet-preset-closure').click();
  // ex04 sits on the V1/V4 future plans; V2/V3 run elsewhere. V5 is already
  // driving ex04 (occupied arc), so the engine lets it finish rather than
  // divert — affected but not notified.
  await expect(page.getByTestId('fleet-kpi-affected')).toHaveText('3', { timeout: 30000 });
  for (const id of ['V1', 'V4']) {
    await expect(page.getByTestId(`fleet-vdecision-${id}`)).toBeVisible({ timeout: 60000 });
  }
  for (const id of ['V2', 'V3', 'V5']) {
    await expect(page.getByTestId(`fleet-vdecision-${id}`)).toHaveCount(0);
  }
  await expect(page.getByTestId('fleet-vstatus-V5')).toHaveText('enroute');
});

test('single-inbound destination blocks honestly with no alternative', async ({ page }) => {
  await startFleet(page, '60');
  // V3 runs rohtak→jind; jind's only inbound road is wr10.
  await page.getByTestId('fleet-select-V3').click();
  await page.getByTestId('fleet-incident').click();
  await expect(page.getByTestId('fleet-vstatus-V3')).toHaveText('blocked', { timeout: 60000 });
  await expect(page.getByTestId('fleet-counts')).toContainText('Blocked 1');
  // The blocked vehicle never teleports to completed.
  await expect(page.getByTestId('fleet-vstatus-V3')).toHaveText('blocked');
  for (const id of ['V1', 'V2', 'V4', 'V5']) {
    await expect(page.getByTestId(`fleet-vdecision-${id}`)).toHaveCount(0);
  }
});

test('all vehicles complete and KPIs reconcile', async ({ page }) => {
  await startFleet(page, '3600');
  await expect(page.getByTestId('fleet-status')).toContainText('completed', { timeout: 120000 });
  for (const id of ['V1', 'V2', 'V3', 'V4', 'V5']) {
    await expect(page.getByTestId(`fleet-vstatus-${id}`)).toHaveText('completed');
  }
  await expect(page.getByTestId('fleet-kpi-completed')).toHaveText('5');
  await expect(page.getByTestId('fleet-kpi-remaining')).toContainText('0');
});

test('pause, resume, select, add, remove and reset work', async ({ page }) => {
  await startFleet(page, '60');
  await page.getByTestId('fleet-pause').click();
  await expect(page.getByTestId('fleet-status')).toContainText('paused');
  const p1 = await page.getByTestId('fleet-vprogress-V1').textContent();
  await page.waitForTimeout(1500);
  expect(await page.getByTestId('fleet-vprogress-V1').textContent()).toEqual(p1);
  await page.getByTestId('fleet-resume').click();
  await expect(page.getByTestId('fleet-status')).toContainText('running');
  // Add a sixth vehicle mid-run; remove it again.
  await page.getByTestId('fleet-add').click();
  await expect(page.getByTestId('fleet-vehicle-V6')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('fleet-remove-V6').click();
  await expect(page.getByTestId('fleet-vehicle-V6')).toHaveCount(0);
  // Incident then reset: fleet traffic is cleaned, vehicles gone.
  await page.getByTestId('fleet-incident').click();
  await expect(page.getByTestId('fleet-traffic')).toContainText('1 incident(s)');
  await page.getByTestId('fleet-reset').click();
  await expect(page.getByTestId('fleet-status')).toContainText('idle');
  await expect(page.getByTestId('fleet-vehicle-V1')).toHaveCount(0);
  await expect(page.getByTestId('fleet-traffic')).toContainText('0 incident(s)');
  await expect(page.getByTestId('fleet-traffic')).toContainText('0 closure(s)');
});
