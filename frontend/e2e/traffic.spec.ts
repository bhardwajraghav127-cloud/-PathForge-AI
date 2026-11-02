// M7 acceptance AC-09..AC-11 + explanation attribution, against the real
// C++ engine (WASM). The native pf_contract_runner binary is the independent
// oracle: it recomputes every step with the identical overlay the UI sends.
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

async function oracle(cmd: string, payload: unknown): Promise<Record<string, never>> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pf-e2e-'));
  const reqFile = path.join(dir, 'oracle.request.json');
  await writeFile(reqFile, JSON.stringify({ apiVersion: 1, requestId: 'e2e', command: cmd, payload }));
  const out = await new Promise<string>((resolve, reject) => {
    execFile(RUNNER, [reqFile], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
  const env = JSON.parse(out) as { ok: boolean; result: Record<string, never> };
  expect(env.ok).toBe(true);
  return env.result;
}

test('AC-09..AC-11 traffic, recompute, alternatives, attribution', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
  });
  const network = JSON.parse(await readFile(DATASET, 'utf8'));

  await page.goto('/#/route');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });

  // Baseline.
  await page.getByTestId('find-route').click();
  await expect(page.getByTestId('route-result')).toBeVisible({ timeout: 30000 });
  const baseTime = Number(/(\d+) s\)/.exec((await page.getByTestId('fact-time').textContent()) ?? '')?.[1]);
  await page.getByTestId('planner-tabs-steps').click();
  const baseArcs = await page.getByTestId('route-steps').locator('li').allTextContents();
  expect(baseArcs.length).toBe(7);

  // AC-09: report a jam incident on ex06.
  await page.selectOption('#traffic-road', 'ex06');
  await page.selectOption('#traffic-kind', 'jam');
  await page.selectOption('#traffic-dir', 'both');
  await page.getByTestId('traffic-add').click();
  await expect(page.getByTestId('incident-i1')).toContainText('jam on ex06 (both)');
  await expect(page.getByTestId('overlay-version')).toContainText('Overlay v2');

  // AC-09: close road ex03.
  await page.selectOption('#traffic-road', 'ex03');
  await page.getByTestId('traffic-close').click();
  await expect(page.getByTestId('closure-list')).toContainText('ex03');
  await expect(page.getByTestId('overlay-version')).toContainText('Overlay v3');

  // AC-11: engine recomputes automatically; AC-10: version + weights update.
  const overlay = {
    version: 3,
    incidents: [{ id: 'i1', road: 'ex06', dir: 'both', kind: 'jam' }],
    factors: {},
    closures: ['ex03'],
  };
  const expected = (await oracle('route.find', {
    network, overlay, source: 'chandigarh', target: 'delhi', objective: 'FASTEST', algorithm: 'DIJKSTRA',
  })) as unknown as EngineRoute;
  expect(expected.found).toBe(true);
  // Metamorphic proof: the same inputs + traffic change produce a new outcome.
  expect(expected.arcs.map((a) => a.arcId)).not.toEqual(
    baseArcs.map((t) => /([a-z0-9]+:[fr])/.exec(t)?.[1]),
  );
  await page.getByTestId('planner-tabs-steps').click();
  await page.getByTestId('route-steps').filter({ hasText: 'gt01:f' }).waitFor({ timeout: 30000 });
  const uiArcs = await page.getByTestId('route-steps').locator('li').allTextContents();
  expect(uiArcs.length).toBe(expected.arcs.length);
  for (let i = 0; i < expected.arcs.length; i++) {
    expect(uiArcs[i]).toContain(expected.arcs[i]?.arcId ?? '');
  }
  await page.getByTestId('planner-tabs-overview').click();
  const newTime = Number(/(\d+) s\)/.exec((await page.getByTestId('fact-time').textContent()) ?? '')?.[1]);
  expect(newTime).toBe(expected.timeS);
  expect(newTime).toBeGreaterThan(baseTime);

  // Map follows the recomputed route.
  const highlighted: string[] = await page.evaluate(() => {
    const cy = window.__PF_DEBUG__?.cy;
    return cy ? cy.edges('.route').map((e) => e.id()) : [];
  });
  expect(highlighted.sort()).toEqual(expected.arcs.map((a) => a.arcId).sort());

  // Alternatives come from the engine (Yen, up to 3).
  const alts = (await oracle('route.alternatives', {
    network, overlay, source: 'chandigarh', target: 'delhi', objective: 'FASTEST', maxAlternatives: 3,
  })) as unknown as { best: EngineRoute; alternatives: EngineRoute[] };
  expect(alts.alternatives.length).toBeGreaterThanOrEqual(1);
  await page.getByTestId('planner-tabs-compare').click();
  await expect(page.getByTestId('alt-list')).toBeVisible({ timeout: 30000 });
  const altCount = await page.getByTestId('alt-list').locator('li').count();
  expect(altCount).toBe(alts.alternatives.length + 1);
  await page.getByTestId('alt-alt0').click();
  await page.getByTestId('planner-tabs-overview').click();
  const altTime = Number(/(\d+) s\)/.exec((await page.getByTestId('fact-time').textContent()) ?? '')?.[1]);
  expect(altTime).toBe(alts.alternatives[0]?.timeS);
  await page.getByTestId('planner-tabs-compare').click();

  // Attribution: the engine names the slowing incident on the best route.
  await page.getByTestId('alt-best').click();
  await page.getByTestId('planner-tabs-why').click();
  await page.getByTestId('why-toggle').click();
  await expect(page.getByTestId('why-best')).toContainText('i1', { timeout: 30000 });

  expect(consoleErrors).toEqual([]);
});
