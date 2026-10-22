import { describe, expect, it } from 'vitest';
import { maskDeep, maskText, limitLines } from '../api/_lib/redact.ts';
import { checkGate, computeCost, computeImpact, scoreFindings, validateGoldenJson, gradeOf } from '../src/shared/scoring/index.ts';
import { DEFAULT_SCORING } from '../src/store/defaults.ts';
import type { Application, ChecklistItem, Finding, Rule } from '../src/shared/types/index.ts';

describe('마스킹 (4.7.4절)', () => {
  it('이메일·전화번호·주민번호·IP·계정 문자열을 가린다', () => {
    const out = maskText('문의 kim@example.com 010-1234-5678 900101-1234567 10.1.2.3 password=hunter2 <property name="username" value="admin"/>');
    expect(out).not.toMatch(/kim@example\.com|010-1234-5678|900101-1234567|10\.1\.2\.3|hunter2|admin/);
    expect(out).toContain('[EMAIL]');
    expect(out).toContain('[PHONE]');
    expect(out).toContain('[RRN]');
    expect(out).toContain('[IP]');
  });
  it('중첩 객체의 문자열도 마스킹하고 숫자는 보존한다', () => {
    const out = maskDeep({ a: { b: ['x@y.com'] }, n: 3 });
    expect(out).toEqual({ a: { b: ['[EMAIL]'] }, n: 3 });
  });
  it('스니펫은 20줄로 제한한다', () => {
    expect(limitLines(Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n'), 20).split('\n')).toHaveLength(20);
  });
});

const rule = (id: string, axis: Rule['axis'], severity: Rule['severity'], autoFixable: 0 | 1 = 0, effortHours = 1): Rule => ({
  id, axis, severity, autoFixable, effortHours, title: id, pattern: 'x', fileTypes: ['java'], guidance: '',
});
const find = (ruleId: string, line: number, extra: Partial<Finding> = {}): Finding => ({ ruleId, filePath: 'A.java', line, snippet: '', ...extra });

describe('영향도 점수 (4.3절)', () => {
  const rules = [rule('H', 'framework', 'high', 0, 4), rule('I', 'framework', 'info'), rule('A', 'framework', 'medium', 1)];
  it('info·자동변환·주석 탐지는 점수에서 제외한다', () => {
    const { axes } = scoreFindings('r', [find('H', 1), find('I', 2), find('A', 3), find('H', 4, { inComment: true })], rules, DEFAULT_SCORING);
    expect(axes.framework.count).toBe(2); // H(1) + A(1), info·주석 제외
    expect(axes.framework.raw).toBe(5); // high 5 + medium 2×(1-1)
    expect(axes.framework.effortHours).toBe(4);
  });
  it('수용/해결 처리된 탐지는 제외한다', () => {
    const { axes } = scoreFindings('r', [find('H', 1)], rules, DEFAULT_SCORING, { 'r:H:A.java:1': 'accepted' });
    expect(axes.framework.count).toBe(0);
  });
  it('종합 점수는 가중합이며 등급 경계를 따른다', () => {
    const app = { criticality: 5, integrationComplexity: 100 } as Application;
    const axes = { os: { score: 100, raw: 0, count: 0, effortHours: 0 }, jdk: { score: 100, raw: 0, count: 0, effortHours: 0 }, framework: { score: 100, raw: 0, count: 0, effortHours: 0 }, cloud: { score: 0, raw: 0, count: 0, effortHours: 0 } };
    const imp = computeImpact(app, axes, [], DEFAULT_SCORING);
    expect(imp.total).toBe(100);
    expect(imp.grade).toBe('Critical');
    expect([29, 30, 59, 60, 79, 80].map((s) => gradeOf(s, DEFAULT_SCORING))).toEqual(['Low', 'Medium', 'Medium', 'High', 'High', 'Critical']);
  });
});

describe('단계 게이트 (4.4절)', () => {
  const items: ChecklistItem[] = [
    { id: 'c0-1', category: 'conversion', step: 0, required: true, text: 'a' },
    { id: 'c0-2', category: 'conversion', step: 0, required: true, text: 'b' },
    { id: 'c1-1', category: 'conversion', step: 1, required: true, text: 'c' },
  ];
  const app = { id: 'APP', currentStep: 0 } as Application;
  const pass = { scenarios: [{ id: 's1', passed: true }] };
  it('필수 항목이 미완료이면 차단한다', () => {
    const g = checkGate({ checklistResults: { 'APP:c0-1': { done: true } }, goldenMasterResults: [{ appId: 'APP', uploadedAt: '2026-01-01', ...pass }] }, app, items);
    expect(g.ok).toBe(false);
    expect(g.reasons[0]).toContain('1/2');
  });
  it('골든 마스터가 없거나 실패가 있으면 차단한다', () => {
    const done = { 'APP:c0-1': { done: true }, 'APP:c0-2': { done: true } };
    expect(checkGate({ checklistResults: done, goldenMasterResults: [] }, app, items).ok).toBe(false);
    const failing = [{ appId: 'APP', uploadedAt: 'x', scenarios: [{ id: 's', passed: false }] }];
    expect(checkGate({ checklistResults: done, goldenMasterResults: failing }, app, items).reasons.join()).toContain('실패 1건');
    expect(checkGate({ checklistResults: done, goldenMasterResults: [{ appId: 'APP', uploadedAt: 'x', ...pass }] }, app, items)).toMatchObject({ ok: true, to: 1 });
  });
  it('골든 마스터 JSON 형식을 검증한다 (14.7절)', () => {
    expect(validateGoldenJson({ scenarios: [{ id: 'list', passed: true }] }).ok).toBe(true);
    expect(validateGoldenJson({ scenarios: [{ id: 1 }] }).ok).toBe(false);
    expect(validateGoldenJson({}).ok).toBe(false);
  });
});

describe('비용 (4.6절)', () => {
  it('입력 단가 기준으로 월 비용·병행 비용을 계산한다', () => {
    const c = computeCost(
      { appId: 'a', asisAnnual: 1_200_000, containers: 2, vcpuPerContainer: 2, memGbPerContainer: 4, dbTier: 'small', dbGb: 10, storageGb: 20, egressGbMonth: 100, parallelMonths: 3 },
      { currency: 'KRW', unitNote: '', vcpuMonth: 1000, memGbMonth: 100, dbTiers: { small: 5000 }, storageGbMonth: 10, egressGb: 5 },
    );
    expect(c.compute).toBe(2 * (2 * 1000 + 4 * 100));
    expect(c.targetMonthly).toBe(4800 + 5000 + 100 + 200 + 500);
    expect(c.parallel).toBe(c.targetMonthly * 3);
  });
});
