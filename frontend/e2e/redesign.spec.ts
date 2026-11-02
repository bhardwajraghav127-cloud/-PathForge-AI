// U9: redesign interaction coverage against the real engine build.
// Map controls, views, keyboard, inspectors, dashboard entries, panel
// toggle, lab playback/editor, destructive confirms, mobile viewport.
import { expect, test } from '@playwright/test';

test('map controls, views, keyboard, inspectors', async ({ page }) => {
  await page.goto('/#/route');
  await expect(page.getByTestId('map')).toBeVisible();
  // Geographic / network views
  await page.getByTestId('map-view-explore').click();
  await expect(page.getByTestId('map-schematic-tag')).toBeVisible();
  await expect(page.getByTestId('map-stats')).toContainText('explore');
  await page.getByTestId('map-view-geo').click();
  await expect(page.getByTestId('map-schematic-tag')).toHaveCount(0);
  // Expand toggle
  await page.getByTestId('map-expand').click();
  await expect(page.getByTestId('map-expand')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('map-expand').click();
  await expect(page.getByTestId('map-expand')).toHaveAttribute('aria-pressed', 'false');
  // Rotate / zoom / fit smoke
  await page.getByTestId('map-rotate').click();
  await page.getByTestId('map-zoom-in').click();
  await page.getByTestId('map-zoom-out').click();
  await page.getByTestId('map-fit').click();
  await expect(page.getByTestId('map')).toBeVisible();
  // Keyboard shortcuts dialog
  await page.getByTestId('map').press('?');
  await expect(page.getByTestId('map-shortcuts')).toBeVisible();
  await page.getByTestId('map').press('Escape');
  await expect(page.getByTestId('map-shortcuts')).toHaveCount(0);
  // City inspector via search
  await page.getByTestId('map-search').fill('delh');
  await page.getByTestId('map-search-option-delhi').click();
  await expect(page.getByTestId('inspector-drawer')).toBeVisible();
  await expect(page.getByTestId('inspector-drawer')).toContainText('delhi');
  await page.getByTestId('inspector-close').click();
  await expect(page.getByTestId('inspector-drawer')).toHaveCount(0);
  // Road inspector via search
  await page.getByTestId('map-search').fill('ex06');
  await page.getByTestId('map-search-option-ex06').click();
  await expect(page.getByTestId('inspector-drawer')).toBeVisible();
  await expect(page.getByTestId('inspector-road-state')).toBeVisible();
  await page.getByTestId('map').press('Escape');
  await expect(page.getByTestId('inspector-drawer')).toHaveCount(0);
});

test('dashboard command center entries', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByTestId('dash-metrics')).toBeVisible();
  await expect(page.getByTestId('dash-route-summary')).toBeVisible();
  await expect(page.getByTestId('dash-traffic')).toBeVisible();
  await page.getByTestId('dash-entry-route').click();
  await expect(page).toHaveURL(/#\/route/);
  await page.goto('/#/');
  await page.getByTestId('dash-entry-lab').click();
  await expect(page).toHaveURL(/#\/lab/);
});

test('panel toggle collapses workspace', async ({ page }) => {
  await page.goto('/#/route');
  const toggle = page.getByTestId('panel-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText('Show panel');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

test('lab playback and editor', async ({ page }) => {
  await page.goto('/#/lab');
  await expect(page.getByTestId('lab-algo-info')).toBeVisible();
  await page.getByTestId('lab-run').click();
  await expect(page.getByTestId('lab-result')).toBeVisible();
  await expect(page.getByTestId('trace-events')).toBeVisible();
  await expect(page.getByTestId('lab-live-stats')).toBeVisible();
  await page.getByTestId('lab-reset').click();
  await expect(page.getByTestId('lab-step')).toHaveValue('0');
  await page.getByTestId('lab-next').click();
  await expect(page.getByTestId('lab-step')).toHaveValue('1');
  await page.getByTestId('lab-prev').click();
  await expect(page.getByTestId('lab-step')).toHaveValue('0');
  await page.getByTestId('lab-speed').selectOption('2');
  await expect(page.getByTestId('lab-speed')).toHaveValue('2');
  // Editor: example graph validates clean
  await page.getByTestId('lab-net').selectOption('custom');
  await page.getByTestId('lab-example-line').click();
  await page.getByTestId('lab-validate').click();
  await expect(page.getByTestId('lab-valid-ok')).toBeVisible();
  // Compare table with agreement fact
  await page.getByTestId('lab-compare').click();
  await expect(page.getByTestId('lab-compare-out')).toBeVisible();
  await expect(page.getByTestId('lab-cost-agreement')).toBeVisible();
});

test('destructive confirms guard traffic and tours', async ({ page }) => {
  await page.goto('/#/route');
  await page.getByTestId('traffic-add').click();
  await expect(page.getByTestId('overlay-version')).toContainText('1 incident');
  await page.getByTestId('traffic-clear-all').click();
  await expect(page.getByTestId('traffic-clear-dialog')).toBeVisible();
  await page.getByTestId('traffic-clear-cancel').click();
  await expect(page.getByTestId('overlay-version')).toContainText('1 incident');
  await page.getByTestId('traffic-clear-all').click();
  await page.getByTestId('traffic-clear-confirm').click();
  await expect(page.getByTestId('overlay-version')).toContainText('0 incident');

  await page.goto('/#/multistop');
  await page.getByTestId('tour-name').fill('U9tour');
  await page.getByTestId('tour-save').click();
  const row = page.locator('li', { hasText: 'U9tour' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('tour-delete-dialog')).toBeVisible();
  await page.getByTestId('tour-delete-confirm').click();
  await expect(row).toHaveCount(0);
});

test.describe('mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('nav drawer and panel toggle work at 390px', async ({ page }) => {
    await page.goto('/#/route');
    await expect(page.getByTestId('nav-toggle')).toBeVisible();
    await page.getByTestId('nav-toggle').click();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await page.getByRole('link', { name: 'Journey' }).click();
    await expect(page).toHaveURL(/#\/journey/);
    const toggle = page.getByTestId('panel-toggle');
    await toggle.click();
    await expect(toggle).toContainText('Show panel');
    await expect(page.getByTestId('map')).toBeVisible();
  });
});
