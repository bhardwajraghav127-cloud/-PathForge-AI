// M9 AC-18: small multi-stop optimization yields a verified OPTIMAL order.
// Oracle: the native runner on the identical payload.
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

test('AC-18 multistop optimum agrees with the engine', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
  });
  const network = JSON.parse(await readFile(DATASET, 'utf8'));

  await page.goto('/#/multistop');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });

  // Defaults: stops delhi/chandigarh/karnal/ambala, start delhi, open tour.
  await page.getByTestId('stops-optimize').click();
  await expect(page.getByTestId('multistop-result')).toBeVisible({ timeout: 30000 });

  const dir = await mkdtemp(path.join(tmpdir(), 'pf-e2e-'));
  const reqFile = path.join(dir, 'oracle.request.json');
  await writeFile(reqFile, JSON.stringify({
    apiVersion: 1, requestId: 'e2e', command: 'route.multistop',
    payload: { network, stops: ['delhi', 'chandigarh', 'karnal', 'ambala'], start: 'delhi', exactUpTo: 10, allowHeuristic: true },
  }));
  const out = await new Promise<string>((resolve, reject) => {
    execFile(RUNNER, [reqFile], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
  const expected = (JSON.parse(out) as { ok: boolean; result: Record<string, never> }).result as unknown as {
    found: boolean; optimal: boolean; method: string; order: string[];
    totalTimeS: number; totalDistanceM: number; totalTollInr: number;
    legs: { from: string; to: string; route: { timeS: number; arcs: { arcId: string }[] } }[];
  };
  expect(expected.found).toBe(true);
  expect(expected.optimal).toBe(true);

  // The optimum differs from the input stop order (dataset guarantee 9).
  expect(expected.order).not.toEqual(['delhi', 'chandigarh', 'karnal', 'ambala']);
  await expect(page.getByTestId('multistop-method')).toContainText('OPTIMAL');
  await expect(page.getByTestId('multistop-method')).toContainText(expected.method);
  const names = new Map<string, string>(
    (network.vertices as { id: string; name: string }[]).map((v) => [v.id, v.name]),
  );
  const orderText = (await page.getByTestId('multistop-order').textContent()) ?? '';
  for (const id of expected.order) expect(orderText).toContain(names.get(id) ?? id);
  await expect(page.getByTestId('multistop-time')).toContainText(`(${expected.totalTimeS} s)`);
  await expect(page.getByTestId('multistop-dist')).toContainText(`(${expected.totalDistanceM} m)`);
  await expect(page.getByTestId('multistop-toll')).toContainText(`(${expected.totalTollInr})`);
  const legCount = await page.getByTestId('multistop-result').locator('[data-testid^="multistop-leg-"]').count();
  expect(legCount).toBe(expected.legs.length);
  for (let i = 0; i < expected.legs.length; i++) {
    const legText = (await page.getByTestId(`multistop-leg-${i}`).textContent()) ?? '';
    for (const a of expected.legs[i]?.route.arcs ?? []) expect(legText).toContain(a.arcId);
  }

  expect(consoleErrors).toEqual([]);
});
