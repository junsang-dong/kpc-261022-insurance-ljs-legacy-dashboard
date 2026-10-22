/** Claude API로 보내기 전 개인정보·접속 정보를 마스킹한다 (4.7.4절 입력 가드레일). */
const RULES: [RegExp, string][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  [/\b\d{6}-?[1-4]\d{6}\b/g, '[RRN]'],
  [/\b01[016789]-?\d{3,4}-?\d{4}\b/g, '[PHONE]'],
  [/\b0\d{1,2}-\d{3,4}-\d{4}\b/g, '[PHONE]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]'],
  // 접속 계정·비밀번호: XML property, key=value, key: value
  [/(<property\s+name="(?:username|user|password|passwd|pwd)"\s+value=")[^"]*(")/gi, '$1[REDACTED]$2'],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|username)(\s*[=:]\s*)(["']?)[^\s"'<>,;]+\3/gi, '$1$2[REDACTED]'],
  [/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED]'],
];

export function maskText(s: string): string {
  let out = s;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}

export function maskDeep<T>(v: T): T {
  if (typeof v === 'string') return maskText(v) as T;
  if (Array.isArray(v)) return v.map(maskDeep) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)])) as T;
  return v;
}

export function limitLines(s: string, max: number): string {
  const lines = s.split('\n');
  return lines.length <= max ? s : lines.slice(0, max).join('\n');
}
