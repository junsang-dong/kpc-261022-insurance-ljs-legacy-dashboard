// rules/*.yaml → public/data/rules.json (브라우저·함수·스냅샷 스크립트 공용)
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import type { Rule, RulesFile } from '../src/shared/types/index.ts';

const dir = 'rules';
const rules: Rule[] = [];
for (const f of readdirSync(dir).filter((n) => n.endsWith('.yaml')).sort()) {
  rules.push(...(parse(readFileSync(`${dir}/${f}`, 'utf8')) as Rule[]));
}
const ids = new Set<string>();
for (const r of rules) {
  if (ids.has(r.id)) throw new Error(`중복 규칙 ID: ${r.id}`);
  ids.add(r.id);
  new RegExp(r.pattern); // 잘못된 패턴이면 빌드 실패
}
rules.sort((a, b) => a.id.localeCompare(b.id));
// rulesetVersion = 규칙 내용 해시 → 규칙이 바뀌면 스냅샷·캐시가 자동 무효화된다
const hash = createHash('sha1').update(JSON.stringify(rules)).digest('hex').slice(0, 8);
const out: RulesFile = { rulesetVersion: `2026.10.1-${hash}`, rules };
mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/rules.json', JSON.stringify(out, null, 2));
console.log(`rules.json: ${rules.length}개 규칙, ${out.rulesetVersion}`);
