import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError } from './github.ts';
import { loadRules } from './rules.ts';

export type Task = 'explain_finding' | 'migration_plan' | 'report_draft' | 'assistant_chat';

/** 모델 라우팅: 코드 수정 없이 환경변수로 교체한다. 단건 설명은 경량 모델을 쓴다. */
export function modelFor(task: Task): string {
  return task === 'explain_finding'
    ? process.env.AI_MODEL_FAST || 'claude-haiku-5-5'
    : process.env.AI_MODEL_DEFAULT || 'claude-sonnet-5-5';
}

export const STRUCTURED: Partial<Record<Task, true>> = { explain_finding: true, migration_plan: true };
export const STREAMABLE: Partial<Record<Task, true>> = { report_draft: true, assistant_chat: true };

export const maxTokens = () => Math.min(Number(process.env.AI_MAX_TOKENS) || 4096, 8192);

let client: Anthropic | undefined;
export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new ApiError(503, 'AI 기능이 설정되지 않았습니다 (ANTHROPIC_API_KEY 필요).');
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const cache = new Map<string, string>();
const file = (p: string) => {
  if (!cache.has(p)) cache.set(p, read(p));
  return cache.get(p)!;
};

/**
 * 요청 간 동일한 앞부분(시스템 프롬프트 + 규칙 카탈로그 + 명세 발췌)을 한 덩어리로 캐시한다.
 * cache_control은 마지막 블록에 지정하며, 그 앞의 모든 블록이 캐시 접두어에 포함된다.
 */
export function systemBlocks(): Anthropic.TextBlockParam[] {
  const rules = loadRules();
  return [
    { type: 'text', text: file('prompts/system.md') },
    { type: 'text', text: `# 규칙 카탈로그 (rulesetVersion ${rules.rulesetVersion})\n\n\`\`\`json\n${JSON.stringify(rules.rules)}\n\`\`\`` },
    { type: 'text', text: file('prompts/context/spec-excerpt.md'), cache_control: { type: 'ephemeral' } },
  ];
}

export const taskPrompt = (task: Task) => file(`prompts/tasks/${task}.md`);
export const taskSchema = (task: Task): Record<string, unknown> => JSON.parse(file(`prompts/schemas/${task}.json`));

export function usageMeta(model: string, u: Anthropic.Usage | undefined, ms: number) {
  return {
    model,
    inputTokens: u?.input_tokens ?? 0,
    cacheReadInputTokens: u?.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: u?.cache_creation_input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    durationMs: ms,
  };
}
