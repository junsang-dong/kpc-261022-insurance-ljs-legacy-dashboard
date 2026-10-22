import { useEffect, useMemo, useRef, useState } from 'react';
import { AiBadge, Alert, Card, download } from '../../app/ui.tsx';
import { useAppImpacts } from '../../store/derived.ts';
import { AiError, streamAi, useAssistant, type AiMeta } from '../assistant/aiClient.ts';
import { buildReportMarkdown, reportAiInput } from './report.ts';

export function Report() {
  const d = useAppImpacts();
  const setContext = useAssistant((s) => s.setContext);
  const [draft, setDraft] = useState('');
  const [meta, setMeta] = useState<{ meta: AiMeta; at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => setContext({ screen: '보고서' }), [setContext]);
  const md = useMemo(() => (d ? buildReportMarkdown(d) : ''), [d]);
  if (!d) return null;

  async function gen() {
    setBusy(true);
    setErr('');
    setDraft('');
    setMeta(null);
    abort.current = new AbortController();
    try {
      const m = await streamAi('report_draft', reportAiInput(d!), (t) => setDraft((x) => x + t), abort.current.signal);
      setMeta({ meta: m, at: new Date().toISOString() });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr(e instanceof AiError ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const full = `${md}\n---\n\n## 9. 경영진 보고 초안${meta ? ' (AI 초안 – 검토 후 수정됨)' : ''}\n\n${draft || '(작성하지 않음)'}\n`;

  return (
    <>
      <div className="page-head">
        <div><h1>보고서</h1><p>자동 집계 보고서와 AI 초안을 합쳐 Markdown으로 내보냅니다. PDF는 브라우저 인쇄(PDF로 저장)를 사용하세요.</p></div>
        <div className="row">
          <button className="btn" onClick={() => navigator.clipboard?.writeText(full)}>복사</button>
          <button className="btn" onClick={() => window.print()}>인쇄 / PDF</button>
          <button className="btn primary" onClick={() => download(`migration-report-${new Date().toISOString().slice(0, 10)}.md`, full, 'text/markdown')}>Markdown 내보내기</button>
        </div>
      </div>
      <div className="grid cols-2">
        <Card title="자동 집계 (규칙·계산 기반)"><div className="md" tabIndex={0}>{md}</div></Card>
        <Card title="경영진 보고 초안" actions={meta && <AiBadge model={meta.meta.model} at={meta.at} />}>
          <div className="row" style={{ marginBottom: 8 }}>
            <button className="btn primary" onClick={gen} disabled={busy}>{busy ? '생성 중…' : '✦ AI 초안 생성'}</button>
            {busy && <button className="btn" onClick={() => abort.current?.abort()}>중지</button>}
          </div>
          {err && <Alert kind="bad">{err}</Alert>}
          <textarea rows={22} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="AI 초안 (편집 가능)" placeholder="AI 초안을 생성하거나 직접 작성하세요. 내보내기에 포함됩니다." />
          <p className="small muted">AI 초안은 위 집계 수치만 입력으로 받으며 소스 원문은 전송하지 않습니다. 반드시 검토·수정 후 사용하세요.</p>
        </Card>
      </div>
    </>
  );
}
