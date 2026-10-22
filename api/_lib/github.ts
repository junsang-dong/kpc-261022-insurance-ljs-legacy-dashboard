import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import tar from 'tar-stream';
import { SCANNABLE, type InputFile } from '../../src/shared/rules-engine/index.ts';
import type { DiffFile, RefDiff } from '../../src/shared/types/index.ts';

export class ApiError extends Error {
  status: number;
  extra?: Record<string, unknown>;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const LIMITS = { fileBytes: 1_000_000, totalBytes: 30_000_000 };

export function parseRepo(input: string): string {
  const m = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/.exec(input.trim());
  if (!m) throw new ApiError(400, 'github.com 공개 저장소 형식(owner/name)만 허용됩니다.');
  return `${m[1]}/${m[2]}`;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'user-agent': 'migration-dashboard-poc', accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function gh(path: string): Promise<Response> {
  const res = await fetch(`https://api.github.com${path}`, { headers: headers(), redirect: 'follow' });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    if (res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429) {
      throw new ApiError(429, 'GitHub API 호출 한도를 초과했습니다.', { retryAt: reset ? new Date(Number(reset) * 1000).toISOString() : undefined });
    }
  }
  return res;
}

/** 공개 저장소인지 확인하고 기본 브랜치를 돌려준다. */
export async function assertPublic(repo: string): Promise<{ defaultBranch: string; description: string | null; archived: boolean }> {
  const res = await gh(`/repos/${repo}`);
  if (res.status === 404) throw new ApiError(400, '공개 저장소를 찾을 수 없습니다 (URL을 확인하세요. 비공개 저장소는 MVP에서 지원하지 않습니다).');
  if (!res.ok) throw new ApiError(502, `GitHub 응답 오류 (${res.status})`);
  const j = (await res.json()) as { private?: boolean; default_branch?: string; description?: string | null; archived?: boolean };
  if (j.private) throw new ApiError(400, '비공개 저장소는 MVP에서 분석할 수 없습니다.');
  return { defaultBranch: j.default_branch ?? 'main', description: j.description ?? null, archived: !!j.archived };
}

/** 분석 대상 Ref 후보: 기본 브랜치 + 브랜치·태그 각 최대 50개 */
export async function listRefs(repo: string) {
  const meta = await assertPublic(repo);
  const names = async (kind: 'branches' | 'tags') => {
    const res = await gh(`/repos/${repo}/${kind}?per_page=50`);
    if (!res.ok) return [] as string[];
    return ((await res.json()) as { name: string }[]).map((x) => x.name);
  };
  const [branches, tags] = await Promise.all([names('branches'), names('tags')]);
  return { ...meta, branches, tags };
}

export async function resolveSha(repo: string, ref: string): Promise<string> {
  if (!/^[A-Za-z0-9_./-]{1,200}$/.test(ref)) throw new ApiError(400, 'Ref 형식이 올바르지 않습니다.');
  const res = await gh(`/repos/${repo}/commits/${encodeURIComponent(ref).replace(/%2F/g, '/')}`);
  if (res.status === 404 || res.status === 422) throw new ApiError(404, `Ref를 찾을 수 없습니다: ${ref}`);
  if (!res.ok) throw new ApiError(502, `GitHub 응답 오류 (${res.status})`);
  return ((await res.json()) as { sha: string }).sha;
}

/** 해당 SHA의 tar.gz를 스트림으로 받아 메모리에서만 해제한다 (디스크 기록 없음). */
export async function fetchSourceFiles(repo: string, sha: string): Promise<InputFile[]> {
  const res = await fetch(`https://api.github.com/repos/${repo}/tarball/${sha}`, { headers: headers(), redirect: 'follow' });
  if (res.status === 404) throw new ApiError(404, '소스 아카이브를 찾을 수 없습니다.');
  if (!res.ok || !res.body) throw new ApiError(502, `아카이브 수신 실패 (${res.status})`);

  const files: InputFile[] = [];
  let total = 0;
  const extract = tar.extract();
  const done = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const path = header.name.split('/').slice(1).join('/');
      const keep = header.type === 'file' && path && SCANNABLE(path) && (header.size ?? 0) <= LIMITS.fileBytes;
      if (!keep) {
        stream.resume();
        stream.on('end', next);
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (c: unknown) => chunks.push(c as Buffer));
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        total += buf.length;
        if (total > LIMITS.totalBytes) return reject(new ApiError(413, '저장소가 MVP 한도(30MB)를 초과했습니다.'));
        files.push({ path, content: buf.toString('utf8') });
        next();
      });
      stream.on('error', reject);
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
  });
  const gunzip = createGunzip();
  gunzip.on('error', (e) => extract.destroy(e));
  Readable.fromWeb(res.body as never).pipe(gunzip).pipe(extract);
  await done;
  return files;
}

/* ───────────── Ref 간 diff (스냅샷 스크립트용) ───────────── */

export function parsePatch(patch: string | undefined): Pick<DiffFile, 'removed' | 'added'> {
  const removed: DiffFile['removed'] = [];
  const added: DiffFile['added'] = [];
  if (!patch) return { removed, added };
  let oldLine = 0;
  let newLine = 0;
  for (const l of patch.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) {
      oldLine = Number(h[1]);
      newLine = Number(h[2]);
    } else if (l.startsWith('-')) removed.push({ line: oldLine++, text: l.slice(1).slice(0, 300) });
    else if (l.startsWith('+')) added.push({ line: newLine++, text: l.slice(1).slice(0, 300) });
    else if (l.startsWith(' ')) {
      oldLine++;
      newLine++;
    }
  }
  return { removed, added };
}

export async function compareRefs(repo: string, fromSha: string, toSha: string): Promise<RefDiff> {
  const files: DiffFile[] = [];
  for (let page = 1; page <= 3; page++) {
    const res = await gh(`/repos/${repo}/compare/${fromSha}...${toSha}?per_page=100&page=${page}`);
    if (!res.ok) throw new ApiError(502, `compare 실패 (${res.status})`);
    const j = (await res.json()) as { files?: { filename: string; status: string; patch?: string; previous_filename?: string }[] };
    const list = j.files ?? [];
    for (const f of list) {
      // 변경 전 경로를 기준으로 기록해야 from-ref의 탐지 위치와 대조할 수 있다
      files.push({ path: f.previous_filename ?? f.filename, status: f.status, ...parsePatch(f.patch) });
    }
    if (list.length < 100) break;
  }
  return { fromSha, toSha, files };
}
