import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Chart, themeColors } from '../../app/Chart.tsx';
import { Alert, Card, GradeBadge, Progress, SeverityBadge, SyntheticBadge, Tabs, download } from '../../app/ui.tsx';
import { AXES, AXIS_LABEL, checklistKey, checkGate, computeImpact, GRADE_ADVICE, latestGolden, scoreFindings, validateGoldenJson } from '../../shared/scoring/index.ts';
import { STEP_NAMES, type ChecklistItem, type Step } from '../../shared/types/index.ts';
import { buildRefData, checklistFor, primaryRefId } from '../../store/derived.ts';
import { useStatic } from '../../store/staticData.ts';
import { useWs } from '../../store/workspace.ts';
import { useAssistant } from '../assistant/aiClient.ts';

const GOLDEN_SAMPLE = {
  scenarios: [
    { id: 'list-first-last-page', passed: true, detail: 'HTTP 200, 게시글 건수·ID 목록 일치' },
    { id: 'search-by-name-description', passed: true, detail: '결과 ID 목록 일치' },
    { id: 'create-valid', passed: true, detail: '리다이렉트, DB 신규 행 컬럼 값 일치' },
    { id: 'create-invalid-required-and-maxlength', passed: true, detail: '등록 거부, DB 행 수 불변' },
    { id: 'update-delete', passed: true, detail: 'DB 행 변경·삭제 결과 일치' },
    { id: 'korean-roundtrip', passed: true, detail: '한글 저장·조회 문자열 일치' },
  ],
};

