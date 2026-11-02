// M12 release screenshots: real pages, real engine results, 1440x900.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(HERE, '..', '..', 'docs', 'screenshots');

test.setTimeout(300000);

test('release screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await expect(page.getByTestId('network-counts')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'dashboard.png') });

  await page.goto('/#/route');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('find-route').click();
  await expect(page.getByTestId('route-result')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'route.png') });

  await page.goto('/#/journey');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('journey-start').click();
  await expect(page.getByTestId('vehicle')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(SHOTS, 'journey.png') });
  await page.getByTestId('journey-reset').click();

  await page.goto('/#/lab');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('lab-run').click();
  await expect(page.getByTestId('lab-result')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOTS, 'lab.png') });

  await page.goto('/#/demo');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('demo-guided').uncheck();
  await page.getByTestId('demo-speed').selectOption('600');
  await page.getByTestId('demo-start').click();
  await expect(page.getByTestId('demo-decision')).toBeVisible({ timeout: 90000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'demo.png') });
  await page.getByTestId('demo-accept').click();
  await expect(page.getByTestId('demo-receipt')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('demo-replay').click();

  await page.goto('/#/fleet');
  await page.getByTestId('fleet-speed').selectOption('60');
  await page.getByTestId('fleet-start').click();
  await expect(page.getByTestId('fleet-vehicle-V5')).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.getByTestId('fleet-show').selectOption('all');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, 'fleet.png') });
  await page.getByTestId('fleet-preset-closure').click();
  await expect(page.getByTestId('fleet-vdecision-V1')).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, 'fleet-incident.png') });
  await page.getByTestId('fleet-reset').click();

  await page.goto('/#/settings');
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/#/route');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'route-dark.png') });
  await page.goto('/#/settings');
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // 3.0 real-maps captures: genuine OSM streets, real engine results.
  await page.goto('/#/real');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await expect(page.getByTestId('realmap-canvas').locator('canvas')).toBeVisible({ timeout: 30000 });
  await page.locator('#real-origin').fill('Connaught');
  await page.getByTestId('real-origin-option-p561299050').click();
  await page.locator('#real-dest').fill('Central Vista');
  await page.getByTestId('real-dest-option-p6666318646').click();
  await page.getByTestId('real-find').click();
  await expect(page.getByTestId('real-result')).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'real-route.png') });

  await page.goto('/#/real-demo');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('realdemo-speed').selectOption('60');
  await page.getByTestId('realdemo-start').click();
  await expect(page.getByTestId('realdemo-decision')).toBeVisible({ timeout: 120000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'real-demo.png') });
  await page.getByTestId('realdemo-replay').click();

  await page.goto('/#/real-fleet');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('realfleet-speed').selectOption('10');
  await page.getByTestId('realfleet-start').click();
  await expect(page.getByTestId('realfleet-vehicle-F5')).toBeVisible({ timeout: 90000 });
  await expect(page.getByTestId('realfleet-status')).toContainText('running', { timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SHOTS, 'real-fleet.png') });

  await page.goto('/#/real-lab');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('reallab-run').click();
  await expect(page.getByTestId('reallab-table')).toBeVisible({ timeout: 120000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOTS, 'real-lab.png') });
  expect(true).toBe(true);
});
