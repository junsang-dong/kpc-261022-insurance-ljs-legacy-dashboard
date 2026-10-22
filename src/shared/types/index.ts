export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Axis = 'os' | 'jdk' | 'framework' | 'cloud';
export type Step = 0 | 1 | 2 | 3 | 4 | 5;
export type FindingStatus = 'open' | 'in_progress' | 'resolved' | 'accepted';

export interface Rule {
  id: string;
  axis: Axis;
  title: string;
  pattern: string;
  fileTypes: string[];
  includeComments?: boolean;
  severity: Severity;
  effortHours: number;
  autoFixable: 0 | 1;
  guidance: string;
  /** 명세 카탈로그에 없는 확장 규칙 */
  extension?: boolean;
}

export interface RulesFile {
  rulesetVersion: string;
  rules: Rule[];
}

export interface DetectedVersions {
  java?: string;
  spring?: string;
  egov?: string;
  servlet?: string;
  dockerBase?: string;
  ciJava?: string;
}

export interface GitRef {
  id: string;
  repo: string;
  refName: string;
  sha: string;
  order: number;
  role: 'overlay' | 'baseline' | 'bridge' | 'target';
  synthetic: boolean;
  detectedVersions: DetectedVersions;
  inferredStep?: Step;
}

export interface Finding {
  ruleId: string;
  filePath: string;
  line: number;
  /** 최대 3줄 (공개 저장소) */
  snippet: string;
  /** 주석 안에서만 매치됨 (기본 제외 대상) */
  inComment?: boolean;
  /** exclude glob 대상 파일 */
  excluded?: boolean;
}

export interface ScanStats {
  filesScanned: number;
  durationMs: number;
  truncated: boolean;
  signals: { javaxImports: number; jakartaImports: number; oldEgovImports: number; newEgovImports: number };
}

export interface ScanResult {
  ref: Pick<GitRef, 'repo' | 'refName' | 'sha' | 'detectedVersions' | 'inferredStep'>;
  stats: ScanStats;
  findings: Finding[];
  rulesetVersion: string;
  /** 규칙별 활성 탐지 총건수 (findings가 잘렸어도 정확). 점수 계산에 사용 */
  ruleCounts?: Record<string, number>;
}

/** 스냅샷 파일 (public/data/snapshots/<repo>/<sha>.json) */
export interface Snapshot extends ScanResult {
  refId: string;
  role: GitRef['role'];
  order: number;
  synthetic: boolean;
}

export interface DiffLine {
  line: number;
  text: string;
}
export interface DiffFile {
  path: string;
  status: string;
  removed: DiffLine[];
  added: DiffLine[];
}
export interface RefDiff {
  fromSha: string;
  toSha: string;
  files: DiffFile[];
}

export interface ScoringConfig {
  severityWeights: Record<Severity, number>;
  normalization: Record<Axis, number>;
  weights: { os: number; jdk: number; framework: number; criticality: number; integration: number };
  grades: { medium: number; high: number; critical: number };
}

export interface Application {
  id: string;
  name: string;
  domain: string;
  criticality: 1 | 2 | 3 | 4 | 5;
  integrationComplexity: number; // 0~100 (가상 입력값)
  currentStep: Step;
  waveId?: string;
  refIds: string[];
  sharedDbIds: string[];
  synthetic: boolean;
  /** Ref가 없는 가상 앱의 가정 축 점수 */
  assumedAxisScores?: Partial<Record<Axis, number>>;
  asis: { os: string; jdk: string; egov: string; spring: string; was: string };
}

export interface ServerInfo { id: string; appId: string; hostname: string; os: string; arch: string; cores: number; memoryGb: number; avgCpu: number; peakCpu: number; synthetic: boolean }
export interface DbInfo { id: string; name: string; engine: string; sizeGb: number; license: string; synthetic: boolean }
export interface IntegrationInfo { id: string; appId: string; target: string; type: string; external: boolean; ipWhitelist: boolean; ready: 'todo' | 'requested' | 'ready'; synthetic: boolean }

export interface ChecklistItem {
  id: string;
  category: 'conversion' | 'cloud' | 'regulation';
  step?: Step;
  required: boolean;
  text: string;
  /** 자동 생성 항목의 근거 규칙 */
  ruleId?: string;
  /** 지정되면 해당 앱에만 적용 (AI 제안에서 반영한 항목 등) */
  appId?: string;
}

export interface Risk {
  id: string;
  appId?: string;
  waveId?: string;
  title: string;
  likelihood: 1 | 2 | 3 | 4 | 5;
  impact: 1 | 2 | 3 | 4 | 5;
  mitigation: string;
  owner: string;
  status: 'open' | 'mitigating' | 'closed';
  source?: 'manual' | 'ai' | 'gap';
}

export interface Wave {
  id: string;
  name: string;
  start: string;
  end: string;
  cutoverWindow: string;
  rollbackCriteria: string;
  owner: string;
}

export interface CostInput {
  appId: string;
  asisAnnual: number; // 원
  containers: number;
  vcpuPerContainer: number;
  memGbPerContainer: number;
  dbTier: string;
  dbGb: number;
  storageGb: number;
  egressGbMonth: number;
  parallelMonths: number;
}

export interface PricingConfig {
  currency: string;
  unitNote: string;
  vcpuMonth: number;
  memGbMonth: number;
  dbTiers: Record<string, number>;
  storageGbMonth: number;
  egressGb: number;
}

export interface GoldenMasterResult {
  appId: string;
  refId?: string;
  uploadedAt: string;
  scenarios: { id: string; passed: boolean; detail?: string }[];
}

export interface HistoryEntry { at: string; actor: string; action: string; target: string; note?: string }

export interface AiRecord { task: string; model: string; createdAt: string; output: unknown }

export interface Workspace {
  schemaVersion: number;
  applications: Application[];
  refs: GitRef[];
  /** 라이브 스캔 결과 캐시 (스냅샷 외) */
  liveScans: Record<string, ScanResult>;
  findingStatus: Record<string, FindingStatus>;
  checklistResults: Record<string, { done: boolean; note?: string }>;
  extraChecklist: ChecklistItem[];
  risks: Risk[];
  waves: Wave[];
  costInputs: CostInput[];
  goldenMasterResults: GoldenMasterResult[];
  validationReviews: Record<string, 'fp' | 'fn' | 'ok'>;
  history: HistoryEntry[];
  aiResults: Record<string, AiRecord>;
  scoring: ScoringConfig;
  viewpoint: 'architect' | 'pm' | 'exec';
  actor: string;
}

export const SCHEMA_VERSION = 1;
export const STEP_NAMES = ['기준선 확보', 'OS 축', '프레임워크 브리지', 'JDK 축', 'Jakarta 전환', '배포(클라우드)'] as const;
