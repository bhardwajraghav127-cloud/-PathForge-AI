// M10 AC-19 + trace determinism: every required algorithm runs against the
// real engine on the tiny lab graph; repeated runs are byte-identical.
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const RUNNER = path.join(ROOT, 'engine', 'build', 'native-release', 'pf_contract_runner');

const TINY = {
  schemaVersion: 1,
  vertices: [
    { id: 'a', name: 'A', lat: 28.0, lon: 77.0 },
    { id: 'b', name: 'B', lat: 28.0, lon: 77.0001 },
    { id: 'c', name: 'C', lat: 28.0001, lon: 77.0001 },
    { id: 'd', name: 'D', lat: 28.0001, lon: 77.0 },
  ],
  roads: [
    { id: 'ab', from: 'a', to: 'b', oneWay: true, distanceM: 10, baselineTimeS: 10 },
    { id: 'ba', from: 'b', to: 'a', oneWay: true, distanceM: 10, baselineTimeS: 90 },
    { id: 'bc', from: 'b', to: 'c', oneWay: true, distanceM: 10, baselineTimeS: 10 },
    { id: 'cb', from: 'c', to: 'b', oneWay: true, distanceM: 10, baselineTimeS: 90 },
    { id: 'cd', from: 'c', to: 'd', oneWay: true, distanceM: 10, baselineTimeS: 10 },
    { id: 'dc', from: 'd', to: 'c', oneWay: true, distanceM: 10, baselineTimeS: 90 },
    { id: 'da', from: 'd', to: 'a', oneWay: true, distanceM: 10, baselineTimeS: 10 },
    { id: 'ad', from: 'a', to: 'd', oneWay: true, distanceM: 10, baselineTimeS: 90 },
    { id: 'ac', from: 'a', to: 'c', oneWay: true, distanceM: 25, baselineTimeS: 25 },
  ],
};

async function native(payload: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pf-e2e-'));
  const reqFile = path.join(dir, 'oracle.request.json');
  await writeFile(reqFile, JSON.stringify({ apiVersion: 1, requestId: 'e2e', command: 'lab.run', payload }));
  return new Promise<string>((resolve, reject) => {
    execFile(RUNNER, [reqFile], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

test('AC-19 lab algorithms, determinism, MST agreement', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
  });

  // Engine-level determinism: identical bytes across runs (modulo volatile fields).
  const dijPayload = { network: TINY, overlay: { version: 1 }, algorithm: 'DIJKSTRA', source: 'a', target: 'c', objective: 'FASTEST', maxEvents: 20000 };
  const [r1, r2] = await Promise.all([native(dijPayload), native(dijPayload)]);
  const mask = (s: string) => s.replace(/"elapsedUs":\d+/, '').replace(/"build":"[^"]*"/, '');
  expect(mask(r1)).toBe(mask(r2));

  await page.goto('/#/lab');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });

  async function runAlgo(algo: string, needsTarget: boolean) {
    await page.selectOption('#lab-algo', algo);
    if (needsTarget) await page.selectOption('#lab-target', 'c');
    await page.getByTestId('lab-run').click();
    await expect(page.getByTestId('lab-result')).toBeVisible({ timeout: 30000 });
  }

  // AC-19: BFS, DFS, Dijkstra, A*, Prim, Kruskal all demonstrate with controls.
  await runAlgo('BFS', false);
  await expect(page.getByTestId('lab-order')).toContainText('a');
  await runAlgo('DFS', false);
  await expect(page.getByTestId('lab-order')).toContainText('a');
  await runAlgo('DIJKSTRA', true);
  await expect(page.getByTestId('lab-route')).toContainText('ab:f bc:f');

  // Trace determinism in the UI: re-running reproduces the trace exactly.
  const liCount1 = await page.getByTestId('trace-events').locator('li').count();
  const route1 = await page.getByTestId('lab-route').textContent();
  await page.getByTestId('lab-run').click();
  await expect(page.getByTestId('lab-result')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('trace-events').locator('li')).toHaveCount(liCount1);
  await expect(page.getByTestId('lab-route')).toHaveText(route1 ?? '');

  await runAlgo('A_STAR', true);
  await expect(page.getByTestId('lab-route')).toContainText('ab:f bc:f');
  await runAlgo('MST_PRIM', false);
  await expect(page.getByTestId('lab-mst')).toContainText('MST weight 30m');
  await runAlgo('MST_KRUSKAL', false);
  await expect(page.getByTestId('lab-mst')).toContainText('MST weight 30m');

  // Trace player: scrubbing to 0 clears highlights; full step restores the route.
  const total = await page.getByTestId('trace-events').locator('li').count();
  expect(total).toBeGreaterThan(0);
  const items = page.getByTestId('trace-events').locator('li');
  await page.fill('#lab-step', '0');
  await expect(items).toHaveCount(0);
  await expect
    .poll(async () => page.evaluate(() => window.__PF_DEBUG__?.cy?.nodes('.visited').length ?? -1))
    .toBe(0);
  await page.fill('#lab-step', String(total));
  await expect(items).toHaveCount(total);

  // Prim vs Kruskal cost agreement through lab.compare.
  await page.selectOption('#lab-cmp-a', 'MST_PRIM');
  await page.selectOption('#lab-cmp-b', 'MST_KRUSKAL');
  await page.getByTestId('lab-compare').click();
  await expect(page.getByTestId('lab-cost-agreement')).toContainText('true', { timeout: 30000 });

  expect(consoleErrors).toEqual([]);
});
