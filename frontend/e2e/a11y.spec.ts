// M11 accessibility + responsive checks: keyboard-only planning, theme
// persistence, small-viewport usability, reduced-motion stylesheet guard.
import { expect, test } from '@playwright/test';

test('a11y and responsive basics', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
  });

  // Keyboard-only route plan: arrows + Enter in the combobox, focus + Enter.
  await page.goto('/#/route');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.locator('#destination').click();
  await page.locator('#destination').fill('delh');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('destination-current')).toContainText('Delhi');
  await page.getByTestId('find-route').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('route-result')).toBeVisible({ timeout: 30000 });

  // Theme toggle persists across reload.
  await page.goto('/#/settings');
  await expect(page.getByTestId('theme-current')).toContainText('light');
  await page.getByTestId('theme-toggle').click();
  await expect(page.getByTestId('theme-current')).toContainText('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByTestId('theme-current')).toContainText('dark');
  await page.getByTestId('theme-toggle').click();
  await expect(page.getByTestId('theme-current')).toContainText('light');

  // Map exposes an accessible name; journey progress is a live region.
  await page.goto('/#/route');
  await expect(page.getByTestId('map')).toHaveAttribute('aria-label', 'Road network map');
  await page.goto('/#/journey');
  await expect(page.getByTestId('journey-progress')).toHaveAttribute('aria-live', 'polite');

  // Reduced-motion guard ships in the stylesheet.
  const hasRM = await page.evaluate(() => {
    const texts: string[] = [];
    for (const sh of document.styleSheets) {
      try {
        for (const r of sh.cssRules) texts.push(r.cssText);
      } catch {
        /* cross-origin sheet */
      }
    }
    return texts.join('\n').includes('prefers-reduced-motion');
  });
  expect(hasRM).toBe(true);

  expect(consoleErrors).toEqual([]);
});

test('responsive small viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
  });
  await page.goto('/#/');
  await expect(page.getByTestId('network-counts')).toBeVisible();
  await page.goto('/#/route');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await expect(page.getByTestId('map')).toBeVisible();
  await expect(page.getByTestId('find-route')).toBeVisible();
  await page.getByTestId('find-route').click();
  await expect(page.getByTestId('route-result')).toBeVisible({ timeout: 30000 });
  expect(consoleErrors).toEqual([]);
});
