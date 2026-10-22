import { useQuery } from '@tanstack/react-query';
import type {
  ChecklistItem, DbInfo, GitRef, IntegrationInfo, PricingConfig, RefDiff, Risk, Rule, RulesFile, ScoringConfig, ServerInfo, Snapshot, Wave, Application, CostInput,
} from '../shared/types/index.ts';

export interface Inventory {
  waves: Wave[];
  dbs: DbInfo[];
  applications: Application[];
  servers: ServerInfo[];
  integrations: IntegrationInfo[];
  costInputs: CostInput[];
  risks: Risk[];
}
export interface SnapshotIndex {
  repo: string;
  rulesetVersion: string;
  generatedAt: string;
  refs: { refId: string; refName: string; sha: string; order: number; role: GitRef['role']; synthetic: boolean; file: string }[];
  diffs: { from: string; to: string; fromSha: string; toSha: string; file: string }[];
}
export interface RefsConfig { repo: string; includeGlobs: string[]; excludeGlobs: string[] }

export interface StaticData {
  rules: Rule[];
  rulesetVersion: string;
  checklist: ChecklistItem[];
  pricing: PricingConfig;
  scoring: ScoringConfig;
  inventory: Inventory;
  refsConfig: RefsConfig;
  index: SnapshotIndex | null;
  snapshots: Record<string, Snapshot>;
  diffs: { from: string; to: string; diff: RefDiff }[];
}

const get = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} (${r.status})`);
  return r.json() as Promise<T>;
};

export async function loadStatic(): Promise<StaticData> {
  const [rf, cl, pricing, scoring, inventory, refsConfig] = await Promise.all([
    get<RulesFile>('/data/rules.json'),
    get<{ items: ChecklistItem[] }>('/data/seed/checklists.json'),
    get<PricingConfig>('/data/seed/pricing.json'),
    get<ScoringConfig>('/data/seed/scoring.json'),
    get<Inventory>('/data/seed/inventory.json'),
    get<RefsConfig>('/data/seed/refs.json'),
  ]);
  let index: SnapshotIndex | null = null;
  const snapshots: Record<string, Snapshot> = {};
  const diffs: StaticData['diffs'] = [];
  try {
    const dir = `/data/snapshots/${refsConfig.repo.replace('/', '__')}`;
    index = await get<SnapshotIndex>(`${dir}/index.json`);
    await Promise.all([
      ...index.refs.map(async (r) => (snapshots[r.refId] = await get<Snapshot>(`${dir}/${r.file}`))),
      ...index.diffs.map(async (d) => diffs.push({ from: d.from, to: d.to, diff: await get<RefDiff>(`${dir}/${d.file}`) })),
    ]);
  } catch {
    index = null; // 스냅샷이 없으면 라이브 모드로만 사용할 수 있다
  }
  return { rules: rf.rules, rulesetVersion: rf.rulesetVersion, checklist: cl.items, pricing, scoring, inventory, refsConfig, index, snapshots, diffs };
}

export function useStatic() {
  return useQuery({ queryKey: ['static-data'], queryFn: loadStatic, staleTime: Infinity, retry: 1 });
}
