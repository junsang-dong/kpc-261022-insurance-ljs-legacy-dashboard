// 예시 저장소 고정 커밋(SHA) 스냅샷 대상 회귀 테스트 (명세 12장 · 14.4절 기대값, 주석·템플릿 제외 적용 후)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { RefDiff, Snapshot } from '../src/shared/types/index.ts';
import { isActive, validatePair } from '../src/shared/scoring/index.ts';

const dir = 'public/data/snapshots/eGovFramework__egovframe-web-sample';
const index = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8')) as {
  refs: { refId: string; sha: string; file: string }[];
  diffs: { from: string; to: string; file: string }[];
};
const snap = (id: string) => JSON.parse(readFileSync(`${dir}/${index.refs.find((r) => r.refId === id)!.file}`, 'utf8')) as Snapshot;
const count = (id: string, rule: string) => snap(id).findings.filter((f) => f.ruleId === rule && isActive(f)).length;

describe('고정 SHA', () => {
  it.each([
    ['4.1.x', '3b3cffcb726b'], ['4.2.x', 'e362bceeef42'], ['4.3.x', 'd5ec49f233cd'], ['5.0.x', 'f617f7287529'], ['main', '9dc46fdf8cc5'],
  ])('%s → %s', (id, sha) => expect(snap(id).ref.sha.startsWith(sha)).toBe(true));
});

describe('버전 자동 추출 (14.2절)', () => {
  it.each([
    ['4.1.x', { java: '1.8', spring: '5.3.20', egov: '4.1.0', servlet: '3.1' }],
    ['4.2.x', { java: '1.8', spring: '5.3.27', egov: '4.2.0', servlet: '3.1' }],
    ['4.3.x', { java: '1.8', spring: '5.3.37', egov: '4.3.0', servlet: '3.1' }],
    ['5.0.x', { java: '17', egov: '5.0.0', servlet: '5.0' }],
    ['main', { java: '17', spring: '6.2.11', egov: '5.0.1', servlet: '5.0' }],
  ])('%s', (id, expected) => expect(snap(id).ref.detectedVersions).toMatchObject(expected));

  it('추정 Step: 4.x 브리지는 2, 5.0.x·main은 4, 오버레이는 0', () => {
    expect(['4.1.x', '4.2.x', '4.3.x'].map((i) => snap(i).ref.inferredStep)).toEqual([2, 2, 2]);
    expect([snap('5.0.x').ref.inferredStep, snap('main').ref.inferredStep]).toEqual([4, 4]);
    expect(snap('overlay').ref.inferredStep).toBe(0);
  });
});

describe('인수 기준', () => {
  it('RULE-FW-020(iBATIS): 4.1.x 탐지, 4.3.x부터 0건', () => {
    expect(count('4.1.x', 'RULE-FW-020')).toBeGreaterThan(0);
    for (const id of ['4.3.x', '5.0.x', 'main']) expect(count(id, 'RULE-FW-020')).toBe(0);
  });
  it('RULE-FW-021(springmodules): 4.3.x까지 탐지, 5.0.x부터 0건', () => {
    for (const id of ['4.1.x', '4.2.x', '4.3.x']) expect(count(id, 'RULE-FW-021')).toBeGreaterThan(0);
    for (const id of ['5.0.x', 'main']) expect(count(id, 'RULE-FW-021')).toBe(0);
  });
  it('javax import: 4.1.x에서 3건 이상, 5.0.x부터 0건', () => {
    expect(count('4.1.x', 'RULE-FW-002')).toBeGreaterThanOrEqual(3);
    for (const id of ['5.0.x', 'main']) expect(count(id, 'RULE-FW-002')).toBe(0);
  });
  it('main의 주석 처리된 DBCP·log4jdbc는 탐지에 포함되지 않고 억제 항목으로만 남는다', () => {
    const f = snap('main').findings.filter((x) => x.ruleId === 'RULE-FW-013');
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.inComment || x.excluded)).toBe(true);
  });
  it('템플릿 POM(pom-core.xml, pom-web.xml)은 exclude 처리된다', () => {
    const f = snap('4.1.x').findings.filter((x) => /pom-(core|web)\.xml$/.test(x.filePath));
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.excluded)).toBe(true);
  });
  it('main에 To-Be 잔여 갭(RULE-CL-001~004)이 남아 있다', () => {
    for (const r of ['RULE-CL-001', 'RULE-CL-003', 'RULE-CL-004']) expect(count('main', r), r).toBeGreaterThan(0);
  });
  it('구 JSTL URI는 info이며 5.0.x·main에도 남는다', () => {
    expect(count('main', 'RULE-FW-023')).toBeGreaterThan(0);
  });
  it('오버레이는 가상 데이터이며 AIX/IBM 규칙이 탐지된다', () => {
    const o = snap('overlay');
    expect(o.synthetic).toBe(true);
    for (const r of ['RULE-OS-001', 'RULE-OS-002', 'RULE-OS-003', 'RULE-FW-001', 'RULE-FW-010', 'RULE-JDK-003', 'RULE-JDK-010']) {
      expect(count('overlay', r), r).toBeGreaterThan(0);
    }
  });
});

describe('규칙 검증 (14.6절)', () => {
  const diffOf = (from: string, to: string) => {
    const d = index.diffs.find((x) => x.from === from && x.to === to)!;
    return JSON.parse(readFileSync(`${dir}/${d.file}`, 'utf8')) as RefDiff;
  };
  it('4.3.x → 5.0.x: springmodules 탐지가 해소되고 diff 위치와 일치(TP)한다', () => {
    const v = validatePair(snap('4.3.x'), snap('5.0.x'), diffOf('4.3.x', '5.0.x'));
    const row = v.rows.find((r) => r.ruleId === 'RULE-FW-021')!;
    expect(row.resolved).toBe(row.from);
    expect(row.tp).toBe(row.resolved);
    expect(row.persisted).toBe(0);
  });
  it('5.0.x → main: 주석 안에서만 매치된 항목은 오탐 후보로 분리된다', () => {
    const v = validatePair(snap('5.0.x'), snap('main'), diffOf('5.0.x', 'main'));
    expect(v.rows.find((r) => r.ruleId === 'RULE-FW-013')!.fpCandidates.length).toBeGreaterThan(0);
  });
});
