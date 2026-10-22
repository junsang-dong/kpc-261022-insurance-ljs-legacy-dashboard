// 고정 커밋 SHA별 스캔 결과와 Ref 간 diff를 public/data/snapshots/ 에 생성한다.
//   npx tsx scripts/scan-snapshot.ts            # refs.json 전체
//   npx tsx scripts/scan-snapshot.ts --only 4.1.x
// GITHUB_TOKEN(선택)이 있으면 호출 한도가 늘어난다.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { scanFiles, type InputFile } from '../src/shared/rules-engine/index.ts';
import type { RefDiff, RulesFile, Snapshot } from '../src/shared/types/index.ts';
import { assertPublic, compareRefs, fetchSourceFiles, resolveSha } from '../api/_lib/github.ts';

interface RefsConfig {
  repo: string;
  includeGlobs: string[];
  excludeGlobs: string[];
  refs: { id: string; refName: string; pin: string | null; order: number; role: Snapshot['role']; synthetic: boolean }[];
}

const cfg = JSON.parse(readFileSync('public/data/seed/refs.json', 'utf8')) as RefsConfig;
const rules = JSON.parse(readFileSync('public/data/rules.json', 'utf8')) as RulesFile;
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
const outDir = join('public/data/snapshots', cfg.repo.replace('/', '__'));
mkdirSync(outDir, { recursive: true });

function readLocalDir(dir: string): InputFile[] {
  const out: InputFile[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ path: relative(dir, p).split('\\').join('/'), content: readFileSync(p, 'utf8') });
    }
  };
  walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const index: {
  repo: string;
  rulesetVersion: string;
  generatedAt: string;
  refs: { refId: string; refName: string; sha: string; order: number; role: string; synthetic: boolean; file: string }[];
  diffs: { from: string; to: string; fromSha: string; toSha: string; file: string }[];
} = { repo: cfg.repo, rulesetVersion: rules.rulesetVersion, generatedAt: new Date().toISOString(), refs: [], diffs: [] };

await assertPublic(cfg.repo);

for (const r of cfg.refs) {
  if (only && r.id !== only) continue;
  let files: InputFile[];
  let sha: string;
  if (r.synthetic) {
    files = readLocalDir('fixtures/legacy-overlay');
    sha = `overlay-${createHash('sha1').update(JSON.stringify(files)).digest('hex').slice(0, 12)}`;
  } else {
    sha = await resolveSha(cfg.repo, r.pin!);
    files = await fetchSourceFiles(cfg.repo, sha);
  }
  // keepSuppressed: 주석·exclude 대상에서만 매치된 항목도 플래그와 함께 보존 (규칙 검증·원시 측정용)
  const scan = scanFiles(files, rules.rules, { includeGlobs: cfg.includeGlobs, excludeGlobs: cfg.excludeGlobs, keepSuppressed: true });
  const snap: Snapshot = {
    refId: r.id,
    role: r.role,
    order: r.order,
    synthetic: r.synthetic,
    ref: { repo: cfg.repo, refName: r.refName, sha, detectedVersions: scan.detectedVersions, inferredStep: scan.inferredStep },
    stats: scan.stats,
    findings: scan.findings,
    rulesetVersion: rules.rulesetVersion,
  };
  const file = `${sha}.json`;
  writeFileSync(join(outDir, file), JSON.stringify(snap));
  index.refs.push({ refId: r.id, refName: r.refName, sha, order: r.order, role: r.role, synthetic: r.synthetic, file });
  const active = scan.findings.filter((f) => !f.inComment && !f.excluded).length;
  console.log(`${r.id.padEnd(8)} ${sha.slice(0, 12)}  파일 ${scan.stats.filesScanned}, 탐지 ${active} (+억제 ${scan.findings.length - active}), step ${scan.inferredStep ?? '-'}`, JSON.stringify(scan.detectedVersions));
}

// 연속된 실제 Ref 간 diff (오버레이 제외)
const real = index.refs.filter((r) => !r.synthetic).sort((a, b) => a.order - b.order);
for (let i = 0; i + 1 < real.length; i++) {
  const [a, b] = [real[i], real[i + 1]];
  if (only && a.refId !== only && b.refId !== only) continue;
  const diff: RefDiff = await compareRefs(cfg.repo, a.sha, b.sha);
  const file = `diff-${a.sha.slice(0, 12)}-${b.sha.slice(0, 12)}.json`;
  writeFileSync(join(outDir, file), JSON.stringify(diff));
  index.diffs.push({ from: a.refId, to: b.refId, fromSha: a.sha, toSha: b.sha, file });
  console.log(`diff ${a.refId} → ${b.refId}: 파일 ${diff.files.length}개`);
}

if (!only) writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1));
else console.log('--only 지정: index.json은 갱신하지 않았습니다.');
