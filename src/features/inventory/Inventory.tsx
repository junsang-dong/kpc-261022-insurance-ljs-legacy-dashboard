import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, GradeBadge, Modal, SyntheticBadge, Tabs } from '../../app/ui.tsx';
import type { Application } from '../../shared/types/index.ts';
import { useAppImpacts } from '../../store/derived.ts';
import { useWs } from '../../store/workspace.ts';

type Tab = 'apps' | 'servers' | 'dbs' | 'integrations';

export function Inventory() {
  const d = useAppImpacts();
  const upsertApp = useWs((s) => s.upsertApp);
  const [tab, setTab] = useState<Tab>('apps');
  const [grade, setGrade] = useState('');
  const [domain, setDomain] = useState('');
  const [wave, setWave] = useState('');
  const [editing, setEditing] = useState<Application | null>(null);

  const rows = useMemo(() => {
    if (!d) return [];
    return d.impacts.filter(({ app, impact }) => (!grade || impact.grade === grade) && (!domain || app.domain === domain) && (!wave || (app.waveId ?? '') === wave));
  }, [d, grade, domain, wave]);
  if (!d) return null;
  const { sd, ws } = d;
  const domains = [...new Set(ws.applications.map((a) => a.domain))];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>인벤토리</h1>
          <p>앱·서버·DB·연계 목록. 예시 앱의 서버·DB·연계 값은 <SyntheticBadge /> 입니다.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing(blank())}>+ 애플리케이션 추가</button>
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'apps', label: '애플리케이션' }, { id: 'servers', label: '서버' }, { id: 'dbs', label: 'DB' }, { id: 'integrations', label: '연계' }]} />

      {tab === 'apps' && (
        <Card>
          <div className="row" style={{ marginBottom: 10 }}>
            <label className="field">등급<select value={grade} onChange={(e) => setGrade(e.target.value)}><option value="">전체</option>{['Low', 'Medium', 'High', 'Critical'].map((g) => <option key={g}>{g}</option>)}</select></label>
            <label className="field">업무 영역<select value={domain} onChange={(e) => setDomain(e.target.value)}><option value="">전체</option>{domains.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="field">웨이브<select value={wave} onChange={(e) => setWave(e.target.value)}><option value="">전체</option>{ws.waves.map((w) => <option key={w.id} value={w.id}>{w.id}</option>)}</select></label>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>이름</th><th>영역</th><th className="num">중요도</th><th>단계</th><th>웨이브</th><th>영향도</th><th>근거</th><th /></tr></thead>
              <tbody>
                {rows.map(({ app, impact, refId }) => (
                  <tr key={app.id}>
                    <td className="mono">{app.id}</td>
                    <td><Link to={`/apps/${app.id}`}>{app.name}</Link> {app.synthetic && <SyntheticBadge />}</td>
                    <td>{app.domain}</td>
                    <td className="num">{app.criticality}</td>
                    <td>Step {app.currentStep}</td>
                    <td>{app.waveId ?? '—'}</td>
                    <td><GradeBadge grade={impact.grade} score={impact.total} /></td>
                    <td className="small muted">{impact.basis === 'scan' ? `스캔 (${refId})` : impact.basis === 'assumed' ? '가정 점수' : '없음'}</td>
                    <td><button className="btn small" onClick={() => setEditing(app)}>편집</button></td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={9} className="muted">조건에 맞는 앱이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'servers' && (
        <Card><div className="table-wrap"><table>
          <thead><tr><th>호스트</th><th>앱</th><th>OS</th><th>아키텍처</th><th className="num">코어</th><th className="num">메모리(GB)</th><th className="num">평균/피크 CPU(%)</th><th /></tr></thead>
          <tbody>{sd.inventory.servers.map((s) => (
            <tr key={s.id}><td className="mono">{s.hostname}</td><td>{s.appId}</td><td>{s.os}</td><td>{s.arch}</td><td className="num">{s.cores}</td><td className="num">{s.memoryGb}</td><td className="num">{s.avgCpu} / {s.peakCpu}</td><td><SyntheticBadge /></td></tr>
          ))}</tbody>
        </table></div></Card>
      )}

      {tab === 'dbs' && (
        <Card><div className="table-wrap"><table>
          <thead><tr><th>DB</th><th>엔진</th><th className="num">크기(GB)</th><th>라이선스</th><th>공유 앱</th><th /></tr></thead>
          <tbody>{sd.inventory.dbs.map((x) => {
            const apps = ws.applications.filter((a) => a.sharedDbIds.includes(x.id));
            const waves = new Set(apps.map((a) => a.waveId ?? '미배정'));
            return (
              <tr key={x.id}>
                <td>{x.name}</td><td>{x.engine}</td><td className="num">{x.sizeGb.toLocaleString('ko-KR')}</td>
                <td>{x.license.includes('상용') ? <><span className="badge b-warn">라이선스 리스크</span> {x.license}</> : x.license}</td>
                <td>{apps.map((a) => a.id).join(', ') || '—'}{waves.size > 1 && <span className="badge b-warn" style={{ marginLeft: 6 }}>⚠ 웨이브 상이</span>}</td>
                <td><SyntheticBadge /></td>
              </tr>
            );
          })}</tbody>
        </table></div></Card>
      )}

      {tab === 'integrations' && (
        <Card><div className="table-wrap"><table>
          <thead><tr><th>앱</th><th>대상</th><th>유형</th><th>구분</th><th>IP 화이트리스트</th><th>준비 상태</th><th /></tr></thead>
          <tbody>{sd.inventory.integrations.map((x) => (
            <tr key={x.id}>
              <td>{x.appId}</td><td>{x.target}</td><td>{x.type}</td><td>{x.external ? '대외' : '대내'}</td>
              <td>{x.ipWhitelist ? '필요' : '—'}</td>
              <td>{x.ready === 'ready' ? <span className="badge b-ok">준비 완료</span> : x.ready === 'requested' ? <span className="badge b-warn">신청 중</span> : <span className="badge b-bad">미착수</span>}</td>
              <td><SyntheticBadge /></td>
            </tr>
          ))}</tbody>
        </table></div></Card>
      )}

      {editing && <AppForm app={editing} isNew={!ws.applications.some((a) => a.id === editing.id)} onClose={() => setEditing(null)} onSave={(a) => { upsertApp(a); setEditing(null); }} />}
    </>
  );
}

const blank = (): Application => ({
  id: '', name: '', domain: '', criticality: 3, integrationComplexity: 30, currentStep: 0, refIds: [], sharedDbIds: [], synthetic: true,
  assumedAxisScores: { os: 30, jdk: 30, framework: 30, cloud: 30 },
  asis: { os: 'AIX 7.1 (POWER)', jdk: 'IBM J9 1.8', egov: '3.1', spring: '4.0.1', was: '' },
});

function AppForm({ app, isNew, onClose, onSave }: { app: Application; isNew: boolean; onClose: () => void; onSave: (a: Application) => void }) {
  const [a, setA] = useState(app);
  const ws = useWs((s) => s.ws!);
  const set = <K extends keyof Application>(k: K, v: Application[K]) => setA((x) => ({ ...x, [k]: v }));
  const dupe = isNew && ws.applications.some((x) => x.id === a.id);
  const valid = a.id.trim() && a.name.trim() && !dupe;
  return (
    <Modal title={isNew ? '애플리케이션 추가' : '애플리케이션 편집'} onClose={onClose}>
      <div className="grid cols-2">
        <label className="field">ID<input type="text" value={a.id} disabled={!isNew} onChange={(e) => set('id', e.target.value.trim())} /></label>
        <label className="field">이름<input type="text" value={a.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="field">업무 영역<input type="text" value={a.domain} onChange={(e) => set('domain', e.target.value)} /></label>
        <label className="field">업무 중요도 (1~5)<input type="number" min={1} max={5} value={a.criticality} onChange={(e) => set('criticality', Math.min(5, Math.max(1, Number(e.target.value))) as Application['criticality'])} /></label>
        <label className="field">연계 복잡도 (0~100)<input type="number" min={0} max={100} value={a.integrationComplexity} onChange={(e) => set('integrationComplexity', Math.min(100, Math.max(0, Number(e.target.value))))} /></label>
        <label className="field">웨이브<select value={a.waveId ?? ''} onChange={(e) => set('waveId', e.target.value || undefined)}><option value="">미배정</option>{ws.waves.map((w) => <option key={w.id} value={w.id}>{w.id}</option>)}</select></label>
      </div>
      {dupe && <p className="alert bad">이미 있는 ID입니다.</p>}
      <p className="muted small">Ref가 없는 앱은 영향도를 직접 입력한 가정 점수로 계산합니다 (가상 값).</p>
      <div className="grid cols-4">
        {(['os', 'jdk', 'framework', 'cloud'] as const).map((k) => (
          <label className="field" key={k}>{k.toUpperCase()} 가정 점수<input type="number" min={0} max={100} value={a.assumedAxisScores?.[k] ?? 0} onChange={(e) => set('assumedAxisScores', { ...a.assumedAxisScores, [k]: Math.min(100, Math.max(0, Number(e.target.value))) })} /></label>
        ))}
      </div>
      <div className="row end" style={{ marginTop: 12 }}>
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={!valid} onClick={() => onSave(a)}>저장</button>
      </div>
    </Modal>
  );
}
