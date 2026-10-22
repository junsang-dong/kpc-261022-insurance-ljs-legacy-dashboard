import { z } from 'zod';
import { scanFiles } from '../src/shared/rules-engine/index.ts';
import type { Finding, ScanResult } from '../src/shared/types/index.ts';
import { ApiError, assertPublic, fetchSourceFiles, parseRepo, resolveSha } from './_lib/github.ts';
import { checkAccess, errorResponse, json, log } from './_lib/guard.ts';
import { loadRules } from './_lib/rules.ts';

const Body = z.object({
  repo: z.string().max(200),
  ref: z.string().min(1).max(200),
  includeGlobs: z.array(z.string().max(200)).max(50).optional(),
  excludeGlobs: z.array(z.string().max(200)).max(50).optional(),
  rulesetVersion: z.string().max(100).optional(),
});

const MAX_BYTES = 4_000_000; // Vercel 응답 본문 한도(4.5MB) 안쪽

/** 응답이 한도를 넘으면 규칙별 상위 N건만 남긴다. */
function fit(result: ScanResult): ScanResult {
  let n = Infinity;
  for (;;) {
    const body = JSON.stringify(result);
    if (body.length <= MAX_BYTES) return result;
    n = n === Infinity ? 500 : Math.floor(n / 2);
    if (n < 1) return result;
    const seen = new Map<string, number>();
    result.findings = result.findings.filter((f: Finding) => {
      const c = (seen.get(f.ruleId) ?? 0) + 1;
      seen.set(f.ruleId, c);
      return c <= n;
    });
    result.stats.truncated = true;
  }
}

async function run(input: z.infer<typeof Body>): Promise<Response> {
  const t0 = Date.now();
  const repo = parseRepo(input.repo);
  await assertPublic(repo);
  const sha = await resolveSha(repo, input.ref);
  const files = await fetchSourceFiles(repo, sha);
  const rules = loadRules();
  const scan = scanFiles(files, rules.rules, { includeGlobs: input.includeGlobs, excludeGlobs: input.excludeGlobs });
  const result = fit({
    ref: { repo, refName: input.ref, sha, detectedVersions: scan.detectedVersions, inferredStep: scan.inferredStep },
    stats: { ...scan.stats, durationMs: Date.now() - t0 },
    findings: scan.findings,
    rulesetVersion: rules.rulesetVersion,
  });
  log({ fn: 'scan', repo, sha, files: scan.stats.filesScanned, findings: result.findings.length, ms: Date.now() - t0 });
  // 같은 (repo, sha, rulesetVersion)이면 결과가 같으므로 SHA 고정 요청은 장기 캐시 가능
  const immutable = /^[0-9a-f]{40}$/.test(input.ref);
  return json(result, 200, {
    'cache-control': immutable ? 'public, s-maxage=31536000, immutable' : 'public, s-maxage=60, stale-while-revalidate=300',
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, '요청 형식이 올바르지 않습니다.');
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
    const parsed = Body.safeParse({ repo: u.searchParams.get('repo') ?? '', ref: u.searchParams.get('ref') ?? '' });
    if (!parsed.success) throw new ApiError(400, '요청 형식이 올바르지 않습니다.');
    return await run(parsed.data);
  } catch (e) {
    return errorResponse(e);
  }
}
