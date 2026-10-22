import { create } from 'zustand';

export interface AiMeta {
  requestId?: string;
  model: string;
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  durationMs: number;
  stopReason?: string;
}

export class AiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const CODE_KEY = 'migration-dashboard.accessCode';
export const getAccessCode = () => {
  try {
    return localStorage.getItem(CODE_KEY) ?? '';
  } catch {
    return '';
  }
};
export const setAccessCode = (v: string) => {
  try {
    localStorage.setItem(CODE_KEY, v);
  } catch {
    /* 저장 불가 환경에서는 새로고침 시 다시 입력 */
  }
};

const headers = () => {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const c = getAccessCode();
  if (c) h['x-access-code'] = c;
  return h;
};

async function failure(res: Response): Promise<never> {
  let msg = `요청 실패 (${res.status})`;
  try {
    msg = ((await res.json()) as { error?: string }).error ?? msg;
  } catch {
    /* 본문 없음 */
  }
  throw new AiError(res.status, msg);
}

export type StructuredTask = 'explain_finding' | 'migration_plan';
export type StreamTask = 'report_draft' | 'assistant_chat';

export async function callAi<T>(task: StructuredTask, input: unknown): Promise<{ result: T; meta: AiMeta }> {
  const res = await fetch('/api/ai', { method: 'POST', headers: headers(), body: JSON.stringify({ task, input }) });
  if (!res.ok) return failure(res);
  return res.json();
}

/** SSE(text/event-stream)를 읽어 텍스트 조각을 콜백으로 전달하고, 마지막 meta를 반환한다. */
export async function streamAi(task: StreamTask, input: unknown, onText: (t: string) => void, signal?: AbortSignal): Promise<AiMeta> {
  const res = await fetch('/api/ai', { method: 'POST', headers: headers(), body: JSON.stringify({ task, input, stream: true }), signal });
  if (!res.ok || !res.body) return failure(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let meta: AiMeta | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (!data) continue;
      const j = JSON.parse(data);
      if (event === 'meta') meta = j;
      else if (event === 'error') throw new AiError(502, j.error);
      else if (j.text) onText(j.text);
    }
  }
  if (!meta) throw new AiError(502, '응답이 중간에 끊겼습니다.');
  if (meta.stopReason === 'max_tokens') onText('\n\n…(길이 한도로 잘렸습니다)');
  return meta;
}

export function hashInput(task: string, input: unknown): string {
  const s = JSON.stringify(input);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `ai:${task}:${(h >>> 0).toString(36)}`;
}

/** 어시스턴트 패널이 보내는 "현재 화면 컨텍스트" */
interface AssistantState {
  open: boolean;
  context: Record<string, unknown>;
  setOpen: (o: boolean) => void;
  setContext: (c: Record<string, unknown>) => void;
}
export const useAssistant = create<AssistantState>((set) => ({
  open: false,
  context: {},
  setOpen: (open) => set({ open }),
  setContext: (context) => set({ context }),
}));
