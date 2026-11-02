// V6: new flows usable at mobile width.
import { expect, test } from '@playwright/test';

test.setTimeout(240000);

test.describe('v2 mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('smart demo starts and decides at 390px', async ({ page }) => {
    await page.goto('/#/demo');
    await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
    await page.getByTestId('demo-guided').uncheck();
    await page.getByTestId('demo-speed').selectOption('3600');
    await page.getByTestId('demo-start').click();
    await expect(page.getByTestId('demo-decision')).toBeVisible({ timeout: 90000 });
    await page.getByTestId('demo-accept').click();
    await expect(page.getByTestId('demo-receipt')).toBeVisible({ timeout: 30000 });
  });

  test('fleet runs five vehicles at 390px', async ({ page }) => {
    await page.goto('/#/fleet');
    await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
    await page.getByTestId('fleet-speed').selectOption('3600');
    await page.getByTestId('fleet-start').click();
    await expect(page.getByTestId('fleet-vehicle-V5')).toBeVisible({ timeout: 60000 });
    await page.getByTestId('fleet-incident').click();
    await expect(page.getByTestId('fleet-vdecision-V1')).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId('fleet-kpis')).toBeVisible();
  });
});
