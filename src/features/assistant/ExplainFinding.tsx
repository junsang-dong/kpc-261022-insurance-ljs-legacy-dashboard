import { useState } from 'react';
import { AiBadge, Alert } from '../../app/ui.tsx';
import type { DetectedVersions, Finding, Rule } from '../../shared/types/index.ts';
import { useWs } from '../../store/workspace.ts';
import { AiError, callAi, hashInput, type AiMeta } from './aiClient.ts';

interface Explanation { cause: string; impact: string; replacement: string; codeBefore: string; codeAfter: string; cautions: string[] }
const TO = { spring: '6.2', egov: '5.0', java: '21' };

export function ExplainFinding({ finding, rule, from }: { finding: Finding; rule: Rule; from: DetectedVersions }) {
  const saved = useWs((s) => s.ws!.aiResults);
  const saveAi = useWs((s) => s.saveAi);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = {
    ruleId: rule.id,
    filePath: finding.filePath,
    snippet: finding.snippet,
    fromVersions: { spring: from.spring ?? '', egov: from.egov ?? '', java: from.java ?? '' },
    toVersions: TO,
  };
  const key = hashInput('explain_finding', input);
  const rec = saved[key];
  const out = rec?.output as Explanation | undefined;

  async function run() {
    setBusy(true);
    setErr('');
    try {
      const { result, meta } = await callAi<Explanation>('explain_finding', input);
      saveAi(key, { task: 'explain_finding', model: (meta as AiMeta).model, createdAt: new Date().toISOString(), output: result });
    } catch (e) {
      setErr(e instanceof AiError ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="row">
        <button className="btn small" onClick={run} disabled={busy}>{busy ? 'AI 설명 생성 중…' : out ? 'AI 설명 다시 생성' : '✦ AI 설명'}</button>
        {rec && <AiBadge model={rec.model} at={rec.createdAt} />}
      </div>
      {err && <Alert kind="bad">{err}</Alert>}
      {out && (
        <div className="small">
          <h3>원인</h3><p>{out.cause}</p>
          <h3>영향</h3><p>{out.impact}</p>
          <h3>대체 방법</h3><p>{out.replacement}</p>
          <div className="grid cols-2">
            <div><div className="muted">변경 전</div><pre className="code">{out.codeBefore}</pre></div>
            <div><div className="muted">변경 후</div><pre className="code">{out.codeAfter}</pre></div>
          </div>
          {out.cautions.length > 0 && (<><h3>주의사항</h3><ul>{out.cautions.map((c, i) => <li key={i}>{c}</li>)}</ul></>)}
        </div>
      )}
    </div>
  );
}
