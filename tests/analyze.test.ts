import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGithubInput, PRESETS } from '../src/features/analyze/analysis.ts';
import { scoreFindings } from '../src/shared/scoring/index.ts';
import { DEFAULT_SCORING } from '../src/store/defaults.ts';
import { analysisAppId, analysisRefId, useWs } from '../src/store/workspace.ts';
import type { Finding, RulesFile, ScanResult, Workspace } from '../src/shared/types/index.ts';

const rules = (JSON.parse(readFileSync('public/data/rules.json', 'utf8')) as RulesFile).rules;

describe('GitHub URL 파싱', () => {
  it.each([
    ['https://github.com/eGovFramework/egovframe-web-sample', 'eGovFramework/egovframe-web-sample', undefined],
    ['https://github.com/eGovFramework/egovframe-web-sample.git', 'eGovFramework/egovframe-web-sample', undefined],
    ['https://github.com/o/r/', 'o/r', undefined],
    ['github.com/o/r', 'o/r', undefined],
    ['o/r', 'o/r', undefined],
    ['https://github.com/o/r/tree/4.1.x', 'o/r', '4.1.x'],
    ['https://github.com/o/r/tree/release/1.0', 'o/r', 'release/1.0'],
    ['  https://www.github.com/o/my.repo-x?tab=readme  ', 'o/my.repo-x', undefined],
  ])('%s', (input, repo, ref) => {
    expect(parseGithubInput(input)).toEqual(ref ? { repo, ref } : { repo, ref: undefined });
  });
  it('github.com이 아니거나 형식이 틀리면 오류', () => {
    for (const bad of ['', 'https://gitlab.com/o/r', 'git@bitbucket.org:o/r.git', 'hello', 'https://github.com/onlyowner']) {
      expect('error' in parseGithubInput(bad), bad).toBe(true);
    }
  });
  it('예시 저장소는 모두 올바른 형식이다', () => {
    expect(PRESETS).toHaveLength(5);
    for (const p of PRESETS) expect(parseGithubInput(`https://github.com/${p.repo}`)).toMatchObject({ repo: p.repo });
  });
});

describe('잘린 스캔의 점수 계산 (ruleCounts)', () => {
  const f = (n: number): Finding[] => Array.from({ length: n }, (_, i) => ({ ruleId: 'RULE-FW-021', filePath: 'a.xml', line: i + 1, snippet: 'x' }));
  it('보관된 건수가 아니라 총건수로 계산한다', () => {
    const kept = scoreFindings('r', f(10), rules, DEFAULT_SCORING);
    const full = scoreFindings('r', f(10), rules, DEFAULT_SCORING, {}, { 'RULE-FW-021': 100 });
    expect(kept.axes.framework.count).toBe(10);
    expect(full.axes.framework.count).toBe(100);
    expect(full.axes.framework.raw).toBe(100 * 5); // high = 5
  });
  it('수용/해결 처리한 건수는 총건수에서 차감한다', () => {
    const st = { 'r:RULE-FW-021:a.xml:1': 'accepted', 'r:RULE-FW-021:a.xml:2': 'resolved' } as const;
    const s = scoreFindings('r', f(10), rules, DEFAULT_SCORING, st, { 'RULE-FW-021': 100 });
    expect(s.axes.framework.count).toBe(98);
  });
});

const scan = (refName: string, sha: string, counts: Record<string, number>): ScanResult => ({
  ref: { repo: 'o/r', refName, sha, detectedVersions: { java: '1.8', spring: '4.0.9.RELEASE', egov: '3.5.0' }, inferredStep: 0 },
  stats: { filesScanned: 3, durationMs: 5, truncated: false, signals: { javaxImports: 0, jakartaImports: 0, oldEgovImports: 0, newEgovImports: 0 } },
  findings: [],
  rulesetVersion: 'x',
  ruleCounts: counts,
});
const empty = (): Workspace => ({
  schemaVersion: 1, applications: [], refs: [], liveScans: {}, findingStatus: {}, checklistResults: {}, extraChecklist: [], risks: [], waves: [], costInputs: [],
  goldenMasterResults: [], validationReviews: {}, history: [], aiResults: {}, scoring: DEFAULT_SCORING, viewpoint: 'architect', actor: 't',
});

describe('분석 결과 자동 등록', () => {
  it('저장소당 앱 1개, Ref는 이어서 추가된다 (첫 Ref=기준선)', () => {
    useWs.setState({ ws: empty() });
    const id = useWs.getState().addAnalysis(scan('master', 'a'.repeat(40), { 'RULE-FW-001': 5 }));
    expect(id).toBe(analysisAppId('o/r'));
    useWs.getState().addAnalysis(scan('4.x', 'b'.repeat(40), {}));
    const ws = useWs.getState().ws!;
    expect(ws.applications).toHaveLength(1);
    expect(ws.applications[0]).toMatchObject({ id, synthetic: false, currentStep: 0, refIds: [analysisRefId('o/r', 'master'), analysisRefId('o/r', '4.x')] });
    expect(ws.applications[0].asis).toMatchObject({ jdk: 'Java 1.8', egov: '3.5.0', spring: '4.0.9.RELEASE' });
    expect(ws.refs.map((r) => r.role)).toEqual(['baseline', 'target']);
  });
  it('같은 Ref를 다시 분석하면 중복 없이 갱신된다', () => {
    useWs.setState({ ws: empty() });
    const st = useWs.getState();
    st.addAnalysis(scan('master', 'a'.repeat(40), { 'RULE-FW-001': 5 }));
    st.addAnalysis(scan('master', 'c'.repeat(40), { 'RULE-FW-001': 1 }));
    const ws = useWs.getState().ws!;
    expect(ws.refs).toHaveLength(1);
    expect(ws.refs[0].sha).toBe('c'.repeat(40));
    expect(ws.applications[0].refIds).toHaveLength(1);
  });
  it('삭제하면 앱·Ref·스캔·체크리스트·리스크가 함께 지워진다', () => {
    useWs.setState({ ws: empty() });
    const id = useWs.getState().addAnalysis(scan('master', 'a'.repeat(40), {}));
    useWs.getState().setChecklist(id, 'c0-1', true);
    useWs.getState().upsertRisk({ id: 'R1', appId: id, title: 't', likelihood: 1, impact: 1, mitigation: '', owner: '', status: 'open' });
    useWs.getState().removeAnalysis(id);
    const ws = useWs.getState().ws!;
    expect([ws.applications, ws.refs, ws.risks].map((x) => x.length)).toEqual([0, 0, 0]);
    expect(Object.keys(ws.liveScans)).toHaveLength(0);
    expect(Object.keys(ws.checklistResults)).toHaveLength(0);
  });
});
