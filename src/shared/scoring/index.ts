import type {
  Application, Axis, ChecklistItem, CostInput, Finding, FindingStatus, GoldenMasterResult, PricingConfig,
  RefDiff, Rule, ScoringConfig, Snapshot, Step, Workspace,
} from '../types/index.ts';

export const AXES: Axis[] = ['os', 'jdk', 'framework', 'cloud'];
export const AXIS_LABEL: Record<Axis, string> = { os: 'OS', jdk: 'JDK', framework: '프레임워크', cloud: '클라우드' };
export type Grade = 'Low' | 'Medium' | 'High' | 'Critical';
export const GRADE_LABEL: Record<Grade, string> = { Low: '낮음 (Low)', Medium: '보통 (Medium)', High: '높음 (High)', Critical: '매우 높음 (Critical)' };
export const GRADE_ADVICE: Record<Grade, string> = {
  Low: '표준 경로, 앞선 웨이브 배치',
  Medium: '브리지 버전 경유 필수',
  High: '사전 PoC 후 전환',
  Critical: '재작성·교체 검토, 최종 웨이브',
};

export const findingKey = (refId: string, f: Pick<Finding, 'ruleId' | 'filePath' | 'line'>) =>
  `${refId}:${f.ruleId}:${f.filePath}:${f.line}`;

/** 실제 코드에서 탐지된 항목만 (주석·exclude 대상 제외) */
export const isActive = (f: Finding) => !f.inComment && !f.excluded;

export interface AxisResult { score: number; raw: number; count: number; effortHours: number }
export interface TopFinding { ruleId: string; title: string; count: number; severity: Rule['severity'] }

export function scoreFindings(
  refId: string,
  findings: Finding[],
  rules: Rule[],
  cfg: ScoringConfig,
  statuses: Record<string, FindingStatus> = {},
  /** 있으면 findings가 잘렸더라도 이 총건수로 계산한다 (처리 상태는 보관된 항목에서 차감) */
  ruleCounts?: Record<string, number>,
) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const axes = Object.fromEntries(AXES.map((a) => [a, { score: 0, raw: 0, count: 0, effortHours: 0 }])) as Record<Axis, AxisResult>;
  const perRule = new Map<string, number>();
  const add = (ruleId: string, n: number) => {
    const r = byId.get(ruleId);
    if (!r || n <= 0) return;
    perRule.set(r.id, (perRule.get(r.id) ?? 0) + n);
    const w = cfg.severityWeights[r.severity] ?? 0;
    if (w === 0) return; // info: 점수·공수·건수 제외, 목록에만 표시
    const a = axes[r.axis];
    a.count += n;
    a.raw += n * w * (1 - r.autoFixable);
    a.effortHours += n * r.effortHours * (1 - r.autoFixable);
  };
  if (ruleCounts) {
    const closed = new Map<string, number>();
    for (const f of findings) {
      const st = statuses[findingKey(refId, f)] ?? 'open';
      if (isActive(f) && (st === 'resolved' || st === 'accepted')) closed.set(f.ruleId, (closed.get(f.ruleId) ?? 0) + 1);
    }
    for (const [id, n] of Object.entries(ruleCounts)) add(id, n - (closed.get(id) ?? 0));
  } else {
    const open = new Map<string, number>();
    for (const f of findings) {
      if (!isActive(f)) continue;
      const st = statuses[findingKey(refId, f)] ?? 'open';
      if (st === 'resolved' || st === 'accepted') continue;
      open.set(f.ruleId, (open.get(f.ruleId) ?? 0) + 1);
    }
    for (const [id, n] of open) add(id, n);
  }
  for (const a of AXES) axes[a].score = Math.min(100, Math.round((axes[a].raw / cfg.normalization[a]) * 100));
  const top: TopFinding[] = [...perRule.entries()]
    .map(([id, count]) => ({ ruleId: id, title: byId.get(id)!.title, count, severity: byId.get(id)!.severity }))
    .sort((a, b) => b.count * (cfg.severityWeights[b.severity] || 0.01) - a.count * (cfg.severityWeights[a.severity] || 0.01));
  return { axes, top, perRule };
}

export const gradeOf = (score: number, cfg: ScoringConfig): Grade =>
  score >= cfg.grades.critical ? 'Critical' : score >= cfg.grades.high ? 'High' : score >= cfg.grades.medium ? 'Medium' : 'Low';

export interface Impact {
  total: number;
  grade: Grade;
  axes: Record<Axis, AxisResult>;
  criticalityScore: number;
  integrationScore: number;
  effortHours: number;
  top: TopFinding[];
  basis: 'scan' | 'assumed' | 'none';
  recommendedPath: string[];
}