export function AppDetail() {
  const { id } = useParams();
  const { data: sd } = useStatic();
  const ws = useWs((s) => s.ws);
  const { setChecklist, requestStep, addGolden } = useWs();
  const setContext = useAssistant((s) => s.setContext);
  const [refSel, setRefSel] = useState<string>('');
  const [cmpSel, setCmpSel] = useState<string>('');
  const [tab, setTab] = useState<'conversion' | 'cloud' | 'regulation'>('conversion');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const app = ws?.applications.find((a) => a.id === id);
  const refs = useMemo(() => (sd && ws ? buildRefData(sd, ws) : null), [sd, ws]);
  const defaultRef = app && refs ? primaryRefId(app, refs) : undefined;
  const refId = refSel || defaultRef;
  useEffect(() => setContext({ screen: '애플리케이션 상세', app: app?.id, refName: refId }), [setContext, app?.id, refId]);

  if (!sd || !ws || !app || !refs) return <p>애플리케이션을 찾을 수 없습니다. <Link to="/inventory">목록으로</Link></p>;

  const rd = refId ? refs.get(refId) : undefined;
  const scored = rd ? scoreFindings(rd.ref.id, rd.snap.findings, sd.rules, ws.scoring, ws.findingStatus) : null;
  const impact = computeImpact(app, scored?.axes ?? null, scored?.top ?? [], ws.scoring);
  const cmp = cmpSel ? refs.get(cmpSel) : undefined;
  const cmpScored = cmp ? scoreFindings(cmp.ref.id, cmp.snap.findings, sd.rules, ws.scoring, ws.findingStatus) : null;
  const c = themeColors();

  const items = checklistFor(app, sd, ws, refs, refId);
  const gate = checkGate(ws, app, items);
  const gm = latestGolden(ws.goldenMasterResults, app.id);
  const radar = {
    tooltip: {},
    legend: { bottom: 0, textStyle: { color: c.text } },
    radar: { indicator: AXES.map((a) => ({ name: AXIS_LABEL[a], max: 100 })), axisName: { color: c.text }, splitLine: { lineStyle: { color: c.line } }, axisLine: { lineStyle: { color: c.line } } },
    series: [{
      type: 'radar',
      data: [
        { name: refId ?? '가정 점수', value: AXES.map((a) => impact.axes[a].score), areaStyle: { opacity: 0.2 }, itemStyle: { color: c.accent } },
        ...(cmpScored ? [{ name: cmpSel, value: AXES.map((a) => cmpScored.axes[a].score), areaStyle: { opacity: 0.15 }, itemStyle: { color: c.warn } }] : []),
      ],
    }],
  };

  const done = (i: ChecklistItem) => ws.checklistResults[checklistKey(app.id, i.id)]?.done ?? false;
  const convSteps = [0, 1, 2, 3, 4, 5] as Step[];
  const listFor = (cat: typeof tab) => items.filter((i) => i.category === cat && (!i.appId || i.appId === app.id));
  const history = ws.history.filter((h) => h.target.includes(app.id)).slice().reverse().slice(0, 15);

  async function onUpload(f: File | undefined) {
    if (!f) return;
    try {
      const v = validateGoldenJson(JSON.parse(await f.text()));
      if (!v.ok) return setMsg({ kind: 'bad', text: v.error });
      addGolden({ appId: app!.id, refId, uploadedAt: new Date().toISOString(), scenarios: v.value });
      setMsg({ kind: 'ok', text: `골든 마스터 결과 ${v.value.length}건을 반영했습니다.` });
    } catch {
      setMsg({ kind: 'bad', text: 'JSON 파일을 읽지 못했습니다.' });
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  function transition() {
    const r = requestStep(app!.id, items, note);
    setMsg(r.ok ? { kind: 'ok', text: `Step ${r.from} → Step ${r.to} 전환을 기록했습니다.` } : { kind: 'bad', text: `전환 차단: ${r.reasons.join(' · ')}` });
    if (r.ok) setNote('');
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{app.name} {app.synthetic && <SyntheticBadge text="가상 인벤토리" />}</h1>
          <p className="mono">{app.id} · {app.domain} · 중요도 {app.criticality} · 현재 Step {app.currentStep} ({STEP_NAMES[app.currentStep]}) · 웨이브 {app.waveId ?? '미배정'}</p>
        </div>
        <div className="row">
          {app.refIds.length > 0 && (
            <>
              <label className="field">분석 기준 Ref
                <select value={refId ?? ''} onChange={(e) => setRefSel(e.target.value)}>{app.refIds.filter((r) => refs.has(r)).map((r) => <option key={r}>{r}</option>)}</select>
              </label>
              <label className="field">비교 Ref
                <select value={cmpSel} onChange={(e) => setCmpSel(e.target.value)}><option value="">없음</option>{app.refIds.filter((r) => refs.has(r) && r !== refId).map((r) => <option key={r}>{r}</option>)}</select>
              </label>
            </>
          )}
        </div>
      </div>

      <div className="grid cols-2">
        <Card title="축별 영향도" actions={<GradeBadge grade={impact.grade} score={impact.total} />}>
          <Chart option={radar} label="OS, JDK, 프레임워크, 클라우드 축별 영향도 레이더 차트" />
          <p className="small">권장: <strong>{GRADE_ADVICE[impact.grade]}</strong>. 권장 경로: {impact.recommendedPath.map((s) => s.replace('STEP_', 'Step ')).join(' → ')}</p>
          {impact.basis === 'assumed' && <Alert kind="info">이 앱은 Ref가 없어 <strong>가정 점수</strong>(가상 값)로 계산했습니다.</Alert>}
          {rd?.ref.synthetic && <Alert kind="info"><SyntheticBadge /> 오버레이 Ref 기준입니다. 정적 분석 검증용 가상 파일의 결과입니다.</Alert>}
        </Card>

        <Card title="점수 근거 보기">
          <table>
            <thead><tr><th>축</th><th className="num">점수</th><th className="num">건수</th><th className="num">공수(h)</th></tr></thead>
            <tbody>
              {AXES.map((a) => (
                <tr key={a}><td>{AXIS_LABEL[a]}{a === 'cloud' && <span className="muted small"> (종합 점수 제외)</span>}</td><td className="num">{impact.axes[a].score}</td><td className="num">{impact.axes[a].count}</td><td className="num">{impact.axes[a].effortHours.toFixed(1)}</td></tr>
              ))}
              <tr><td>업무 중요도</td><td className="num">{Math.round(impact.criticalityScore)}</td><td /><td /></tr>
              <tr><td>연계 복잡도</td><td className="num">{impact.integrationScore}</td><td /><td /></tr>
              <tr><th>종합 / 예상 공수</th><th className="num">{impact.total}</th><th /><th className="num">{impact.effortHours}</th></tr>
            </tbody>
          </table>
          <p className="small muted">종합 = 0.20×OS + 0.20×JDK + 0.30×프레임워크 + 0.15×업무 중요도 + 0.15×연계 복잡도 (가중치는 설정에서 What-if 조정). 클라우드 축은 Step 5 준비도로 별도 표시합니다.</p>
          {impact.top.length > 0 && (
            <>
              <h3>상위 탐지 규칙</h3>
              <table>
                <tbody>
                  {impact.top.slice(0, 6).map((t) => (
                    <tr key={t.ruleId}>
                      <td><Link to={`/findings?ref=${refId}&rule=${t.ruleId}`}>{t.ruleId}</Link></td>
                      <td>{t.title}</td><td><SeverityBadge s={t.severity} /></td><td className="num">{t.count}건</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small"><Link to={`/findings?ref=${refId}`}>탐지 결과 전체 보기 →</Link> (파일·라인·GitHub 링크까지 추적)</p>
            </>
          )}
        </Card>
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card title={`단계 전환 (Step ${app.currentStep} → ${app.currentStep < 5 ? app.currentStep + 1 : '—'})`}>
          {app.currentStep >= 5 ? <p>마지막 단계입니다.</p> : (
            <>
              <ul className="small" style={{ paddingLeft: 18 }}>
                <li>Step {app.currentStep} 필수 체크리스트: {items.filter((i) => i.category === 'conversion' && i.step === app.currentStep && i.required).filter(done).length} / {items.filter((i) => i.category === 'conversion' && i.step === app.currentStep && i.required).length}</li>
                <li>골든 마스터: {gm ? `${gm.scenarios.filter((s) => s.passed).length}/${gm.scenarios.length} 통과 (${new Date(gm.uploadedAt).toLocaleDateString('ko-KR')})` : '결과 없음'}</li>
              </ul>
              {!gate.ok && <Alert kind="warn">차단 사유: {gate.reasons.join(' · ')}</Alert>}
              {gate.ok && <Alert kind="ok">게이트 조건을 모두 충족했습니다.</Alert>}
              <label className="field">확인 메모<input type="text" value={note} placeholder="확인자 메모 (이력에 기록)" onChange={(e) => setNote(e.target.value)} /></label>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn primary" onClick={transition}>전환 확인 기록</button>
                <span className="small muted">확인자: {ws.actor}</span>
              </div>
            </>
          )}
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <h3>골든 마스터 결과 (F-12)</h3>
          <div className="row">
            <input ref={fileRef} type="file" accept="application/json,.json" aria-label="골든 마스터 결과 JSON 업로드" onChange={(e) => onUpload(e.target.files?.[0])} />
            <button className="btn small" onClick={() => download('golden-master-sample.json', JSON.stringify(GOLDEN_SAMPLE, null, 2), 'application/json')}>형식 예시 받기</button>
          </div>
          {gm && (
            <table style={{ marginTop: 8 }}>
              <tbody>{gm.scenarios.map((s) => <tr key={s.id}><td className="mono">{s.id}</td><td>{s.passed ? <span className="badge b-ok">통과</span> : <span className="badge b-bad">실패</span>}</td><td className="small muted">{s.detail}</td></tr>)}</tbody>
            </table>
          )}
        </Card>

        <Card title="체크리스트">
          <Tabs value={tab} onChange={setTab} items={[{ id: 'conversion', label: 'Conversion' }, { id: 'cloud', label: 'Cloud' }, { id: 'regulation', label: '규제·보안' }]} />
          {tab === 'conversion'
            ? convSteps.map((s) => {
                const list = listFor('conversion').filter((i) => i.step === s);
                if (!list.length) return null;
                const n = list.filter(done).length;
                return (
                  <details key={s} open={s === app.currentStep} style={{ marginBottom: 6 }}>
                    <summary>Step {s} · {STEP_NAMES[s]} <span className="muted small">({n}/{list.length}){s === app.currentStep ? ' ← 현재' : ''}</span></summary>
                    <Progress value={n} max={list.length} />
                    {list.map((i) => <CheckRow key={i.id} item={i} appId={app.id} checked={done(i)} onChange={(v) => setChecklist(app.id, i.id, v)} />)}
                  </details>
                );
              })
            : listFor(tab).map((i) => <CheckRow key={i.id} item={i} appId={app.id} checked={done(i)} onChange={(v) => setChecklist(app.id, i.id, v)} />)}
        </Card>
      </div>

      <Card title="확인 이력" className="" >
        {history.length ? (
          <table><tbody>{history.map((h, i) => (<tr key={i}><td className="small muted" style={{ whiteSpace: 'nowrap' }}>{new Date(h.at).toLocaleString('ko-KR')}</td><td>{h.actor}</td><td>{h.action}</td><td className="small muted">{h.note}</td></tr>))}</tbody></table>
        ) : <p className="muted">이력이 없습니다.</p>}
      </Card>
    </>
  );
}

function CheckRow({ item, appId, checked, onChange }: { item: ChecklistItem; appId: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row" style={{ padding: '3px 0', alignItems: 'flex-start' }} htmlFor={`${appId}-${item.id}`}>
      <input id={`${appId}-${item.id}`} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{item.text}{item.ruleId && <span className="badge b-info" style={{ marginLeft: 6 }}>잔여 갭 · 자동 생성</span>}{item.required ? '' : ' (선택)'}</span>
    </label>
  );
}
