# 명세 발췌 (기술명세서 v1.2)

## 1.1절 핵심 원칙: 한 번에 하나의 축만 바꾼다

| Step | 변경 축 | 상태 | 핵심 작업 |
|---|---|---|---|
| 0 | 기준선 확보 | AIX + JDK8 + eGov 3.1 + Spring 4.0.1 (현행) | 골든 마스터 테스트, 성능 기준선, 의존성 인벤토리 |
| 1 | OS 축 | Linux + JDK 8(OpenJDK) + eGov 3.x 최신 패치 + Spring 4.3.x | AIX 고유 의존성 제거, 엔디언·인코딩·셸 스크립트 이슈 해소 |
| 2 | 프레임워크 브리지 | Linux + JDK 8/11 + eGov 4.x + Spring 5.3.x (javax 유지) | 패키지 경로 `egovframework.rte` → `org.egovframe.rte` |
| 3 | JDK 축 | Linux + JDK 17 + eGov 4.x + Spring 5.3.x | 제거된 Java EE 모듈, 내부 API 캡슐화, 기본 인코딩 이슈 해소 |
| 4 | Jakarta 전환 | Linux + JDK 21 + eGov 5.x + Spring 6.2.x | `javax` → `jakarta`, WAS/서블릿 컨테이너 교체, 제거된 Spring 기능 대체 |
| 5 | 배포 축 | 클라우드 (VM 리호스트 → 컨테이너) | 세션 외부화, 파일 저장소 이관, 설정 외부화, 헬스체크 |

Step 1(OS)과 Step 5(클라우드)는 순서를 바꿀 수 있다. 영향도 최소화 기법: 골든 마스터 회귀 테스트 선행, 자동 변환(OpenRewrite)과 사람 검토 분리, 기능 토글·병행 운영, 변경 단위 소형화(한 PR에 한 종류의 변경).

## 1.2절 축별 주요 영향

- **OS**: 엔디언(Big→Little), JNI 네이티브 라이브러리, IBM JDK 전용(`com.ibm.*`, J9 옵션), ksh/AIX 명령, 하드코딩 경로, 로케일(`ko_KR.IBM-eucKR`)·인코딩.
- **JDK**: Java 11에서 JAXB/JAX-WS/`javax.annotation` 제거, Java 17에서 내부 API(`sun.*`) 강한 캡슐화, Java 18부터 기본 문자셋 UTF-8(EUC-KR/MS949 처리 영향), Java 9 CLDR 로케일, Java 15 Nashorn 제거, G1 기본 GC.
- **프레임워크**: `egovframework.rte` → `org.egovframe.rte`(4.0~), `javax` → `jakarta`, Tomcat 10+/Jetty 11+ 필요, `CommonsMultipartResolver`·Apache Tiles 연동 제거, iBATIS → MyBatis, Commons DBCP → HikariCP, Log4j 1.x → Log4j2/Logback, XML 설정은 유지 후 단계적 Java Config 전환.

## 2장 클라우드 전환의 부정적 영향

지연시간(앱-DB 분리), 비용 급증(과대 사양·egress·병행 운영), 라이선스, 규제·보안(전자금융감독규정, 망분리, 개인정보), 대외 연계 단절(고정 IP 화이트리스트), 배치 시간 초과, 세션·상태 문제, 운영 공백(모니터링·백업·DR), 컷오버 실패. 웨이브 원칙: 조회성·내부용 먼저, 앱-DB는 같은 웨이브, 결산·보험료 산출 같은 핵심은 마지막, 각 웨이브는 리허설→컷오버→안정화→레거시 종료 게이트.

## 14.2절 예시 저장소(egovframe-web-sample) 브랜치와 Step 매핑

| Ref | eGov | Spring | Java | 네임스페이스 | 특징 | Step |
|---|---|---|---|---|---|---|
| 4.1.x | 4.1.0 | 5.3.20 | 1.8 | javax, web.xml 3.1 | iBATIS·MyBatis 공존, springmodules Validator | Step 2 진입 (실행 기준선) |
| 4.2.x | 4.2.0 | 5.3.27 | 1.8 | javax | 라이브러리 상향 | Step 2 진행 |
| 4.3.x | 4.3.0 | 5.3.37 | 1.8 | javax | iBATIS 제거, Dockerfile 추가 | Step 2 완료 |
| 5.0.x | 5.0.0 | 6.x | 17 | jakarta, web.xml 5.0 | javax→jakarta, springmodules 제거 → Bean Validation | Step 4 |
| main | 5.0.1 | 6.2.11 | 17 | jakarta | `@GetMapping`, Lombok, Docker·k8s·CI | Step 4 완료 / Step 5 준비 |

## 14.5절 To-Be(Java 21 + Linux 10 + 클라우드) 잔여 갭: main 기준

- Java 17 → 21: `java.version` 재정의, CI `java-version: '21'` (RULE-CL-004, RULE-CL-005, RULE-JDK-011)
- 베이스 이미지 `tomcat:10.1-jdk17-temurin` → Java 21 기반 이미지 (RULE-CL-004)
- HSQLDB 내장 DB → 관리형 RDBMS (RULE-CL-001). `sampledb.sql` 방언 변환, MyBatis SQL 호환성 확인
- `context-datasource.xml` 계정 값 → Secret 주입 (RULE-CL-002)
- `SessionLocaleResolver`, `SessionStatus`, `replicas: 1` → 무상태화, replicas ≥ 2, HPA (RULE-CL-003)
- 헬스체크가 `/app/` 렌더링 → readiness(DB 확인)와 liveness 분리 전용 엔드포인트
- NodePort 30000 → Ingress/로드밸런서 + TLS
- `log4j2.xml` 파일·콘솔 → 표준출력 JSON
- `*.do` URL 체계는 유지 (호환성 우선, URL 변경은 별도 과제)
