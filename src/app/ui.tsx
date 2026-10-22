import type { ReactNode } from 'react';
import { GRADE_LABEL, type Grade } from '../shared/scoring/index.ts';

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <header>
          <h2>{title}</h2>
          <div className="row">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

/** 지표 도움말: 접이식. 의미·계산식·읽는 법을 차트 바로 아래에 둔다. */
export function Help({ title = '이 지표는? (의미와 계산 방식)', children }: { title?: string; children: ReactNode }) {
  return (
    <details className="help">
      <summary>ⓘ {title}</summary>
      <div className="help-body">{children}</div>
    </details>
  );
}

export const SyntheticBadge = ({ text = '가상 데이터' }: { text?: string }) => <span className="badge b-synthetic" title="실제 시스템이 아닌 가상 값입니다">◇ {text}</span>;

export function AiBadge({ model, at }: { model?: string; at?: string }) {
  return (
    <span className="badge b-ai" title="AI가 생성한 제안입니다. 사람이 검토해야 합니다.">
      ✦ AI 제안 – 검토 필요{model ? ` · ${model}` : ''}{at ? ` · ${new Date(at).toLocaleString('ko-KR')}` : ''}
    </span>
  );
}

const GRADE_CLASS: Record<Grade, string> = { Low: 'b-ok', Medium: 'b-info', High: 'b-warn', Critical: 'b-bad' };
export const GradeBadge = ({ grade, score }: { grade: Grade; score?: number }) => (
  <span className={`badge ${GRADE_CLASS[grade]}`}>{GRADE_LABEL[grade]}{score !== undefined ? ` · ${score}점` : ''}</span>
);

const SEV_CLASS: Record<string, string> = { critical: 'b-bad', high: 'b-bad', medium: 'b-warn', low: 'b-info', info: 'b-mute' };
const SEV_LABEL: Record<string, string> = { critical: '치명 (critical)', high: '높음 (high)', medium: '보통 (medium)', low: '낮음 (low)', info: '정보 (info)' };
export const SeverityBadge = ({ s }: { s: string }) => <span className={`badge ${SEV_CLASS[s] ?? 'b-mute'}`}>{SEV_LABEL[s] ?? s}</span>;

export function Alert({ kind, children }: { kind: 'warn' | 'bad' | 'ok' | 'info'; children: ReactNode }) {
  return <div className={`alert ${kind}`} role={kind === 'bad' ? 'alert' : 'status'}>{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <button key={i.id} role="tab" aria-selected={value === i.id} onClick={() => onChange(i.id)}>{i.label}</button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2>{title}</h2>
          <button className="btn small" onClick={onClose}>닫기</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Progress = ({ value, max }: { value: number; max: number }) => (
  <div className="bar" role="progressbar" aria-valuenow={value} aria-valuemax={max}><i style={{ width: `${max ? (value / max) * 100 : 0}%` }} /></div>
);

export const fmtKRW = (n: number) =>
  Math.abs(n) >= 1e8 ? `${(n / 1e8).toFixed(1)}억원` : Math.abs(n) >= 1e4 ? `${Math.round(n / 1e4).toLocaleString('ko-KR')}만원` : `${Math.round(n).toLocaleString('ko-KR')}원`;

export function download(name: string, content: string | Blob, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
