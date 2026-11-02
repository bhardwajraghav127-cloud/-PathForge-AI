// M6 acceptance AC-01..AC-06 against the real C++ engine (WASM).
// The independent oracle is the NATIVE pf_contract_runner binary fed the
// identical payload the UI sends; the browser path (React→worker→WASM→render)
// must agree on every fact. No test doubles: real engine, real rendering.
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

interface EngineRoute {
  found: boolean;
  arcs: { arcId: string; from: string; to: string }[];
  distanceM: number;
  timeS: number;
  tollInr: number;
  delayS: number;
}

async function engineOracle(source: string, target: string, objective: string): Promise<EngineRoute> {
  const network = JSON.parse(await readFile(DATASET, 'utf8'));
  const req = {
    apiVersion: 1,
    requestId: 'e2e-oracle',
    command: 'route.find',
    payload: { network, overlay: { version: 1 }, source, target, objective, algorithm: 'DIJKSTRA' },
  };
  const dir = await mkdtemp(path.join(tmpdir(), 'pf-e2e-'));
  const reqFile = path.join(dir, 'oracle.request.json');
  await writeFile(reqFile, JSON.stringify(req));
  const out = await new Promise<string>((resolve, reject) => {
    execFile(RUNNER, [reqFile], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
  const env = JSON.parse(out);
  expect(env.ok).toBe(true);
  return env.result as EngineRoute;
}

test('AC-01..AC-06 route planner against the real engine', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
  });

  // AC-01: launch without errors.
  await page.goto('/#/route');
  await expect(page.getByTestId('map')).toBeVisible();
  await expect(page.getByTestId('engine-status')).toContainText('ready', { timeout: 30000 });

  // AC-02: vertex/road counts on the dashboard.
  await page.goto('/#/');
  await expect(page.getByTestId('network-counts')).toContainText('20 vertices');
  await expect(page.getByTestId('network-counts')).toContainText('42 roads');

  // AC-03: autocomplete origin/destination.
  await page.goto('/#/route');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.locator('#destination').fill('delh');
  await page.getByTestId('destination-option-delhi').click();
  await expect(page.getByTestId('destination-current')).toContainText('Delhi');

  // AC-04: engine returns a valid connected route; independent cost check.
  const expected = await engineOracle('chandigarh', 'delhi', 'FASTEST');
  expect(expected.found).toBe(true);
  await page.getByTestId('find-route').click();
  await expect(page.getByTestId('route-result')).toBeVisible({ timeout: 30000 });

  const renderedArcs = await page.getByTestId('route-steps').locator('li').allTextContents();
  expect(renderedArcs.length).toBe(expected.arcs.length);
  for (let i = 0; i < expected.arcs.length; i++) {
    expect(renderedArcs[i]).toContain(expected.arcs[i]?.arcId ?? '');
  }
  // Connectivity: every leg starts where the previous ended.
  for (let i = 1; i < expected.arcs.length; i++) {
    expect(expected.arcs[i]?.from).toBe(expected.arcs[i - 1]?.to);
  }
  expect(expected.arcs[0]?.from).toBe('chandigarh');
  expect(expected.arcs[expected.arcs.length - 1]?.to).toBe('delhi');

  // AC-05: map highlights exactly the returned arc IDs.
  const highlighted: string[] = await page.evaluate(() => {
    const cy = window.__PF_DEBUG__?.cy;
    if (!cy) return [];
    return cy.edges('.route').map((e) => e.id());
  });
  expect(highlighted.sort()).toEqual(expected.arcs.map((a) => a.arcId).sort());

  // AC-06: displayed facts equal engine facts.
  await expect(page.getByTestId('fact-distance')).toContainText(`(${expected.distanceM} m)`);
  await expect(page.getByTestId('fact-time')).toContainText(`(${expected.timeS} s)`);
  await expect(page.getByTestId('fact-toll')).toContainText(`(${expected.tollInr})`);
  await expect(page.getByTestId('fact-delay')).toContainText(`(${expected.delayS} s)`);

  // AC-01 (cont.): no console/page errors through the whole flow.
  expect(consoleErrors).toEqual([]);
});
