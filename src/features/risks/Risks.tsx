import { useEffect, useState } from 'react';
import { Card, Modal } from '../../app/ui.tsx';
import type { Risk } from '../../shared/types/index.ts';
import { useWs } from '../../store/workspace.ts';
import { useAssistant } from '../assistant/aiClient.ts';

const SRC: Record<string, string> = { manual: '수동', ai: 'AI 제안 반영', gap: '잔여 갭' };
const STATUS: Record<Risk['status'], string> = { open: '열림', mitigating: '대응 중', closed: '종료' };
const level = (s: number) => (s >= 15 ? '매우 높음' : s >= 10 ? '높음' : s >= 5 ? '보통' : '낮음');
const tint = (s: number) => `color-mix(in srgb, var(${s >= 15 ? '--bad' : s >= 10 ? '--warn' : s >= 5 ? '--accent' : '--ok'}) ${s >= 15 ? 30 : 20}%, var(--panel))`;

export function Risks() {
  const ws = useWs((s) => s.ws);
  const { upsertRisk, removeRisk } = useWs();
  const [edit, setEdit] = useState<Risk | null>(null);
  const setContext = useAssistant((s) => s.setContext);
  useEffect(() => setContext({ screen: '리스크 레지스터' }), [setContext]);
  if (!ws) return null;
  const sorted = [...ws.risks].sort((a, b) => b.likelihood * b.impact - a.likelihood * a.impact);

  return (
    <>
      <div className="page-head">
        <div><h1>리스크 레지스터</h1><p>발생 가능성 × 영향도(각 1~5). AI 제안은 사용자가 선택해 반영한 항목만 들어옵니다.</p></div>
        <button className="btn primary" onClick={() => setEdit({ id: `R-${Date.now().toString(36)}`, title: '', likelihood: 3, impact: 3, mitigation: '', owner: ws.actor, status: 'open', source: 'manual' })}>+ 리스크 추가</button>
      </div>
      <div className="grid cols-2">
        <Card title="리스크 목록">
          <div className="table-wrap"><table>
            <thead><tr><th>리스크</th><th className="num">점수</th><th>상태</th><th /></tr></thead>
            <tbody>
              {sorted.map((r) => {
                const s = r.likelihood * r.impact;
                return (
                  <tr key={r.id} style={{ opacity: r.status === 'closed' ? 0.55 : 1 }}>
                    <td>{r.title}<div className="small muted">{[r.appId, r.waveId].filter(Boolean).join(' · ')} · {SRC[r.source ?? 'manual']} · 담당 {r.owner}</div>{r.mitigation && <div className="small">대응: {r.mitigation}</div>}</td>
                    <td className="num"><strong>{s}</strong><div className="small muted">{level(s)}</div></td>
                    <td>{STATUS[r.status]}</td>
                    <td><button className="btn small" onClick={() => setEdit(r)}>편집</button></td>
                  </tr>
                );
              })}
              {!sorted.length && <tr><td colSpan={4} className="muted">등록된 리스크가 없습니다.</td></tr>}
            </tbody>
          </table></div>
        </Card>
        <Card title="발생 가능성 × 영향도 매트릭스">
          <div className="matrix" role="table" aria-label="리스크 매트릭스">
            {[5, 4, 3, 2, 1].map((l) => (
              <div key={l} style={{ display: 'contents' }} role="row">
                <div className="axis">가능성 {l}</div>
                {[1, 2, 3, 4, 5].map((i) => {
                  const here = ws.risks.filter((r) => r.status !== 'closed' && r.likelihood === l && r.impact === i);
                  return (
                    <div key={i} className="cell" style={{ background: tint(l * i) }} role="cell" aria-label={`가능성 ${l}, 영향도 ${i}, ${l * i}점 ${level(l * i)}, 리스크 ${here.length}건`}>
                      <div className="muted">{l * i}점 · {level(l * i)}</div>
                      {here.map((r) => <div key={r.id} title={r.title}>● {r.title.slice(0, 14)}{r.title.length > 14 ? '…' : ''}</div>)}
                    </div>
                  );
                })}
              </div>
            ))}
            <div />{[1, 2, 3, 4, 5].map((i) => <div key={i} className="axis">영향도 {i}</div>)}
          </div>
        </Card>
      </div>
      {edit && (
        <RiskForm risk={edit} onClose={() => setEdit(null)} onSave={(r) => { upsertRisk(r); setEdit(null); }}
          onDelete={ws.risks.some((r) => r.id === edit.id) ? () => { removeRisk(edit.id); setEdit(null); } : undefined} />
      )}
    </>
  );
}

function RiskForm({ risk, onClose, onSave, onDelete }: { risk: Risk; onClose: () => void; onSave: (r: Risk) => void; onDelete?: () => void }) {
  const [r, setR] = useState(risk);
  const ws = useWs((s) => s.ws!);
  const set = <K extends keyof Risk>(k: K, v: Risk[K]) => setR((x) => ({ ...x, [k]: v }));
  const n15 = (v: string) => Math.min(5, Math.max(1, Number(v) || 1)) as 1 | 2 | 3 | 4 | 5;
  return (
    <Modal title="리스크" onClose={onClose}>
      <label className="field">제목<input type="text" value={r.title} onChange={(e) => set('title', e.target.value)} /></label>
      <div className="grid cols-2" style={{ marginTop: 8 }}>
        <label className="field">발생 가능성 (1~5)<input type="number" min={1} max={5} value={r.likelihood} onChange={(e) => set('likelihood', n15(e.target.value))} /></label>
        <label className="field">영향도 (1~5)<input type="number" min={1} max={5} value={r.impact} onChange={(e) => set('impact', n15(e.target.value))} /></label>
        <label className="field">관련 앱<select value={r.appId ?? ''} onChange={(e) => set('appId', e.target.value || undefined)}><option value="">없음</option>{ws.applications.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="field">관련 웨이브<select value={r.waveId ?? ''} onChange={(e) => set('waveId', e.target.value || undefined)}><option value="">없음</option>{ws.waves.map((w) => <option key={w.id} value={w.id}>{w.id}</option>)}</select></label>
        <label className="field">담당<input type="text" value={r.owner} onChange={(e) => set('owner', e.target.value)} /></label>
        <label className="field">상태<select value={r.status} onChange={(e) => set('status', e.target.value as Risk['status'])}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <label className="field" style={{ marginTop: 8 }}>대응 계획<textarea rows={3} value={r.mitigation} onChange={(e) => set('mitigation', e.target.value)} /></label>
      <div className="row end" style={{ marginTop: 12 }}>
        {onDelete && <button className="btn danger" onClick={onDelete}>삭제</button>}
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={!r.title.trim()} onClick={() => onSave(r)}>저장</button>
      </div>
    </Modal>
  );
}
