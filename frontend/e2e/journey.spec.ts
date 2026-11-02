// M8 acceptance AC-07,08,12,14,15,16: a real simulated journey driven by
// engine per-arc times and diversion.evaluate decisions. The native runner is
// the oracle for every diversion decision (position read from the UI banner).
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

interface DivResult {
  decision: string;
  reason: string;
  savingS: number | null;
  notify: boolean;
  candidate: { arcs: { arcId: string }[] } | null;
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

function parseBanner(text: string | null): { arc: string; frac: number } {
  const m = /at ([a-z0-9]+:[fr]) @ (\d+)‰/.exec(text ?? '');
  expect(m, `banner position in: ${text}`).not.toBeNull();
  return { arc: m?.[1] ?? '', frac: Number(m?.[2] ?? 0) };
}

test('AC-07,08,12,14,15,16 journey with diversion accept', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
  });
  const network = JSON.parse(await readFile(DATASET, 'utf8'));

  // Plan the baseline route first.
  await page.goto('/#/route');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.getByTestId('find-route').click();
  await expect(page.getByTestId('route-result')).toBeVisible({ timeout: 30000 });

  // AC-07: start a real simulated run.
  await page.goto('/#/journey');
  await page.getByTestId('engine-status').filter({ hasText: 'ready' }).waitFor({ timeout: 30000 });
  await page.selectOption('#journey-speed', '1');
  await page.getByTestId('journey-start').click();
  await expect(page.getByTestId('journey-status')).toContainText('running', { timeout: 30000 });
  await expect(page.getByTestId('vehicle')).toBeVisible();

  // AC-08: the vehicle advances along a valid directed arc (no jumps).
  const arc1 = await page.getByTestId('vehicle').getAttribute('data-arc');
  const frac1 = Number(await page.getByTestId('vehicle').getAttribute('data-frac'));
  await page.waitForTimeout(2500);
  const arc2 = await page.getByTestId('vehicle').getAttribute('data-arc');
  const frac2 = Number(await page.getByTestId('vehicle').getAttribute('data-frac'));
  expect(arc1).toBe('ex01:f');
  expect(arc2).toBe('ex01:f');
  expect(frac2).toBeGreaterThan(frac1);

  // AC-12 marginal: jam on ex06 => engine STAY, no banner, guidance shown.
  await page.selectOption('#traffic-road', 'ex06');
  await page.selectOption('#traffic-kind', 'jam');
  await page.getByTestId('traffic-add').click();
  await expect(page.getByTestId('journey-guidance')).toContainText('STAY', { timeout: 30000 });
  await expect(page.getByTestId('diversion-banner')).toHaveCount(0);
  const guidance = (await page.getByTestId('journey-guidance').textContent()) ?? '';
  expect(guidance).toContain('CURRENT_IS_BEST');

  // AC-12 major: crawl factor on ex04 => RECOMMEND_DIVERSION + banner.
  await page.selectOption('#traffic-road', 'ex04');
  await page.fill('#traffic-factor', '10'); // 10% speed => factor 100 permille
  await page.getByTestId('traffic-apply-factor').click();
  await expect(page.getByTestId('diversion-banner')).toBeVisible({ timeout: 30000 });
  const bannerText = await page.getByTestId('diversion-detail').textContent();
  expect(bannerText).toContain('RECOMMEND_DIVERSION');
  const frozen = parseBanner(bannerText);
  const overlayV3 = {
    version: 3,
    incidents: [{ id: 'i1', road: 'ex06', dir: 'both', kind: 'jam' }],
    factors: { ex04: 100 },
    closures: [],
  };
  const fullPlan = ['ex01:f', 'ex02:f', 'ex03:f', 'ex04:f', 'ex05:f', 'ex06:f', 'ex07:f'];
  const remaining = fullPlan.slice(fullPlan.indexOf(frozen.arc));
  const div1 = (await oracle('diversion.evaluate', {
    network, overlay: overlayV3, plan: { arcs: remaining },
    position: { arc: frozen.arc, fractionPermille: frozen.frac },
    simTimeS: 0, config: { thresholdS: 600 },
  })) as unknown as DivResult;
  expect(div1.decision).toBe('RECOMMEND_DIVERSION');
  expect(bannerText).toContain(`saving ${div1.savingS}s`);
  expect(div1.candidate?.arcs.length).toBeGreaterThan(0);

  // AC-14 stay: dismissal persists policy + history, run resumes.
  await page.getByTestId('diversion-stay').click();
  await expect(page.getByTestId('diversion-banner')).toHaveCount(0);
  await expect(page.getByTestId('journey-status')).toContainText('running');
  await expect(page.getByTestId('decision-0')).toContainText('stay');

  // Block ex04 ahead: REROUTE_REQUIRED (new signature bypasses dismissal).
  await page.selectOption('#traffic-road', 'ex04');
  await page.getByTestId('traffic-close').click();
  await expect(page.getByTestId('diversion-banner')).toBeVisible({ timeout: 30000 });
  const banner2Text = await page.getByTestId('diversion-detail').textContent();
  expect(banner2Text).toContain('REROUTE_REQUIRED');
  const frozen2 = parseBanner(banner2Text);
  const overlayV4 = { ...overlayV3, version: 4, closures: ['ex04'] };
  const remaining2 = fullPlan.slice(fullPlan.indexOf(frozen2.arc));
  const div2 = (await oracle('diversion.evaluate', {
    network, overlay: overlayV4, plan: { arcs: remaining2 },
    position: { arc: frozen2.arc, fractionPermille: frozen2.frac },
    simTimeS: 0, config: { thresholdS: 600 },
  })) as unknown as DivResult;
  expect(div2.decision).toBe('REROUTE_REQUIRED');
  const candidateArcs = div2.candidate?.arcs.map((a) => a.arcId) ?? [];
  expect(candidateArcs[0]).toBe(frozen2.arc); // candidate starts at occupied arc

  // AC-14/15 accept: engine-validated plan adopted, vehicle stays on arc.
  await page.getByTestId('diversion-accept').click();
  await expect(page.getByTestId('diversion-banner')).toHaveCount(0);
  await expect(page.getByTestId('decision-1')).toContainText('accept');
  await page.waitForTimeout(1200);
  const afterArc = await page.getByTestId('vehicle').getAttribute('data-arc');
  expect(afterArc).toBe(frozen2.arc);
  const highlighted: string[] = await page.evaluate(() => {
    const cy = window.__PF_DEBUG__?.cy;
    return cy ? cy.edges('.route').map((e) => e.id()) : [];
  });
  expect(highlighted.sort()).toEqual([...candidateArcs].sort());

  // AC-16: finish at demo speed; summary carries the required fields.
  await page.selectOption('#journey-speed', '600');
  await expect(page.getByTestId('journey-summary')).toBeVisible({ timeout: 180000 });
  await expect(page.getByTestId('summary-route')).toContainText('chandigarh → delhi');
  await expect(page.getByTestId('summary-arcs')).not.toHaveText('0');
  const accepts = Number(await page.getByTestId('summary-accepts').textContent());
  const stays = Number(await page.getByTestId('summary-stays').textContent());
  expect(accepts).toBeGreaterThanOrEqual(1);
  expect(stays).toBeGreaterThanOrEqual(1);

  // Decision history persists in validated localStorage.
  const stored = await page.evaluate(() => localStorage.getItem('pf-decision-history'));
  const parsed = JSON.parse(stored ?? 'null') as unknown;
  expect(Array.isArray(parsed)).toBe(true);
  expect((parsed as { kind: string }[]).map((r) => r.kind).sort()).toEqual(['accept', 'stay']);

  expect(consoleErrors).toEqual([]);
});
