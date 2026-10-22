import { z } from 'zod';
import { scanFiles } from '../src/shared/rules-engine/index.ts';
import type { Finding, ScanResult } from '../src/shared/types/index.ts';
import { ApiError, assertPublic, fetchSourceFiles, listRefs, parseRepo, resolveSha } from './_lib/github.ts';
import { checkAccess, errorResponse, json, log } from './_lib/guard.ts';
import { loadRules } from './_lib/rules.ts';

const Scan = z.object({
  repo: z.string().max(200),
  /** 생략하면 저장소의 기본 브랜치를 분석한다 */
  ref: z.string().min(1).max(200).optional(),
  includeGlobs: z.array(z.string().max(200)).max(50).optional(),
  excludeGlobs: z.array(z.string().max(200)).max(50).optional(),
  rulesetVersion: z.string().max(100).optional(),
  /** 규칙당 보관할 최대 탐지 건수 (브라우저 저장소 한도 보호). 총건수는 ruleCounts로 항상 전달 */
  maxPerRule: z.number().int().min(1).max(2000).optional(),
});
const Body = z.union([z.object({ action: z.literal('refs'), repo: z.string().max(200) }), Scan.extend({ action: z.literal('scan').optional() })]);

const MAX_BYTES = 4_000_000; // Vercel 응답 본문 한도(4.5MB) 안쪽
const DEFAULT_PER_RULE = 200;

/** 규칙당 상한 → 그래도 한도를 넘으면 상한을 절반씩 줄인다. */
function fit(result: ScanResult, perRule: number): ScanResult {
  let n = perRule;
  for (;;) {
    const seen = new Map<string, number>();
    const kept = result.findings.filter((f: Finding) => {
      const c = (seen.get(f.ruleId) ?? 0) + 1;
      seen.set(f.ruleId, c);
      return c <= n;
    });
    if (kept.length < result.findings.length) {
      result.findings = kept;
      result.stats.truncated = true;
    }
    if (JSON.stringify(result).length <= MAX_BYTES || n <= 1) return result;
    n = Math.floor(n / 2);
  }
}

async function run(input: z.infer<typeof Scan>): Promise<Response> {
  const t0 = Date.now();
  const repo = parseRepo(input.repo);
  const meta = await assertPublic(repo);
  const refName = input.ref ?? meta.defaultBranch;
  const sha = await resolveSha(repo, refName);
  const files = await fetchSourceFiles(repo, sha);
  const rules = loadRules();
  const scan = scanFiles(files, rules.rules, { includeGlobs: input.includeGlobs, excludeGlobs: input.excludeGlobs });
  const ruleCounts: Record<string, number> = {};
  for (const f of scan.findings) ruleCounts[f.ruleId] = (ruleCounts[f.ruleId] ?? 0) + 1;
  const result = fit(
    {
      ref: { repo, refName, sha, detectedVersions: scan.detectedVersions, inferredStep: scan.inferredStep },
      stats: { ...scan.stats, durationMs: Date.now() - t0 },
      findings: scan.findings,
      rulesetVersion: rules.rulesetVersion,
      ruleCounts,
    },
    input.maxPerRule ?? DEFAULT_PER_RULE,
  );
  log({ fn: 'scan', repo, sha, files: scan.stats.filesScanned, findings: result.findings.length, truncated: result.stats.truncated, ms: Date.now() - t0 });
  // 같은 (repo, sha, rulesetVersion)이면 결과가 같으므로 SHA 고정 요청은 장기 캐시 가능
  const immutable = /^[0-9a-f]{40}$/.test(refName);
  return json(result, 200, {
    'cache-control': immutable ? 'public, s-maxage=31536000, immutable' : 'public, s-maxage=60, stale-while-revalidate=300',
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, '요청 형식이 올바르지 않습니다.');
    if (parsed.data.action === 'refs') return json(await listRefs(parseRepo(parsed.data.repo)), 200, { 'cache-control': 'public, s-maxage=60' });
    return await run(parsed.data);
  } catch (e) {
    return errorResponse(e);
  }
}

/** GET /api/scan?repo=&ref=<40자 SHA> : CDN이 캐시할 수 있는 읽기 전용 변형 */
export async function GET(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    const u = new URL(request.url);
    const parsed = Scan.safeParse({ repo: u.searchParams.get('repo') ?? '', ref: u.searchParams.get('ref') ?? undefined });
    if (!parsed.success) throw new ApiError(400, '요청 형식이 올바르지 않습니다.');
    return await run(parsed.data);
  } catch (e) {
    return errorResponse(e);
  }
}
