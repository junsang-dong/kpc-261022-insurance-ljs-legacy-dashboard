# 클라우드 마이그레이션 대시보드 기술명세서

> 문서 버전: v1.2 (2026-10-22) — PoC용 MVP
> 대상 과정: KPC 「AI 네이티브 클라우드 아키텍처 설계」 실습 연계
> 문서 성격: 레거시 Java 시스템의 플랫폼·프레임워크 업그레이드와 클라우드 전환을 계획·추적하는 대시보드 앱의 구현 명세
> 기술 스택 (MVP): React + Vite (TypeScript) · Vercel Serverless Functions · Claude API — 별도 백엔드·DB 없음
> 예시 저장소: [eGovFramework/egovframe-web-sample](https://github.com/eGovFramework/egovframe-web-sample) (전자정부 표준프레임워크 심플 게시판, XML 설정 방식)

### 변경 이력

| 버전 | 일자 | 내용 |
|---|---|---|
| v1.0 | 2026-10-22 | 최초 작성 |
| v1.1 | 2026-10-22 | 예시 저장소(egovframe-web-sample) 기반 구현 명세 추가: 0.5절, 14장 신설. 4.2절 규칙, 5장 화면, 7장 데이터 모델, 8장 API, 11장 일정, 12장 인수 기준 보완 |
| v1.2 | 2026-10-22 | PoC용 MVP로 기술 스택 변경: 별도 백엔드 없이 React/Vite + Vercel Functions(`/api/scan`, `/api/ai`) + Claude API. 3~13장 재작성(스냅샷/라이브 스캔, 브라우저 저장소, AI 기능 4종 MVP 편입, 함수·환경변수·보안 설계, 정식 버전 전환 경로). 14.6~14.9절 MVP 기준으로 수정. 1~2장 방법론과 14.1~14.5절은 유지 |

---

## 0. 문서 개요

### 0.1 목적

본 문서는 다음 두 가지 문제를 해결하는 **클라우드 마이그레이션 대시보드(이하 "대시보드")**의 기술 명세를 정의한다. v1.2는 개념 검증을 위한 **MVP** 구현 명세이며, 정식 버전으로의 확장 경로는 13.2절에 정리한다.

1. **Conversion 영향도 최소화**: AIX 기반 레거시 Java 시스템을 최신 Linux·전자정부 표준프레임워크·Spring 6·Java 21로 업그레이드할 때, 변경 범위와 위험을 사전에 계량화하고 단계적 전환 경로를 제시한다.
2. **클라우드 전환의 부정적 영향 최소화**: 전환 시 발생하는 성능 저하, 비용 증가, 규제·보안 리스크, 업무 중단을 사전에 식별하고, 웨이브(Wave) 단위 전환과 롤백 계획을 관리한다.

### 0.2 전환 대상 구성 (As-Is → To-Be)

| 계층 | As-Is | To-Be | 비고 |
|---|---|---|---|
| OS / HW | IBM AIX 7.1 (POWER, Big-Endian) | Linux 10.x (예: RHEL 10 계열, x86_64 또는 aarch64, Little-Endian) | AIX 7.1은 2023-04-30 IBM 표준 지원 종료 |
| JDK | JDK 1.8 (AIX에서는 통상 IBM J9 계열) | Java 21 LTS (OpenJDK 계열) | RHEL 10.0 이상에서 OpenJDK 21 지원(Red Hat 기준 2029-12-31까지) |
| 표준프레임워크 | 전자정부 표준프레임워크 3.1 (`egovframework.rte.*`) | 전자정부 표준프레임워크 5.x (`org.egovframe.rte.*`) | 5.0.x는 Spring Boot 3.5 / Spring 6.2 / Jakarta EE 10 기반 |
| Spring | Spring Framework 4.0.1 (`javax.*`) | Spring Framework 6.2.x (`jakarta.*`) | Java 17+, Jakarta EE 9+ 필수 |
| 배포 환경 | 온프레미스 물리/LPAR, 상용 WAS | 클라우드(IaaS/컨테이너) 또는 하이브리드 | 금융권 클라우드 이용 절차 준수 필요 |

> "Linux 10.x"는 RHEL 10 및 그 호환 배포판(Rocky/AlmaLinux/Oracle Linux 10)을 가정한다. 다른 배포판이면 4.2절 OS 규칙만 조정한다.

### 0.3 버전 선택 시 유의사항

- **Spring 6.x 수명**: Spring Framework 7.0이 2025년 11월부터 현행 라인이며, Spring Boot 3.5.x의 OSS 패치도 마감 단계에 있다. 본 전환은 전자정부 표준프레임워크 5.x 정합성을 위해 **Spring 6.2를 목표로 하되, 코드는 Spring 7 / Jakarta EE 11 전환이 쉬운 형태**(deprecated API 미사용)로 작성한다.
- **표준프레임워크 버전**: 착수 시점의 최신 패치 버전(5.0.x)과 그에 포함된 Spring Boot 패치 버전을 다시 확인한다. 보안 취약점 수정이 포함된 Boot 패치 적용 여부를 별도 점검 항목으로 관리한다.

### 0.4 용어

| 용어 | 정의 |
|---|---|
| 영향도(Impact) | 특정 변경이 코드·설정·인프라·업무에 미치는 범위와 위험을 수치화한 값 |
| 웨이브(Wave) | 함께 전환·배포·검증하는 애플리케이션 묶음 |
| 브리지 버전 | 한 번에 건너뛰지 않기 위해 거쳐 가는 중간 버전 (예: 표준프레임워크 4.x / Spring 5.3) |
| 골든 마스터 | 전환 전 시스템의 입력-출력을 기록해 두고 전환 후 결과와 비교하는 회귀 기준 |
| 6R | Rehost, Replatform, Refactor, Repurchase, Retire, Retain 전환 전략 분류 |
| Git Ref | 분석 대상이 되는 브랜치·태그·커밋 (예: `origin/4.1.x`, `v5.0.0`) |
| 레거시 오버레이 | 예시 저장소에 없는 As-Is 특성(eGov 3.x, AIX 등)을 재현하기 위해 추가하는 정적 분석 전용 가상 파일 묶음 |

### 0.5 예시 저장소 적용 방침

본 명세의 대시보드는 **전자정부 표준프레임워크 공식 예제 저장소 `egovframe-web-sample`을 파일럿 분석 대상**으로 삼아 구현·검증한다. 이 저장소를 선택한 이유는 다음과 같다.

1. **전환 이력이 브랜치로 남아 있다**: `4.1.x`, `4.2.x`, `4.3.x`, `5.0.x`, `main` 브랜치(태그 `v4.1.0`~`v5.0.0`)가 Spring 5.3/javax에서 Spring 6.2/jakarta까지의 실제 전환 과정을 보여준다. 연속된 브랜치 간 diff를 **규칙 검증용 정답지**로 쓸 수 있다.
2. **국내 실무 구조와 같다**: XML 설정(`context-*.xml`, `dispatcher-servlet.xml`, `web.xml`), JSP, `*.do` URL, MyBatis 매퍼, 표준프레임워크 실행환경 등 국내 SI 프로젝트의 전형적 구조다.
3. **클라우드 전환 산출물이 있다**: 최신 브랜치에 `Dockerfile`, `docker-compose.yaml`, `k8s/` 매니페스트가 포함되어 Step 5(클라우드) 실습까지 이어갈 수 있다.
4. **규모가 작다**: 4.1.x 기준 Java 11개 파일, Java·JSP·XML 약 3,400줄로, 강의 시간 안에 전체 분석·전환 실습이 가능하다.

**한계와 보완**: 저장소는 eGov 4.1(Spring 5.3, `org.egovframe.rte` 패키지)부터 시작하므로, 본 과제의 As-Is인 **eGov 3.1 / Spring 4.0.1 / AIX 7.1 단계는 포함되어 있지 않다**. 이 구간은 14.3절의 **레거시 오버레이 픽스처**로 보완하고, 실제 실행 가능한 기준선은 `4.1.x` 브랜치(Java 1.8, javax)로 둔다. 상세 구현 명세는 **14장**에 정리한다.

---

## 1. Conversion 영향도 최소화 전략 (대시보드가 제시할 방법론)

대시보드는 아래 방법론을 **규칙(Rule)과 체크리스트로 내장**하여, 분석 결과에 따라 애플리케이션별 권장 경로를 자동 제시한다.

### 1.1 핵심 원칙: 한 번에 하나의 축만 바꾼다

OS, JDK, 프레임워크, 배포 환경을 동시에 바꾸면 장애 원인을 분리할 수 없다. 변경 축을 분리해 각 단계마다 회귀 테스트를 통과한 뒤 다음 단계로 넘어간다.

```
[Step 0] 기준선 확보 ── AIX + JDK8 + eGov3.1 + Spring 4.0.1 (현행)
   │       골든 마스터 테스트, 성능 기준선, 의존성 인벤토리
   ▼
[Step 1] OS 축 변경 ── Linux + JDK 8 (OpenJDK) + eGov 3.x 최신 패치 + Spring 4.3.x
   │       AIX 고유 의존성 제거, 엔디언·인코딩·셸 스크립트 이슈 해소
   ▼
[Step 2] 프레임워크 브리지 ── Linux + JDK 8/11 + eGov 4.x + Spring 5.3.x (javax 유지)
   │       패키지 경로 egovframework.rte → org.egovframe.rte 전환
   ▼
[Step 3] JDK 축 변경 ── Linux + JDK 17 + eGov 4.x + Spring 5.3.x
   │       제거된 Java EE 모듈, 내부 API 캡슐화, 기본 인코딩 이슈 해소
   ▼
[Step 4] Jakarta 전환 ── Linux + JDK 21 + eGov 5.x + Spring 6.2.x
   │       javax → jakarta, WAS/서블릿 컨테이너 교체, 제거된 Spring 기능 대체
   ▼
[Step 5] 배포 축 변경 ── 클라우드 (VM 리호스트 → 컨테이너)
```

> Step 1(OS)과 Step 5(클라우드)는 순서를 바꿀 수 있다. 클라우드 일정이 우선이면 "Linux VM on Cloud + JDK 8"로 먼저 리호스트하고, Step 2~4를 클라우드 위에서 진행한다. 대시보드는 두 경로의 위험·비용을 비교해 제시한다.

### 1.2 축별 주요 영향 항목과 대응

#### (1) AIX → Linux (OS·하드웨어 축)

| 영향 항목 | 내용 | 최소화 방법 |
|---|---|---|
| 엔디언 차이 | POWER(Big-Endian) → x86(Little-Endian). 바이너리 파일, 직접 직렬화한 데이터, 네이티브 라이브러리에 영향 | 바이너리 I/O 코드 탐지(`ByteBuffer`, `DataInputStream`, 전문 바이트 처리), 파일 포맷 비교 테스트 |
| 네이티브 라이브러리(JNI) | AIX용 `.a`/`.so`(보안 모듈, 암호화, 전자서명, 키보드 보안 서버 모듈) | 벤더별 Linux 빌드 확보 여부를 인벤토리 필수 항목으로 관리 |
| IBM JDK 전용 기능 | `com.ibm.*` 클래스, IBMJCE 보안 프로바이더, J9 전용 JVM 옵션(GC 정책 등) | 정적 분석으로 `com.ibm` import·JVM 옵션 탐지, 표준 JCA/OpenJDK 옵션으로 매핑 |
| 셸·배치 스크립트 | ksh, AIX 전용 명령(`lsattr`, `errpt`, `topas` 등), `cron` 형식 차이 | 스크립트 스캔 후 bash 변환, 배치 스케줄러로 이관 |
| 파일 시스템·경로 | JFS2 마운트 경로, 권한(UID/GID), 하드코딩 경로 | 경로 상수 외부화, 권한 매핑표 작성 |
| 문자셋·로케일 | `ko_KR.IBM-eucKR` 등 AIX 로케일, 기본 인코딩 | 로케일·인코딩 명시, 인코딩 변환 회귀 테스트 |
| 시간대·NTP | 배치 기준 시각, 보험기간 시작·종료 시각 계산 | `java.time`과 명시적 ZoneId 사용, 시간 동기화 점검 |

#### (2) JDK 1.8 → Java 21 (런타임 축)

| 영향 항목 | 내용 | 최소화 방법 |
|---|---|---|
| 제거된 Java EE 모듈 | JAXB, JAX-WS, `javax.annotation` 등이 JDK에서 제거됨 (Java 11) | 별도 라이브러리 의존성 추가(Jakarta 버전 선택은 Step 4와 연계) |
| 내부 API 강한 캡슐화 | `sun.misc.*`, `sun.security.*` 등 내부 API 접근 차단 (Java 17) | `jdeps --jdk-internals`로 사전 탐지, 대체 API 적용 |
| 기본 문자셋 UTF-8 | Java 18부터 `file.encoding` 기본값이 UTF-8. EUC-KR/MS949 기반 파일·전문 처리 결과가 달라질 수 있음 | 모든 I/O에 문자셋 명시, 전환 초기에는 `-Dfile.encoding=COMPAT` 임시 적용 후 단계적 제거 |
| 로케일 데이터 변경 | CLDR 로케일 데이터가 기본값이 되어 날짜·숫자 포맷 결과가 달라질 수 있음 (Java 9) | 한국어 날짜·통화 포맷 회귀 테스트, 필요 시 `java.locale.providers` 조정 |
| 스크립트 엔진 제거 | Nashorn 제거 (Java 15) | 서버측 JS 사용처 탐지 후 대체 |
| 보안·TLS 기본값 | 구형 TLS·약한 알고리즘 비활성화 | 대외기관 연계 구간 TLS 버전·암호 스위트 사전 협의 |
| GC·메모리 | 기본 GC가 G1로 변경, 컨테이너 메모리 인식 | 성능 기준선 대비 부하 테스트, 힙 설정 재산정 |

#### (3) 전자정부 표준프레임워크 3.1 / Spring 4.0.1 → 5.x / Spring 6.2 (프레임워크 축)

| 영향 항목 | 내용 | 최소화 방법 |
|---|---|---|
| 표준프레임워크 패키지 경로 | `egovframework.rte.*` → `org.egovframe.rte.*` (4.0부터) | Step 2에서 별도 변경 단위로 일괄 치환, 컴파일 단위 검증 |
| `javax` → `jakarta` | Servlet, JPA, Validation, Annotation, JSTL 등 전 영역 | OpenRewrite 레시피로 자동 변환, 미지원 서드파티 목록 관리 |
| 서블릿 컨테이너 | Tomcat 10 / Jetty 11 이상 필요, 상용 WAS는 Jakarta EE 10 지원 버전 필요 | WAS 벤더 지원 매트릭스 확인, 라이선스 갱신 일정과 연동 |
| 제거·변경된 Spring 기능 | `CommonsMultipartResolver` 제거, Apache Tiles 연동 제거, URL 끝 슬래시 매칭 기본값 변경 등 | 레이아웃은 Thymeleaf Layout/SiteMesh 등으로 대체, 파일 업로드는 표준 Multipart 사용, URL 매핑 회귀 테스트 |
| 데이터 접근 | iBATIS 2 계열 사용 시 MyBatis 3로 전환 필요, Commons DBCP → HikariCP 권장 | SQL Map 변환 도구 + SQL 결과 비교 테스트 |
| 로깅 | Log4j 1.x 사용 시 보안·호환 문제 | Log4j2 또는 SLF4J + Logback으로 전환 |
| XML 설정 | `context-*.xml`, `dispatcher-servlet.xml`, `web.xml` | XML 유지 후 단계적 Java Config 전환 (한 번에 바꾸지 않음) |
| 공통컴포넌트 | 3.x 공통컴포넌트(로그인, 권한, 게시판 등)의 테이블·API 변경 | 사용 중인 공통컴포넌트 목록화, 5.x 버전과 DDL 비교 |

#### (4) 영향도 최소화를 위한 공통 기법

1. **골든 마스터 회귀 테스트 선행**: 화면·API·배치의 입력-출력을 전환 전에 기록하고, 각 Step마다 동일 입력으로 비교한다. 보험료·환급금·지급액 계산은 원 단위까지 전수 비교한다.
2. **자동 변환 + 사람 검토 분리**: 기계적 변경(OpenRewrite, 패키지 치환)은 별도 커밋으로 분리해 리뷰 부담을 줄인다.
3. **기능 토글·병행 운영**: 신규 모듈은 토글로 일부 사용자에게만 노출한다.
4. **변경 단위 소형화**: 한 PR에는 한 종류의 변경만 담는다.
5. **AI 코딩 에이전트 활용**: 레거시 코드 설명, 특성 테스트 생성, 변환 초안 작성에 활용하되, 소스코드 외부 전송 가능 여부는 사내 보안정책을 먼저 확인한다.

---

## 2. 클라우드 전환의 부정적 영향 최소화 전략

### 2.1 부정적 영향 유형과 대응

| 유형 | 발생 원인 | 최소화 방법 | 대시보드 지표 |
|---|---|---|---|
| 지연시간 증가 | 앱은 클라우드, DB는 온프레미스로 분리 (데이터 중력 무시) | 강하게 결합된 앱-DB는 같은 웨이브로 이전, 불가피하면 전용선·캐시 적용 | 호출 경로별 RTT, 쿼리당 왕복 횟수 |
| 비용 급증 | 과대 사양 산정, 데이터 송신(egress) 비용, 병행 운영 기간 | 실측 사용률 기반 사이징, 송신 트래픽 추정, 병행 기간 예산 반영 | 월 예상 비용, 병행 비용, egress 추정치 |
| 라이선스 문제 | 상용 DB·WAS의 vCPU 기준 라이선스, BYOL 조건 | 라이선스 정책 사전 검토, 오픈소스 대체 가능성 평가 | 라이선스 리스크 플래그 |
| 규제·보안 리스크 | 전자금융감독규정상 클라우드 이용 절차, 망분리 규제, 개인(신용)정보 처리 | 업무 중요도 평가, 보고 절차 체크리스트, 정보보호·준법 부서 승인 단계를 워크플로에 내장 | 규제 체크리스트 완료율 |
| 대외 연계 단절 | 대외기관이 고정 IP 화이트리스트로 접속을 허용 | 고정 송신 IP(NAT) 확보, 기관별 IP 변경 신청 일정 관리 | 연계 기관별 준비 상태 |
| 배치 시간 초과 | 스토리지 I/O 특성 변화, 네트워크 경유 파일 처리 | 실데이터 규모 배치 리허설, 공유 스토리지 성능 검증 | 배치별 기준선 대비 수행 시간 |
| 세션·상태 문제 | WAS 세션 클러스터링, 로컬 파일 업로드 저장 | 세션 외부화, 파일은 객체 스토리지로 이관 | 상태 의존 컴포넌트 수 |
| 운영 공백 | 모니터링·백업·장애대응 체계 미이관 | 관측성·백업·DR 체계를 전환 전 구축 | 운영 준비도 점수 |
| 전환 실패 | 컷오버 중 장애 | 웨이브 단위 전환, 리허설 2회 이상, 롤백 기준·시간 사전 정의 | 롤백 준비 상태 |

### 2.2 웨이브 구성 원칙

1. **1차 웨이브**: 의존성이 적고 장애 영향이 낮은 시스템 (조회성, 내부용)
2. **중간 웨이브**: 앱-DB가 함께 이동 가능한 업무 단위
3. **최종 웨이브**: 결산·마감 배치, 보험료 산출 등 핵심 계산 시스템
4. 같은 DB를 강하게 공유하는 애플리케이션은 같은 웨이브에 묶는다.
5. 각 웨이브는 "리허설 → 컷오버 → 안정화 → 레거시 종료"의 4단계 게이트를 통과해야 한다.

---


## 3. 대시보드 앱 개요 (MVP)

### 3.1 MVP의 목적과 원칙

이번 버전은 **개념 검증(PoC) 목적의 MVP**다. "레거시 저장소를 넣으면 영향도와 전환 경로가 보이고, AI가 다음 작업을 제안한다"는 핵심 흐름이 실제로 동작하는지 확인하는 것이 목표다.

| 원칙 | 내용 |
|---|---|
| 별도 백엔드 없음 | 상시 구동 서버·DB 없이 **React/Vite 정적 프런트엔드 + Vercel Serverless Functions + Claude API**로 구성한다 |
| 서버 측 로직은 함수 2개 | 저장소 스캔(`/api/scan`)과 AI 호출(`/api/ai`)만 서버 측에서 실행한다. 나머지 계산(영향도 점수, 게이트 판정, 비용 추정)은 브라우저에서 수행한다 |
| 공개 저장소 한정 | MVP의 분석 대상은 **공개 GitHub 저장소**(예시: `egovframe-web-sample`)로 한정한다. 사내 비공개 소스는 MVP 범위에서 제외한다 (9장 보안) |
| AI는 핵심 런타임 | 프로젝트 공통 지침(AI Native)에 따라 AI 기능을 2차가 아닌 **MVP 범위**에 포함한다. 단, 게이트 판정 같은 결정은 규칙·테스트로 하고 AI는 설명·제안·초안을 담당한다 (Human in the Loop) |
| 상태는 브라우저에 | 사용자 입력(체크리스트, 단계, 리스크 등)은 브라우저 저장소에 두고 JSON 내보내기/가져오기로 공유한다. 다중 사용자 동기화는 2차 범위다 |
| 교체 가능한 구조 | 정식 버전에서 백엔드·DB를 붙일 수 있도록 데이터 접근을 `DataStore` 인터페이스 뒤에 둔다 (6.4절) |

### 3.2 제품 목표와 성공 지표 (MVP)

| 목표 | 성공 지표 |
|---|---|
| 예시 저장소 전환 이력 가시화 | `egovframe-web-sample` 5개 Ref + 레거시 오버레이의 탐지 결과·추정 Step을 한 화면에서 비교 |
| 영향도 정량화 | Ref별 축(OS·JDK·Framework·Cloud) 점수와 근거(파일·라인) 표시 |
| AI 기반 전환 가이드 | 탐지 항목 설명, 전환 계획 초안, 보고서 초안을 Claude API로 생성 |
| 클라우드 전환 리스크 점검 | 14.5절 잔여 갭을 체크리스트·리스크로 자동 생성 |
| 배포 용이성 | Git 푸시만으로 Vercel에 배포, 강의 실습생이 각자 포크해 30분 안에 구동 |

### 3.3 사용자 (MVP)

MVP는 강의·PoC 환경을 전제로 한다. 로그인·역할 구분 없이 단일 사용자 모드로 동작하며, 화면에서 "보기 관점"만 전환한다.

| 보기 관점 | 주로 보는 화면 |
|---|---|
| 아키텍트·개발자 | Ref 비교, 탐지 결과, 규칙 검증, AI 설명 |
| PM | 전환 경로 보드, 웨이브, 리스크, 보고서 |
| 경영진 | 요약 대시보드 |

### 3.4 범위

| 구분 | 포함 기능 |
|---|---|
| **MVP 포함** | 공개 저장소·Ref 등록, 서버리스 스캔(TypeScript 규칙 엔진), 스냅샷 데이터, 영향도 점수, Ref 비교, 규칙 검증, 전환 경로·체크리스트, 리스크, 간이 비용 추정, 요약 대시보드, Markdown 보고서, **AI 기능 4종**(설명·계획·보고서·질의응답) |
| **2차 (정식 버전)** | 다중 사용자·SSO·RBAC, 승인 워크플로, 서버 측 영속 저장소, 비공개 저장소 분석(사내망 분석 워커), jdeps·OpenRewrite 연동, 골든 마스터 결과 자동 연동, 실측 메트릭 연동, 웨이브 의존성 그래프 자동 생성, PDF 보고서 |
| **제외** | 코드 자동 수정·커밋, 클라우드 리소스 프로비저닝 |

> v1.1까지의 정식 버전 설계(Spring Boot API, PostgreSQL, 분석 워커, 승인 워크플로)는 2차 범위로 이관하며, 13.2절 "정식 버전 전환 경로"에 대응 관계를 정리한다.

---

## 4. 기능 명세

### 4.1 기능 목록

| ID | 기능 | MVP | 구현 위치 |
|---|---|---|---|
| F-01 | 인벤토리 관리 (앱·서버·DB·연계, 가상 데이터 포함) | O (간소화) | 브라우저 + 시드 JSON |
| F-02 | 저장소·Ref 등록 및 스캔 | O | `/api/scan` (라이브) 또는 스냅샷 JSON |
| F-03 | 영향도 점수 산출 및 근거 표시 | O | 브라우저 |
| F-04 | 전환 경로(Step 0~5) 관리 | O | 브라우저 |
| F-05 | 체크리스트 (Conversion / Cloud / 규제) | O | 브라우저 + 시드 JSON |
| F-06 | 웨이브 계획 | O (수동 배정만) | 브라우저 |
| F-07 | 리스크 레지스터 | O | 브라우저 |
| F-08 | 비용 추정 | O (단가표 기반 간이 계산) | 브라우저 + 단가 JSON |
| F-09 | 요약 대시보드 및 보고서 내보내기 | O (Markdown) | 브라우저 (+ `/api/ai` 보고서 초안) |
| F-10 | 승인 워크플로 | 2차 | — |
| F-11 | AI 마이그레이션 어시스턴트 | **O** | `/api/ai` (Claude API) |
| F-12 | 골든 마스터 결과 연동 | O (결과 JSON 수동 업로드) | 브라우저 |
| F-13 | 실측 메트릭 연동 | 2차 | — |
| F-14 | Ref 비교 / 규칙 검증 (14.6절) | O | 브라우저 (diff 데이터는 스냅샷 또는 `/api/scan`) |
| F-15 | 작업 상태 내보내기·가져오기 (JSON) | O | 브라우저 |

### 4.2 F-02 저장소 스캔 상세

MVP에는 상시 분석 서버가 없으므로, 스캔은 **두 가지 모드**로 제공한다.

| 모드 | 동작 | 용도 |
|---|---|---|
| **스냅샷 모드** (기본) | 개발자가 로컬 또는 GitHub Actions에서 `scripts/scan-snapshot.ts`를 실행해 고정 커밋 SHA별 스캔 결과·Ref 간 diff를 `public/data/snapshots/*.json`으로 생성하고 저장소에 커밋한다. 대시보드는 이 정적 JSON을 읽는다 | 강의 실습, 데모, 재현 가능한 결과. GitHub API 호출 한도·함수 실행 시간과 무관 |
| **라이브 모드** | 사용자가 공개 저장소 URL과 Ref를 입력하면 `/api/scan` 함수가 해당 커밋의 소스 아카이브를 내려받아 메모리에서 압축을 풀고 규칙 엔진을 실행한 뒤 결과 JSON을 반환한다 | 다른 공개 저장소를 즉석에서 분석 |

#### 라이브 스캔 처리 흐름 (`/api/scan`)

```
브라우저 ── POST /api/scan {repo, ref, includeGlobs, excludeGlobs, rulesetVersion}
   │
   ▼
Vercel Function (Node.js)
   1. 입력 검증: github.com 공개 저장소 형식만 허용, Ref는 브랜치·태그·SHA
   2. Ref → 커밋 SHA 확인 (GitHub REST API, 서버 측 GITHUB_TOKEN 사용)
   3. 해당 SHA의 tar.gz 아카이브를 스트림으로 내려받아 메모리에서 해제
      - 대상 확장자만 처리 (.java .xml .jsp .properties .yaml .yml Dockerfile .sh .ksh pom*.xml)
      - 파일당 1MB, 전체 30MB 초과 시 중단하고 "저장소가 MVP 한도를 초과" 응답
   4. 주석 제거 → 규칙 엔진 실행 → 버전 자동 추출(POM·web.xml·Dockerfile·CI)
   5. 결과 반환: Ref 메타데이터 + Finding 목록(파일 경로·라인·규칙 ID·스니펫 최대 3줄)
      - 응답 크기 4MB 이내로 제한 (Vercel 응답 본문 한도 4.5MB), 초과 시 규칙별 상위 N건만 반환하고 truncated 표시
   │
   ▼
브라우저: 결과를 브라우저 저장소에 캐시, 영향도 계산·화면 표시
```

- 동일 `(repo, sha, rulesetVersion)` 조합은 CDN 캐시 헤더(`Cache-Control: s-maxage`)를 붙여 재요청 시 함수를 다시 실행하지 않는다. 커밋 SHA가 같으면 결과가 같으므로 캐시가 안전하다.
- 스캔 함수는 규칙 엔진 모듈(`src/shared/rules-engine/`)을 브라우저·스냅샷 스크립트와 **공유**해 세 경로의 결과가 같도록 한다.

#### 분석 항목 (MVP)

| 분석 항목 | 방법 | MVP |
|---|---|---|
| 의존성·버전 추출 | `pom.xml` 파싱(부모 POM 버전 포함), `web.xml` 스키마 버전, Dockerfile `FROM`, CI `java-version` | O |
| javax 사용처 / jakarta 전환 대상 | 소스·POM 정규식 (주석 제외) | O |
| 표준프레임워크 구 패키지, 제거 기능 (iBATIS, springmodules, Tiles 등) | 정규식 규칙 | O |
| AIX·IBM JDK 의존성, 인코딩 위험 | 정규식 규칙 (레거시 오버레이로 검증) | O |
| 클라우드 준비도 (내장 DB, 하드코딩 계정, 세션, 이미지 JDK) | 정규식 규칙 | O |
| JDK 내부 API (`jdeps`), OpenRewrite dry-run | JDK·Maven 실행 필요 | 2차 (MVP에서는 로컬에서 생성한 결과 JSON 가져오기만 지원) |
| 의존성 취약점(CVE) | 외부 DB 조회 필요 | 2차 |

#### 탐지 규칙 카탈로그

규칙은 `rules/*.yaml`로 관리하고 빌드 시 JSON으로 변환해 브라우저·함수가 함께 사용한다. MVP 초기 규칙은 다음과 같다(v1.1과 동일).

```yaml
- id: RULE-OS-001
  axis: os
  title: IBM JDK 전용 클래스 사용
  pattern: "import com\\.ibm\\."
  severity: high
  effort_hours: 4
  guidance: 표준 JCA 프로바이더 또는 OpenJDK API로 대체

- id: RULE-JDK-003
  axis: jdk
  title: 문자셋을 지정하지 않은 바이트-문자열 변환
  pattern: "new String\\([a-zA-Z_]+\\)"
  severity: medium
  effort_hours: 0.5
  guidance: StandardCharsets 또는 Charset.forName("MS949") 등 명시

- id: RULE-FW-010
  axis: framework
  title: Apache Tiles 연동 사용
  pattern: "org\\.springframework\\.web\\.servlet\\.view\\.tiles"
  severity: high
  effort_hours: 16
  guidance: Spring 6에서 제거됨. Thymeleaf Layout 또는 JSP include 구조로 대체

- id: RULE-FW-001
  axis: framework
  title: 표준프레임워크 구 패키지 경로
  pattern: "egovframework\\.rte\\."
  severity: low
  effort_hours: 0.1
  guidance: org.egovframe.rte로 일괄 치환 (Step 2)

# ── 예시 저장소(egovframe-web-sample) 파일럿에서 추가한 규칙 ──
- id: RULE-FW-020
  axis: framework
  title: iBATIS SqlMap 사용 (EgovAbstractDAO, SqlMapClientFactoryBean)
  pattern: "EgovAbstractDAO|SqlMapClient"
  file_types: [java, xml]
  severity: high
  effort_hours: 4
  guidance: MyBatis 매퍼(@Mapper 인터페이스 + mapper XML)로 전환. 예시 저장소는 4.3.x에서 제거됨

- id: RULE-FW-021
  axis: framework
  title: springmodules Commons Validator 사용
  pattern: "org\\.springmodules\\.validation"
  file_types: [java, xml, jsp]
  severity: high
  effort_hours: 6
  guidance: Bean Validation(@Valid + jakarta.validation 어노테이션)으로 전환. 예시 저장소는 5.0.x에서 제거됨

- id: RULE-FW-022
  axis: framework
  title: Servlet 3.1/4.0 web.xml 스키마
  pattern: "web-app_3_1\\.xsd|web-app_4_0\\.xsd"
  file_types: [xml]
  severity: medium
  effort_hours: 0.5
  guidance: Jakarta EE 스키마(web-app 5.0 이상)로 변경, Tomcat 10.1 이상과 함께 적용

- id: RULE-FW-023
  axis: framework
  title: 구 JSTL taglib URI
  pattern: "java\\.sun\\.com/jsp/jstl"
  file_types: [jsp]
  severity: info
  effort_hours: 0.1
  guidance: Jakarta JSTL 구현체를 쓰면 동작은 유지됨. 신규 URI(jakarta.tags.*)로의 정리는 선택 사항

- id: RULE-JDK-010
  axis: jdk
  title: Java 1.8 컴파일 타깃
  pattern: "<source>1\\.8</source>|<target>1\\.8</target>"
  file_types: [pom]
  severity: medium
  effort_hours: 0.5
  guidance: maven-compiler-plugin의 <release>21</release>로 변경

- id: RULE-CL-001
  axis: cloud
  title: 내장(인메모리) DB 사용
  pattern: "jdbc:embedded-database"
  file_types: [xml]
  severity: high
  effort_hours: 8
  guidance: 관리형 DB(PostgreSQL 등)로 전환하고 접속 정보는 환경변수·Secret으로 주입

- id: RULE-CL-002
  axis: cloud
  title: 설정 파일 내 접속 계정·비밀번호 하드코딩
  pattern: "<property name=\"(username|password)\" value=\""
  file_types: [xml]
  severity: high
  effort_hours: 2
  guidance: 외부 설정(환경변수, Kubernetes Secret, 클라우드 Secret Manager)으로 분리

- id: RULE-CL-003
  axis: cloud
  title: 세션 기반 상태 의존 (SessionLocaleResolver, SessionStatus 등)
  pattern: "SessionLocaleResolver|HttpSession|@SessionAttributes"
  file_types: [java, xml]
  severity: medium
  effort_hours: 3
  guidance: 수평 확장 전 세션 외부화(Spring Session + Redis) 또는 CookieLocaleResolver 등 무상태 대안 적용

- id: RULE-CL-004
  axis: cloud
  title: 컨테이너 베이스 이미지의 JDK 버전이 목표(21)와 다름
  pattern: "FROM .*jdk(8|11|17)"
  file_types: [Dockerfile]
  severity: medium
  effort_hours: 1
  guidance: Java 21 기반 이미지(예: Tomcat 10.1 + JDK 21)로 교체하고 CI의 java-version도 함께 변경
```


규칙은 `rules/` 디렉터리의 YAML로 관리하고, 관리자 화면 대신 **Pull Request로 추가·수정**한다(MVP). 규칙 변경 시 `rulesetVersion`을 올려 스냅샷·캐시를 갱신한다.

#### 탐지 엔진 요구사항

- **주석 제외**: 예시 저장소 `main` 브랜치의 `context-datasource.xml`에는 DBCP·log4jdbc 설정이 XML 주석으로 남아 있어, 단순 정규식 검색에서는 오탐이 된다. 엔진은 Java(`//`, `/* */`), XML·JSP(`<!-- -->`, `<%-- --%>`), 셸(`#`) 주석을 기본 제외하고, 규칙별로 `includeComments: true`를 지정할 수 있어야 한다.
- **템플릿 파일 구분**: 저장소의 `pom-core.xml`, `pom-web.xml`은 개발환경 템플릿용 POM이다. 저장소 등록 시 include/exclude glob을 지정할 수 있어야 한다.
- **심각도 info**: 동작에 영향이 없는 정리 항목(예: 구 JSTL URI)은 `info`로 분류하고 영향도 점수에서 제외한다.
- **결정론**: 같은 커밋 SHA와 `rulesetVersion`이면 항상 같은 결과를 내야 한다. AI는 탐지에 관여하지 않는다.
- **공유 모듈**: 엔진은 순수 TypeScript(Node.js 전용 API 미사용)로 작성해 브라우저, Vercel 함수, 스냅샷 스크립트에서 동일하게 실행한다.

### 4.3 F-03 영향도 점수 산출

애플리케이션(또는 Ref)별 영향도 점수(0~100)는 축별 점수의 가중합으로 계산하며, **브라우저에서 계산**한다.

```
축별 원점수 = Σ (탐지 건수 × 심각도 가중치 × (1 - 자동변환율))
축별 점수   = min(100, 축별 원점수 / 정규화 계수 × 100)

종합 영향도 = 0.20 × OS + 0.20 × JDK + 0.30 × Framework
            + 0.15 × 업무 중요도 + 0.15 × 연계 복잡도
```

| 심각도 | 가중치 |
|---|---|
| critical | 10 |
| high | 5 |
| medium | 2 |
| low | 0.5 |
| info | 0 (점수 제외, 목록에만 표시) |

- **업무 중요도·연계 복잡도**: 인벤토리 입력값 (예시 앱은 가상값)
- **자동변환율**: MVP에서는 규칙별 `auto_fixable` 값(0 또는 1)으로 근사한다. OpenRewrite dry-run 연동은 2차
- **예상 공수** = Σ (탐지 건수 × 규칙별 effort_hours × (1 - 자동변환율))
- 가중치·정규화 계수는 `public/data/config/scoring.json`에서 관리하고 화면에서 임시 조정(What-if)할 수 있다.

| 점수 | 등급 | 권장 |
|---|---|---|
| 0~29 | Low | 표준 경로, 앞선 웨이브 배치 |
| 30~59 | Medium | 브리지 버전 경유 필수 |
| 60~79 | High | 사전 PoC 후 전환 |
| 80~100 | Critical | 재작성·교체 검토, 최종 웨이브 |

### 4.4 F-04 전환 경로 관리

- 각 앱은 Step 0~5 중 하나의 현재 단계를 가진다. Ref를 분석하면 추출된 버전으로 **추정 Step**을 자동 표시한다(14.2절 매핑 규칙).
- 단계 전환(Gate) 조건 (MVP):
  - 해당 단계 체크리스트 필수 항목 100% 완료
  - 골든 마스터 결과 JSON(14.7절)이 업로드되어 있고 실패 0건
  - 확인자 이름과 확인 메모 입력 → 브라우저 내 이력(`history`)에 기록
- 정식 승인 워크플로(F-10)는 2차 범위이며, MVP의 확인 이력은 내보내기 JSON에 포함된다.

### 4.5 F-06 웨이브 계획 (MVP)

- 앱을 웨이브에 수동 배정하고, 웨이브별 일정·컷오버 시간 창·롤백 기준을 입력한다.
- 인벤토리에 "공유 DB"가 같은 앱이 서로 다른 웨이브에 배정되면 경고를 표시한다.
- 의존성 그래프 자동 생성은 2차 범위다.

### 4.6 F-08 비용 추정 (MVP)

| 항목 | 입력 | 산출 |
|---|---|---|
| 현행 비용 | 하드웨어 유지보수·라이선스·상면 (수동 입력) | 연간 현행 비용 |
| 목표 컴퓨트 | 컨테이너 수 × vCPU·메모리 | 월 컴퓨트 비용 |
| 관리형 DB·스토리지 | 등급·용량 | 월 비용 |
| 병행 운영 | 웨이브별 병행 기간 | 일시 비용 |

- 단가는 `public/data/pricing/*.json`에 사용자가 직접 입력한 값으로 계산한다. **MVP는 단가를 자동 조회하지 않으며**, 화면에 "입력 단가 기준 추정치" 라벨을 표시한다.

### 4.7 F-11 AI 기능 (Claude API)

AI 기능은 모두 `/api/ai` 함수를 경유한다. 브라우저는 Claude API를 직접 호출하지 않으며, **API 키는 서버 측 환경변수에만 둔다**.

#### 4.7.1 기능 목록

| 모드 (`task`) | 입력 | 출력 | 기본 모델 | 출력 형식 |
|---|---|---|---|---|
| `explain_finding` | 탐지 항목 1건(규칙, 파일 경로, 스니펫 최대 20줄), 현재·목표 버전 | 원인, 영향, 대체 방법, 예시 코드(전·후), 주의사항 | `claude-haiku-5-5` | 구조화 출력(JSON Schema) |
| `migration_plan` | Ref 요약(버전, 축별 점수, 규칙별 탐지 건수), 목표 스택 | Step별 작업 목록, 작업별 예상 공수, 선행 조건, 리스크 | `claude-sonnet-5-5` | 구조화 출력 |
| `report_draft` | 요약 대시보드 지표, 리스크 목록, 웨이브 계획 | 경영진 보고용 Markdown 초안 | `claude-sonnet-5-5` | Markdown (스트리밍) |
| `assistant_chat` | 사용자 질문 + 현재 화면 컨텍스트(선택한 Ref·탐지 요약) | 답변, 참조한 규칙 ID·명세 절 | `claude-sonnet-5-5` | 텍스트 (스트리밍) |

- 모델 ID는 환경변수(`AI_MODEL_FAST`, `AI_MODEL_DEFAULT`)로 지정해 코드 수정 없이 교체한다 (프로젝트 지침: Model Router, 느슨한 결합).
- `migration_plan` 결과는 **제안**으로 표시하고, 사용자가 항목을 선택해야 체크리스트·리스크에 반영된다 (Human in the Loop).

#### 4.7.2 구조화 출력

`explain_finding`, `migration_plan`은 Messages API의 `output_config.format`에 JSON Schema(`type: "json_schema"`)를 지정해 응답을 받는다. 스키마는 `prompts/schemas/*.json`으로 관리한다.

- 스키마는 지원 범위 안에서 작성한다: `additionalProperties: false` 필수, 문자열 길이·숫자 범위 제약(`minLength`, `maximum` 등) 사용 금지. 길이 제한은 프롬프트 지시와 화면 측 잘라내기로 처리한다.
- `stop_reason`이 `refusal` 또는 `max_tokens`이면 파싱하지 않고 사용자에게 재시도를 안내한다.

`migration_plan` 스키마 예시 (요약):

```json
{
  "type": "object",
  "properties": {
    "summary": { "type": "string" },
    "steps": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "step": { "type": "string", "enum": ["STEP_0", "STEP_1", "STEP_2", "STEP_3", "STEP_4", "STEP_5"] },
          "tasks": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "title": { "type": "string" },
                "relatedRuleIds": { "type": "array", "items": { "type": "string" } },
                "effortHours": { "type": "number" },
                "prerequisite": { "type": "string" }
              },
              "required": ["title", "relatedRuleIds", "effortHours", "prerequisite"],
              "additionalProperties": false
            }
          },
          "risks": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["step", "tasks", "risks"],
        "additionalProperties": false
      }
    }
  },
  "required": ["summary", "steps"],
  "additionalProperties": false
}
```

#### 4.7.3 컨텍스트 구성과 프롬프트 캐싱

```
[system]  prompts/system.md          ── 역할, 금지사항, 출력 원칙       ┐
[system]  규칙 카탈로그 JSON (전체)                                    ├─ 캐시 대상 (요청 간 동일)
[system]  명세 발췌: 1장(전환 원칙), 2장(클라우드 영향), 14.2·14.5절   ┘
[user]    task별 입력 (탐지 항목, Ref 요약, 질문 등)                   ── 매 요청 변경
```

- 요청마다 동일한 앞부분(시스템 프롬프트 + 규칙 카탈로그 + 명세 발췌)에 `cache_control: {"type": "ephemeral"}`를 지정해 프롬프트 캐싱을 적용한다. 기본 캐시 수명은 5분이며 읽을 때마다 갱신되므로, 실습처럼 연속 호출이 많은 환경에서 입력 토큰 비용을 줄일 수 있다.
- 캐시 적중 여부는 응답의 `cache_read_input_tokens`로 확인해 사용량 로그에 남긴다.
- MVP의 "RAG"는 벡터 DB 없이 **명세·규칙 문서를 컨텍스트에 직접 넣는 방식**으로 구현한다. 문서가 커져 컨텍스트 효율이 떨어지면 2차에서 임베딩 검색(pgvector 등)으로 전환한다.
- 프롬프트는 코드에 하드코딩하지 않고 `prompts/` 디렉터리의 Markdown으로 관리한다 (프로젝트 지침 8장).

#### 4.7.4 가드레일

| 구분 | 내용 |
|---|---|
| 입력 | 스니펫 최대 20줄, 사용자 질문 최대 2,000자. 이메일·전화번호·주민등록번호 형식·IP·접속 계정 문자열은 `api/_lib/redact.ts`에서 마스킹 후 전송 |
| 소스 범위 | 공개 저장소 스니펫만 전송. "비공개 소스 붙여넣기" 입력란은 MVP에 두지 않는다 |
| 출력 | 생성 코드·계획에는 "AI 제안 – 검토 필요" 배지를 표시. 게이트 판정·점수 계산에는 AI 결과를 사용하지 않음 |
| 남용 방지 | 요청당 `max_tokens` 상한, 배포 보호(9장)와 간이 요청 제한 적용 |
| 기록 | 요청 ID, task, 모델, 입력·출력·캐시 토큰 수, 소요 시간을 함수 로그(구조화 JSON)에 기록. 프롬프트 본문은 로그에 남기지 않음 |

---

## 5. 화면 명세 (MVP)

| 화면 ID | 화면명 | 주요 구성 | MVP |
|---|---|---|---|
| UI-01 | 요약 대시보드 | 앱·Ref 수, 단계 분포, 영향도 등급 분포, 상위 리스크 5건, 비용 요약 | O |
| UI-02 | 인벤토리 | 앱·서버·DB·연계 목록(예시 앱은 "가상 데이터" 라벨) | O |
| UI-03 | 애플리케이션 상세 | 현재 단계, 축별 영향도 레이더 차트, 탐지 항목, 체크리스트, 확인 이력 | O |
| UI-04 | 탐지 결과 상세 | 규칙, 파일·라인(GitHub 해당 라인 링크), 스니펫, 가이드, **AI 설명 패널** | O |
| UI-05 | 전환 경로 보드 | Step 0~5 칸반, 게이트 조건 충족 여부, **AI 전환 계획 초안** | O |
| UI-06 | 웨이브 계획 | 웨이브 목록·일정, 공유 DB 경고 | O (간소화) |
| UI-07 | 리스크 레지스터 | 리스크 목록, 발생 가능성 × 영향도 매트릭스 | O |
| UI-08 | 비용 추정 | 현행 vs 목표, 병행 비용 | O (간소화) |
| UI-09 | 규제·승인 | 규제 체크리스트 | O (체크리스트만) |
| UI-10 | AI 어시스턴트 | 우측 슬라이드 패널(모든 화면에서 호출), 스트리밍 답변, 참조 규칙·명세 절 표시 | O |
| UI-11 | 설정 | 저장소·Ref 등록, 스캔 모드 선택, 점수 가중치 What-if, 상태 내보내기·가져오기·초기화 | O |
| UI-12 | Git Ref 비교 | Ref별 규칙 탐지 건수 추이(4.1.x → 4.3.x → 5.0.x → main), 추정 Step, 해소된 탐지와 diff 연결 | O |
| UI-13 | 규칙 검증 | Ref 간 diff 기준 규칙별 적중·오탐·미탐 후보 (14.6절) | O |

UI 원칙:
- 모든 점수에 "근거 보기"를 제공해 탐지 결과(파일·라인)까지 추적할 수 있어야 한다.
- 색상만으로 등급을 구분하지 않고 텍스트 라벨을 함께 표시한다.
- AI가 생성한 내용은 배지로 구분하고, 생성 시각·모델 ID를 함께 표시한다.
- 가상 데이터(레거시 오버레이, 예시 인벤토리)는 화면 전체에서 일관된 라벨로 구분한다.

---

## 6. 시스템 아키텍처 (MVP)

### 6.1 구성도

```
┌──────────────────────────────── Vercel 프로젝트 ────────────────────────────────┐
│                                                                                │
│  [정적 자산: Vite 빌드 결과]  ── CDN 배포                                         │
│   ├─ React SPA (화면, 영향도 계산, 게이트 판정, 비용 계산)                          │
│   └─ public/data/  (규칙 JSON, 스냅샷 JSON, 시드 인벤토리, 체크리스트, 단가표)        │
│                                                                                │
│  [Vercel Functions: Node.js 런타임]                                              │
│   ├─ api/scan.ts ── GitHub에서 공개 저장소 아카이브 수신 → 규칙 엔진 → Finding JSON   │
│   │                 (응답 CDN 캐시: repo+sha+rulesetVersion 기준)                  │
│   └─ api/ai.ts   ── 입력 검증·마스킹 → Claude API (Messages) → JSON 또는 스트림      │
│                                                                                │
└───────────────┬───────────────────────────────────────────┬────────────────────┘
                │                                           │
                ▼                                           ▼
        [GitHub (공개 저장소)]                          [Claude API]
        REST API, 소스 아카이브                         구조화 출력, 프롬프트 캐싱, 스트리밍

[브라우저 저장소]  사용자 작업 상태(체크리스트, 단계, 리스크, 웨이브, 확인 이력, AI 결과 캐시)
                  └─ JSON 내보내기/가져오기로 백업·공유
```

### 6.2 기술 스택

| 계층 | 기술 | 비고 |
|---|---|---|
| 프런트엔드 | React 19, TypeScript (strict), Vite | 프로젝트 지침의 TypeScript Strict, ESLint, Prettier 적용 |
| 라우팅·상태 | React Router, Zustand(브라우저 저장소 영속화), TanStack Query(함수 호출·캐시) | |
| 시각화 | ECharts (레이더·막대·추이 차트) | |
| 스타일 | Tailwind CSS 또는 CSS Modules | 접근성(대비, 키보드 탐색) 준수 |
| 서버리스 | Vercel Functions, Node.js 런타임 (현재 LTS), TypeScript, Web 표준 `fetch` 핸들러 | `api/` 디렉터리 |
| AI | Claude API (Messages API), 공식 TypeScript SDK `@anthropic-ai/sdk` | 모델: `claude-sonnet-5-5`(기본), `claude-haiku-5-5`(단건 설명) |
| 저장소 수신 | GitHub REST API + tar 스트림 해제 라이브러리 | 서버 측 `GITHUB_TOKEN` |
| 스키마 검증 | Zod (요청·응답 검증), JSON Schema (AI 구조화 출력) | |
| 테스트 | Vitest (규칙 엔진·점수 계산 단위 테스트), Playwright (E2E) | |
| CI/CD | GitHub 저장소 연동 Vercel 자동 배포 (PR마다 Preview 배포), GitHub Actions (테스트·스냅샷 생성) | |

### 6.3 Vercel 함수 구성

| 함수 | 역할 | 실행 설정 | 근거 |
|---|---|---|---|
| `api/scan.ts` | 저장소 스캔 | `maxDuration` 60초, 메모리 기본(2GB) | 예시 저장소 규모에서는 수 초 내 완료 예상. Hobby 플랜 최대 300초 이내에서 여유 확보 |
| `api/ai.ts` | Claude API 호출 | `maxDuration` 120초, 스트리밍 응답 | 보고서 초안 등 긴 생성 대비. AI 응답 대기 시간은 Active CPU 과금에 포함되지 않음 |

- 두 함수는 실행 특성(파일 처리 vs 외부 API 대기·스트리밍)이 달라 분리한다. Vercel은 관련 경로를 한 함수로 묶는 방식을 권장하므로, 경로가 늘어나면 함수 내부 라우팅으로 묶고 새 함수 파일을 만들지 않는다.
- 요청·응답 본문은 4.5MB 한도가 있으므로 스캔 결과는 4MB 이내로 자른다(4.2절).
- 함수 리전은 기본값이 미국 동부이므로, 한국 사용자 지연을 줄이려면 프로젝트 설정에서 서울 등 가까운 리전으로 지정한다.
- 환경변수:

| 변수 | 용도 | 비고 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API 인증 | **`VITE_` 접두어 금지**. Vite는 `VITE_`로 시작하는 변수를 클라이언트 번들에 포함하므로 키가 노출된다 |
| `GITHUB_TOKEN` | GitHub API 호출 한도 확보 (공개 저장소 읽기 권한만) | 최소 권한 토큰 |
| `AI_MODEL_DEFAULT`, `AI_MODEL_FAST` | 모델 라우팅 | 기본 `claude-sonnet-5-5`, `claude-haiku-5-5` |
| `AI_MAX_TOKENS` | 요청당 출력 상한 | |
| `APP_ACCESS_CODE` | 실습용 간이 접근 코드 (9장) | 선택 |

### 6.4 데이터 접근 추상화 (정식 버전 대비)

```ts
interface DataStore {
  getWorkspace(): Promise<Workspace>;
  saveWorkspace(ws: Workspace): Promise<void>;
  exportJson(): Promise<Blob>;
  importJson(file: File): Promise<Workspace>;
}
// MVP: LocalDataStore (브라우저 저장소)
// 2차: RemoteDataStore (서버 API + DB) — 화면 코드는 변경하지 않음
```

브라우저 저장소 접근은 모두 `try/catch`로 감싸고, 사용할 수 없는 환경(사생활 보호 모드 등)에서는 메모리 저장으로 대체한 뒤 "내보내기로 백업하라"는 안내를 표시한다.

---

## 7. 데이터 모델 (MVP)

### 7.1 저장 위치

| 데이터 | 저장 위치 | 변경 방법 |
|---|---|---|
| 규칙 카탈로그 | `rules/*.yaml` → 빌드 시 `public/data/rules.json` | Pull Request |
| 스냅샷 (스캔 결과, Ref 간 diff) | `public/data/snapshots/<repo>/<sha>.json`, `diff-<fromSha>-<toSha>.json` | `scripts/scan-snapshot.ts` 실행 후 커밋 |
| 시드 데이터 (예시 인벤토리, 체크리스트 초기값, 단가표, 점수 설정) | `public/data/seed/*.json` | Pull Request |
| 사용자 작업 상태 | 브라우저 저장소 (`Workspace` 단일 문서) | 화면 조작, JSON 가져오기 |
| AI 결과 | 브라우저 저장소 (`aiResults`, 입력 해시 기준 캐시) | AI 기능 호출 |
| 라이브 스캔 결과 | 브라우저 저장소 + Vercel CDN 캐시 | `/api/scan` |

### 7.2 주요 타입 (TypeScript)

```ts
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
type Axis = 'os' | 'jdk' | 'framework' | 'cloud';
type Step = 0 | 1 | 2 | 3 | 4 | 5;

interface Rule {
  id: string; axis: Axis; title: string;
  pattern: string; fileTypes: string[]; includeComments?: boolean;
  severity: Severity; effortHours: number; autoFixable: 0 | 1; guidance: string;
}

interface GitRef {
  id: string; repo: string;               // "eGovFramework/egovframe-web-sample"
  refName: string; sha: string;           // "4.1.x", "3b3cffcb726b..."
  order: number; role: 'overlay' | 'baseline' | 'bridge' | 'target';
  synthetic: boolean;                      // 레거시 오버레이 = true
  detectedVersions: { java?: string; spring?: string; egov?: string; servlet?: string; dockerBase?: string };
  inferredStep?: Step;
}

interface Finding {
  ruleId: string; refId: string;
  filePath: string; line: number;
  snippet: string;                         // 최대 3줄 (공개 저장소)
  status: 'open' | 'in_progress' | 'resolved' | 'accepted';
}

interface Application {
  id: string; name: string; criticality: 1|2|3|4|5;
  currentStep: Step; waveId?: string; refIds: string[];
  sharedDbIds: string[]; synthetic: boolean;
}

interface Workspace {
  schemaVersion: number;
  applications: Application[]; refs: GitRef[];
  findingStatus: Record<string, Finding['status']>;   // 키: refId:ruleId:filePath:line
  checklistResults: Record<string, { done: boolean; note?: string }>;
  risks: Risk[]; waves: Wave[]; costInputs: CostInput[];
  goldenMasterResults: GoldenMasterResult[];
  history: { at: string; actor: string; action: string; target: string; note?: string }[];
  aiResults: Record<string, { task: string; model: string; createdAt: string; output: unknown }>;
}
```

- `Workspace.schemaVersion`을 두어 구조 변경 시 가져오기 단계에서 마이그레이션한다.
- 감사 로그 대신 `history` 배열을 사용한다(MVP). 다중 사용자 감사는 2차 범위다.

---

## 8. API 명세 (Vercel Functions)

기본 경로: `/api`, 형식: JSON(스트리밍 응답은 `text/event-stream`), 인증: 9장 배포 보호 + 선택적 접근 코드 헤더(`x-access-code`)

### 8.1 `POST /api/scan`

요청:

```json
{
  "repo": "eGovFramework/egovframe-web-sample",
  "ref": "4.1.x",
  "includeGlobs": ["**/*"],
  "excludeGlobs": ["pom-core.xml", "pom-web.xml", "**/img/**", "**/fonts/**"],
  "rulesetVersion": "2026.10.1"
}
```

응답 (요약):

```json
{
  "ref": { "repo": "eGovFramework/egovframe-web-sample", "refName": "4.1.x", "sha": "3b3cffcb726b...",
           "detectedVersions": { "java": "1.8", "spring": "5.3.20", "egov": "4.1.0", "servlet": "3.1" },
           "inferredStep": 2 },
  "stats": { "filesScanned": 43, "durationMs": 2100, "truncated": false },
  "findings": [
    { "ruleId": "RULE-FW-020", "filePath": "src/main/java/egovframework/example/sample/service/impl/SampleDAO.java",
      "line": 45, "snippet": "public class SampleDAO extends EgovAbstractDAO {" }
  ]
}
```

| 오류 | 상태 코드 |
|---|---|
| 공개 저장소가 아니거나 형식 오류 | 400 |
| Ref 없음 | 404 |
| 저장소 크기 한도 초과 | 413 |
| GitHub 호출 한도 초과 | 429 (재시도 시각 포함) |

### 8.2 `POST /api/ai`

요청:

```json
{
  "task": "explain_finding",
  "input": {
    "ruleId": "RULE-FW-021",
    "filePath": "src/main/resources/egovframework/spring/context-validator.xml",
    "snippet": "<bean id=\"beanValidator\" class=\"org.springmodules.validation.commons.DefaultBeanValidator\">",
    "fromVersions": { "spring": "5.3.37", "egov": "4.3.0" },
    "toVersions": { "spring": "6.2", "egov": "5.0", "java": "21" }
  },
  "stream": false
}
```

응답 (`explain_finding`, 구조화 출력):

```json
{
  "result": {
    "cause": "...", "impact": "...", "replacement": "...",
    "codeBefore": "...", "codeAfter": "...", "cautions": ["..."]
  },
  "meta": { "model": "claude-haiku-5-5", "inputTokens": 3120, "cacheReadInputTokens": 2800, "outputTokens": 410 }
}
```

- `stream: true`(report_draft, assistant_chat)는 서버 전송 이벤트로 텍스트 조각을 보내고 마지막 이벤트에 `meta`를 담는다.
- 함수는 `task`별 허용 입력 스키마를 Zod로 검증하고, 정의되지 않은 `task`는 400으로 거부한다.

---

## 9. 비기능 요구사항 (MVP)

| 구분 | 요구사항 |
|---|---|
| 성능 | 스냅샷 모드 화면 로딩 2초 이내. 예시 저장소 라이브 스캔 10초 이내(캐시 미적중 기준). AI 설명 첫 응답 5초 이내 |
| 비용 | Vercel Hobby 또는 Pro 플랜 범위 내 운영. AI는 프롬프트 캐싱과 경량 모델 우선 사용, 요청당 `max_tokens` 상한 |
| 보안 – 키 관리 | API 키·토큰은 Vercel 환경변수에만 저장, 클라이언트 번들·저장소·로그에 포함 금지 (`VITE_` 접두어 사용 금지) |
| 보안 – 접근 | Vercel 배포 보호(Deployment Protection)로 미리보기·운영 URL 접근 제한. 실습용 공개 시 `APP_ACCESS_CODE` 확인 |
| 보안 – 데이터 | 공개 저장소만 분석. AI 전송 전 마스킹. 서버 측에 사용자 데이터 저장하지 않음 |
| 남용 방지 | 함수별 입력 크기 제한, 요청 제한(서버리스 인스턴스 메모리 기반의 근사치이므로 정확한 한도가 필요하면 2차에서 외부 저장소 기반 제한으로 교체) |
| 관측성 | 함수 로그를 구조화 JSON으로 남기고 Vercel 로그에서 조회. 프런트엔드 오류는 콘솔·간이 오류 화면 |
| 가용성 | 별도 SLA 없음 (PoC) |
| 접근성 | 색상 외 텍스트 라벨, 키보드 탐색 지원 |

> **사내 비공개 소스 사용 금지**: MVP는 공개 저장소와 가상 데이터 전용이다. 금융사 실제 소스·계약 데이터를 다루려면 13.2절의 정식 버전(사내망 분석 워커, 승인된 AI 게이트웨이)이 필요하며, 이때도 정보보호·준법 부서의 사전 승인이 필요하다.

---

## 10. 체크리스트 내장 항목 (초기값)

`public/data/seed/checklists.json`에 아래 항목을 시드로 제공한다. 사용자는 화면에서 완료 여부와 메모를 입력한다.

### 10.1 Conversion 체크리스트

| Step | 필수 항목 |
|---|---|
| 0 | 의존성 인벤토리 완료, 골든 마스터 테스트 확보, 성능 기준선 측정, 네이티브 라이브러리 목록화 |
| 1 | Linux용 네이티브 모듈 확보, IBM JDK 전용 코드 제거, 셸 스크립트 변환, 인코딩·로케일 명시, 바이너리 파일 호환 검증 |
| 2 | 표준프레임워크 4.x 적용, 패키지 경로 치환, Log4j 1.x 제거, iBATIS 사용 시 MyBatis 전환 |
| 3 | 내부 API 사용 0건, 제거된 Java EE 모듈 대체, 기본 인코딩 영향 검증, GC·힙 재설정 |
| 4 | jakarta 전환 완료, Jakarta EE 10 지원 컨테이너 확보, 제거된 Spring 기능 대체, URL 매핑 회귀 통과, 표준프레임워크 5.x 공통컴포넌트 DDL 반영 |
| 5 | 세션 외부화, 파일 저장소 이관, 로그 표준출력 전환, 설정 외부화, 헬스체크 엔드포인트 |

### 10.2 Cloud 체크리스트

- 실측 기반 사이징 완료
- 앱-DB 배치 위치와 지연시간 검증
- 대외기관 고정 IP 변경 신청 완료
- 백업·DR·모니터링 체계 구축
- 배치 수행 시간 리허설 통과
- 컷오버 리허설 2회 이상, 롤백 시간 측정
- 병행 운영 기간·비용 확정
- 레거시 종료(Decommission) 일정 확정

### 10.3 규제·보안 체크리스트

- 클라우드 이용 업무의 중요도 평가 완료
- 클라우드 이용 관련 내부 승인 및 감독기관 보고 필요 여부 확인
- 망분리 적용 대상 여부 및 예외 적용 가능 범위 확인 (최신 감독규정 기준)
- 개인(신용)정보 처리 위치 및 암호화 방식 확인
- 접속기록·거래로그 보존 요건 충족 확인
- 정보보호부서·준법감시부서 승인 완료

> 규제 항목은 법령·감독규정 개정에 따라 바뀔 수 있으므로 시드 JSON으로 분리해 수정 가능하게 하고, 시행 시점의 규정으로 확인한다.

---

## 11. 개발 일정 (MVP, 안)

| 단계 | 기간 | 산출물 |
|---|---|---|
| 1. 기반 | 1주 | Vite·React 프로젝트, Vercel 연동(Preview 배포), 규칙 YAML → JSON 빌드, 시드 데이터 |
| 2. 규칙 엔진·스냅샷 | 1주 | 공유 규칙 엔진(주석 제거 포함), `scripts/scan-snapshot.ts`, 예시 저장소 5개 Ref·오버레이 스냅샷, Vitest 회귀 테스트(14.4절 기대값) |
| 3. 화면 | 2주 | UI-01~09, UI-11~13, 영향도 계산, 게이트 판정, 내보내기·가져오기 |
| 4. 서버리스·AI | 1주 | `/api/scan` 라이브 모드, `/api/ai` 4개 task, 구조화 출력 스키마, 프롬프트 캐싱, UI-10 |
| 5. 검증·시연 | 1주 | 14.8절 파일럿 흐름 시연, Playwright E2E, 인수 기준 점검, 실습 가이드 |

---

## 12. 인수 기준 (MVP)

**공통**

- [ ] `git push`만으로 Vercel에 배포되고, PR마다 Preview URL이 생성된다.
- [ ] 클라이언트 번들(`dist/`)에서 `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` 값이나 `sk-ant-` 형식 문자열이 검색되지 않는다.
- [ ] 영향도 점수에서 근거 탐지 항목(파일·라인, GitHub 링크)까지 추적할 수 있다.
- [ ] 체크리스트 필수 항목이 미완료이거나 골든 마스터 실패가 있으면 단계 전환이 차단된다.
- [ ] 작업 상태를 JSON으로 내보낸 뒤 새 브라우저에서 가져오면 동일한 화면이 복원된다.
- [ ] 요약 대시보드를 Markdown 보고서로 내보낼 수 있다.

**AI 기능**

- [ ] `explain_finding`, `migration_plan`은 JSON Schema를 만족하는 결과를 반환하고, 화면에 "AI 제안" 배지·모델 ID·생성 시각이 표시된다.
- [ ] 같은 세션에서 두 번째 AI 호출부터 `cache_read_input_tokens`가 0보다 크다 (프롬프트 캐싱 동작 확인).
- [ ] 마스킹 대상 문자열(이메일, 전화번호 등)을 입력하면 Claude API로 전송되는 본문에서 마스킹되어 있다 (함수 단위 테스트).
- [ ] AI 결과는 사용자가 선택하기 전까지 체크리스트·리스크에 반영되지 않는다.

**예시 저장소 기준 (14장)**

- [ ] `egovframe-web-sample`의 5개 Ref(`4.1.x`, `4.2.x`, `4.3.x`, `5.0.x`, `main`)와 레거시 오버레이가 스냅샷 모드로 표시된다.
- [ ] 라이브 모드로 `4.1.x`를 스캔한 결과가 같은 SHA의 스냅샷과 일치한다.
- [ ] 각 Ref의 Java·Spring·eGov·Servlet 버전이 자동 추출되어 14.2절 표와 일치한다.
- [ ] RULE-FW-020(iBATIS)은 `4.1.x`에서 탐지되고 `4.3.x`부터 0건이 된다.
- [ ] RULE-FW-021(springmodules Validator)은 `4.3.x`까지 탐지되고 `5.0.x`부터 0건이 된다.
- [ ] `javax` import 탐지는 `4.1.x`에서 3건 이상, `5.0.x`부터 0건이 된다.
- [ ] `main` 브랜치의 주석 처리된 DBCP·log4jdbc 설정은 탐지 결과에 포함되지 않는다.
- [ ] `main` 브랜치에서 To-Be(Java 21) 잔여 갭(RULE-CL-001~004)이 Step 4·5 체크리스트와 연결되어 표시된다.
- [ ] 레거시 오버레이의 탐지 결과는 "가상 데이터" 라벨과 함께 표시되고 실제 앱 통계에서 분리된다.

---

## 13. 리스크, 가정, 정식 버전 전환 경로

### 13.1 리스크 및 가정

| 구분 | 내용 | 대응 |
|---|---|---|
| 가정 | 분석 대상은 공개 GitHub 저장소이며 규모가 작다 (예시 저장소 수준) | 크기 한도 초과 시 413 응답, 스냅샷 모드로 대체 |
| 리스크 | GitHub API 호출 한도 | 서버 측 토큰 사용, SHA 기준 CDN 캐시, 강의 시에는 스냅샷 모드 기본 |
| 리스크 | 정규식 규칙의 오탐·미탐 | 주석 제외, glob 제외, 14.6절 규칙 검증으로 보정. 사용자가 "수용(accepted)" 처리 가능 |
| 리스크 | 브라우저 저장소 유실 (캐시 삭제, 다른 기기) | 내보내기 안내, 주요 작업 후 자동 백업 파일 다운로드 제안 |
| 리스크 | AI 비용 증가 | 프롬프트 캐싱, 경량 모델 우선, `max_tokens` 상한, 결과 캐시(입력 해시 기준) |
| 리스크 | AI 결과의 부정확성 | 제안으로만 표시, 규칙·테스트 기반 판정과 분리, 근거 규칙 ID 표시 |
| 리스크 | MVP를 실제 금융사 소스에 사용 | 9장 금지 조항 명시, 화면 상단 고지, 공개 저장소 외 입력 차단 |
| 리스크 | 영향도 점수 과신 | 점수는 의사결정 보조 지표이며 게이트는 체크리스트·테스트로 판정 |
| 리스크 | Spring 6.x 지원 기간 | Spring 7 전환을 고려한 코딩 표준 적용, 차기 업그레이드 로드맵 별도 수립 |

### 13.2 정식 버전 전환 경로

MVP 검증 후 정식 버전으로 확장할 때의 대응 관계는 다음과 같다. 화면·규칙 엔진·프롬프트는 재사용하고, 저장·분석·인증 계층을 교체한다.

| MVP 구성 | 정식 버전 | 비고 |
|---|---|---|
| 브라우저 저장소 + JSON 내보내기 | 서버 API + 관계형 DB(PostgreSQL 등) | `DataStore` 구현만 교체 (6.4절) |
| `/api/scan` (공개 저장소) | 사내망 분석 워커 (컨테이너) + jdeps·OpenRewrite | 소스는 사내 보안 구역 밖으로 나가지 않음 |
| `/api/ai` 직접 호출 | 사내 AI Gateway 경유 (PII 마스킹, 모델 라우팅, 사용량 통제) | 프롬프트·스키마 재사용 |
| 컨텍스트 직접 주입 | 임베딩 검색 기반 RAG (pgvector 등) | 사내 표준·과거 전환 사례 확대 시 |
| 단일 사용자 + 확인 이력 | SSO, RBAC, 승인 워크플로(F-10), 감사 로그 | 역할(VIEWER·DEVELOPER·ARCHITECT·PM·COMPLIANCE·ADMIN)별 권한 적용 |
| Vercel 배포 | 사내 클라우드 또는 승인된 클라우드 VPC | 금융권 클라우드 이용 절차 준수 |

---

## 14. 예시 저장소(egovframe-web-sample) 기반 구현 명세

### 14.1 저장소 개요

| 항목 | 내용 |
|---|---|
| 저장소 | `https://github.com/eGovFramework/egovframe-web-sample` (Apache-2.0) |
| 성격 | 전자정부 표준프레임워크 공식 예제. 웹 기반 심플 게시판(목록·등록·수정·삭제·페이징·검색), XML 설정 방식 |
| 최신(main) 환경 | README 기준 JDK 17, Jakarta EE 9, Servlet 5.0, Spring Framework 6.2.11. 부모 POM `org.egovframe.web:egovframe-web-config-parent:5.0.1` |
| 브랜치 / 태그 | `4.1.x`, `4.2.x`, `4.3.x`, `5.0.x`, `main` / `v4.1.0`, `v4.2.0`, `v4.3.0`, `v5.0.0` |
| 패키징 | WAR (`*.do` URL 매핑, `DispatcherServlet` + `ContextLoaderListener`) |
| DB | HSQLDB 내장 DB(`jdbc:embedded-database`) + `sampledb.sql` 초기화 스크립트. MySQL·Oracle 설정은 주석으로 제공 |
| 클라우드 산출물 (main) | `Dockerfile`(Tomcat 10.1 + JDK 17 Temurin), `docker-compose.yaml`(헬스체크 포함), `k8s/deployment.yaml`·`service.yaml`(NodePort 30000), GitHub Actions(`java-version: 17`) |

**파일럿 고정 커밋 (2026-10-22 확인)**

| Ref | 커밋 SHA | 최종 커밋일 |
|---|---|---|
| `4.1.x` | `3b3cffcb726b` | 2026-05-26 |
| `4.2.x` | `e362bceeef42` | 2026-05-26 |
| `4.3.x` | `d5ec49f233cd` | 2026-05-26 |
| `5.0.x` | `f617f7287529` | 2026-09-23 |
| `main` | `9dc46fdf8cc5` | 2026-09-29 |

> 위 정보는 2026-10-22에 저장소를 직접 클론해 확인한 값이다. 대시보드는 이 값을 하드코딩하지 않고 분석 시점에 POM·`web.xml`·Dockerfile에서 자동 추출해야 한다(12장 인수 기준).

### 14.2 브랜치와 전환 단계(Step) 매핑

각 브랜치를 1.1절 전환 경로의 한 지점으로 매핑해, **"같은 앱이 단계별로 어떻게 바뀌었는가"**를 대시보드에서 보여준다.

| Ref | eGov 실행환경 | Spring | Java 타깃 | Servlet / 네임스페이스 | 주요 특징 | 대응 Step |
|---|---|---|---|---|---|---|
| (오버레이) | 3.x (`egovframework.rte`) | 4.0.x | 1.8 (IBM J9 가정) | 3.x / javax | 14.3절 가상 픽스처. AIX 스크립트·IBM JDK 옵션 포함 | Step 0~1 (정적 분석 전용) |
| `4.1.x` | 4.1.0 | 5.3.20 | 1.8 | `javax.servlet-api` 3.1.0, `web.xml` 3.1 | iBATIS SqlMap(`SampleDAO extends EgovAbstractDAO`)과 MyBatis 매퍼 공존, springmodules Commons Validator, 테스트 코드 없음, Dockerfile 없음 | **Step 2 진입 (실행 기준선)** |
| `4.2.x` | 4.2.0 | 5.3.27 | 1.8 | `javax.servlet-api` 4.0.1, `web.xml` 3.1 | 라이브러리 버전 상향 | Step 2 진행 |
| `4.3.x` | 4.3.0 | 5.3.37 | 1.8 | javax | iBATIS 제거(MyBatis 매퍼 단일화), `@RequestMapping(method=…)` 정리, Dockerfile 추가. Validator는 유지 | Step 2 완료 |
| `5.0.x` | 5.0.0 | 6.x | 17 | `jakarta.servlet`, `web.xml` 5.0 | `javax` → `jakarta` 전환, springmodules Validator 제거 → Bean Validation | Step 4 |
| `main` | 5.0.1 (부모 POM) | 6.2.11 | 17 | jakarta, Servlet 5.0 | `@GetMapping`/`@PostMapping`, Lombok, KRDS(디자인 시스템) UI, 단위·Selenium 테스트 관련 Java 파일 14개, Docker·k8s·CI | Step 4 완료 / Step 5 준비 |
| (목표) | 5.0.x 최신 | 6.2.x | **21** | jakarta | Java 21 재빌드, 관리형 DB, Secret 분리, 무상태화 (14.5절) | Step 5 완료 |

> 저장소에는 Java 17→21 단계(Step 3의 Java 21 부분)가 없다. `main`을 기준으로 Java 21 빌드를 실습 과제로 수행하고, 그 결과를 새 Ref(`lab/java21`)로 등록한다.

### 14.3 레거시 오버레이 픽스처 (As-Is 보완)

본 과제의 As-Is(AIX 7.1 + eGov 3.1 + Spring 4.0.1 + JDK 1.8)는 저장소에 없으므로, `4.1.x`를 복제한 브랜치 `lab/legacy-overlay`에 아래 **가상 파일**을 추가해 Step 0~1 규칙을 검증한다.

| 원칙 | 내용 |
|---|---|
| 용도 | **정적 분석 전용**. 빌드·실행 대상이 아니며, 실행 기준선은 `4.1.x`다 |
| 표시 | 대시보드에서 Ref `role=overlay`로 등록하고, 결과에 "가상 데이터" 라벨을 붙여 실제 앱 통계와 분리한다 |
| 관리 | 오버레이 파일은 `fixtures/legacy-overlay/` 디렉터리에 두고, 파일마다 상단에 `SYNTHETIC FIXTURE – NOT FOR BUILD` 주석을 넣는다 (이 주석은 탐지 엔진의 주석 제외 대상이 아님을 별도 설정) |

| 오버레이 파일 | 재현하는 As-Is 특성 | 검증 대상 규칙 |
|---|---|---|
| `src/main/java/.../legacy/EgovLegacyImports.java` | `import egovframework.rte.fdl.cmmn.*` 등 eGov 3.x 구 패키지 | RULE-FW-001 |
| `pom-legacy-3.1.xml` | `egovframework.rte.version` 3.1.0, `spring.maven.artifact.version` 4.0.1.RELEASE, `<source>1.8</source>` | 버전 추출, RULE-JDK-010 |
| `src/main/java/.../legacy/FixedLengthParser.java` | 문자셋 미지정 `new String(bytes)`, `ByteBuffer` 직접 처리(엔디언 가정) | RULE-JDK-003, 엔디언 규칙 |
| `src/main/java/.../legacy/IbmCryptoUtil.java` | `import com.ibm.crypto.provider.*` (IBM JDK 전용 보안 프로바이더) | RULE-OS-001 |
| `scripts/aix/startup.ksh` | `#!/bin/ksh`, `lsattr`, `errpt`, AIX 전용 경로(`/usr/IBMJava/…`) | AIX 셸 규칙 |
| `scripts/aix/jvm-options.txt` | `-Xgcpolicy:gencon` 등 IBM J9 전용 JVM 옵션 | IBM JVM 옵션 규칙 |
| `src/main/webapp/WEB-INF/config/.../tiles-defs.xml` + 뷰 리졸버 설정 | Apache Tiles 레이아웃 (eGov 3.x 프로젝트에 흔한 구성) | RULE-FW-010 |

### 14.4 파일럿 사전 측정 결과 (프로토타입 정규식 스캔)

대시보드 구현 전, 규칙 일부를 정규식으로 저장소 5개 Ref 중 4개에 적용해 기대 결과를 확인했다(2026-10-22). **주석 제외·템플릿 POM 제외를 적용하지 않은 원시 값**이며, 대시보드 탐지 엔진의 회귀 기준값으로 사용한다.

| 규칙 | `4.1.x` | `4.3.x` | `5.0.x` | `main` | 해석 |
|---|---|---|---|---|---|
| `javax` import (Java) | 3건 / 3파일 | 1건 / 1파일 | 0 | 0 | 5.0.x에서 jakarta 전환 완료 |
| `javax` 의존성 (POM, 템플릿 포함) | 12건 / 4파일 | 16건 / 4파일 | 0 | 0 | 4.3.x는 `javax.json` 추가로 증가 |
| Servlet 3.1 `web.xml` 스키마 | 2건 | 2건 | 0 | 0 | 5.0.x에서 Servlet 5.0 스키마로 변경 |
| iBATIS(SqlMap) | 4건 / 2파일 | 0 | 0 | 0 | 4.3.x에서 제거 |
| springmodules Validator | 23건 / 5파일 | 23건 / 5파일 | 0 | 0 | 5.0.x에서 Bean Validation으로 대체 |
| `@RequestMapping(method=…)` | 2건 | 0 | 0 | 0 | 4.3.x에서 정리 |
| Java 1.8 컴파일 타깃 | 8건 / 4파일 | 8건 / 4파일 | 0 | 0 | 5.0.x에서 Java 17 `<release>` |
| 구 JSTL taglib URI | 3건 | 3건 | 3건 | 2건 | 동작 영향 없음 → `info` |
| Commons DBCP / log4jdbc | 9 / 10건 | 6 / 4건 | 5 / 2건 | 5 / 2건 | **5.0.x·main은 주석 내 오탐** → 주석 제외 필요 |
| 세션 의존 | 5건 / 2파일 | 5건 / 2파일 | 5건 / 2파일 | 8건 / 3파일 | 전환과 무관하게 남음 → Step 5 과제 |
| Dockerfile 존재 | 없음 | 있음 | 있음 | 있음 | 4.3.x부터 컨테이너화 |

이 결과에서 도출한 구현 요구사항은 4.2절 "탐지 엔진 요구사항"에 반영했고, 주석·템플릿 제외를 적용한 기대값은 규칙 엔진의 Vitest 회귀 테스트로 고정한다.

### 14.5 To-Be(Java 21 + Linux 10 + 클라우드) 잔여 갭: `main` 기준

`main` 브랜치는 프레임워크 축(Step 4)은 완료했지만, 본 과제의 To-Be와 비교하면 아래 갭이 남는다. 대시보드는 이 항목을 `main` Ref의 Step 4·5 체크리스트로 자동 생성해야 한다.

| 구분 | 현재 (`main`) | To-Be | 관련 규칙 / 조치 |
|---|---|---|---|
| Java 버전 | JDK 17 (README, CI, Dockerfile) | Java 21 | `java.version` 21로 재정의, CI `java-version: '21'`, RULE-CL-004 |
| 베이스 이미지 | `tomcat:10.1-jdk17-temurin` | Java 21 기반 Tomcat 10.1 이미지 또는 사내 승인 RHEL 10 계열 베이스 이미지 | RULE-CL-004, 이미지 취약점 스캔 |
| DB | HSQLDB 내장 DB | 관리형 RDBMS (예: PostgreSQL) | RULE-CL-001. `sampledb.sql`을 대상 DB 방언으로 변환, MyBatis 매퍼 SQL 호환성 확인 |
| 접속 정보 | `context-datasource.xml`에 계정 값 기재 | Secret 주입 | RULE-CL-002. `${DB_URL}` 등 프로퍼티 플레이스홀더 + Kubernetes Secret |
| 상태 | `SessionLocaleResolver`, `SessionStatus`, `replicas: 1` | 수평 확장 가능 | RULE-CL-003. `CookieLocaleResolver` 또는 Spring Session(Redis) 적용 후 replicas ≥ 2, HPA |
| 헬스체크 | readiness/liveness 모두 `/app/` 페이지 렌더링 | 전용 경량 엔드포인트 | 헬스체크용 경로 추가 (DB 연결 확인 포함 readiness, 프로세스 확인 liveness 분리) |
| 노출 방식 | NodePort 30000 | Ingress / 로드밸런서 + TLS | 서비스 매니페스트 교체 |
| 로그 | `log4j2.xml` 파일·콘솔 설정 | 표준출력 + 중앙 수집 | 로그 appender를 콘솔(JSON)로 통일 |
| URL 체계 | `*.do` 매핑 | 유지 (호환성 우선) | 전환 범위에서 제외. URL 변경은 별도 과제로 분리해 영향도 최소화 |

### 14.6 규칙 검증: 브랜치 diff를 정답지로 사용

예시 저장소의 가장 큰 장점은 **"무엇이 실제로 바뀌었는지"를 연속 브랜치 diff로 확인할 수 있다**는 점이다. 대시보드는 이를 이용해 규칙 품질을 측정한다.

```
for (from, to) in [(4.1.x, 4.2.x), (4.2.x, 4.3.x), (4.3.x, 5.0.x), (5.0.x, main)]:
    F_from = from Ref의 탐지 결과
    F_to   = to Ref의 탐지 결과
    D      = git diff from..to 에서 변경된 (파일, 라인) 집합

    해소된 탐지 = F_from 중 F_to 에 없는 항목
    적중(TP)   = 해소된 탐지 중 해당 위치가 D 에 포함된 항목
    오탐 후보(FP) = F_from 중 실제 코드가 아닌 위치(주석·템플릿)로 판정된 항목
    미탐 후보(FN) = D 의 변경 중 전환 관련 키워드(javax→jakarta 등)를 포함하나 어떤 규칙에도 걸리지 않은 항목
```

- MVP에서는 Ref 간 diff를 `scripts/scan-snapshot.ts`가 미리 계산해 `diff-<fromSha>-<toSha>.json`으로 저장하고, 규칙 검증 계산은 브라우저에서 수행해 UI-13에 규칙별로 표시한다. 검토 결과(FP·FN 확정)는 `Workspace`에 저장한다.
- FP·FN 후보는 아키텍트가 검토해 확정하며, 확정 결과로 규칙 패턴과 제외 조건을 보정한다.
- 이 검증은 예시 저장소처럼 전환 이력이 있는 저장소에서만 가능하므로, 사내 앱에는 **보정된 규칙을 적용**하는 방식으로 활용한다.

### 14.7 골든 마스터 회귀 테스트 실습

`4.1.x`에는 테스트 코드가 없고, `main`은 UI가 KRDS로 바뀌어 HTML 구조가 다르다. 따라서 **HTML 비교가 아니라 업무 결과(HTTP 상태, 리다이렉트, DB 상태) 비교** 방식으로 골든 마스터를 구성한다.

| 구성 | 기준선 | 비교 대상 |
|---|---|---|
| 런타임 | `4.1.x` WAR + JDK 8 + Tomcat 9 | `main`(또는 `lab/java21`) WAR + JDK 21 + Tomcat 10.1 |
| 데이터 | 동일한 `sampledb.sql` 초기 데이터 | 동일 |
| 실행 도구 | Playwright 또는 HTTP 클라이언트 스크립트 | 동일 시나리오 |

| 시나리오 | 비교 항목 |
|---|---|
| 목록 조회 (1페이지, 마지막 페이지) | HTTP 200, 게시글 건수, 게시글 ID 목록 |
| 검색 (이름·설명 조건) | 결과 ID 목록 |
| 등록 (정상) | 리다이렉트 여부, DB 신규 행의 컬럼 값 |
| 등록 (필수값 누락·최대 길이 초과) | 등록 거부 여부, DB 행 수 불변 |
| 수정 / 삭제 | DB 행의 변경·삭제 결과 |
| 한글 입력 (등록 후 조회) | 저장·조회된 문자열 일치 (인코딩 회귀 확인) |

- 화면 요소는 `data-testid` 같은 프레임워크 중립 식별자로 찾도록 시나리오를 작성한다. 예시 저장소 JSP에는 이런 속성이 없으므로, 실습에서는 양쪽 JSP에 동일한 `data-testid`를 추가하는 것을 Step 0 과제로 둔다.
- 시나리오 실행 결과는 정해진 형식의 JSON(시나리오 ID, 통과 여부, 비교 값)으로 저장해 대시보드에 업로드한다(F-12). 업로드된 결과는 단계 게이트(4.4절) 판정에 사용한다.
- 골든 마스터 실행 자체(Tomcat·JDK 구동)는 Vercel 함수에서 하지 않고, 실습생의 로컬 환경 또는 GitHub Actions에서 수행한다.

### 14.8 파일럿 실행 절차 (대시보드 사용 흐름)

| 순서 | 대시보드 작업 | 입력 / 결과 |
|---|---|---|
| 1 | 앱 첫 실행 | 시드 데이터 로드: 앱 `SAMPLE-BOARD`(게시판, 업무 중요도 2, 서버 정보는 **가상 값** AIX 7.1 / POWER / 상용 WAS) |
| 2 | Ref 확인 (UI-11) | 스냅샷 모드에 등록된 `lab/legacy-overlay`(overlay), `4.1.x`(baseline), `4.2.x`·`4.3.x`(bridge), `5.0.x`·`main`(target) 확인. exclude glob: `pom-core.xml`, `pom-web.xml` |
| 3 | Ref 비교 (UI-12) | 14.4절 표와 같은 추이 확인 (주석 제외 적용 후 DBCP·log4jdbc 오탐 0건) |
| 4 | 라이브 스캔 확인 | `4.1.x`를 라이브 모드로 다시 스캔해 스냅샷과 결과 일치 확인 (`/api/scan`) |
| 5 | 규칙 검증 (UI-13) | 14.6절 절차로 규칙별 적중·오탐·미탐 후보 확인, FP·FN 확정 |
| 6 | 영향도 산출 (F-03) | `4.1.x` 기준 축별 점수와 예상 공수, `main` 기준 잔여 갭. 가중치 What-if 조정 |
| 7 | AI 설명 (UI-04) | RULE-FW-021(springmodules Validator) 탐지 항목에 `explain_finding` 실행 → 전·후 코드 확인 |
| 8 | AI 전환 계획 (UI-05) | `main` Ref 요약으로 `migration_plan` 실행 → Java 21 재빌드·14.5절 항목을 제안 목록으로 확인 → 선택 항목만 체크리스트·리스크에 반영 |
| 9 | 골든 마스터 업로드 (F-12) | 로컬에서 실행한 14.7절 결과 JSON 업로드 → 단계 게이트 확인 |
| 10 | 웨이브·비용 (F-06, F-08) | 1차 웨이브 배정, 컨테이너 1~2개 + 관리형 DB 기준 입력 단가로 추정 |
| 11 | 보고서 (F-09) | `report_draft`로 초안 생성 → 수정 → Markdown 내보내기 |
| 12 | 상태 백업 (F-15) | 작업 상태 JSON 내보내기 (강의 종료 후 제출물로 활용 가능) |

### 14.9 대시보드 구현 저장소 구조 (MVP)

프로젝트 공통 지침(문서·코드 동시 관리, 프롬프트 외부화)에 맞추되, 백엔드 없이 Vite 프로젝트 하나에 프런트엔드와 Vercel 함수를 함께 둔다.

```
migration-dashboard/
├─ docs/
│  ├─ spec/                         # 본 기술명세서
│  ├─ architecture/                 # 구성도, ADR (예: "MVP는 백엔드 없이 Vercel 함수 2개")
│  └─ pilot/egovframe-web-sample.md # 파일럿 결과 기록 (14.4절 기준값 포함)
├─ src/                             # React + TypeScript (Vite)
│  ├─ app/                          # 라우팅, 레이아웃
│  ├─ features/                     # inventory, refs, findings, impact, steps, waves, risks, cost, report, assistant
│  ├─ store/                        # Zustand + LocalDataStore (DataStore 인터페이스 구현)
│  └─ shared/
│     ├─ rules-engine/              # 규칙 엔진 (브라우저·함수·스크립트 공용, 순수 TS)
│     ├─ scoring/                   # 영향도·게이트·비용 계산
│     └─ types/                     # 7.2절 타입
├─ api/                             # Vercel Functions
│  ├─ scan.ts                       # POST /api/scan
│  ├─ ai.ts                         # POST /api/ai
│  └─ _lib/                         # github.ts, redact.ts, rate-limit.ts, anthropic.ts (함수로 배포되지 않는 공용 코드)
├─ prompts/
│  ├─ system.md
│  ├─ tasks/explain_finding.md  migration_plan.md  report_draft.md  assistant_chat.md
│  └─ schemas/explain_finding.json  migration_plan.json
├─ rules/
│  ├─ os.yaml  jdk.yaml  framework.yaml  cloud.yaml
│  └─ tests/                        # 규칙별 양성·음성 예시 파일
├─ fixtures/
│  └─ legacy-overlay/               # 14.3절 가상 파일 (SYNTHETIC FIXTURE)
├─ golden-master/
│  └─ egovframe-web-sample/         # 14.7절 시나리오 (로컬·Actions 실행)
├─ public/data/
│  ├─ rules.json                    # 빌드 시 생성
│  ├─ seed/                         # 인벤토리, 체크리스트, 단가표, 점수 설정
│  └─ snapshots/eGovFramework__egovframe-web-sample/   # <sha>.json, diff-<from>-<to>.json
├─ scripts/
│  ├─ build-rules.ts                # rules/*.yaml → public/data/rules.json
│  └─ scan-snapshot.ts              # 고정 SHA 스캔·diff 생성
├─ tests/e2e/                       # Playwright
├─ vercel.json                      # 함수별 maxDuration, 헤더(캐시), 리전
├─ vite.config.ts  tsconfig.json  package.json
└─ .github/workflows/               # 테스트, 스냅샷 재생성(수동 실행)
```

- 규칙 엔진 회귀 테스트(Vitest)는 예시 저장소의 고정 커밋 SHA 스냅샷을 대상으로 14.4절 기대값(주석 제외 적용 후)을 검증한다. 브랜치는 계속 갱신되므로 **브랜치 이름이 아닌 커밋 SHA로 고정**한다.
- 실습생은 저장소를 포크한 뒤 Vercel에 연결하고 환경변수(`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`)만 설정하면 동일한 환경을 구동할 수 있어야 한다.

---

## 참고

- IBM AIX Standard Edition 7.1 Lifecycle (End of Support 2023-04-30)
- Red Hat, OpenJDK Life Cycle and Support Policy
- Spring Framework 6.0 Release Notes, Spring Framework Versions (spring-projects wiki)
- 전자정부 표준프레임워크 포털 및 eGovFramework GitHub (egovframe-runtime, egovframe-common-components)
- OpenRewrite 레시피 문서, Konveyor 프로젝트 문서
- eGovFramework/egovframe-web-sample 저장소 (브랜치 4.1.x~5.0.x, main), README, Dockerfile, k8s 매니페스트
- Vercel, Functions Limits / Node.js Runtime 문서 (2026-08 갱신본)
- Claude API 문서: Structured outputs, Prompt caching
- 강의 교재: NextPlatform 「AI 네이티브 클라우드 아키텍처 설계」 Module 3·4
