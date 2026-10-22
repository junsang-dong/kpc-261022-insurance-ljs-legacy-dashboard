// 인수 기준: 클라이언트 번들(dist/)에 API 키·토큰 값이나 sk-ant- 문자열이 없어야 한다. `npm run build` 후 실행된다.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

describe.skipIf(!existsSync('dist'))('dist 번들 점검', () => {
  const files = existsSync('dist') ? walk('dist').filter((f) => /\.(js|css|html|json|map)$/.test(f)) : [];
  const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');

  it('sk-ant- 형식 문자열이 없다', () => expect(text).not.toMatch(/sk-ant-/));
  it('서버 전용 환경변수 이름이 번들에 없다 (VITE_ 접두어로 노출된 적 없음)', () => {
    expect(text).not.toMatch(/VITE_ANTHROPIC|VITE_GITHUB|ANTHROPIC_API_KEY|GITHUB_TOKEN/);
  });
  it('환경에 키가 설정돼 있다면 그 값이 번들에 없다', () => {
    for (const k of ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN']) {
      const v = process.env[k];
      if (v && v.length > 8) expect(text.includes(v), k).toBe(false);
    }
  });
});
