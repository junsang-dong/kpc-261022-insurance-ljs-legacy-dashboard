import { GRADE_LABEL, type Grade } from '../../shared/scoring/index.ts';
import { STEP_NAMES } from '../../shared/types/index.ts';
import type { useAppImpacts } from '../../store/derived.ts';
import { fmtKRW } from '../../app/ui.tsx';
import { summaryMetrics } from '../summary/metrics.ts';

type Data = NonNullable<ReturnType<typeof useAppImpacts>>;

export function buildReportMarkdown(d: Data): string {
  const m = summaryMetrics(d);
  const { ws, sd, impacts } = d;
  const L: string[] = [];
  L.push('# 클라우드 마이그레이션 현황 보고서', '');
  L.push(`> 생성: ${new Date().toLocaleString('ko-KR')} · 확인자: ${ws.actor} · 규칙셋 ${sd.rulesetVersion}`);
  L.push('> 공개 저장소 분석 결과와 **가상 인벤토리**(◇)를 포함합니다. 영향도 점수는 의사결정 보조 지표이며, 단계 게이트는 체크리스트와 테스트로 판정합니다.', '');

  L.push('## 1. 요약', '');
  L.push(`- 애플리케이션 ${impacts.length}개 (실제 ${impacts.filter((i) => !i.app.synthetic).length}개 / 가상 인벤토리 ${impacts.filter((i) => i.app.synthetic).length}개), 평균 영향도 ${m.avgImpact}점`);
  L.push(`- 분석한 실제 Ref ${m.realRefCount}개 (오버레이 ${m.overlays.length}개는 가상 데이터로 분리)`);
  L.push(`- 열린 리스크 ${m.openRisks.length}건, DB 공유·웨이브 불일치 경고 ${m.warnings.length}건`, '');

  L.push('## 2. 전환 단계 분포', '', '| Step | 단계 | 앱 수 |', '|---|---|---|');
  m.stepDist.forEach((n, i) => L.push(`| ${i} | ${STEP_NAMES[i]} | ${n} |`));
  L.push('', '## 3. 영향도 등급', '', '| 등급 | 앱 수 |', '|---|---|');
  (Object.keys(m.gradeDist) as Grade[]).forEach((g) => L.push(`| ${GRADE_LABEL[g]} | ${m.gradeDist[g]} |`));

  L.push('', '## 4. 애플리케이션별 영향도', '', '| 앱 | 구분 | 단계 | 웨이브 | 점수 | 등급 | 예상 공수(h) | 근거 |', '|---|---|---|---|---|---|---|---|');
  for (const { app, impact, refId } of [...impacts].sort((a, b) => b.impact.total - a.impact.total)) {
    L.push(`| ${app.name} | ${app.synthetic ? '◇ 가상' : '실제'} | Step ${app.currentStep} | ${app.waveId ?? '-'} | ${impact.total} | ${GRADE_LABEL[impact.grade]} | ${impact.basis === 'scan' ? impact.effortHours : '-'} | ${impact.basis === 'scan' ? `스캔(${refId})` : impact.basis === 'assumed' ? '가정 점수' : '-'} |`);
  }

  L.push('', '## 5. Ref별 축 점수 (실제 데이터)', '', '| Ref | 추정 Step | OS | JDK | 프레임워크 | 클라우드 |', '|---|---|---|---|---|---|');
  for (const r of m.refTrend) L.push(`| ${r.refId} | ${r.step ?? '-'} | ${r.axes.os.score} | ${r.axes.jdk.score} | ${r.axes.framework.score} | ${r.axes.cloud.score} |`);

  L.push('', '## 6. 상위 리스크', '', '| 리스크 | 가능성×영향 | 상태 | 대응 |', '|---|---|---|---|');
  for (const r of m.openRisks.slice(0, 5)) L.push(`| ${r.title} | ${r.likelihood}×${r.impact}=${r.likelihood * r.impact} | ${r.status === 'mitigating' ? '대응 중' : '열림'} | ${r.mitigation || '-'} |`);
  if (!m.openRisks.length) L.push('| (없음) | | | |');

  L.push('', '## 7. 웨이브 일정', '', '| 웨이브 | 기간 | 앱 | 컷오버 시간 창 |', '|---|---|---|---|');
  for (const w of ws.waves) L.push(`| ${w.name} | ${w.start} ~ ${w.end} | ${ws.applications.filter((a) => a.waveId === w.id).map((a) => a.name).join(', ') || '-'} | ${w.cutoverWindow || '-'} |`);
  for (const w of m.warnings) L.push('', `> ⚠ ${w.dbId} 공유 앱(${w.appIds.join(', ')})이 서로 다른 웨이브(${w.waveIds.join(', ')})에 배정되어 있습니다.`);

  L.push('', '## 8. 비용 (입력 단가 기준 추정치)', '', `- 현행 연간 ${fmtKRW(m.cost.asisAnnual)} → 목표 연간 ${fmtKRW(m.cost.targetAnnual)}, 병행 운영 일시 ${fmtKRW(m.cost.parallel)} (비용 입력이 있는 ${m.cost.apps}개 앱, 가상 입력)`);
  L.push(`- ${sd.pricing.unitNote}`, '');
  return L.join('\n');
}

/** AI 초안 입력용 요약 (원문 코드는 포함하지 않는다) */
export function reportAiInput(d: Data) {
  const m = summaryMetrics(d);
  return {
    metrics: {
      applications: d.impacts.length,
      syntheticApplications: d.impacts.filter((i) => i.app.synthetic).length + '개 (가상 데이터)',
      avgImpact: m.avgImpact,
      stepDistribution: Object.fromEntries(m.stepDist.map((n, i) => [`Step ${i}`, n])),
      gradeDistribution: m.gradeDist,
      refTrend: m.refTrend.map((r) => ({ ref: r.refId, step: r.step, framework: r.axes.framework.score, cloud: r.axes.cloud.score })),
      cost: { ...m.cost, note: '입력 단가 기준 추정치, 가상 입력' },
      dbWaveWarnings: m.warnings,
    },
    risks: m.openRisks.slice(0, 10).map((r) => ({ title: r.title, score: r.likelihood * r.impact, status: r.status, mitigation: r.mitigation })),
    waves: d.ws.waves.map((w) => ({ name: w.name, start: w.start, end: w.end, apps: d.ws.applications.filter((a) => a.waveId === w.id).length })),
  };
}
