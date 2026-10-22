import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RulesFile } from '../../src/shared/types/index.ts';

let cached: RulesFile | undefined;

/** 빌드 시 생성된 public/data/rules.json (vercel.json의 includeFiles로 함수에 포함) */
export function loadRules(): RulesFile {
  cached ??= JSON.parse(readFileSync(join(process.cwd(), 'public/data/rules.json'), 'utf8')) as RulesFile;
  return cached;
}
