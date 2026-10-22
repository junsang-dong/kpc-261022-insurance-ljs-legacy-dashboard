import type { DetectedVersions, Step } from '../types/index.ts';
import { blankComments } from './comments.ts';

export interface VersionFile {
  path: string;
  content: string;
}
export interface Signals {
  javaxImports: number;
  jakartaImports: number;
  oldEgovImports: number;
  newEgovImports: number;
}

const PROP_RE = /<([A-Za-z][\w.-]*)>([^<>]*)<\/\1>/g;

function resolve(v: string | undefined, props: Map<string, string>): string | undefined {
  if (v === undefined) return undefined;
  let out = v.trim();
  for (let i = 0; i < 3 && out.includes('${'); i++) {
    out = out.replace(/\$\{([^}]+)\}/g, (m, k) => props.get(k) ?? m);
  }
  return out.includes('${') || out === '' ? undefined : out;
}

export function javaMajor(v?: string): number | undefined {
  if (!v) return undefined;
  const m = /^(?:1\.)?(\d+)/.exec(v);
  return m ? Number(m[1]) : undefined;
}

function pickPom(files: VersionFile[]): VersionFile[] {
  const poms = files.filter((f) => /(^|\/)pom[^/]*\.xml$/.test(f.path));
  const exact = poms.filter((f) => /(^|\/)pom\.xml$/.test(f.path)).sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  return exact.length ? exact : poms;
}

export function extractVersions(files: VersionFile[]): DetectedVersions {
  const v: DetectedVersions = {};
  const poms = pickPom(files);
  const text = poms.map((p) => blankComments(p.content, 'xml')).join('\n');
  const props = new Map<string, string>();
  for (const m of text.matchAll(PROP_RE)) if (!props.has(m[1])) props.set(m[1], m[2].trim());
  const R = (s?: string) => resolve(s, props);
  const first = (re: RegExp) => R(re.exec(text)?.[1]);

  v.java =
    first(/<maven\.compiler\.release>([^<]+)</) ??
    first(/<release>([^<]+)<\/release>/) ??
    first(/<java\.version>([^<]+)</) ??
    first(/<maven\.compiler\.source>([^<]+)</) ??
    first(/<source>([^<]+)<\/source>/);

  v.spring =
    R(props.get('spring.version')) ??
    R(props.get('spring-framework.version')) ??
    R(props.get('org.springframework.version')) ??
    R(props.get('spring.maven.artifact.version')) ??
    first(/<groupId>org\.springframework<\/groupId>\s*<artifactId>spring-[\w-]+<\/artifactId>\s*<version>([^<]+)</);
  if (!v.spring) {
    const boot = /<artifactId>spring-boot-starter-parent<\/artifactId>\s*<version>([^<]+)</.exec(text)?.[1];
    if (boot) v.spring = `boot ${boot}`;
  }

  v.egov =
    R(props.get('org.egovframe.rte.version')) ??
    R(props.get('egovframework.rte.version')) ??
    R(props.get('egovframe.rte.version')) ??
    first(/<groupId>(?:org\.egovframe\.rte|egovframework\.rte)<\/groupId>\s*<artifactId>[^<]+<\/artifactId>\s*<version>([^<]+)</) ??
    first(/<artifactId>egovframe[\w-]*parent<\/artifactId>\s*<version>([^<]+)</);

  const webXml = files.find((f) => /(^|\/)web\.xml$/.test(f.path));
  if (webXml) {
    const x = blankComments(webXml.content, 'xml');
    const m = /web-app_(\d+)_(\d+)\.xsd/.exec(x);
    v.servlet = m ? `${m[1]}.${m[2]}` : /<web-app[^>]*\sversion="(\d+\.\d+)"/.exec(x)?.[1];
  }
  v.servlet ??= first(/<artifactId>(?:javax|jakarta)\.servlet-api<\/artifactId>\s*<version>([^<]+)</);

  const docker = files.find((f) => /(^|\/)Dockerfile[^/]*$/.test(f.path));
  if (docker) v.dockerBase = /^\s*FROM\s+(\S+)/m.exec(blankComments(docker.content, 'hash'))?.[1];

  const ci = files.find((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path) && /java-version/.test(f.content));
  if (ci) v.ciJava = /java-version:\s*['"]?([\d.]+)/.exec(ci.content)?.[1];

  // README 폴백: POM에서 직접 읽을 수 없는 값(부모 POM이 정하는 버전)
  const readme = files.find((f) => /^README(\.md)?$/i.test(f.path));
  if (readme) {
    v.java ??= /\bJDK\s*[|:]?\s*(\d+)\b/.exec(readme.content)?.[1];
    v.spring ??= /Spring(?: |%20)Framework\s*[|:-]?\s*(\d+(?:\.\d+)+)/.exec(readme.content)?.[1];
  }
  for (const k of Object.keys(v) as (keyof DetectedVersions)[]) if (v[k] === undefined) delete v[k];
  return v;
}

/** 14.2절 매핑: 추출된 버전·신호로 전환 단계를 추정한다 (제안값이며 게이트 판정에는 쓰지 않는다). */
export function inferStep(v: DetectedVersions, s: Signals): Step | undefined {
  const major = javaMajor(v.java);
  if (s.jakartaImports > 0 && s.javaxImports === 0) return 4;
  if (major !== undefined && major >= 17) return 3;
  if (s.newEgovImports > 0) return 2;
  if (s.oldEgovImports > 0) return 0;
  return undefined;
}
