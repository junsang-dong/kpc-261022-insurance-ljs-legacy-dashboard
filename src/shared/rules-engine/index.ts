import type { Finding, Rule, ScanStats } from '../types/index.ts';
import { blankComments, commentStyleOf } from './comments.ts';
import { globToRegExp, matchesAny } from './glob.ts';
import { extractVersions, inferStep, type Signals } from './versions.ts';

export { extractVersions, inferStep, javaMajor } from './versions.ts';
export { blankComments } from './comments.ts';
export { globToRegExp } from './glob.ts';

export interface InputFile {
  path: string;
  content: string;
}
export interface ScanOptions {
  includeGlobs?: string[];
  excludeGlobs?: string[];
  /** true면 주석·exclude 대상에서만 매치된 항목도 플래그를 달아 반환한다 (규칙 검증·원시 측정용) */
  keepSuppressed?: boolean;
}

/** 파일 경로 → 규칙의 fileTypes와 대응하는 유형 목록 */
export function fileTypesOf(path: string): string[] {
  const base = path.split('/').pop() ?? path;
  const lower = base.toLowerCase();
  if (lower.endsWith('.java')) return ['java'];
  if (/^pom[^/]*\.xml$/.test(lower)) return ['pom', 'xml'];
  if (/\.(jsp|jspf|tag|tagx)$/.test(lower)) return ['jsp'];
  if (lower.endsWith('.xml')) return ['xml'];
  if (base.startsWith('Dockerfile')) return ['Dockerfile'];
  if (lower.endsWith('.properties')) return ['properties'];
  if (/\.ya?ml$/.test(lower)) return ['yaml'];
  if (/\.(sh|ksh|bash)$/.test(lower)) return ['sh'];
  if (lower.endsWith('.txt')) return ['txt'];
  return [];
}

export const SCANNABLE = (path: string) => fileTypesOf(path).length > 0 || /^README(\.md)?$/i.test(path);

const SIGNAL = {
  javax: /^\s*import\s+javax\.(servlet|persistence|validation|annotation|inject|mail|jms|transaction|ws|xml\.bind|json|el|faces|ejb)\b/,
  jakarta: /^\s*import\s+jakarta\./,
  oldEgov: /\begovframework\.rte\./,
  newEgov: /\borg\.egovframe\.rte\./,
};

function snippetOf(lines: string[], i: number): string {
  return lines
    .slice(i, i + 3)
    .map((l) => l.trimEnd().slice(0, 240))
    .join('\n')
    .trimEnd();
}

export function scanFiles(files: InputFile[], rules: Rule[], opts: ScanOptions = {}) {
  const t0 = Date.now();
  const include = (opts.includeGlobs ?? ['**/*']).map(globToRegExp);
  const exclude = (opts.excludeGlobs ?? []).map(globToRegExp);
  const compiled = rules.map((r) => ({ rule: r, re: new RegExp(r.pattern) }));
  const findings: Finding[] = [];
  const signals: Signals = { javaxImports: 0, jakartaImports: 0, oldEgovImports: 0, newEgovImports: 0 };
  const versionFiles: InputFile[] = [];
  let filesScanned = 0;

  for (const file of files) {
    if (!matchesAny(file.path, include)) continue;
    const excluded = matchesAny(file.path, exclude);
    if (excluded && !opts.keepSuppressed) continue;
    const types = fileTypesOf(file.path);
    if (!excluded) versionFiles.push(file);
    if (!types.length) continue;
    filesScanned++;

    const style = commentStyleOf(types);
    const rawLines = file.content.split('\n');
    const codeLines = blankComments(file.content, style).split('\n');

    if (!excluded && (types.includes('java') || types.includes('xml'))) {
      for (const l of codeLines) {
        if (types.includes('java')) {
          if (SIGNAL.javax.test(l)) signals.javaxImports++;
          if (SIGNAL.jakarta.test(l)) signals.jakartaImports++;
        }
        if (SIGNAL.oldEgov.test(l)) signals.oldEgovImports++;
        if (SIGNAL.newEgov.test(l)) signals.newEgovImports++;
      }
    }

    for (const { rule, re } of compiled) {
      if (!rule.fileTypes.some((t) => types.includes(t))) continue;
      for (let i = 0; i < rawLines.length; i++) {
        const raw = rawLines[i].replace(/\r$/, '');
        let inComment = false;
        if (rule.includeComments) {
          if (!re.test(raw)) continue;
        } else if (!re.test(codeLines[i].replace(/\r$/, ''))) {
          if (opts.keepSuppressed && re.test(raw)) inComment = true;
          else continue;
        }
        if ((inComment || excluded) && !opts.keepSuppressed) continue;
        const f: Finding = { ruleId: rule.id, filePath: file.path, line: i + 1, snippet: snippetOf(rawLines, i) };
        if (inComment) f.inComment = true;
        if (excluded) f.excluded = true;
        findings.push(f);
      }
    }
  }

  findings.sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.filePath.localeCompare(b.filePath) || a.line - b.line);
  const detectedVersions = extractVersions(versionFiles);
  const stats: ScanStats = { filesScanned, durationMs: Date.now() - t0, truncated: false, signals };
  return { findings, stats, detectedVersions, inferredStep: inferStep(detectedVersions, signals) };
}
