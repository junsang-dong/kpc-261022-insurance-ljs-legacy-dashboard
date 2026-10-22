import { AXES, AXIS_LABEL, computeCost, dbWaveWarnings, scoreFindings, type Grade } from '../../shared/scoring/index.ts';
import type { Axis } from '../../shared/types/index.ts';
import type { useAppImpacts } from '../../store/derived.ts';

type Data = NonNullable<ReturnType<typeof useAppImpacts>>;

export function summaryMetrics(d: Data) {
  const { impacts, refData, sd, ws } = d;
  const stepDist = [0, 1, 2, 3, 4, 5].map((s) => ws.applications.filter((a) => a.currentStep === s).length);
  const gradeDist: Record<Grade, number> = { Low: 0, Medium: 0, High: 0, Critical: 0 };
  for (const i of impacts) gradeDist[i.impact.grade]++;
  const avgImpact = impacts.length ? Math.round(impacts.reduce((s, i) => s + i.impact.total, 0) / impacts.length) : 0;

  // 실제 Ref(오버레이 제외)의 축별 점수 추이 — 가상 데이터와 분리
  const realRefs = [...refData.values()].filter((r) => !r.ref.synthetic).sort((a, b) => a.ref.order - b.ref.order);
  const refTrend = realRefs.map((r) => ({
    refId: r.ref.id,
    step: r.ref.inferredStep,
    axes: scoreFindings(r.ref.id, r.snap.findings, sd.rules, ws.scoring, ws.findingStatus).axes,
  }));
  const overlays = [...refData.values()].filter((r) => r.ref.synthetic);

  const openRisks = ws.risks.filter((r) => r.status !== 'closed').sort((a, b) => b.likelihood * b.impact - a.likelihood * a.impact);
  const costs = ws.costInputs.map((c) => ({ appId: c.appId, ...computeCost(c, sd.pricing) }));
  const cost = {
    asisAnnual: costs.reduce((s, c) => s + c.asisAnnual, 0),
    targetAnnual: costs.reduce((s, c) => s + c.targetAnnual, 0),
    parallel: costs.reduce((s, c) => s + c.parallel, 0),
    apps: costs.length,
  };
  const warnings = dbWaveWarnings(ws.applications);
  return { stepDist, gradeDist, avgImpact, refTrend, overlays, openRisks, cost, warnings, realRefCount: realRefs.length };
}

export const axisLabel = (a: Axis) => AXIS_LABEL[a];
export { AXES };
