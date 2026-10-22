export type CommentStyle = 'c' | 'xml' | 'hash' | 'none';

export function commentStyleOf(types: string[]): CommentStyle {
  if (types.includes('java')) return 'c';
  if (types.includes('xml') || types.includes('pom') || types.includes('jsp')) return 'xml';
  if (types.some((t) => t === 'sh' || t === 'properties' || t === 'Dockerfile' || t === 'yaml')) return 'hash';
  return 'none';
}

/** 주석 영역을 공백으로 치환한다. 줄 수와 컬럼 위치는 유지된다. */
export function blankComments(text: string, style: CommentStyle): string {
  switch (style) {
    case 'c':
      return blankC(text);
    case 'xml':
      return text.replace(/<!--[\s\S]*?-->|<%--[\s\S]*?--%>/g, blank);
    case 'hash':
      return text.replace(/^[ \t]*#.*$/gm, blank);
    default:
      return text;
  }
}

const blank = (s: string) => s.replace(/[^\r\n]/g, ' ');

function blankC(text: string): string {
  const out: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && text[i] !== '\n') {
        out.push(text[i] === '\r' ? '\r' : ' ');
        i++;
      }
    } else if (c === '/' && d === '*') {
      out.push(' ', ' ');
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        out.push(text[i] === '\n' || text[i] === '\r' ? text[i] : ' ');
        i++;
      }
      if (i < n) {
        out.push(' ', ' ');
        i += 2;
      }
    } else if (c === '"' || c === "'") {
      // 문자열 리터럴 안의 // 를 주석으로 오인하지 않도록 통째로 보존한다
      out.push(c);
      i++;
      while (i < n && text[i] !== c && text[i] !== '\n') {
        if (text[i] === '\\' && i + 1 < n) {
          out.push(text[i], text[i + 1]);
          i += 2;
        } else {
          out.push(text[i]);
          i++;
        }
      }
      if (i < n && text[i] === c) {
        out.push(c);
        i++;
      }
    } else {
      out.push(c);
      i++;
    }
  }
  return out.join('');
}
