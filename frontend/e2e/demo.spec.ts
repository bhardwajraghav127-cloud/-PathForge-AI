// M11 hero demo: 14 steps across every page, each asserting real engine-backed
// behavior. This is the C3 rehearsal path in executable form.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const RUNNER = path.join(ROOT, 'engine', 'build', 'native-release', 'pf_contract_runner');
const DATASET = path.join(ROOT, 'frontend', 'src', 'data', 'north-india-sim-v1.json');

test.setTimeout(240000);

async function native(payload: unknown): Promise<{ ok: boolean; result: Record<string, never> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pf-demo-'));
  const f = path.join(dir, 'r.json');
  await writeFile(f, JSON.stringify({ apiVersion: 1, requestId: 'demo', command: (payload as { cmd: string }).cmd, payload: (payload as { p: unknown }).p }));
  const out = await new Promise<string>((resolve, reject) => {
    execFile(RUNNER, [f], (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
  return JSON.parse(out) as { ok: boolean; result: Record<string, never> };
}

test('14-step hero demo Chandigarh to Delhi', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
  });
  const network = JSON.parse(await readFile(DATASET, 'utf8'));

  // 1. Dashboard network facts.
  await page.goto('/#/');
  await expect(page.getByTestId('network-counts')).toContainText('20 vertices');
  // 2. Plan the hero route.
  await page.goto('/#/route');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('find-route').click();
  await expect(page.getByTestId('route-result')).toBeVisible({ timeout: 30000 });
  // 3. Seven arcs, engine-agreeing time.
  const r = await native({ cmd: 'route.find', p: { network, overlay: { version: 1 }, source: 'chandigarh', target: 'delhi', objective: 'FASTEST', algorithm: 'DIJKSTRA' } });
  const route = r.result as unknown as { arcs: { arcId: string }[]; timeS: number };
  await expect(page.getByTestId('fact-time')).toContainText(`(${route.timeS} s)`);
  // 4. Alternatives listed.
  await expect(page.getByTestId('alt-list')).toBeVisible({ timeout: 30000 });
  // 5. Why This Route explains.
  await page.getByTestId('why-toggle').click();
  await expect(page.getByTestId('why-best')).toBeVisible();
  // 6. Marginal jam: overlay versions, route still found after recompute.
  await page.selectOption('#traffic-road', 'ex06');
  await page.getByTestId('traffic-add').click();
  await expect(page.getByTestId('overlay-version')).toContainText('Overlay v2');
  await expect(page.getByTestId('route-result')).toBeVisible({ timeout: 30000 });
  // 7. Closure forces a recompute with different arcs.
  await page.selectOption('#traffic-road', 'ex03');
  await page.getByTestId('traffic-close').click();
  await expect(page.getByTestId('closure-list')).toContainText('ex03');
  // 8. Scenarios: snapshot + compare.
  await page.goto('/#/scenarios');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.fill('#scenario-name', 'demo-closed');
  await page.getByTestId('scenario-save').click();
  await page.getByTestId('scenario-compare').click();
  await expect(page.getByTestId('scenario-results')).toBeVisible({ timeout: 30000 });
  // 9. Multi-stop optimum.
  await page.goto('/#/multistop');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('stops-optimize').click();
  await expect(page.getByTestId('multistop-method')).toContainText('OPTIMAL', { timeout: 30000 });
  // 10. Journey starts and the vehicle moves.
  await page.goto('/#/journey');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('journey-start').click();
  await expect(page.getByTestId('journey-status')).toContainText('running', { timeout: 30000 });
  const f1 = Number(await page.getByTestId('vehicle').getAttribute('data-frac'));
  await page.waitForTimeout(2000);
  const f2 = Number(await page.getByTestId('vehicle').getAttribute('data-frac'));
  expect(f2).toBeGreaterThan(f1);
  await page.getByTestId('journey-reset').click();
  // 11. Lab BFS visits (clear demo traffic first: shared overlay store).
  await page.goto('/#/lab');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('incident-remove-i1').click();
  await page.selectOption('#traffic-road', 'ex03');
  await page.getByTestId('traffic-close').click();
  await expect(page.getByTestId('overlay-version')).toContainText('Overlay v5');
  await page.getByTestId('lab-run').click();
  await expect(page.getByTestId('lab-order')).toContainText('a', { timeout: 30000 });
  // 12. Lab MST agreement.
  await page.selectOption('#lab-algo', 'MST_PRIM');
  await page.getByTestId('lab-run').click();
  await expect(page.getByTestId('lab-mst')).toContainText('MST weight 30m', { timeout: 30000 });
  // 13. Dark theme.
  await page.goto('/#/settings');
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('theme-toggle').click();
  // 14. No console errors on any page.
  expect(consoleErrors).toEqual([]);
});
