import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Card, GradeBadge, Modal, SyntheticBadge } from '../../app/ui.tsx';
import { dbWaveWarnings } from '../../shared/scoring/index.ts';
import type { Wave } from '../../shared/types/index.ts';
import { useAppImpacts } from '../../store/derived.ts';
import { useWs } from '../../store/workspace.ts';
import { useAssistant } from '../assistant/aiClient.ts';

const dayMs = 86_400_000;

export function Waves() {
  const d = useAppImpacts();
  const { upsertWave, upsertApp } = useWs();
  const [edit, setEdit] = useState<Wave | null>(null);
  const setContext = useAssistant((s) => s.setContext);
  useEffect(() => setContext({ screen: '웨이브 계획' }), [setContext]);
  if (!d) return null;
  const { ws, sd, impacts } = d;
  const warnings = dbWaveWarnings(ws.applications);
  const warnApps = new Set(warnings.flatMap((w) => w.appIds));
  const t0 = Math.min(...ws.waves.map((w) => Date.parse(w.start)));
  const t1 = Math.max(...ws.waves.map((w) => Date.parse(w.end)));
  const span = Math.max(1, t1 - t0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>웨이브 계획</h1>
          <p>앱을 웨이브에 수동 배정합니다. 같은 DB를 공유하는 앱이 서로 다른 웨이브에 있으면 경고합니다. 최종 웨이브에는 결산·보험료 산출 같은 핵심 계산 시스템을 둡니다.</p>
        </div>
        <button className="btn primary" onClick={() => setEdit({ id: `W${ws.waves.length + 1}`, name: '', start: '', end: '', cutoverWindow: '', rollbackCriteria: '', owner: '' })}>+ 웨이브 추가</button>
      </div>

      {warnings.map((w) => (
        <Alert key={w.dbId} kind="warn">
          ⚠ <strong>{sd.inventory.dbs.find((x) => x.id === w.dbId)?.name ?? w.dbId}</strong>를 공유하는 앱({w.appIds.join(', ')})이 서로 다른 웨이브({w.waveIds.join(', ')})에 배정되어 있습니다. 앱-DB 분리는 지연시간·정합성 위험을 키우므로 같은 웨이브로 묶거나 전용선·캐시 대책을 세우세요.
        </Alert>
      ))}

      <Card title="일정 (간이 간트)">
        {ws.waves.map((w, i) => {
          const l = ((Date.parse(w.start) - t0) / span) * 100;
          const wd = Math.max(2, ((Date.parse(w.end) - Date.parse(w.start)) / span) * 100);
          return (
            <div key={w.id} className="row" style={{ margin: '6px 0' }}>
              <div style={{ width: 70 }}><strong>{w.id}</strong></div>
              <div style={{ flex: 1, position: 'relative', height: 22, background: 'var(--bg)', borderRadius: 6 }} role="img" aria-label={`${w.name}: ${w.start}부터 ${w.end}까지`}>
                <div style={{ position: 'absolute', left: `${l}%`, width: `${wd}%`, height: '100%', background: 'var(--accent)', opacity: 0.35 + 0.2 * i, borderRadius: 6 }} />
              </div>
              <div className="small muted" style={{ width: 190 }}>{w.start} ~ {w.end} ({Math.round((Date.parse(w.end) - Date.parse(w.start)) / dayMs)}일)</div>
            </div>
          );
        })}
      </Card>

      <div className="grid cols-3" style={{ marginTop: 14 }}>
        {ws.waves.map((w) => {
          const apps = impacts.filter((i) => i.app.waveId === w.id);
          return (
            <Card key={w.id} title={w.name || w.id} actions={<button className="btn small" onClick={() => setEdit(w)}>편집</button>}>
              <dl className="kv small">
                <dt>컷오버 시간 창</dt><dd>{w.cutoverWindow || '—'}</dd>
                <dt>롤백 기준</dt><dd>{w.rollbackCriteria || '—'}</dd>
                <dt>담당</dt><dd>{w.owner || '—'}</dd>
              </dl>
              <h3>배정된 앱 ({apps.length})</h3>
              {apps.map(({ app, impact }) => (
                <div key={app.id} className="row small" style={{ justifyContent: 'space-between' }}>
                  <span><Link to={`/apps/${app.id}`}>{app.name}</Link> {warnApps.has(app.id) && <span className="badge b-warn">DB 공유 경고</span>}</span>
                  <GradeBadge grade={impact.grade} />
                </div>
              ))}
              {!apps.length && <p className="muted small">없음</p>}
              <p className="small muted">4단계 게이트: 리허설 → 컷오버 → 안정화 → 레거시 종료</p>
            </Card>
          );
        })}
      </div>

      <Card title={<>앱 배정 <SyntheticBadge text="가상 인벤토리" /></>}>
        <div className="table-wrap"><table>
          <thead><tr><th>앱</th><th>영향도</th><th>공유 DB</th><th>웨이브</th></tr></thead>
          <tbody>
            {impacts.map(({ app, impact }) => (
              <tr key={app.id}>
                <td>{app.name}</td>
                <td><GradeBadge grade={impact.grade} score={impact.total} /></td>
                <td className="small">{app.sharedDbIds.join(', ') || '—'}</td>
                <td>
                  <select aria-label={`${app.name} 웨이브`} value={app.waveId ?? ''} onChange={(e) => upsertApp({ ...app, waveId: e.target.value || undefined })}>
                    <option value="">미배정</option>{ws.waves.map((w) => <option key={w.id} value={w.id}>{w.id}</option>)}
                  </select>
                  {impact.grade === 'Critical' && app.waveId && app.waveId !== ws.waves[ws.waves.length - 1]?.id && <span className="badge b-warn" style={{ marginLeft: 6 }}>Critical은 최종 웨이브 권장</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>

      {edit && <WaveForm wave={edit} onClose={() => setEdit(null)} onSave={(w) => { upsertWave(w); setEdit(null); }} />}
    </>
  );
}

function WaveForm({ wave, onClose, onSave }: { wave: Wave; onClose: () => void; onSave: (w: Wave) => void }) {
  const [w, setW] = useState(wave);
  const set = (k: keyof Wave, v: string) => setW((x) => ({ ...x, [k]: v }));
  const bad = !w.name.trim() || !w.start || !w.end || w.end < w.start;
  return (
    <Modal title="웨이브" onClose={onClose}>
      <div className="grid cols-2">
        <label className="field">ID<input type="text" value={w.id} disabled /></label>
        <label className="field">이름<input type="text" value={w.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="field">시작<input type="date" value={w.start} onChange={(e) => set('start', e.target.value)} /></label>
        <label className="field">종료<input type="date" value={w.end} onChange={(e) => set('end', e.target.value)} /></label>
        <label className="field">컷오버 시간 창<input type="text" value={w.cutoverWindow} onChange={(e) => set('cutoverWindow', e.target.value)} /></label>
        <label className="field">담당<input type="text" value={w.owner} onChange={(e) => set('owner', e.target.value)} /></label>
      </div>
      <label className="field" style={{ marginTop: 8 }}>롤백 기준<textarea rows={2} value={w.rollbackCriteria} onChange={(e) => set('rollbackCriteria', e.target.value)} /></label>
      {w.end && w.end < w.start && <Alert kind="bad">종료일이 시작일보다 빠릅니다.</Alert>}
      <div className="row end" style={{ marginTop: 12 }}>
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={bad} onClick={() => onSave(w)}>저장</button>
      </div>
    </Modal>
  );
}
