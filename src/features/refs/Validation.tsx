import { useEffect, useMemo, useState } from 'react';
import { Alert, Card } from '../../app/ui.tsx';
import { validatePair } from '../../shared/scoring/index.ts';
import { buildRefData } from '../../store/derived.ts';
import { useStatic } from '../../store/staticData.ts';
import { useWs } from '../../store/workspace.ts';
import { useAssistant } from '../assistant/aiClient.ts';

export function Validation() {
  const { data: sd } = useStatic();
  const ws = useWs((s) => s.ws);
  const setReview = useWs((s) => s.setReview);
  const setContext = useAssistant((s) => s.setContext);
  const [pairIdx, setPairIdx] = useState(0);
  useEffect(() => setContext({ screen: '규칙 검증' }), [setContext]);
  const refs = useMemo(() => (sd && ws ? buildRefData(sd, ws) : null), [sd, ws]);
  if (!sd || !ws || !refs) return null;

  const pairs = sd.diffs
    .map((d) => ({ d, a: refs.get(d.from), b: refs.get(d.to) }))
    .filter((p) => p.a && p.b)
    .sort((x, y) => x.a!.ref.order - y.a!.ref.order);
  if (!pairs.length) {
    return <><h1>규칙 검증</h1><Alert kind="warn">Ref 간 diff 스냅샷이 없습니다. 이 검증은 전환 이력이 있는 저장소(예: egovframe-web-sample)에서만 가능합니다. <code>npm run snapshot</code> 으로 생성하세요.</Alert></>;
  }
  const p = pairs[Math.min(pairIdx, pairs.length - 1)];
  const v = validatePair(p.a!.snap, p.b!.snap, p.d.diff);
  const pair = `${p.d.from}>${p.d.to}`;
  const ruleById = new Map(sd.rules.map((r) => [r.id, r]));

  const fpKey = (rule: string, path: string, line: number) => `fp:${pair}:${rule}:${path}:${line}`;
  const fnKey = (path: string, line: number) => `fn:${pair}:${path}:${line}`;
  const reviews = Object.entries(ws.validationReviews).filter(([k]) => k.includes(`:${pair}:`));
  const confirmedFp = reviews.filter(([k, x]) => k.startsWith('fp:') && x === 'fp').length;
  const confirmedFn = reviews.filter(([k, x]) => k.startsWith('fn:') && x === 'fn').length;
  const totals = v.rows.reduce((a, r) => ({ from: a.from + r.from, resolved: a.resolved + r.resolved, tp: a.tp + r.tp, persisted: a.persisted + r.persisted, fp: a.fp + r.fpCandidates.length }), { from: 0, resolved: 0, tp: 0, persisted: 0, fp: 0 });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>규칙 검증</h1>
          <p>연속된 Ref의 diff를 정답지로 삼아 규칙별 적중(TP)·오탐 후보(FP)·미탐 후보(FN)를 봅니다. 후보는 아키텍트가 확정하며, 확정 결과로 규칙 패턴과 제외 조건을 보정합니다.</p>
        </div>
        <label className="field">비교 구간
          <select value={pairIdx} onChange={(e) => setPairIdx(Number(e.target.value))}>{pairs.map((x, i) => <option key={i} value={i}>{x.d.from} → {x.d.to}</option>)}</select>
        </label>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <div className="card stat"><div className="l">해소된 탐지</div><div className="v">{totals.resolved}</div><div className="s">{p.d.from} {totals.from}건 중</div></div>
        <div className="card stat"><div className="l">적중 (diff 위치 일치)</div><div className="v">{totals.tp}</div><div className="s">해소 중 diff에 포함된 위치</div></div>
        <div className="card stat"><div className="l">오탐 후보</div><div className="v">{totals.fp}</div><div className="s">확정 {confirmedFp}건 (주석·exclude에서만 매치)</div></div>
        <div className="card stat"><div className="l">미탐 후보</div><div className="v">{v.fnCandidates.length}</div><div className="s">확정 {confirmedFn}건 (변경됐지만 규칙 없음)</div></div>
      </div>

      <Card title={`규칙별 결과 · ${p.d.from} → ${p.d.to} (변경 파일 ${v.filesChanged}개)`}>
        <div className="table-wrap"><table>
          <thead><tr><th>규칙</th><th className="num">{p.d.from}</th><th className="num">{p.d.to}</th><th className="num">해소</th><th className="num">적중(TP)</th><th className="num">남음</th><th className="num">오탐 후보</th></tr></thead>
          <tbody>{v.rows.map((r) => (
            <tr key={r.ruleId}>
              <td><span className="mono">{r.ruleId}</span><div className="small muted">{ruleById.get(r.ruleId)?.title}</div></td>
              <td className="num">{r.from}</td><td className="num">{r.to}</td>
              <td className="num">{r.resolved}</td>
              <td className="num">{r.tp > 0 ? <strong>{r.tp}</strong> : r.tp}{r.resolved > 0 && r.tp === r.resolved && <span className="badge b-ok" style={{ marginLeft: 6 }}>전부 일치</span>}{r.resolved > r.tp && <span className="badge b-warn" style={{ marginLeft: 6 }}>위치 불일치 {r.resolved - r.tp}</span>}</td>
              <td className="num">{r.persisted}</td>
              <td className="num">{r.fpCandidates.length}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="small muted">‘해소’는 from에만 있고 to에서 같은 규칙·파일·코드 줄이 사라진 탐지입니다. ‘적중’은 그 위치가 실제 diff의 변경(삭제) 줄이거나 파일이 삭제·이동된 경우입니다.</p>
      </Card>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card title="오탐 후보 (주석·exclude에서만 매치)">
          {v.rows.flatMap((r) => r.fpCandidates.map((f) => ({ r, f }))).slice(0, 60).map(({ r, f }) => {
            const k = fpKey(r.ruleId, f.filePath, f.line);
            const st = ws.validationReviews[k];
            return (
              <div key={k} className="kcard small">
                <span className="mono">{f.ruleId}</span> <span className="badge b-mute">{f.inComment ? '주석 안' : 'exclude 대상'}</span>
                <div className="mono">{f.filePath}:{f.line}</div>
                <pre className="code">{f.snippet}</pre>
                <div className="row">
                  <button className="btn small" aria-pressed={st === 'fp'} onClick={() => setReview(k, st === 'fp' ? null : 'fp')}>{st === 'fp' ? '✓ 오탐 확정' : '오탐 확정'}</button>
                  <button className="btn small" aria-pressed={st === 'ok'} onClick={() => setReview(k, st === 'ok' ? null : 'ok')}>{st === 'ok' ? '✓ 정상 탐지' : '정상 탐지'}</button>
                </div>
              </div>
            );
          })}
          {totals.fp === 0 && <p className="muted">오탐 후보가 없습니다.</p>}
          {confirmedFp > 0 && <Alert kind="info">오탐 {confirmedFp}건 확정: 해당 규칙은 기본 설정(주석·템플릿 제외)이 이미 제외합니다. 같은 패턴이 다른 위치에서 반복되면 exclude glob을 추가하세요.</Alert>}
        </Card>
        <Card title="미탐 후보 (전환 관련 변경이지만 어떤 규칙에도 걸리지 않음)">
          {v.fnCandidates.slice(0, 60).map((f) => {
            const k = fnKey(f.filePath, f.line);
            const st = ws.validationReviews[k];
            return (
              <div key={k} className="kcard small">
                <div className="mono">{f.filePath}:{f.line}</div>
                <pre className="code">{f.text}</pre>
                <div className="row">
                  <button className="btn small" aria-pressed={st === 'fn'} onClick={() => setReview(k, st === 'fn' ? null : 'fn')}>{st === 'fn' ? '✓ 미탐 확정' : '미탐 확정'}</button>
                  <button className="btn small" aria-pressed={st === 'ok'} onClick={() => setReview(k, st === 'ok' ? null : 'ok')}>{st === 'ok' ? '✓ 무관' : '무관'}</button>
                </div>
              </div>
            );
          })}
          {!v.fnCandidates.length && <p className="muted">미탐 후보가 없습니다.</p>}
          {v.fnCandidates.length > 60 && <p className="small muted">상위 60건만 표시합니다 (전체 {v.fnCandidates.length}건).</p>}
          {confirmedFn > 0 && <Alert kind="info">미탐 {confirmedFn}건 확정: <code>rules/*.yaml</code> 에 규칙을 추가하는 Pull Request로 보정하고 스냅샷을 다시 생성하세요.</Alert>}
        </Card>
      </div>
    </>
  );
}
