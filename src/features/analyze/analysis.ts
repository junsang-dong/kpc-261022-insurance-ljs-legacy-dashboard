import type { ScanResult } from '../../shared/types/index.ts';
import { getAccessCode } from '../assistant/aiClient.ts';

/** 입력 예: `owner/name`, `https://github.com/owner/name(.git)`, `https://github.com/owner/name/tree/브랜치` */
export function parseGithubInput(input: string): { repo: string; ref?: string } | { error: string } {
  const s = input.trim();
  if (!s) return { error: '저장소 URL을 입력하세요.' };
  const m = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?(?:\/(?:tree|blob)\/([^?#]+?))?\/?(?:[?#].*)?$/.exec(s);
  if (!m) {
    if (/^(https?:\/\/|git@)/.test(s) && !/github\.com/.test(s)) return { error: 'github.com 저장소만 분석할 수 있습니다.' };
    return { error: 'GitHub 저장소 URL 형식이 아닙니다. 예: https://github.com/owner/repo' };
  }
  const [, owner, name, ref] = m;
  return { repo: `${owner}/${name}`, ref: ref ? decodeURIComponent(ref.split('/blob/')[0]) : undefined };
}

export interface RefsInfo { defaultBranch: string; description: string | null; archived: boolean; branches: string[]; tags: string[] }

const headers = () => {
  const code = getAccessCode();
  return { 'content-type': 'application/json', ...(code ? { 'x-access-code': code } : {}) };
};

async function call<T>(body: unknown): Promise<T> {
  const res = await fetch('/api/scan', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error ?? `요청 실패 (${res.status})`) + (j.retryAt ? ` (재시도 가능: ${new Date(j.retryAt).toLocaleTimeString('ko-KR')})` : ''));
  return j as T;
}

export const fetchRefs = (repo: string) => call<RefsInfo>({ action: 'refs', repo });

/** 기본 제외 대상: 점수와 무관한 정적 자산·빌드 산출물 */
export const DEFAULT_EXCLUDES = ['**/img/**', '**/images/**', '**/fonts/**', '**/node_modules/**', '**/target/**'];

export const scanRepo = (repo: string, ref: string | undefined, excludeGlobs: string[]) =>
  call<ScanResult>({ repo, ...(ref ? { ref } : {}), excludeGlobs });

export interface Preset {
  id: string;
  repo: string;
  ref?: string;
  title: string;
  similarity: string;
  note: string;
  caution?: string;
  extraExcludes?: string[];
}

/** 소스 구조 유사성(XML 기반 Spring MVC + eGov 스타일 + Maven WAR) 기준 추천 예시 */
export const PRESETS: Preset[] = [
  {
    id: 'practice-spring-study', repo: 'beginnerSpringStudy/practice-spring-study', title: 'practice-spring-study', similarity: '유사도 1순위',
    note: 'eGovFrame + Spring 4.x, Maven, MVC, AOP, 로그인·게시판 예제. As-Is(Spring 4.0.1 · JDK 1.8)에 가장 가까운 후보.',
    caution: 'H2 DB 기반이며 JDK 1.8 환경에 맞춰 검증이 필요합니다.',
  },
  {
    id: 'egovframe-web-sample-4.1', repo: 'eGovFramework/egovframe-web-sample', ref: '4.1.x', title: 'egovframe-web-sample (4.1.x)', similarity: '유사도 2순위',
    note: 'eGov 표준 구조와 XML 설정 기반 게시판. 4.1.x는 Spring 5.3 · javax · iBATIS가 남아 있는 브리지 단계 기준선입니다.',
    caution: 'main은 Spring 6.2.11 · JDK 17이므로 과거 브랜치(4.1.x 등)를 지정했습니다. 5개 Ref의 스냅샷 비교는 “Git Ref 비교”에서 볼 수 있습니다.',
    extraExcludes: ['pom-core.xml', 'pom-web.xml'],
  },
  {
    id: 'egovframe-runtime', repo: 'eGovFramework/egovframe-runtime', title: 'egovframe-runtime', similarity: '유사도 3순위',
    note: 'eGov 실행환경의 계층 구조, 공통 컴포넌트, Maven 멀티모듈 구성을 이해하기에 핵심.',
    caution: '규모가 큽니다(소스 한도 30MB 초과 시 413). 최신은 Spring 6/JDK 17 기반이라 레거시 비교는 과거 태그를 지정하세요.',
  },
  {
    id: 'awesome-egovframe', repo: 'eGovFramework/awesome-egovframe', title: 'awesome-egovframe', similarity: '유사도 4순위',
    note: 'eGov 기반 커뮤니티 프로젝트·컴포넌트를 모아 둔 인덱스. 관련 프로젝트 발굴용입니다.',
    caution: '소스가 거의 없는 목록형 저장소라 탐지 결과가 비어 있을 수 있습니다 (정상).',
  },
  {
    id: 'spring-integration-samples', repo: 'spring-projects/spring-integration-samples', title: 'spring-integration-samples', similarity: '유사도 5순위',
    note: 'XML 설정, 전통적 Spring 컨테이너 구성, 메시지 기반 처리 예제. eGov는 아니지만 Spring 4 시절 XML 중심 아키텍처 이해에 도움.',
    caution: '다수 모듈로 구성된 큰 저장소라 분석에 시간이 걸릴 수 있습니다.',
  },
];
