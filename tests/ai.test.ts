import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const calls: Record<string, unknown>[] = [];
let reply: Record<string, unknown> = {};

vi.mock('../api/_lib/anthropic.ts', async (orig) => {
  const real = await orig<typeof import('../api/_lib/anthropic.ts')>();
  return {
    ...real,
    anthropic: () => {
      real.anthropic(); // 키가 없으면 실제 코드와 같이 503
      return { messages: { create: async (args: Record<string, unknown>) => { calls.push(args); return reply; } } };
    },
  };
});

const { POST } = await import('../api/ai.ts');
const { systemBlocks } = await import('../api/_lib/anthropic.ts');

const post = (body: unknown) =>
  POST(new Request('http://x/api/ai', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': `t${Math.random()}` } }));

const ok = (obj: unknown) => ({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 0 }, content: [{ type: 'text', text: JSON.stringify(obj) }] });
const EXPLAIN = { cause: 'c', impact: 'i', replacement: 'r', codeBefore: 'a', codeAfter: 'b', cautions: [] };

beforeEach(() => {
  calls.length = 0;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.APP_ACCESS_CODE;
  reply = ok(EXPLAIN);
});

describe('/api/ai 가드레일', () => {
  it('Claude로 보내는 본문에서 이메일·전화·IP·계정이 마스킹된다', async () => {
    const res = await post({
      task: 'explain_finding',
      input: { ruleId: 'RULE-CL-002', filePath: 'ctx.xml', snippet: '<property name="password" value="s3cr3t"/> // 담당 kim@corp.com 010-1234-5678 10.20.30.40' },
    });
    expect(res.status).toBe(200);
    const sent = JSON.stringify(calls[0].messages);
    expect(sent).not.toMatch(/kim@corp\.com|010-1234-5678|10\.20\.30\.40|s3cr3t/);
    expect(sent).toContain('[EMAIL]');
  });

  it('스니펫은 20줄로 잘린다', async () => {
    const snippet = Array.from({ length: 40 }, (_, i) => `line${i}`).join('\n');
    await post({ task: 'explain_finding', input: { ruleId: 'R', filePath: 'a', snippet } });
    const sent = JSON.stringify(calls[0].messages);
    expect(sent).toContain('line19');
    expect(sent).not.toContain('line20');
  });

  it('프롬프트 캐싱: 시스템 블록 마지막에 cache_control, 규칙 카탈로그와 명세 발췌 포함', async () => {
    await post({ task: 'explain_finding', input: { ruleId: 'R', filePath: 'a', snippet: 'x' } });
    const sys = calls[0].system as { text: string; cache_control?: unknown }[];
    expect(sys.at(-1)?.cache_control).toEqual({ type: 'ephemeral' });
    expect(sys.some((b) => b.text.includes('RULE-FW-021'))).toBe(true);
    expect(sys.some((b) => b.text.includes('14.5절'))).toBe(true);
    // 요청마다 달라지는 입력은 캐시 접두어(system) 밖의 user 메시지에만 있어야 한다
    expect(JSON.stringify(sys)).not.toContain('"filePath"');
    expect(systemBlocks().map((b) => b.text)).toEqual(sys.map((b) => b.text));
  });

  it('구조화 출력: output_config.format에 JSON Schema를 지정하고 메타에 캐시 토큰을 담는다', async () => {
    const res = await post({ task: 'explain_finding', input: { ruleId: 'R', filePath: 'a', snippet: 'x' } });
    const body = await res.json();
    expect((calls[0].output_config as { format: { type: string } }).format.type).toBe('json_schema');
    expect(calls[0].model).toBe('claude-haiku-5-5');
    expect(body.result).toEqual(EXPLAIN);
    expect(body.meta.cacheReadInputTokens).toBe(7);
  });

  it('모델 ID는 환경변수로 교체할 수 있다', async () => {
    process.env.AI_MODEL_FAST = 'custom-fast';
    await post({ task: 'explain_finding', input: { ruleId: 'R', filePath: 'a', snippet: 'x' } });
    delete process.env.AI_MODEL_FAST;
    expect(calls[0].model).toBe('custom-fast');
  });

  it('refusal / max_tokens 이면 파싱하지 않고 재시도를 안내한다 (422)', async () => {
    for (const stop of ['refusal', 'max_tokens']) {
      reply = { ...ok(EXPLAIN), stop_reason: stop };
      const res = await post({ task: 'explain_finding', input: { ruleId: 'R', filePath: 'a', snippet: 'x' } });
      expect(res.status).toBe(422);
    }
  });

  it('정의되지 않은 task, 2000자 초과 질문은 400', async () => {
    expect((await post({ task: 'nope', input: {} })).status).toBe(400);
    expect((await post({ task: 'assistant_chat', input: { question: 'a'.repeat(2001) } })).status).toBe(400);
  });

  it('API 키가 없으면 503, 접근 코드가 설정되면 헤더가 필요하다', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect((await post({ task: 'explain_finding', input: { ruleId: 'R', filePath: 'a', snippet: 'x' } })).status).toBe(503);
    process.env.APP_ACCESS_CODE = 'lab-2026';
    expect((await post({ task: 'explain_finding', input: { ruleId: 'R', filePath: 'a', snippet: 'x' } })).status).toBe(401);
  });

  it('요청 제한: 같은 IP에서 분당 한도를 넘기면 429', async () => {
    const hit = () => POST(new Request('http://x/api/ai', { method: 'POST', body: '{}', headers: { 'x-forwarded-for': 'same-ip' } }));
    let last = 0;
    for (let i = 0; i < 35; i++) last = (await hit()).status;
    expect(last).toBe(429);
  });
});

describe('구조화 출력 스키마 (4.7.2절)', () => {
  const walk = (s: Record<string, unknown>, path: string, errs: string[]) => {
    for (const bad of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems']) if (bad in s) errs.push(`${path}: ${bad} 사용 금지`);
    if (s.type === 'object') {
      if (s.additionalProperties !== false) errs.push(`${path}: additionalProperties:false 필요`);
      for (const [k, v] of Object.entries((s.properties ?? {}) as Record<string, Record<string, unknown>>)) walk(v, `${path}.${k}`, errs);
    }
    if (s.type === 'array') walk(s.items as Record<string, unknown>, `${path}[]`, errs);
  };
  it.each(['explain_finding', 'migration_plan'])('%s 스키마는 지원 범위 안에 있다', (name) => {
    const errs: string[] = [];
    walk(JSON.parse(readFileSync(`prompts/schemas/${name}.json`, 'utf8')), name, errs);
    expect(errs).toEqual([]);
  });
});
