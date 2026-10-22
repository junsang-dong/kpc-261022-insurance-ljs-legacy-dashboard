import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Card, GradeBadge, SyntheticBadge } from '../../app/ui.tsx';
import { checkGate, AXES } from '../../shared/scoring/index.ts';
import { STEP_NAMES, type ChecklistItem, type Risk } from '../../shared/types/index.ts';
import { checklistFor, scoreRef, useAppImpacts } from '../../store/derived.ts';
import { useWs } from '../../store/workspace.ts';
import { AiBadge } from '../../app/ui.tsx';
import { AiError, callAi, hashInput, useAssistant } from '../assistant/aiClient.ts';

interface Plan {
  summary: string;
  steps: { step: string; tasks: { title: string; relatedRuleIds: string[]; effortHours: number; prerequisite: string }[]; risks: string[] }[];
}

export function Board() {
  const d = useAppImpacts();
  const requestStep = useWs((s) => s.requestStep);
  const setContext = useAssistant((s) => s.setContext);
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  useEffect(() => setContext({ screen: '전환 경로 보드' }), [setContext]);
  if (!d) return null;
  const { impacts, sd, ws, refData } = d;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>전환 경로 보드</h1>
          <p>한 번에 하나의 축만 바꿉니다. 단계 전환은 필수 체크리스트 100% · 골든 마스터 실패 0건을 충족해야 기록됩니다.</p>
        </div>
      </div>
      <div className="board">
        {STEP_NAMES.map((name, step) => (
          <section className="col" key={step} aria-label={`Step ${step} ${name}`}>
            <h3>Step {step} · {name}</h3>
            {impacts.filter((i) => i.app.currentStep === step).map(({ app, impact }) => {
              const items = checklistFor(app, sd, ws, refData);
              const gate = checkGate(ws, app, items);
              return (
                <div className="kcard" key={app.id}>
                  <Link to={`/apps/${app.id}`}><strong>{app.name}</strong></Link> {app.synthetic && <SyntheticBadge text="가상" />}
                  <div style={{ margin: '4px 0' }}><GradeBadge grade={impact.grade} score={impact.total} /></div>
                  {step < 5 && (gate.ok ? <span className="badge b-ok">게이트 충족</span> : <span className="badge b-warn" title={gate.reasons.join('\n')}>게이트 차단 {gate.reasons.length}건</span>)}
                  {step < 5 && (
                    <div style={{ marginTop: 6 }}>
                      <button className="btn small" onClick={() => { const r = requestStep(app.id, items, '보드에서 전환 확인'); setMsg((m) => ({ ...m, [app.id]: { ok: r.ok, text: r.ok ? `Step ${r.to}로 전환` : r.reasons.join(' · ') } })); }}>
                        전환 확인 →
                      </button>
                    </div>
                  )}
                  {msg[app.id] && <div className={`small ${msg[app.id].ok ? '' : 'muted'}`} role="status">{msg[app.id].text}</div>}
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <PlanPanel />
    </>
  );
}

function PlanPanel() {
  const d = useAppImpacts();
  const { addExtraChecklist, upsertRisk, saveAi } = useWs();
  const [appId, setAppId] = useState('');
  const [refId, setRefId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [done, setDone] = useState('');

  const real = useMemo(() => (d ? [...d.refData.values()].sort((a, b) => a.ref.order - b.ref.order) : []), [d]);
  if (!d) return null;
  const { ws, sd } = d;
  const rid = refId || (real.find((r) => r.ref.id === 'main') ?? real[real.length - 1])?.ref.id;
  const rd = rid ? d.refData.get(rid) : undefined;
  const targetApp = ws.applications.find((a) => a.id === (appId || ws.applications.find((x) => x.refIds.includes(rid ?? ''))?.id));

  const input = rd
    ? (() => {
        const sc = scoreRef(rd, sd.rules, ws);
        return {
          ref: { repo: rd.ref.repo, refName: rd.ref.refName, sha: rd.ref.sha, synthetic: rd.ref.synthetic },
          detectedVersions: Object.fromEntries(Object.entries(rd.ref.detectedVersions).filter(([, v]) => v) as [string, string][]),
          axisScores: Object.fromEntries(AXES.map((a) => [a, sc.axes[a].score])),
          ruleCounts: [...sc.perRule.entries()].map(([ruleId, count]) => {
            const r = sd.rules.find((x) => x.id === ruleId)!;
            return { ruleId, title: r.title, count, severity: r.severity };
          }),
          target: 'Linux 10.x + Java 21 + eGov 5.x + Spring 6.2.x + 컨테이너(클라우드)',
        };
      })()
    : null;
  const key = input ? hashInput('migration_plan', input) : '';
  const rec = ws.aiResults[key];
  const plan = rec?.output as Plan | undefined;

  async function run() {
    if (!input) return;
    setBusy(true);
    setErr('');
    setDone('');
    setPicked(new Set());
    try {
      const { result, meta } = await callAi<Plan>('migration_plan', input);
      saveAi(key, { task: 'migration_plan', model: meta.model, createdAt: new Date().toISOString(), output: result });
    } catch (e) {
      setErr(e instanceof AiError ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  function apply() {
    if (!plan || !targetApp) return;
    const items: ChecklistItem[] = [];
    const risks: Risk[] = [];
    plan.steps.forEach((s, si) => {
      const step = Math.min(5, Math.max(0, Number(s.step.replace('STEP_', '')))) as ChecklistItem['step'];
      s.tasks.forEach((t, ti) => {
        if (picked.has(`t:${si}:${ti}`)) items.push({ id: `ai:${key}:${si}:${ti}`, category: 'conversion', step, required: false, appId: targetApp.id, text: `${t.title} (예상 ${t.effortHours}h) — AI 제안` });
      });
      s.risks.forEach((r, ri) => {
        if (picked.has(`r:${si}:${ri}`)) risks.push({ id: `R-AI-${key.slice(-6)}-${si}${ri}`, appId: targetApp.id, title: r, likelihood: 3, impact: 3, mitigation: '(검토 후 작성)', owner: ws.actor, status: 'open', source: 'ai' });
      });
    });
    if (items.length) addExtraChecklist(items);
    risks.forEach(upsertRisk);
    setDone(`체크리스트 ${items.length}건, 리스크 ${risks.length}건을 ${targetApp.name}에 반영했습니다 (선택한 항목만).`);
    setPicked(new Set());
  }

  return (
    <Card title="AI 전환 계획 초안" actions={rec && <AiBadge model={rec.model} at={rec.createdAt} />}>
      <p className="small muted">Ref 요약(버전·축별 점수·규칙별 건수)을 Claude에 보내 Step별 작업을 제안받습니다. 제안은 <strong>선택한 항목만</strong> 체크리스트·리스크에 반영되며 게이트 판정에는 쓰이지 않습니다.</p>
      <div className="row">
        <label className="field">분석 Ref
          <select value={rid ?? ''} onChange={(e) => { setRefId(e.target.value); setPicked(new Set()); }}>{real.map((r) => <option key={r.ref.id} value={r.ref.id}>{r.ref.id}{r.ref.synthetic ? ' (가상)' : ''}</option>)}</select>
        </label>
        <label className="field">반영 대상 앱
          <select value={targetApp?.id ?? ''} onChange={(e) => setAppId(e.target.value)}>{ws.applications.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </label>
        <button className="btn primary" style={{ alignSelf: 'end' }} onClick={run} disabled={busy || !input}>{busy ? '생성 중…' : plan ? '다시 생성' : '✦ 계획 생성'}</button>
      </div>
      {err && <Alert kind="bad">{err}</Alert>}
      {done && <Alert kind="ok">{done}</Alert>}
      {plan && (
        <div>
          <p>{plan.summary}</p>
          {plan.steps.map((s, si) => (
            <div key={si} className="kcard">
              <strong>{s.step.replace('STEP_', 'Step ')}</strong>
              {s.tasks.map((t, ti) => (
                <label key={ti} className="row" style={{ alignItems: 'flex-start', padding: '3px 0' }}>
                  <input type="checkbox" checked={picked.has(`t:${si}:${ti}`)} onChange={() => toggle(`t:${si}:${ti}`)} />
                  <span>{t.title} <span className="muted small">({t.effortHours}h · 선행: {t.prerequisite}{t.relatedRuleIds.length ? ` · ${t.relatedRuleIds.join(', ')}` : ''})</span></span>
                </label>
              ))}
              {s.risks.map((r, ri) => (
                <label key={ri} className="row" style={{ alignItems: 'flex-start', padding: '3px 0' }}>
                  <input type="checkbox" checked={picked.has(`r:${si}:${ri}`)} onChange={() => toggle(`r:${si}:${ri}`)} />
                  <span><span className="badge b-warn">리스크</span> {r}</span>
                </label>
              ))}
            </div>
          ))}
          <button className="btn primary" disabled={!picked.size || !targetApp} onClick={apply}>선택한 {picked.size}건 반영</button>
        </div>
      )}
    </Card>
  );
}
