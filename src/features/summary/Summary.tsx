import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Chart, themeColors } from '../../app/Chart.tsx';
import { Alert, Card, GradeBadge, Help, Stat, SyntheticBadge, fmtKRW } from '../../app/ui.tsx';
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

  const sc = d.ws.scoring;
  // 도움말의 계산 예시: Ref 스캔 기반으로 점수가 계산된 앱 중 프레임워크 점수가 가장 높은 앱
  const ex = [...d.impacts].filter((i) => i.impact.basis === 'scan').sort((a, b) => b.impact.axes.framework.score - a.impact.axes.framework.score)[0];
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
        <Card title="전환 단계 분포 (Step 0~5)">
          <Chart option={stepOption} label="애플리케이션 전환 단계별 분포 막대 차트" />
          <Help>
            <p><strong>의미</strong> 각 애플리케이션이 전환 경로(Step 0~5)의 어느 단계에 있는지 세어 보여줍니다. 막대가 오른쪽(Step 5)으로 갈수록 전환이 진행된 것입니다.</p>
            <p><strong>계산</strong></p>
            <code className="formula">{`n_s = |{ 앱 a : currentStep(a) = s }|,  s = 0..5\nΣ n_s = 전체 앱 수 N (= ${d.impacts.length})`}</code>
            <ul>
              <li><code>currentStep</code>은 점수나 AI가 바꾸지 않습니다. 앱 상세·보드에서 <strong>단계 게이트</strong>(현재 단계 필수 체크리스트 100% 완료 AND 골든 마스터 실패 0건)를 통과해 전환을 기록할 때만 1씩 올라갑니다.</li>
              <li>Ref 분석으로 나오는 “추정 Step”(jakarta 전환 완료 → 4, Java 17+ → 3, org.egovframe 사용 → 2, egovframework 사용 → 0)은 참고용이며 이 차트에 반영되지 않습니다.</li>
              <li>Step 0 기준선 확보 · 1 OS · 2 프레임워크 브리지 · 3 JDK · 4 Jakarta · 5 배포(클라우드).</li>
            </ul>
          </Help>
        </Card>
        <Card title="영향도 등급 분포">
          <Chart option={gradeOption} label="영향도 등급별 애플리케이션 수 막대 차트" />
          <Help>
            <p><strong>의미</strong> 앱마다 “전환 시 얼마나 손이 많이 가고 위험한가”를 0~100점으로 계산한 뒤, 등급(Low~Critical)별로 앱 수를 센 것입니다. 점수는 의사결정 보조 지표이며 단계 게이트 판정에는 쓰이지 않습니다.</p>
            <p><strong>① 축별 점수</strong> (OS · JDK · 프레임워크 · 클라우드 각각)</p>
            <code className="formula">{`원점수 R_x = Σ  w(심각도(f)) × (1 − 자동변환(규칙(f)))      f ∈ 열린·진행 중 탐지\n축 점수 S_x = min(100, R_x ÷ N_x × 100)`}</code>
            <ul>
              <li>심각도 가중치 w: {(['critical', 'high', 'medium', 'low', 'info'] as const).map((k) => `${k} ${sc.severityWeights[k]}`).join(' · ')} (info는 점수 제외)</li>
              <li>자동변환 = 1이면(OpenRewrite 등으로 기계 변환 가능한 규칙) 원점수에서 제외, 0이면 전부 반영</li>
              <li>정규화 계수 N_x: OS {sc.normalization.os} · JDK {sc.normalization.jdk} · 프레임워크 {sc.normalization.framework} · 클라우드 {sc.normalization.cloud}</li>
              <li>주석·exclude 대상·해결·수용 처리된 탐지는 계산에서 빠집니다.</li>
            </ul>
            <p><strong>② 종합 영향도</strong></p>
            <code className="formula">{`종합 = ${sc.weights.os}×S_os + ${sc.weights.jdk}×S_jdk + ${sc.weights.framework}×S_framework\n     + ${sc.weights.criticality}×C + ${sc.weights.integration}×I\nC = (업무 중요도 − 1) ÷ 4 × 100,   I = 연계 복잡도 (0~100, 인벤토리 입력)`}</code>
            <p>클라우드 축은 Step 5 준비도로 따로 보여주며 종합 점수에는 넣지 않습니다. Ref가 없는 앱은 입력한 <em>가정 점수</em>(가상 값)를 S_x 대신 사용합니다.</p>
            <p><strong>③ 등급</strong> 0~{sc.grades.medium - 1} Low · {sc.grades.medium}~{sc.grades.high - 1} Medium · {sc.grades.high}~{sc.grades.critical - 1} High · {sc.grades.critical}~100 Critical</p>
            {ex && (
              <p><strong>계산 예</strong> {ex.app.name}({ex.refId}): 프레임워크 원점수 {ex.impact.axes.framework.raw} ÷ {sc.normalization.framework} × 100 → S_framework = {ex.impact.axes.framework.score}. 종합 = {sc.weights.os}×{ex.impact.axes.os.score} + {sc.weights.jdk}×{ex.impact.axes.jdk.score} + {sc.weights.framework}×{ex.impact.axes.framework.score} + {sc.weights.criticality}×{Math.round(ex.impact.criticalityScore)} + {sc.weights.integration}×{ex.impact.integrationScore} = <strong>{ex.impact.total}점 ({ex.impact.grade})</strong></p>
            )}
            <p className="muted">가중치·정규화 계수는 설정 → 점수 가중치(What-if)에서 바꿀 수 있고, 바꾸면 이 차트도 즉시 달라집니다.</p>
          </Help>
        </Card>
        <Card title="Ref별 축 점수 추이 (실제 데이터)">
          <Chart option={trendOption} label="Ref별 축 점수 추이 선 차트" />
          <Help>
            <p><strong>의미</strong> 예시 저장소의 브랜치(4.1.x → … → main)를 같은 규칙으로 분석했을 때, 축별 점수가 전환이 진행되며 어떻게 줄었는지 보여줍니다. 선이 내려가면 해당 축의 전환 작업이 코드에서 실제로 해소됐다는 뜻입니다.</p>
            <p><strong>계산</strong> 각 Ref r, 축 x마다 위 ①과 같은 식을 그 Ref의 탐지 결과에 적용합니다.</p>
            <code className="formula">{`S_x(r) = min(100, Σ w(심각도) × (1 − 자동변환) ÷ N_x × 100)\n          f ∈ Ref r의 열린 탐지 (축 x 규칙만)`}</code>
            <ul>
              <li>업무 중요도·연계 복잡도는 앱 속성이라 Ref 점수에 포함하지 않습니다 (종합 영향도와 다름).</li>
              <li>레거시 오버레이 Ref는 가상 데이터이므로 이 추이에서 제외합니다. Ref 비교 화면에서 별도 표시됩니다.</li>
              <li>값 0은 그 축에서 점수에 반영되는 탐지가 없다는 뜻입니다. 예: 5.0.x에서 프레임워크 축이 0이 되는 것은 javax→jakarta 전환과 springmodules 제거가 끝났기 때문입니다.</li>
              <li>클라우드 축은 오히려 오르거나 유지될 수 있습니다. 내장 DB·세션 의존·JDK 17 이미지 같은 Step 5 과제는 프레임워크 전환과 무관하게 남기 때문입니다.</li>
              <li>탐지 항목을 ‘해결’·‘수용’으로 처리하면 점수가 즉시 내려갑니다.</li>
            </ul>
          </Help>
        </Card>
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
