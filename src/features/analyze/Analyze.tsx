import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Card, GradeBadge, SeverityBadge } from '../../app/ui.tsx';
import { AXES, AXIS_LABEL } from '../../shared/scoring/index.ts';
import { STEP_NAMES } from '../../shared/types/index.ts';
import { useAppImpacts } from '../../store/derived.ts';
import { analysisAppId, useWs } from '../../store/workspace.ts';
import { useAssistant } from '../assistant/aiClient.ts';
import { DEFAULT_EXCLUDES, PRESETS, fetchRefs, parseGithubInput, scanRepo, type Preset, type RefsInfo } from './analysis.ts';

type Phase = 'idle' | 'refs' | 'scan' | 'save' | 'done' | 'error';
const PHASES: { id: Phase; label: string }[] = [
  { id: 'refs', label: '① 저장소 확인 (공개 여부·기본 브랜치)' },
  { id: 'scan', label: '② 소스 수신 · 규칙 엔진 실행' },
  { id: 'save', label: '③ 결과 반영 (앱·Ref 자동 등록, 영향도 계산)' },
];

export function Analyze() {
  const d = useAppImpacts();
  const addAnalysis = useWs((s) => s.addAnalysis);
  const removeAnalysis = useWs((s) => s.removeAnalysis);
  const setContext = useAssistant((s) => s.setContext);
  const [url, setUrl] = useState('');
  const [ref, setRef] = useState('');
  const [excludes, setExcludes] = useState(DEFAULT_EXCLUDES.join('\n'));
  const [preset, setPreset] = useState<string>('');
  const [info, setInfo] = useState<RefsInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState('');
  const [lastApp, setLastApp] = useState('');
  const [secs, setSecs] = useState(0);
  const [failed, setFailed] = useState<Phase>('refs');
  useEffect(() => setContext({ screen: '저장소 분석' }), [setContext]);

  const busy = phase === 'refs' || phase === 'scan' || phase === 'save';
  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const id = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [busy]);

  const parsed = url.trim() ? parseGithubInput(url) : null;
  const parseError = parsed && 'error' in parsed ? parsed.error : '';

  function choose(p: Preset) {
    setPreset(p.id);
    setUrl(`https://github.com/${p.repo}`);
    setRef(p.ref ?? '');
    setExcludes([...DEFAULT_EXCLUDES, ...(p.extraExcludes ?? [])].join('\n'));
    setInfo(null);
    setErr('');
  }

  async function run(target?: { repo: string; ref?: string; excludes?: string[] }) {
    const p = target ?? (parsed && !('error' in parsed) ? { repo: parsed.repo, ref: ref.trim() || parsed.ref } : null);
    if (!p || busy) return;
    const ex = target?.excludes ?? excludes.split('\n').map((s) => s.trim()).filter(Boolean);
    setErr('');
    setSecs(0);
    let cur: Phase = 'refs';
    try {
      setPhase('refs');
      const meta = await fetchRefs(p.repo);
      setInfo(meta);
      cur = 'scan';
      setPhase('scan');
      const scan = await scanRepo(p.repo, p.ref, ex);
      cur = 'save';
      setPhase('save');
      setLastApp(addAnalysis(scan));
      setPhase('done');
    } catch (e) {
      setErr((e as Error).message);
      setFailed(cur);
      setPhase('error');
    }
  }

  function runPreset(p: Preset) {
    choose(p);
    void run({ repo: p.repo, ref: p.ref, excludes: [...DEFAULT_EXCLUDES, ...(p.extraExcludes ?? [])] });
  }

  async function loadRefs() {
    if (!parsed || 'error' in parsed) return;
    setErr('');
    try {
      setInfo(await fetchRefs(parsed.repo));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const result = d?.impacts.find((i) => i.app.id === lastApp);
  const resultRef = result?.refId ? d?.refData.get(result.refId) : undefined;
  const analyzed = d?.impacts.filter((i) => i.app.id.startsWith('GH-')) ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>저장소 분석</h1>
          <p>레거시 프로젝트가 있는 공개 GitHub 저장소 URL을 입력하면 소스를 내려받아(메모리에서만 처리) 규칙 엔진으로 자동 분석하고, 애플리케이션과 Ref로 등록해 영향도·전환 경로를 계산합니다.</p>
        </div>
      </div>

      <div className="grid cols-2">
        <Card title="분석할 저장소">
          <label className="field">GitHub 저장소 URL
            <input type="text" value={url} placeholder="https://github.com/owner/repo" aria-label="GitHub 저장소 URL"
              onChange={(e) => { setUrl(e.target.value); setPreset(''); setInfo(null); }}
              onKeyDown={(e) => e.key === 'Enter' && run()} />
          </label>
          {parseError && <p className="small" style={{ color: 'var(--bad)' }} role="alert">{parseError}</p>}
          <div className="row" style={{ marginTop: 8, alignItems: 'end' }}>
            <label className="field" style={{ flex: 1 }}>Ref (브랜치·태그·SHA, 비우면 기본 브랜치)
              <input type="text" list="ref-list" value={ref} placeholder={info?.defaultBranch ?? '기본 브랜치'} onChange={(e) => setRef(e.target.value)} />
              <datalist id="ref-list">{[...(info?.branches ?? []), ...(info?.tags ?? [])].map((r) => <option key={r} value={r} />)}</datalist>
            </label>
            <button className="btn" onClick={loadRefs} disabled={!parsed || !!parseError || busy}>Ref 목록 불러오기</button>
          </div>
          {info && (
            <p className="small muted">
              기본 브랜치 <code>{info.defaultBranch}</code> · 브랜치 {info.branches.length}개 · 태그 {info.tags.length}개{info.archived ? ' · 보관(archived)됨' : ''}
              {info.description && <><br />{info.description}</>}
            </p>
          )}
          <details style={{ marginTop: 8 }}>
            <summary className="small">고급: 제외할 경로 (glob, 줄마다 하나)</summary>
            <textarea rows={5} value={excludes} onChange={(e) => setExcludes(e.target.value)} aria-label="제외 glob" />
            <p className="small muted">슬래시가 없는 패턴은 어느 디렉터리의 같은 파일명에도 적용됩니다. 템플릿 POM 등은 여기서 제외하세요.</p>
          </details>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={() => run()} disabled={busy || !parsed || !!parseError}>{busy ? '분석 중…' : '분석 시작'}</button>
            {busy && <span className="small muted">{secs}초 경과 · 큰 저장소는 수십 초 걸릴 수 있습니다</span>}
          </div>
          {(phase !== 'idle') && (
            <ol className="small" style={{ paddingLeft: 18, margin: '10px 0 0' }} aria-live="polite">
              {PHASES.map((p, i) => {
                const at = PHASES.findIndex((x) => x.id === (phase === 'error' ? failed : phase));
                const state = phase === 'done' ? 'done' : i < at ? 'done' : i === at ? (phase === 'error' ? 'error' : 'run') : 'todo';
                return <li key={p.id} style={{ color: state === 'todo' ? 'var(--muted)' : undefined }}>{state === 'done' ? '✓ ' : state === 'run' ? '⏳ ' : state === 'error' ? '✗ ' : ''}{p.label}</li>;
              })}
            </ol>
          )}
          {err && <Alert kind="bad">{err}</Alert>}
          <Alert kind="info">공개 저장소만 분석합니다. 소스는 서버리스 함수의 메모리에서만 처리되고 저장되지 않으며, 브라우저에는 파일 경로·라인·최대 3줄 스니펫만 보관됩니다. 사내 비공개 소스는 이 MVP에서 지원하지 않습니다.</Alert>
        </Card>

        <Card title="예시 저장소로 분석하기">
          <p className="small muted">저장소 URL이 없다면 아래 예시를 선택하세요. 소스 구조 유사성(XML 기반 Spring MVC + eGov 스타일 계층 + Maven WAR) 기준 추천 순입니다.</p>
          {PRESETS.map((p) => (
            <div key={p.id} className="kcard" style={preset === p.id ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : undefined}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{p.title}</strong>
                <span className="badge b-info">{p.similarity}</span>
              </div>
              <div className="mono small muted">{p.repo}{p.ref ? ` @ ${p.ref}` : ''}</div>
              <p className="small">{p.note}</p>
              {p.caution && <p className="small" style={{ color: 'var(--warn)' }}>⚠ {p.caution}</p>}
              <div className="row">
                <button className="btn small" onClick={() => choose(p)} disabled={busy} aria-pressed={preset === p.id}>{preset === p.id ? '✓ 선택됨' : '선택'}</button>
                <button className="btn small primary" onClick={() => runPreset(p)} disabled={busy}>선택하고 바로 분석</button>
              </div>
            </div>
          ))}
        </Card>
      </div>

      {phase === 'done' && result && resultRef && (
        <Card title={`분석 결과 · ${resultRef.ref.repo} @ ${resultRef.ref.refName}`} actions={<GradeBadge grade={result.impact.grade} score={result.impact.total} />}>
          {resultRef.snap.stats.truncated && (
            <Alert kind="warn">탐지 항목이 많아 규칙당 일부만 보관했습니다. 점수와 건수는 전체 건수로 계산되었고, 목록에는 규칙당 최대 200건까지 표시됩니다.</Alert>
          )}
          <div className="grid cols-3">
            <div>
              <h3>감지된 환경</h3>
              <dl className="kv small">
                <dt>Java</dt><dd>{resultRef.ref.detectedVersions.java ?? '감지 안 됨'}</dd>
                <dt>Spring</dt><dd>{resultRef.ref.detectedVersions.spring ?? '감지 안 됨'}</dd>
                <dt>표준프레임워크</dt><dd>{resultRef.ref.detectedVersions.egov ?? '감지 안 됨'}</dd>
                <dt>Servlet</dt><dd>{resultRef.ref.detectedVersions.servlet ?? '감지 안 됨'}</dd>
                <dt>추정 Step</dt><dd>{resultRef.ref.inferredStep !== undefined ? <strong>Step {resultRef.ref.inferredStep} · {STEP_NAMES[resultRef.ref.inferredStep]}</strong> : '추정 불가 (표준프레임워크 사용 흔적 없음)'}</dd>
                <dt>스캔</dt><dd>{resultRef.snap.stats.filesScanned}개 파일 · {(resultRef.snap.stats.durationMs / 1000).toFixed(1)}초</dd>
                <dt>커밋</dt><dd className="mono">{resultRef.ref.sha.slice(0, 12)}</dd>
              </dl>
            </div>
            <div>
              <h3>축별 점수</h3>
              <table><tbody>
                {AXES.map((a) => (
                  <tr key={a}><td>{AXIS_LABEL[a]}</td><td className="num"><strong>{result.impact.axes[a].score}</strong></td><td className="num small muted">{result.impact.axes[a].count}건</td></tr>
                ))}
                <tr><td>예상 공수</td><td className="num"><strong>{result.impact.effortHours}h</strong></td><td /></tr>
              </tbody></table>
              <p className="small muted">업무 중요도·연계 복잡도는 기본값(3 · 30)입니다. 인벤토리에서 수정하면 종합 점수가 바뀝니다.</p>
            </div>
            <div>
              <h3>상위 탐지 규칙</h3>
              {result.impact.top.length ? (
                <table><tbody>
                  {result.impact.top.slice(0, 6).map((t) => (
                    <tr key={t.ruleId}><td><Link to={`/findings?ref=${encodeURIComponent(resultRef.ref.id)}&rule=${t.ruleId}`}>{t.ruleId}</Link></td><td><SeverityBadge s={t.severity} /></td><td className="num">{t.count}건</td></tr>
                  ))}
                </tbody></table>
              ) : <p className="muted small">탐지된 전환 이슈가 없습니다. Java·Spring·eGov 소스가 거의 없는 저장소일 수 있습니다.</p>}
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <Link className="btn primary" to={`/findings?ref=${encodeURIComponent(resultRef.ref.id)}`}>탐지 결과 보기</Link>
            <Link className="btn" to={`/apps/${result.app.id}`}>앱 상세·체크리스트</Link>
            <Link className="btn" to="/refs">Git Ref 비교</Link>
            <Link className="btn" to="/board">AI 전환 계획</Link>
          </div>
        </Card>
      )}

      <Card title={`분석한 저장소 (${analyzed.length})`}>
        {analyzed.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>저장소</th><th>분석한 Ref</th><th>영향도</th><th>추정 Step</th><th /></tr></thead>
            <tbody>{analyzed.map(({ app, impact, refId }) => {
              const refs = app.refIds.map((id) => d!.refData.get(id)).filter(Boolean);
              return (
                <tr key={app.id}>
                  <td><Link to={`/apps/${app.id}`}>{app.name}</Link></td>
                  <td className="small">{refs.map((r) => <span key={r!.ref.id} className="badge b-mute" style={{ marginRight: 4 }}>{r!.ref.refName}</span>)}</td>
                  <td><GradeBadge grade={impact.grade} score={impact.total} /></td>
                  <td>{refId && d!.refData.get(refId)?.ref.inferredStep !== undefined ? `Step ${d!.refData.get(refId)!.ref.inferredStep}` : '—'}</td>
                  <td className="row">
                    <button className="btn small" disabled={busy} onClick={() => { const r = d!.refData.get(app.refIds[app.refIds.length - 1])!.ref; void run({ repo: r.repo, ref: r.refName, excludes: DEFAULT_EXCLUDES }); }}>다시 분석</button>
                    <button className="btn small danger" onClick={() => confirm(`${app.name}의 분석 결과와 관련 체크리스트·리스크를 삭제할까요?`) && removeAnalysis(app.id)}>삭제</button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <p className="muted">아직 분석한 저장소가 없습니다. 위에서 URL을 입력하거나 예시를 선택하세요.</p>}
        <p className="small muted">같은 저장소의 다른 브랜치·태그를 이어서 분석하면 같은 앱에 Ref로 추가되어 “Git Ref 비교”에서 전환 이력을 비교할 수 있습니다. 앱 ID 형식: <code>{analysisAppId('owner/repo')}</code></p>
      </Card>
    </>
  );
}

