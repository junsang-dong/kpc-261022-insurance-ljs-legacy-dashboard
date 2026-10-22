import { useEffect, useRef, useState } from 'react';
import { Alert, Card, SyntheticBadge, Tabs, download } from '../../app/ui.tsx';
import { isActive } from '../../shared/scoring/index.ts';
import type { GitRef, ScanResult, ScoringConfig } from '../../shared/types/index.ts';
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
  const addLiveScan = useWs((s) => s.addLiveScan);
  const [repo, setRepo] = useState(sd?.refsConfig.repo ?? '');
  const [ref, setRef] = useState('4.1.x');
  const [exclude, setExclude] = useState((sd?.refsConfig.excludeGlobs ?? []).join('\n'));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  if (!sd) return null;

  async function scan() {
    setBusy(true);
    setMsg(null);
    try {
      const code = getAccessCode();
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(code ? { 'x-access-code': code } : {}) },
        body: JSON.stringify({ repo, ref, includeGlobs: sd!.refsConfig.includeGlobs, excludeGlobs: exclude.split('\n').map((s) => s.trim()).filter(Boolean) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error + (body.retryAt ? ` (재시도: ${new Date(body.retryAt).toLocaleTimeString('ko-KR')})` : ''));
      const scan = body as ScanResult;
      const known = sd!.index?.refs.find((r) => r.sha === scan.ref.sha);
      const id = known ? `live:${known.refId}` : `live:${scan.ref.repo}@${scan.ref.refName}`;
      const gitRef: GitRef = {
        id, repo: scan.ref.repo, refName: scan.ref.refName, sha: scan.ref.sha, order: 100 + ws.refs.length, role: 'target', synthetic: false,
        detectedVersions: scan.ref.detectedVersions, inferredStep: scan.ref.inferredStep,
      };
      addLiveScan(id, gitRef, scan);
      let text = `스캔 완료: ${scan.stats.filesScanned}개 파일, 탐지 ${scan.findings.length}건 (${scan.stats.durationMs}ms)${scan.stats.truncated ? ' · 응답 크기 한도로 일부만 반환됨' : ''}.`;
      if (known) {
        const snap = sd!.snapshots[known.refId];
        const key = (f: { ruleId: string; filePath: string; line: number }) => `${f.ruleId}|${f.filePath}|${f.line}`;
        const a = new Set(snap.findings.filter(isActive).map(key));
        const b = new Set(scan.findings.map(key));
        const diff = [...a].filter((k) => !b.has(k)).length + [...b].filter((k) => !a.has(k)).length;
        text += diff === 0 ? ` 같은 SHA(${known.refId})의 스냅샷과 탐지 결과가 일치합니다.` : ` ⚠ 같은 SHA의 스냅샷과 ${diff}건 다릅니다 (규칙셋 버전: 스냅샷 ${snap.rulesetVersion}, 라이브 ${scan.rulesetVersion}).`;
        setMsg({ kind: diff === 0 ? 'ok' : 'bad', text });
      } else setMsg({ kind: 'ok', text });
    } catch (e) {
      setMsg({ kind: 'bad', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

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
        {live.length > 0 && (<><h3>라이브 스캔 결과</h3><ul className="small">{live.map((r) => <li key={r.id}>{r.repo} @ {r.refName} ({r.sha.slice(0, 8)})</li>)}</ul></>)}
      </Card>
      <Card title="라이브 스캔 (공개 GitHub 저장소)">
        <Alert kind="info">공개 저장소만 분석합니다. 서버리스 함수가 해당 커밋의 아카이브를 메모리에서만 해제해 규칙을 실행하고, 소스는 저장하지 않습니다.</Alert>
        <label className="field">저장소 (owner/name)<input type="text" value={repo} onChange={(e) => setRepo(e.target.value)} /></label>
        <label className="field" style={{ marginTop: 8 }}>Ref (브랜치·태그·SHA)<input type="text" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        <label className="field" style={{ marginTop: 8 }}>exclude glob (줄마다 하나)<textarea rows={4} value={exclude} onChange={(e) => setExclude(e.target.value)} /></label>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn primary" disabled={busy || !repo.trim() || !ref.trim()} onClick={scan}>{busy ? '스캔 중…' : '라이브 스캔 실행'}</button>
        </div>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
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
