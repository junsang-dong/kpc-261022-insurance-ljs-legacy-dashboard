/** gitignore 유사 glob: `/`가 없는 패턴은 어느 디렉터리의 파일명과도 매치된다. */
export function globToRegExp(glob: string): RegExp {
  let g = glob.replace(/^\.\//, '');
  if (!g.includes('/')) g = `**/${g}`;
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, globs: RegExp[]): boolean {
  return globs.some((r) => r.test(path));
}