export function computeImpact(app: Application, axes: Record<Axis, AxisResult> | null, top: TopFinding[], cfg: ScoringConfig): Impact {
  let a = axes;
  let basis: Impact['basis'] = 'scan';
  if (!a) {
    basis = app.assumedAxisScores ? 'assumed' : 'none';
    a = Object.fromEntries(AXES.map((x) => [x, { score: app.assumedAxisScores?.[x] ?? 0, raw: 0, count: 0, effortHours: 0 }])) as Record<Axis, AxisResult>;
  }
  const criticalityScore = ((app.criticality - 1) / 4) * 100;
  const integrationScore = app.integrationComplexity;
  const w = cfg.weights;
  const total = Math.round(
    w.os * a.os.score + w.jdk * a.jdk.score + w.framework * a.framework.score + w.criticality * criticalityScore + w.integration * integrationScore,
  );
  const effortHours = Math.round(AXES.reduce((s, x) => s + a![x].effortHours, 0) * 10) / 10;
  const grade = gradeOf(total, cfg);
  const path: string[] = ['STEP_0'];
  if (a.os.score > 0) path.push('STEP_1');
  path.push('STEP_2'); // 브리지 버전: 한 번에 건너뛰지 않는다
  if (a.jdk.score > 0 || grade !== 'Low') path.push('STEP_3');
  path.push('STEP_4', 'STEP_5');
  return { total, grade, axes: a, criticalityScore, integrationScore, effortHours, top, basis, recommendedPath: path };
}

/* ───────────── 체크리스트 · 단계 게이트 ───────────── */

export const checklistKey = (appId: string, itemId: string) => `${appId}:${itemId}`;

/** 14.5절: 클라우드·To-Be 잔여 갭 규칙 → Step 4/5 체크리스트 항목 */
const GAP_RULES: Record<string, Step> = { 'RULE-JDK-011': 4, 'RULE-CL-004': 4, 'RULE-CL-005': 4, 'RULE-CL-001': 5, 'RULE-CL-002': 5, 'RULE-CL-003': 5 };

export function gapChecklist(findings: Finding[], rules: Rule[]): (ChecklistItem & { count: number })[] {
  const out: (ChecklistItem & { count: number })[] = [];
  for (const [ruleId, step] of Object.entries(GAP_RULES)) {
    const r = rules.find((x) => x.id === ruleId);
    const count = findings.filter((f) => f.ruleId === ruleId && isActive(f)).length;
    if (!r || !count) continue;
    out.push({ id: `gap:${ruleId}`, category: 'conversion', step, required: true, ruleId, count, text: `[${ruleId}] ${r.title} — ${count}건 남음 → ${r.guidance}` });
  }
  return out;
}

export interface GateResult { ok: boolean; reasons: string[]; from: Step; to?: Step }

export function checkGate(ws: Pick<Workspace, 'checklistResults' | 'goldenMasterResults'>, app: Application, items: ChecklistItem[]): GateResult {
  const from = app.currentStep;
  if (from >= 5) return { ok: false, reasons: ['이미 마지막 단계(Step 5)입니다.'], from };
  const to = (from + 1) as Step;
  const reasons: string[] = [];
  const required = items.filter((i) => (!i.appId || i.appId === app.id) && i.category === 'conversion' && i.step === from && i.required);
  const missing = required.filter((i) => !ws.checklistResults[checklistKey(app.id, i.id)]?.done);
  if (missing.length) reasons.push(`Step ${from} 필수 체크리스트 ${missing.length}/${required.length}건 미완료`);
  const gm = latestGolden(ws.goldenMasterResults, app.id);
  if (!gm) reasons.push('골든 마스터 결과가 업로드되지 않았습니다 (F-12)');
  else {
    const failed = gm.scenarios.filter((s) => !s.passed).length;
    if (!gm.scenarios.length) reasons.push('골든 마스터 시나리오가 비어 있습니다');
    if (failed) reasons.push(`골든 마스터 실패 ${failed}건`);
  }
  return { ok: reasons.length === 0, reasons, from, to };
}

export const latestGolden = (list: GoldenMasterResult[], appId: string) =>
  list.filter((g) => g.appId === appId).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];

export function validateGoldenJson(x: unknown): { ok: true; value: GoldenMasterResult['scenarios'] } | { ok: false; error: string } {
  const arr = (x as { scenarios?: unknown })?.scenarios;
  if (!Array.isArray(arr) || !arr.length) return { ok: false, error: '`scenarios` 배열이 필요합니다.' };
  const out: GoldenMasterResult['scenarios'] = [];
  for (const s of arr) {
    const o = s as { id?: unknown; passed?: unknown; detail?: unknown };
    if (typeof o.id !== 'string' || typeof o.passed !== 'boolean') return { ok: false, error: '각 시나리오는 { id: string, passed: boolean } 이어야 합니다.' };
    out.push({ id: o.id, passed: o.passed, detail: typeof o.detail === 'string' ? o.detail : undefined });
  }
  return { ok: true, value: out };
}

