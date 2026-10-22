import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Chart, themeColors } from '../../app/Chart.tsx';
import { Alert, Card, GradeBadge, Stat, SyntheticBadge, fmtKRW } from '../../app/ui.tsx';
import { AXES, AXIS_LABEL, GRADE_LABEL, type Grade } from '../../shared/scoring/index.ts';
import { STEP_NAMES } from '../../shared/types/index.ts';
import { useAppImpacts } from '../../store/derived.ts';
import { useAssistant } from '../assistant/aiClient.ts';
import { summaryMetrics } from './metrics.ts';
import { useEffect } from 'react';

export function Summary() {
  const d = useAppImpacts();
  const setContext = useAssistant((s) => s.setContext);
  const m = useMemo(() => (d ? summaryMetrics(d) : null), [d]);
  useEffect(() => setContext({ screen: '요약 대시보드' }), [setContext]);
  if (!d || !m) return null;
  const c = themeColors();

  const stepOption = {
    grid: { left: 36, right: 12, top: 16, bottom: 52 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: STEP_NAMES.map((n, i) => `Step ${i}\n${n}`), axisLabel: { color: c.muted, fontSize: 11, interval: 0 } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.line } } },
    series: [{ type: 'bar', data: m.stepDist, itemStyle: { color: c.accent }, label: { show: true, position: 'top', color: c.text } }],
  };
  const grades = Object.keys(m.gradeDist) as Grade[];
  const gradeOption = {
    grid: { left: 110, right: 24, top: 8, bottom: 8 },
    tooltip: {},
    xAxis: { type: 'value', minInterval: 1, show: false },
    yAxis: { type: 'category', inverse: true, data: grades.map((g) => GRADE_LABEL[g]), axisLabel: { color: c.text, fontSize: 11.5 } },
    series: [{ type: 'bar', data: grades.map((g) => m.gradeDist[g]), itemStyle: { color: c.warn }, label: { show: true, position: 'right', color: c.text } }],
  };
  const trendOption = {
    grid: { left: 36, right: 12, top: 30, bottom: 28 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, textStyle: { color: c.text } },
    xAxis: { type: 'category', data: m.refTrend.map((r) => r.refId), axisLabel: { color: c.muted } },
    yAxis: { type: 'value', max: 100, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.line } } },
    series: AXES.map((a) => ({ name: AXIS_LABEL[a], type: 'line', symbolSize: 7, data: m.refTrend.map((r) => r.axes[a].score) })),
  };

  const realApps = d.impacts.filter((i) => !i.app.synthetic).length;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>요약 대시보드</h1>
          <p>예시 저장소 전환 이력과 인벤토리 현황. 점수는 의사결정 보조 지표이며 단계 게이트는 체크리스트·테스트로 판정합니다.</p>
        </div>
      </div>

      {m.warnings.length > 0 && (
        <Alert kind="warn">
          ⚠ 같은 DB를 공유하는데 웨이브가 다른 앱이 있습니다 ({m.warnings.map((w) => `${w.dbId}: ${w.appIds.join(', ')}`).join(' / ')}). <Link to="/waves">웨이브 계획에서 확인</Link>
        </Alert>
      )}

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Stat label="애플리케이션" value={d.impacts.length} sub={<>{realApps}개 실제 · {d.impacts.length - realApps}개 <SyntheticBadge text="가상 인벤토리" /></>} />
        <Stat label="분석된 Ref" value={m.realRefCount} sub={<>실제 공개 저장소 · 오버레이 {m.overlays.length}개는 <SyntheticBadge /> 로 분리</>} />
        <Stat label="평균 영향도" value={`${m.avgImpact}점`} sub="가상 인벤토리 포함 평균" />
        <Stat label="열린 리스크" value={m.openRisks.length} sub={m.openRisks[0] ? `최대 ${m.openRisks[0].likelihood * m.openRisks[0].impact}점` : '없음'} />
      </div>

      <div className="grid cols-3">
        <Card title="전환 단계 분포 (Step 0~5)"><Chart option={stepOption} label="애플리케이션 전환 단계별 분포 막대 차트" /></Card>
        <Card title="영향도 등급 분포"><Chart option={gradeOption} label="영향도 등급별 애플리케이션 수 막대 차트" /></Card>
        <Card title="Ref별 축 점수 추이 (실제 데이터)"><Chart option={trendOption} label="Ref별 축 점수 추이 선 차트" /></Card>
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card title="상위 리스크 5건" actions={<Link to="/risks">전체 보기</Link>}>
          <table>
            <thead><tr><th>리스크</th><th className="num">점수</th><th>상태</th></tr></thead>
            <tbody>
              {m.openRisks.slice(0, 5).map((r) => (
                <tr key={r.id}><td>{r.title}</td><td className="num">{r.likelihood}×{r.impact}={r.likelihood * r.impact}</td><td>{r.status === 'mitigating' ? '대응 중' : '열림'}</td></tr>
              ))}
              {!m.openRisks.length && <tr><td colSpan={3} className="muted">등록된 리스크가 없습니다.</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card title={<>비용 요약 <SyntheticBadge text="입력 단가 기준 추정치" /></>} actions={<Link to="/cost">상세</Link>}>
          <div className="grid cols-3">
            <div><div className="muted small">현행 연간</div><strong>{fmtKRW(m.cost.asisAnnual)}</strong></div>
            <div><div className="muted small">목표 연간</div><strong>{fmtKRW(m.cost.targetAnnual)}</strong></div>
            <div><div className="muted small">병행 비용</div><strong>{fmtKRW(m.cost.parallel)}</strong></div>
          </div>
          <p className="muted small">비용 입력이 있는 {m.cost.apps}개 앱 기준입니다. 단가는 사용자가 입력한 값이며 자동 조회하지 않습니다.</p>
        </Card>
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card title="웨이브 일정" actions={<Link to="/waves">계획</Link>}>
          <table>
            <thead><tr><th>웨이브</th><th>기간</th><th className="num">앱</th></tr></thead>
            <tbody>
              {d.ws.waves.map((w) => (
                <tr key={w.id}><td>{w.name}</td><td>{w.start} ~ {w.end}</td><td className="num">{d.ws.applications.filter((a) => a.waveId === w.id).length}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="영향도 상위 애플리케이션">
          <table>
            <thead><tr><th>앱</th><th>등급</th><th className="num">공수(h)</th></tr></thead>
            <tbody>
              {[...d.impacts].sort((a, b) => b.impact.total - a.impact.total).slice(0, 5).map(({ app, impact }) => (
                <tr key={app.id}>
                  <td><Link to={`/apps/${app.id}`}>{app.name}</Link> {app.synthetic && <SyntheticBadge />}</td>
                  <td><GradeBadge grade={impact.grade} score={impact.total} /></td>
                  <td className="num">{impact.basis === 'scan' ? impact.effortHours : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
