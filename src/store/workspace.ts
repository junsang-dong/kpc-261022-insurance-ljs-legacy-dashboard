import { create } from 'zustand';
import { SCHEMA_VERSION, type Application, type ChecklistItem, type CostInput, type FindingStatus, type GitRef, type GoldenMasterResult, type Risk, type ScanResult, type ScoringConfig, type Step, type Wave, type Workspace } from '../shared/types/index.ts';
import { checkGate, checklistKey, type GateResult } from '../shared/scoring/index.ts';
import { dataStore, migrate } from './dataStore.ts';
import type { StaticData } from './staticData.ts';

export function buildWorkspace(sd: StaticData): Workspace {
  const refs: GitRef[] = (sd.index?.refs ?? []).map((r) => {
    const s = sd.snapshots[r.refId];
    return {
      id: r.refId, repo: sd.index!.repo, refName: r.refName, sha: r.sha, order: r.order, role: r.role, synthetic: r.synthetic,
      detectedVersions: s?.ref.detectedVersions ?? {}, inferredStep: s?.ref.inferredStep,
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    applications: structuredClone(sd.inventory.applications),
    refs,
    liveScans: {},
    findingStatus: {},
    checklistResults: {},
    extraChecklist: [],
    risks: structuredClone(sd.inventory.risks),
    waves: structuredClone(sd.inventory.waves),
    costInputs: structuredClone(sd.inventory.costInputs),
    goldenMasterResults: [],
    validationReviews: {},
    history: [{ at: new Date().toISOString(), actor: 'system', action: '시드 데이터 로드', target: 'workspace' }],
    aiResults: {},
    scoring: structuredClone(sd.scoring),
    viewpoint: 'architect',
    actor: '사용자',
  };
}

interface State {
  ws: Workspace | null;
  persistent: boolean;
  ready: boolean;
  init: (sd: StaticData) => Promise<void>;
  replace: (ws: Workspace) => void;
  reset: (sd: StaticData) => void;
  log: (action: string, target: string, note?: string) => void;
  setViewpoint: (v: Workspace['viewpoint']) => void;
  setActor: (a: string) => void;
  setChecklist: (appId: string, itemId: string, done: boolean, note?: string) => void;
  setFindingStatus: (key: string, status: FindingStatus) => void;
  upsertRisk: (r: Risk) => void;
  removeRisk: (id: string) => void;
  upsertWave: (w: Wave) => void;
  upsertApp: (a: Application) => void;
  setCost: (c: CostInput) => void;
  addGolden: (g: GoldenMasterResult) => void;
  requestStep: (appId: string, items: StaticData['checklist'], note: string) => GateResult;
  addLiveScan: (key: string, ref: GitRef, scan: ScanResult) => void;
  setReview: (key: string, v: 'fp' | 'fn' | 'ok' | null) => void;
  saveAi: (key: string, rec: Workspace['aiResults'][string]) => void;
  setScoring: (s: ScoringConfig) => void;
  addExtraChecklist: (items: ChecklistItem[]) => void;
}

export const useWs = create<State>((set, get) => {
  const patch = (fn: (w: Workspace) => Partial<Workspace>) => set((s) => (s.ws ? { ws: { ...s.ws, ...fn(s.ws) } } : s));
  const entry = (w: Workspace, action: string, target: string, note?: string) => [...w.history, { at: new Date().toISOString(), actor: w.actor, action, target, note }].slice(-500);

  return {
    ws: null,
    persistent: true,
    ready: false,
    async init(sd) {
      const saved = await dataStore.getWorkspace();
      set({ ws: saved ?? buildWorkspace(sd), ready: true, persistent: dataStore.persistent });
    },
    replace: (ws) => set({ ws: migrate(ws) }),
    reset(sd) {
      void dataStore.clear();
      set({ ws: buildWorkspace(sd) });
    },
    log: (action, target, note) => patch((w) => ({ history: entry(w, action, target, note) })),
    setViewpoint: (viewpoint) => patch(() => ({ viewpoint })),
    setActor: (actor) => patch(() => ({ actor })),
    setChecklist: (appId, itemId, done, note) =>
      patch((w) => {
        const k = checklistKey(appId, itemId);
        return {
          checklistResults: { ...w.checklistResults, [k]: { done, note: note ?? w.checklistResults[k]?.note } },
          history: entry(w, done ? '체크리스트 완료' : '체크리스트 해제', `${appId}/${itemId}`, note),
        };
      }),
    setFindingStatus: (key, status) =>
      patch((w) => ({ findingStatus: { ...w.findingStatus, [key]: status }, history: entry(w, `탐지 상태 → ${status}`, key) })),
    upsertRisk: (r) => patch((w) => ({ risks: w.risks.some((x) => x.id === r.id) ? w.risks.map((x) => (x.id === r.id ? r : x)) : [...w.risks, r], history: entry(w, '리스크 저장', r.id) })),
    removeRisk: (id) => patch((w) => ({ risks: w.risks.filter((r) => r.id !== id), history: entry(w, '리스크 삭제', id) })),
    upsertWave: (wv) => patch((w) => ({ waves: w.waves.some((x) => x.id === wv.id) ? w.waves.map((x) => (x.id === wv.id ? wv : x)) : [...w.waves, wv], history: entry(w, '웨이브 저장', wv.id) })),
    upsertApp: (a) => patch((w) => ({ applications: w.applications.some((x) => x.id === a.id) ? w.applications.map((x) => (x.id === a.id ? a : x)) : [...w.applications, a], history: entry(w, '애플리케이션 저장', a.id) })),
    setCost: (c) => patch((w) => ({ costInputs: w.costInputs.some((x) => x.appId === c.appId) ? w.costInputs.map((x) => (x.appId === c.appId ? c : x)) : [...w.costInputs, c] })),
    addGolden: (g) => patch((w) => ({ goldenMasterResults: [...w.goldenMasterResults, g], history: entry(w, '골든 마스터 결과 업로드', g.appId, `${g.scenarios.length}개 시나리오, 실패 ${g.scenarios.filter((s) => !s.passed).length}`) })),
    requestStep(appId, items, note) {
      const w = get().ws!;
      const app = w.applications.find((a) => a.id === appId)!;
      const gate = checkGate(w, app, items);
      if (!gate.ok) {
        patch((cur) => ({ history: entry(cur, `단계 전환 차단 (Step ${gate.from}→${gate.to ?? '-'})`, appId, gate.reasons.join(' / ')) }));
        return gate;
      }
      patch((cur) => ({
        applications: cur.applications.map((a) => (a.id === appId ? { ...a, currentStep: gate.to as Step } : a)),
        history: entry(cur, `단계 전환 확인 (Step ${gate.from}→${gate.to})`, appId, note),
      }));
      return gate;
    },
    addLiveScan: (key, ref, scan) =>
      patch((w) => ({
        liveScans: { ...w.liveScans, [key]: scan },
        refs: w.refs.some((r) => r.id === ref.id) ? w.refs.map((r) => (r.id === ref.id ? ref : r)) : [...w.refs, ref],
        history: entry(w, '라이브 스캔', ref.id, `탐지 ${scan.findings.length}건${scan.stats.truncated ? ' (일부 잘림)' : ''}`),
      })),
    setReview: (key, v) =>
      patch((w) => {
        const next = { ...w.validationReviews };
        if (v) next[key] = v;
        else delete next[key];
        return { validationReviews: next };
      }),
    saveAi: (key, rec) => patch((w) => ({ aiResults: { ...w.aiResults, [key]: rec } })),
    setScoring: (scoring) => patch(() => ({ scoring })),
    addExtraChecklist: (items) =>
      patch((w) => {
        const have = new Set(w.extraChecklist.map((i) => i.id));
        const fresh = items.filter((i) => !have.has(i.id));
        return { extraChecklist: [...w.extraChecklist, ...fresh], history: entry(w, 'AI 제안을 체크리스트에 반영', fresh.map((i) => i.appId).join(','), `${fresh.length}건`) };
      }),
  };
});

let timer: ReturnType<typeof setTimeout> | undefined;
useWs.subscribe((s, prev) => {
  if (!s.ws || s.ws === prev.ws) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await dataStore.saveWorkspace(s.ws!);
    if (useWs.getState().persistent !== dataStore.persistent) useWs.setState({ persistent: dataStore.persistent });
  }, 300);
});