/* ───────────── 웨이브 (4.5절) ───────────── */

export interface DbWaveWarning { dbId: string; appIds: string[]; waveIds: string[] }

/** 같은 DB를 공유하는 앱이 서로 다른 웨이브에 배정되면 경고한다 (웨이브 미배정도 다른 웨이브로 본다). */
export function dbWaveWarnings(apps: Application[]): DbWaveWarning[] {
  const byDb = new Map<string, Application[]>();
  for (const a of apps) for (const d of a.sharedDbIds) byDb.set(d, [...(byDb.get(d) ?? []), a]);
  const out: DbWaveWarning[] = [];
  for (const [dbId, list] of byDb) {
    const waves = new Set(list.map((a) => a.waveId ?? '(미배정)'));
    if (list.length > 1 && waves.size > 1) out.push({ dbId, appIds: list.map((a) => a.id), waveIds: [...waves] });
  }
  return out;
}

/* ───────────── 비용 ───────────── */

export function computeCost(c: CostInput, p: PricingConfig) {
  const compute = c.containers * (c.vcpuPerContainer * p.vcpuMonth + c.memGbPerContainer * p.memGbMonth);
  const db = (p.dbTiers[c.dbTier] ?? 0) + c.dbGb * p.storageGbMonth;
  const storage = c.storageGb * p.storageGbMonth;
  const egress = c.egressGbMonth * p.egressGb;
  const targetMonthly = compute + db + storage + egress;
  return { compute, db, storage, egress, targetMonthly, targetAnnual: targetMonthly * 12, parallel: targetMonthly * c.parallelMonths, asisAnnual: c.asisAnnual };
}

/* ───────────── 규칙 검증 (14.6절) ───────────── */

const KEYWORD = /\bjavax\.|\bjakarta\.|egovframework\.rte|org\.egovframe|springmodules|ibatis|SqlMap|web-app_\d|jstl/i;
const norm = (s: string) => s.split('\n')[0].trim();
const mkKey = (f: Finding) => `${f.ruleId}|${f.filePath}|${norm(f.snippet)}`;

export interface ValidationRow {
  ruleId: string;
  from: number;
  to: number;
  resolved: number;
  tp: number;
  persisted: number;
  fpCandidates: Finding[];
}
export interface FnCandidate { filePath: string; line: number; text: string }
export interface PairValidation { fromRef: string; toRef: string; rows: ValidationRow[]; fnCandidates: FnCandidate[]; filesChanged: number }

export function validatePair(from: Snapshot, to: Snapshot, diff: RefDiff | undefined): PairValidation {
  const toActive = new Map<string, number>();
  for (const f of to.findings.filter(isActive)) toActive.set(mkKey(f), (toActive.get(mkKey(f)) ?? 0) + 1);

  const removed = new Map<string, Set<number>>();
  const wholeFile = new Set<string>();
  for (const d of diff?.files ?? []) {
    removed.set(d.path, new Set(d.removed.map((l) => l.line)));
    if (d.status === 'removed' || d.status === 'renamed') wholeFile.add(d.path);
  }

  const rows = new Map<string, ValidationRow>();
  const row = (id: string) => {
    if (!rows.has(id)) rows.set(id, { ruleId: id, from: 0, to: 0, resolved: 0, tp: 0, persisted: 0, fpCandidates: [] });
    return rows.get(id)!;
  };
  const matchedLines = new Set<string>();
  for (const f of from.findings) {
    const r = row(f.ruleId);
    if (!isActive(f)) {
      r.fpCandidates.push(f);
      continue;
    }
    r.from++;
    matchedLines.add(`${f.filePath}:${f.line}`);
    const k = mkKey(f);
    const left = toActive.get(k) ?? 0;
    if (left > 0) {
      toActive.set(k, left - 1);
      r.persisted++;
    } else {
      r.resolved++;
      if (wholeFile.has(f.filePath) || removed.get(f.filePath)?.has(f.line)) r.tp++;
    }
  }
  for (const f of to.findings.filter(isActive)) row(f.ruleId).to++;

  const fn: FnCandidate[] = [];
  for (const d of diff?.files ?? []) {
    for (const l of d.removed) if (KEYWORD.test(l.text) && !matchedLines.has(`${d.path}:${l.line}`)) fn.push({ filePath: d.path, line: l.line, text: l.text.trim().slice(0, 200) });
  }
  return {
    fromRef: from.refId,
    toRef: to.refId,
    rows: [...rows.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId)),
    fnCandidates: fn,
    filesChanged: diff?.files.length ?? 0,
  };
}
