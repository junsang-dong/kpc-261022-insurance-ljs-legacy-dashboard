import { useMemo } from 'react';
import { computeImpact, gapChecklist, scoreFindings, type Impact } from '../shared/scoring/index.ts';
import type { Application, ChecklistItem, GitRef, Snapshot, Workspace } from '../shared/types/index.ts';
import { useWs } from './workspace.ts';
import { useStatic, type StaticData } from './staticData.ts';

export interface RefData { ref: GitRef; snap: Snapshot }

/** 스냅샷 + 라이브 스캔 결과를 Ref ID 기준으로 합친다. */
export function buildRefData(sd: StaticData, ws: Workspace): Map<string, RefData> {
  const out = new Map<string, RefData>();
  for (const ref of ws.refs) {
    const snap = sd.snapshots[ref.id] ?? (ws.liveScans[ref.id] ? { ...ws.liveScans[ref.id], refId: ref.id, role: ref.role, order: ref.order, synthetic: ref.synthetic } : undefined);
    if (snap) out.set(ref.id, { ref: { ...ref, detectedVersions: snap.ref.detectedVersions, inferredStep: snap.ref.inferredStep }, snap });
  }
  return out;
}

/** 앱의 분석 기준 Ref: baseline → 그 외 실제 Ref 중 마지막 → 오버레이 */
export function primaryRefId(app: Application, refs: Map<string, RefData>): string | undefined {
  const ids = app.refIds.filter((id) => refs.has(id));
  return ids.find((id) => refs.get(id)!.ref.role === 'baseline') ?? [...ids].reverse().find((id) => !refs.get(id)!.ref.synthetic) ?? ids[0];
}

/** 앱에 적용되는 체크리스트: 시드 + 사용자가 반영한 항목 + 분석 기준 Ref의 잔여 갭(14.5절) */
export function checklistFor(app: Application, sd: StaticData, ws: Workspace, refs: Map<string, RefData>, refId?: string): ChecklistItem[] {
  const id = refId ?? primaryRefId(app, refs);
  const gaps = id && refs.get(id) ? gapChecklist(refs.get(id)!.snap.findings, sd.rules) : [];
  return [...sd.checklist, ...ws.extraChecklist.filter((i) => !i.appId || i.appId === app.id), ...gaps];
}

export interface AppImpact { app: Application; impact: Impact; refId?: string }

export function useAppImpacts(): { impacts: AppImpact[]; refData: Map<string, RefData>; sd: StaticData; ws: Workspace } | null {
  const { data: sd } = useStatic();
  const ws = useWs((s) => s.ws);
  return useMemo(() => {
    if (!sd || !ws) return null;
    const refData = buildRefData(sd, ws);
    const impacts = ws.applications.map((app) => {
      const refId = primaryRefId(app, refData);
      const rd = refId ? refData.get(refId) : undefined;
      const sc = rd ? scoreFindings(rd.ref.id, rd.snap.findings, sd.rules, ws.scoring, ws.findingStatus) : null;
      return { app, refId, impact: computeImpact(app, sc?.axes ?? null, sc?.top ?? [], ws.scoring) };
    });
    return { impacts, refData, sd, ws };
  }, [sd, ws]);
}
