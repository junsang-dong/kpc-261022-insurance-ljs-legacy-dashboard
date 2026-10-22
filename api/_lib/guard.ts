import { ApiError } from './github.ts';

/**
 * 서버리스 인스턴스 메모리 기반의 근사 요청 제한. 인스턴스가 여러 개이거나 재시작되면 정확하지 않다.
 * 정확한 한도가 필요하면 2차에서 외부 저장소 기반 제한으로 교체한다 (명세 9장).
 */
const hits = new Map<string, number[]>();

export function rateLimit(key: string, max = 30, windowMs = 60_000): void {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new ApiError(429, '요청이 너무 많습니다. 잠시 후 다시 시도하세요.', { retryAt: new Date(list[0] + windowMs).toISOString() });
  list.push(now);
  hits.set(key, list);
}

export function checkAccess(request: Request): void {
  const code = process.env.APP_ACCESS_CODE;
  if (code && request.headers.get('x-access-code') !== code) throw new ApiError(401, '접근 코드가 필요합니다.');
  const ip = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
  rateLimit(ip);
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) return json({ error: e.message, ...e.extra }, e.status);
  console.error(JSON.stringify({ level: 'error', message: (e as Error).message }));
  return json({ error: '서버 내부 오류' }, 500);
}

export function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...fields })); // 프롬프트 본문은 기록하지 않는다
}
