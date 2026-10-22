import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Card, SyntheticBadge, Tabs, download } from '../../app/ui.tsx';
import type { ScoringConfig } from '../../shared/types/index.ts';
import { dataStore } from '../../store/dataStore.ts';
import { useStatic } from '../../store/staticData.ts';
import { useWs } from '../../store/workspace.ts';
import { getAccessCode, setAccessCode, useAssistant } from '../assistant/aiClient.ts';

type Tab = 'repo' | 'scoring' | 'rules' | 'state';

export function Settings() {
  const [tab, setTab] = useState<Tab>('repo');
  const setContext = useAssistant((s) => s.setContext);
  useEffect(() => setContext({ screen: '설정' }), [setContext]);
  return (
    <>
      <div className="page-head"><div><h1>설정</h1><p>저장소·Ref 등록, 점수 What-if, 규칙 카탈로그, 작업 상태 내보내기·가져오기.</p></div></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'repo', label: '저장소·Ref' }, { id: 'scoring', label: '점수 가중치 (What-if)' }, { id: 'rules', label: '규칙 카탈로그' }, { id: 'state', label: '작업 상태' }]} />
      {tab === 'repo' && <RepoTab />}
      {tab === 'scoring' && <ScoringTab />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'state' && <StateTab />}
    </>
  );
}

function RepoTab() {
  const { data: sd } = useStatic();
  const ws = useWs((s) => s.ws)!;
  if (!sd) return null;
  const live = ws.refs.filter((r) => r.id.startsWith('live:'));
  return (
    <div className="grid cols-2">
      <Card title="등록된 Ref (스냅샷 모드)">
        <table>
          <thead><tr><th>Ref</th><th>SHA</th><th>역할</th><th>Step</th></tr></thead>
          <tbody>{ws.refs.filter((r) => !r.id.startsWith('live:')).map((r) => (
            <tr key={r.id}><td>{r.id} {r.synthetic && <SyntheticBadge />}</td><td className="mono">{r.sha.slice(0, 12)}</td><td>{r.role}</td><td>{r.inferredStep ?? '—'}</td></tr>
          ))}</tbody>
        </table>
        <p className="small muted">스냅샷은 <code>npm run snapshot</code> 으로 고정 SHA 기준 재생성합니다. exclude glob: <code>{(sd.refsConfig.excludeGlobs).join(', ')}</code></p>
      </Card>
      <Card title="라이브 분석 (공개 GitHub 저장소)">
        <p>임의의 공개 저장소는 <Link to="/analyze">저장소 분석</Link> 화면에서 URL만 입력하면 자동으로 분석됩니다. 예시 저장소 5개도 그곳에서 고를 수 있습니다.</p>
        {live.length > 0 ? (<><h3>분석한 Ref ({live.length})</h3><ul className="small">{live.map((r) => <li key={r.id}>{r.repo} @ {r.refName} ({r.sha.slice(0, 8)})</li>)}</ul></>) : <p className="muted small">아직 분석한 저장소가 없습니다.</p>}
      </Card>
    </div>
  );
}

function ScoringTab() {
  const { data: sd } = useStatic();
  const ws = useWs((s) => s.ws)!;
  const setScoring = useWs((s) => s.setScoring);
  if (!sd) return null;
  const s = ws.scoring;
  const sumW = Object.values(s.weights).reduce((a, b) => a + b, 0);
  const upd = (fn: (c: ScoringConfig) => void) => {
    const c = structuredClone(s);
    fn(c);
    setScoring(c);
  };
  const num = (v: string) => Math.max(0, Number(v) || 0);
  return (
    <div className="grid cols-2">
      <Card title="종합 영향도 가중치" actions={<button className="btn small" onClick={() => setScoring(structuredClone(sd.scoring))}>시드 값으로 되돌리기</button>}>
        <p className="small muted">변경 즉시 모든 화면의 점수에 반영됩니다 (What-if). 시드 파일은 바뀌지 않습니다.</p>
        {(['os', 'jdk', 'framework', 'criticality', 'integration'] as const).map((k) => (
          <label key={k} className="row" style={{ justifyContent: 'space-between', margin: '4px 0' }}>
            <span>{{ os: 'OS', jdk: 'JDK', framework: '프레임워크', criticality: '업무 중요도', integration: '연계 복잡도' }[k]}</span>
            <input type="number" step={0.05} min={0} max={1} value={s.weights[k]} onChange={(e) => upd((c) => (c.weights[k] = num(e.target.value)))} style={{ width: 90 }} />
          </label>
        ))}
        {Math.abs(sumW - 1) > 0.001 && <Alert kind="warn">가중치 합이 {sumW.toFixed(2)} 입니다 (1.00 권장).</Alert>}
        <h3>등급 경계 (점수 이상)</h3>
        <div className="row">
          {(['medium', 'high', 'critical'] as const).map((k) => (
            <label key={k} className="field">{k}<input type="number" value={s.grades[k]} onChange={(e) => upd((c) => (c.grades[k] = num(e.target.value)))} style={{ width: 80 }} /></label>
          ))}
        </div>
      </Card>
      <Card title="정규화 계수 · 심각도 가중치">
        <p className="small muted">축별 점수 = min(100, 원점수 ÷ 정규화 계수 × 100). 파일럿 결과로 보정하세요.</p>
        <div className="row">
          {(['os', 'jdk', 'framework', 'cloud'] as const).map((k) => (
            <label key={k} className="field">{k}<input type="number" min={1} value={s.normalization[k]} onChange={(e) => upd((c) => (c.normalization[k] = Math.max(1, num(e.target.value))))} style={{ width: 80 }} /></label>
          ))}
        </div>
        <h3>심각도 가중치</h3>
        <div className="row">
          {(['critical', 'high', 'medium', 'low', 'info'] as const).map((k) => (
            <label key={k} className="field">{k}<input type="number" step={0.5} value={s.severityWeights[k]} disabled={k === 'info'} onChange={(e) => upd((c) => (c.severityWeights[k] = num(e.target.value)))} style={{ width: 80 }} /></label>
          ))}
        </div>
        <p className="small muted">info는 항상 0 (점수·공수·건수에서 제외, 목록에만 표시).</p>
      </Card>
    </div>
  );
}

