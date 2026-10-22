import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, SeverityBadge, SyntheticBadge } from '../../app/ui.tsx';
import { findingKey, isActive } from '../../shared/scoring/index.ts';
import type { FindingStatus } from '../../shared/types/index.ts';
import { buildRefData } from '../../store/derived.ts';
import { useStatic } from '../../store/staticData.ts';
import { useWs } from '../../store/workspace.ts';
import { useAssistant } from '../assistant/aiClient.ts';
import { ExplainFinding } from '../assistant/ExplainFinding.tsx';

const PAGE = 100;
const STATUS: Record<FindingStatus, string> = { open: '열림', in_progress: '진행 중', resolved: '해결', accepted: '수용' };

export function Findings() {
  const { data: sd } = useStatic();
  const ws = useWs((s) => s.ws);
  const setStatus = useWs((s) => s.setFindingStatus);
  const setContext = useAssistant((s) => s.setContext);
  const [sp, setSp] = useSearchParams();
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const refs = useMemo(() => (sd && ws ? buildRefData(sd, ws) : null), [sd, ws]);

  const refId = sp.get('ref') ?? [...(refs?.keys() ?? [])].find((k) => k === '4.1.x') ?? [...(refs?.keys() ?? [])][0] ?? '';
  const rule = sp.get('rule') ?? '';
  const axis = sp.get('axis') ?? '';
  const sev = sp.get('sev') ?? '';
  const st = sp.get('st') ?? '';
  const suppressed = sp.get('suppressed') === '1';
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
    setPage(0);
  };
  useEffect(() => setContext({ screen: '탐지 결과', refName: refId }), [setContext, refId]);

  const rd = refs?.get(refId);
  const byRule = useMemo(() => new Map(sd?.rules.map((r) => [r.id, r])), [sd]);
  const rows = useMemo(() => {
    if (!rd || !ws) return [];
    return rd.snap.findings.filter((f) => {
      const r = byRule.get(f.ruleId);
      if (!r) return false;
      if (!suppressed && !isActive(f)) return false;
      if (rule && f.ruleId !== rule) return false;
      if (axis && r.axis !== axis) return false;
      if (sev && r.severity !== sev) return false;
      if (st && (ws.findingStatus[findingKey(rd.ref.id, f)] ?? 'open') !== st) return false;
      if (q && !f.filePath.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [rd, ws, byRule, suppressed, rule, axis, sev, st, q]);

  if (!sd || !ws || !refs) return null;
  const link = (path: string, line: number) => (rd && !rd.ref.synthetic ? `https://github.com/${rd.ref.repo}/blob/${rd.ref.sha}/${path}#L${line}` : null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>탐지 결과</h1>
          <p>규칙·파일·라인 단위로 점수의 근거를 추적합니다. 주석·템플릿 POM 등 억제된 항목은 기본적으로 숨깁니다.</p>
        </div>
      </div>
      <Card>
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="field">Ref
            <select value={refId} onChange={(e) => set('ref', e.target.value)}>{[...refs.values()].sort((a, b) => a.ref.order - b.ref.order).map((r) => <option key={r.ref.id} value={r.ref.id}>{r.ref.id}{r.ref.synthetic ? ' (가상)' : ''}</option>)}</select>
          </label>
          <label className="field">규칙<select value={rule} onChange={(e) => set('rule', e.target.value)}><option value="">전체</option>{sd.rules.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}</select></label>
          <label className="field">축<select value={axis} onChange={(e) => set('axis', e.target.value)}><option value="">전체</option>{['os', 'jdk', 'framework', 'cloud'].map((a) => <option key={a}>{a}</option>)}</select></label>
          <label className="field">심각도<select value={sev} onChange={(e) => set('sev', e.target.value)}><option value="">전체</option>{['critical', 'high', 'medium', 'low', 'info'].map((a) => <option key={a}>{a}</option>)}</select></label>
          <label className="field">상태<select value={st} onChange={(e) => set('st', e.target.value)}><option value="">전체</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field">파일 검색<input type="text" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} /></label>
          <label className="row small" style={{ alignSelf: 'end' }}><input type="checkbox" checked={suppressed} onChange={(e) => set('suppressed', e.target.checked ? '1' : '')} />억제 항목 표시 (주석·exclude)</label>
        </div>
        {rd?.ref.synthetic && <p><SyntheticBadge /> 오버레이 Ref의 결과입니다.</p>}
        {rd?.snap.stats.truncated && <p className="alert warn">탐지가 많아 규칙당 최대 200건까지만 보관했습니다 (점수·건수는 전체 {Object.values(rd.snap.ruleCounts ?? {}).reduce((a, b) => a + b, 0).toLocaleString('ko-KR')}건 기준).</p>}
        <p className="small muted">{rows.length.toLocaleString('ko-KR')}건 · {rd ? `${rd.ref.repo} @ ${rd.ref.sha.slice(0, 12)}` : ''}</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>규칙</th><th>심각도</th><th>위치</th><th>스니펫</th><th>상태</th></tr></thead>
            <tbody>
              {rows.slice(page * PAGE, (page + 1) * PAGE).map((f) => {
                const r = byRule.get(f.ruleId)!;
                const key = findingKey(rd!.ref.id, f);
                const url = link(f.filePath, f.line);
                const expanded = open === key;
                return (
                  <Fragment key={key}>
                    <tr className="clickable" onClick={() => setOpen(expanded ? null : key)}>
                      <td><span className="mono">{f.ruleId}</span><div className="small muted">{r.title}</div></td>
                      <td><SeverityBadge s={r.severity} /></td>
                      <td className="mono small">
                        {url ? <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{f.filePath}:{f.line}</a> : `${f.filePath}:${f.line}`}
                        {f.inComment && <div><span className="badge b-mute">주석 안</span></div>}
                        {f.excluded && <div><span className="badge b-mute">exclude 대상</span></div>}
                      </td>
                      <td><pre className="code" style={{ margin: 0 }}>{f.snippet}</pre></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select aria-label="처리 상태" value={ws.findingStatus[key] ?? 'open'} onChange={(e) => setStatus(key, e.target.value as FindingStatus)}>
                          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                    </tr>
                    {expanded && (
                      <tr><td colSpan={5}>
                        <p><strong>가이드</strong> · {r.guidance}</p>
                        <p className="small muted">예상 공수 {r.effortHours}h · 자동 변환 {r.autoFixable ? '가능(OpenRewrite 등)' : '수동'}</p>
                        <ExplainFinding finding={f} rule={r} from={rd!.ref.detectedVersions} />
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
              {!rows.length && <tr><td colSpan={5} className="muted">조건에 맞는 탐지 결과가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length > PAGE && (
          <div className="row end" style={{ marginTop: 8 }}>
            <button className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>이전</button>
            <span className="small">{page + 1} / {Math.ceil(rows.length / PAGE)}</span>
            <button className="btn small" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>다음</button>
          </div>
        )}
      </Card>
    </>
  );
}
