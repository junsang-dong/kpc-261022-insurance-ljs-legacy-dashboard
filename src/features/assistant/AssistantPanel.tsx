import { useRef, useState } from 'react';
import { AiBadge } from '../../app/ui.tsx';
import { AiError, streamAi, useAssistant, type AiMeta } from './aiClient.ts';

interface Msg { role: 'user' | 'bot'; text: string; meta?: AiMeta; at?: string }

export function AssistantPanel() {
  const { open, setOpen, context } = useAssistant();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  if (!open) return null;

  async function send() {
    const question = q.trim();
    if (!question || busy) return;
    setQ('');
    setBusy(true);
    setMsgs((m) => [...m, { role: 'user', text: question }, { role: 'bot', text: '' }]);
    abort.current = new AbortController();
    const patchLast = (fn: (m: Msg) => Msg) => setMsgs((m) => [...m.slice(0, -1), fn(m[m.length - 1])]);
    try {
      const meta = await streamAi('assistant_chat', { question, context }, (t) => {
        patchLast((m) => ({ ...m, text: m.text + t }));
        end.current?.scrollIntoView({ block: 'end' });
      }, abort.current.signal);
      patchLast((m) => ({ ...m, meta, at: new Date().toISOString() }));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') patchLast((m) => ({ ...m, text: `⚠ ${e instanceof AiError ? e.message : '요청에 실패했습니다.'}` }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="drawer" aria-label="AI 마이그레이션 어시스턴트">
      <header>
        <div>
          <strong>AI 어시스턴트</strong>
          <div className="small muted">현재 화면: {String(context.screen ?? '—')}{context.refName ? ` · ${context.refName}` : ''}</div>
        </div>
        <button className="btn small" onClick={() => setOpen(false)}>닫기</button>
      </header>
      <div className="body">
        {msgs.length === 0 && (
          <div className="muted small">
            <p>전환 원칙, 탐지 규칙, 클라우드 전환 리스크에 대해 물어보세요. 예:</p>
            <ul>
              <li>springmodules Validator를 Bean Validation으로 바꾸는 순서는?</li>
              <li>왜 Java 21 전환과 jakarta 전환을 한 Step에 합치면 안 되나요?</li>
              <li>main 브랜치에서 Step 5 전에 남은 일은?</li>
            </ul>
            <p>답변은 참고 정보이며 단계 게이트 판정에는 사용되지 않습니다. 소스는 공개 저장소·가상 데이터만 입력하세요.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text || (busy && i === msgs.length - 1 ? '…' : '')}
            {m.role === 'bot' && m.meta && (
              <div style={{ marginTop: 6 }}>
                <AiBadge model={m.meta.model} at={m.at} />
                <span className="small muted"> 캐시 읽기 {m.meta.cacheReadInputTokens} 토큰</span>
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <footer>
        <textarea
          rows={3}
          maxLength={2000}
          value={q}
          placeholder="질문 입력 (최대 2,000자, Ctrl+Enter 전송)"
          aria-label="질문"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && send()}
        />
        <div className="row end">
          {busy && <button className="btn" onClick={() => abort.current?.abort()}>중지</button>}
          <button className="btn primary" disabled={busy || !q.trim()} onClick={send}>전송</button>
        </div>
      </footer>
    </aside>
  );
}