function RulesTab() {
  const { data: sd } = useStatic();
  if (!sd) return null;
  return (
    <Card title={`규칙 카탈로그 · ${sd.rulesetVersion}`}>
      <p className="small muted">규칙은 <code>rules/*.yaml</code> 에서 Pull Request로 추가·수정합니다. 변경하면 <code>npm run build:rules</code> 후 스냅샷을 다시 생성하세요 (rulesetVersion이 바뀌어 캐시가 무효화됩니다).</p>
      <div className="table-wrap"><table>
        <thead><tr><th>ID</th><th>축</th><th>제목</th><th>심각도</th><th className="num">공수(h)</th><th>자동변환</th><th>파일 유형</th><th>패턴</th></tr></thead>
        <tbody>{sd.rules.map((r) => (
          <tr key={r.id}>
            <td className="mono">{r.id}{r.extension && <div><span className="badge b-mute">확장 규칙</span></div>}</td><td>{r.axis}</td><td>{r.title}<div className="small muted">{r.guidance}</div></td>
            <td>{r.severity}</td><td className="num">{r.effortHours}</td><td>{r.autoFixable ? '가능' : '수동'}</td><td className="small">{r.fileTypes.join(', ')}{r.includeComments ? ' (주석 포함)' : ''}</td><td className="mono small">{r.pattern}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </Card>
  );
}

function StateTab() {
  const { data: sd } = useStatic();
  const ws = useWs((s) => s.ws)!;
  const persistent = useWs((s) => s.persistent);
  const { replace, reset } = useWs();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [code, setCode] = useState(getAccessCode());
  if (!sd) return null;

  async function onImport(f?: File) {
    if (!f) return;
    try {
      replace(await dataStore.importJson(f));
      setMsg({ kind: 'ok', text: '작업 상태를 가져왔습니다.' });
    } catch (e) {
      setMsg({ kind: 'bad', text: `가져오기 실패: ${(e as Error).message}` });
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="grid cols-2">
      <Card title="작업 상태 내보내기·가져오기 (F-15)">
        {!persistent && <Alert kind="warn">브라우저 저장소를 쓸 수 없어 메모리에만 보관 중입니다. 새로고침하면 사라지니 지금 내보내세요.</Alert>}
        <p className="small muted">체크리스트, 단계, 리스크, 웨이브, 확인 이력, AI 결과 캐시를 하나의 JSON으로 저장합니다. 캐시 삭제나 기기 변경에 대비해 주요 작업 후 내보내기를 권장합니다.</p>
        <div className="row">
          <button className="btn primary" onClick={() => download(`migration-workspace-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(ws, null, 2), 'application/json')}>JSON 내보내기</button>
          <input ref={fileRef} type="file" accept="application/json,.json" aria-label="작업 상태 JSON 가져오기" onChange={(e) => onImport(e.target.files?.[0])} />
        </div>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <h3>초기화</h3>
        <button className="btn danger" onClick={() => confirm('모든 작업 상태를 지우고 시드 데이터로 되돌립니다. 계속할까요?') && reset(sd)}>시드 데이터로 초기화</button>
      </Card>
      <Card title="접근 코드 (선택)">
        <p className="small muted">서버에 <code>APP_ACCESS_CODE</code> 가 설정된 경우 /api 요청에 필요합니다. 이 브라우저에만 저장됩니다.</p>
        <div className="row">
          <input type="password" value={code} onChange={(e) => { setCode(e.target.value); setAccessCode(e.target.value); }} aria-label="접근 코드" autoComplete="off" />
        </div>
        <h3>저장 현황</h3>
        <dl className="kv small">
          <dt>스키마 버전</dt><dd>{ws.schemaVersion}</dd>
          <dt>이력</dt><dd>{ws.history.length}건</dd>
          <dt>AI 결과 캐시</dt><dd>{Object.keys(ws.aiResults).length}건</dd>
          <dt>라이브 스캔</dt><dd>{Object.keys(ws.liveScans).length}건</dd>
          <dt>저장 방식</dt><dd>{persistent ? '브라우저 저장소' : '메모리 (영속 안 됨)'}</dd>
        </dl>
      </Card>
    </div>
  );
}
