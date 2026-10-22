import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Chart, themeColors } from '../../app/Chart.tsx';
import { Alert, Card, SeverityBadge, SyntheticBadge } from '../../app/ui.tsx';
import { AXES, AXIS_LABEL, gapChecklist, isActive, scoreFindings, validatePair } from '../../shared/scoring/index.ts';
import { STEP_NAMES } from '../../shared/types/index.ts';
import { buildRefData } from '../../store/derived.ts';
import { useStatic } from '../../store/staticData.ts';
import { useWs } from '../../store/workspace.ts';
import { useAssistant } from '../assistant/aiClient.ts';

export function RefCompare() {
  const { data: sd } = useStatic();
  const ws = useWs((s) => s.ws);
  const setContext = useAssistant((s) => s.setContext);
  useEffect(() => setContext({ screen: 'Git Ref 비교' }), [setContext]);
  const refs = useMemo(() => (sd && ws ? buildRefData(sd, ws) : null), [sd, ws]);
  if (!sd || !ws || !refs) return null;

  const list = [...refs.values()].sort((a, b) => a.ref.order - b.ref.order);
  if (!list.length) {
    return <><h1>Git Ref 비교</h1><Alert kind="warn">스냅샷이 없습니다. <code>npm run snapshot</code> 으로 생성하거나 설정에서 라이브 스캔을 실행하세요.</Alert></>;
  }
  const scored = new Map(list.map((r) => [r.ref.id, scoreFindings(r.ref.id, r.snap.findings, sd.rules, ws.scoring, ws.findingStatus)]));
  const c = themeColors();
  const ruleIds = sd.rules.filter((r) => list.some((x) => x.snap.findings.some((f) => f.ruleId === r.id))).map((r) => r.id);
  const cnt = (refId: string, ruleId: string) => refs.get(refId)!.snap.findings.filter((f) => f.ruleId === ruleId && isActive(f)).length;
  const supp = (refId: string, ruleId: string) => refs.get(refId)!.snap.findings.filter((f) => f.ruleId === ruleId && !isActive(f)).length;

  const real = list.filter((r) => !r.ref.synthetic);
  const option = {
    grid: { left: 36, right: 12, top: 30, bottom: 28 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, textStyle: { color: c.text } },
    xAxis: { type: 'category', data: real.map((r) => r.ref.id), axisLabel: { color: c.muted } },
    yAxis: { type: 'value', max: 100, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.line } } },
    series: AXES.map((a) => ({ name: AXIS_LABEL[a], type: 'line', symbolSize: 7, data: real.map((r) => scored.get(r.ref.id)!.axes[a].score) })),
  };

  const transitions = real.slice(0, -1).map((a, i) => {
    const b = real[i + 1];
    const diff = sd.diffs.find((d) => d.from === a.ref.id && d.to === b.ref.id)?.diff;
    const v = validatePair(a.snap, b.snap, diff);
    return { a, b, v };
  });

  const main = real[real.length - 1];
  const gaps = gapChecklist(main.snap.findings, sd.rules);
  const ver = (k: 'java' | 'spring' | 'egov' | 'servlet' | 'dockerBase' | 'ciJava', label: string) => (
    <tr><th>{label}</th>{list.map((r) => <td key={r.ref.id} className="mono small">{r.ref.detectedVersions[k] ?? '—'}</td>)}</tr>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Git Ref 비교</h1>
          <p>{sd.index?.repo} · 같은 규칙({sd.rulesetVersion})으로 분석한 Ref별 결과. 버전은 POM·web.xml·Dockerfile·CI에서 자동 추출했습니다. 괄호 안 숫자는 주석·exclude 때문에 제외된 건수입니다.</p>
        </div>
      </div>

      <Card title="추출된 버전과 추정 Step">
        <div className="table-wrap"><table>
          <thead><tr><th />{list.map((r) => <th key={r.ref.id}>{r.ref.id} {r.ref.synthetic && <SyntheticBadge />}<div className="mono muted small">{r.ref.sha.slice(0, 8)}</div></th>)}</tr></thead>
          <tbody>
            {ver('java', 'Java 타깃')}{ver('spring', 'Spring')}{ver('egov', '표준프레임워크')}{ver('servlet', 'Servlet')}{ver('dockerBase', 'Docker 베이스')}{ver('ciJava', 'CI java-version')}
            <tr><th>추정 Step</th>{list.map((r) => <td key={r.ref.id}>{r.ref.inferredStep !== undefined ? <strong>Step {r.ref.inferredStep}</strong> : '—'}<div className="small muted">{r.ref.inferredStep !== undefined ? STEP_NAMES[r.ref.inferredStep] : ''}</div></td>)}</tr>
            <tr><th>역할</th>{list.map((r) => <td key={r.ref.id} className="small">{{ overlay: '오버레이', baseline: '기준선', bridge: '브리지', target: '목표' }[r.ref.role]}</td>)}</tr>
          </tbody>
        </table></div>
        <p className="small muted">추정 Step은 제안값입니다 (jakarta 전환 완료 → 4, Java 17+ → 3, org.egovframe 사용 → 2, egovframework 사용 → 0).</p>
      </Card>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card title="축별 점수 추이 (실제 Ref)"><Chart option={option} label="Ref별 축 점수 추이 선 차트" /></Card>
        <Card title="Ref 간 변경과 해소된 탐지">
          {transitions.map(({ a, b, v }) => (
            <div key={`${a.ref.id}>${b.ref.id}`} style={{ marginBottom: 10 }}>
              <strong>{a.ref.id} → {b.ref.id}</strong> <span className="small muted">변경 파일 {v.filesChanged}개</span>
              <div className="small">
                {v.rows.filter((r) => r.resolved > 0).map((r) => <span key={r.ruleId} className="badge b-ok" style={{ marginRight: 4 }}>{r.ruleId} −{r.resolved}</span>)}
                {!v.rows.some((r) => r.resolved > 0) && <span className="muted">해소된 탐지 없음</span>}
              </div>
            </div>
          ))}
          <p className="small"><Link to="/validation">규칙 검증에서 diff 위치와 대조 →</Link></p>
        </Card>
      </div>

      <Card title="규칙별 탐지 건수">
        <div className="table-wrap"><table>
          <thead><tr><th>규칙</th><th>축</th><th>심각도</th>{list.map((r) => <th key={r.ref.id} className="num">{r.ref.id}{r.ref.synthetic ? ' ◇' : ''}</th>)}</tr></thead>
          <tbody>
            {ruleIds.map((id) => {
              const r = sd.rules.find((x) => x.id === id)!;
              return (
                <tr key={id}>
                  <td><span className="mono">{id}</span><div className="small muted">{r.title}</div></td>
                  <td>{r.axis}</td><td><SeverityBadge s={r.severity} /></td>
                  {list.map((x) => {
                    const n = cnt(x.ref.id, id), s = supp(x.ref.id, id);
                    return <td key={x.ref.id} className="num">{n === 0 ? <span className="muted">0</span> : <strong>{n}</strong>}{s > 0 && <span className="muted small"> (+{s})</span>}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <p className="small muted">◇ = 가상 데이터(레거시 오버레이). 실제 앱 통계와 분리되어 집계됩니다.</p>
      </Card>

      <Card title={`To-Be(Java 21 + 클라우드) 잔여 갭 — ${main.ref.id} 기준 (14.5절)`}>
        {gaps.length ? (
          <table><tbody>{gaps.map((g) => (
            <tr key={g.id}><td><span className="badge b-info">Step {g.step}</span></td><td>{g.text}</td><td className="num">{g.count}건</td><td><Link to={`/findings?ref=${main.ref.id}&rule=${g.ruleId}`}>근거</Link></td></tr>
          ))}</tbody></table>
        ) : <p className="muted">잔여 갭이 없습니다.</p>}
        <p className="small muted">이 항목은 앱 상세의 Step 4·5 체크리스트에 자동으로 포함됩니다. 헬스체크 분리·Ingress·로그 JSON 같은 정적 규칙으로 탐지되지 않는 항목은 체크리스트(Step 5)에서 수동으로 관리합니다.</p>
      </Card>
    </>
  );
}
