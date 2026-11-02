// M12 release screenshots: real pages, real engine results, 1440x900.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(HERE, '..', '..', 'docs', 'screenshots');

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

  await page.goto('/#/settings');
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/#/route');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'route-dark.png') });
  expect(true).toBe(true);
});
