// M9 AC-17: normal / congested / closure scenarios compare with correct
// deltas. Oracle: the native runner on scenario.compare.
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

interface ScnRow {
  scenarioId: string;
  route: { found: boolean; timeS: number; distanceM: number };
  deltasVsFirst: { timeDeltaS: number; distanceDeltaM: number } | null;
}

test('AC-17 scenario deltas agree with the engine', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
  });
  const network = JSON.parse(await readFile(DATASET, 'utf8'));

  await page.goto('/#/scenarios');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });

  // Congested snapshot: jam on ex06.
  await page.selectOption('#traffic-road', 'ex06');
  await page.getByTestId('traffic-add').click();
  await page.fill('#scenario-name', 'congested');
  await page.getByTestId('scenario-save').click();
  await expect(page.getByTestId('scenario-list')).toContainText('congested · overlay v2');

  // Closure snapshot: also close ex03 (saved snapshot must stay isolated).
  await page.selectOption('#traffic-road', 'ex03');
  await page.getByTestId('traffic-close').click();
  await expect(page.getByTestId('closure-list')).toContainText('ex03');
  await page.fill('#scenario-name', 'closed');
  await page.getByTestId('scenario-save').click();
  await expect(page.getByTestId('scenario-list')).toContainText('congested · overlay v2');
  await expect(page.getByTestId('scenario-list')).toContainText('closed · overlay v3');

  await page.getByTestId('scenario-compare').click();
  await expect(page.getByTestId('scenario-results')).toBeVisible({ timeout: 30000 });

  const congested = { version: 2, incidents: [{ id: 'i1', road: 'ex06', dir: 'both', kind: 'jam' }], factors: {}, closures: [] as string[] };
  const closed = { version: 3, incidents: congested.incidents, factors: {}, closures: ['ex03'] };
  const dir = await mkdtemp(path.join(tmpdir(), 'pf-e2e-'));
  const reqFile = path.join(dir, 'oracle.request.json');
  await writeFile(reqFile, JSON.stringify({
    apiVersion: 1, requestId: 'e2e', command: 'scenario.compare',
    payload: {
      network,
      query: { source: 'chandigarh', target: 'delhi', objective: 'FASTEST', algorithm: 'DIJKSTRA' },
      scenarios: [
        { id: 'normal', overlay: { version: 1 } },
        { id: 'congested', overlay: congested },
        { id: 'closed', overlay: closed },
      ],
    },
  }));
  const out = await new Promise<string>((resolve, reject) => {
    execFile(RUNNER, [reqFile], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
  const expected = (JSON.parse(out) as { ok: boolean; result: { results: ScnRow[] } }).result.results;
  expect(expected.length).toBe(3);

  for (const row of expected) {
    const text = (await page.getByTestId(`scenario-row-${row.scenarioId}`).textContent()) ?? '';
    expect(text).toContain(`(${row.route.timeS} s, ${row.route.distanceM} m)`);
    if (row.deltasVsFirst) {
      expect(text).toContain(`Δ +${row.deltasVsFirst.timeDeltaS}s / +${row.deltasVsFirst.distanceDeltaM}m`);
    }
  }

  // Snapshots persist in validated localStorage.
  const stored = await page.evaluate(() => localStorage.getItem('pf-scenarios'));
  const parsed = JSON.parse(stored ?? 'null') as unknown;
  expect(Array.isArray(parsed)).toBe(true);
  expect((parsed as { name: string }[]).map((s) => s.name).sort()).toEqual(['closed', 'congested']);

  expect(consoleErrors).toEqual([]);
});
