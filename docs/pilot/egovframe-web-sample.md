# 파일럿 결과: egovframe-web-sample (2026-10-22 스냅샷)

`npm run snapshot` 으로 생성한 고정 SHA 기준 결과입니다. 규칙셋: `rules/*.yaml` (28개 규칙, 명세 카탈로그 + 확장 규칙). 주석·템플릿 POM(`pom-core.xml`, `pom-web.xml`) 제외 적용 후 값입니다.

## 추출된 버전 (명세 14.2절과 일치)

| Ref | SHA | Java | Spring | eGov | Servlet | 추정 Step |
|---|---|---|---|---|---|---|
| overlay (가상) | overlay-1a5f… | 1.8 | 4.0.1 | 3.1.0 | 3.1.0 | 0 |
| 4.1.x | 3b3cffcb726b | 1.8 | 5.3.20 | 4.1.0 | 3.1 | 2 |
| 4.2.x | e362bceeef42 | 1.8 | 5.3.27 | 4.2.0 | 3.1 | 2 |
| 4.3.x | d5ec49f233cd | 1.8 | 5.3.37 | 4.3.0 | 3.1 | 2 |
| 5.0.x | f617f7287529 | 17 | 6.2.11 | 5.0.0 | 5.0 | 4 |
| main | 9dc46fdf8cc5 | 17 | 6.2.11 | 5.0.1 | 5.0 | 4 |

## 규칙별 탐지 건수 (주석·exclude 제외, 괄호는 제외된 건수)

| 규칙 | 4.1.x | 4.2.x | 4.3.x | 5.0.x | main |
|---|---|---|---|---|---|
| RULE-FW-002 javax import | 3 | 3 | 1 | 0 | 0 |
| RULE-FW-003 javax 의존성 (POM) | 4 (+4) | 4 (+4) | 4 (+4) | 0 | 0 |
| RULE-FW-022 web.xml 3.1 스키마 | 1 | 1 | 1 | 0 | 0 |
| RULE-FW-020 iBATIS | 3 | **0** | 0 | 0 | 0 |
| RULE-FW-021 springmodules | 21 | 21 | 21 | 0 | 0 |
| RULE-JDK-010 Java 1.8 타깃 | 4 (+4) | 4 (+4) | 4 (+4) | 0 | 0 |
| RULE-FW-013 DBCP/log4jdbc | 0 (+13) | 0 (+13) | 0 (+7) | 0 (+5) | 0 (+5) |
| RULE-CL-001 내장 DB | 2 | 2 | 2 | 2 | 2 |
| RULE-CL-003 세션 의존 | 1 | 1 | 1 | 1 | 1 |
| RULE-CL-004 JDK≠21 이미지 | 0 | 0 | 0 | 0 | 1 |
| RULE-CL-005 CI java-version≠21 | 0 | 1 | 1 | 1 | 1 |

## 명세 기대값과의 차이 (검토 필요)

| 항목 | 명세 | 실측 | 비고 |
|---|---|---|---|
| iBATIS 제거 시점 | 4.3.x (14.2절) | **4.2.x** | 4.2.x에서 `SampleDAO`·`context-sqlMap.xml`이 이미 사라짐. 인수 기준("4.1.x 탐지, 4.3.x부터 0건")은 충족 |
| springmodules 건수 | 23건 / 5파일 (14.4절 원시값) | 21건 | 규칙의 대상 파일 유형(java, xml, jsp) 밖에서 2건이 더 있을 수 있음. 규칙 검증(UI-13)에서 확인 대상 |
| web.xml 3.1 스키마 | 2건 | 1건 | 원시값은 템플릿 파일 등을 포함했을 가능성 |
| javax import | 3건 / 3파일 | 3건 | `javax.annotation`을 FW-002에 포함해 일치 |
| 구 JSTL URI (info) | 3건 (main 2건) | 3건 (main 2건) | 일치. 점수에서 제외 |
| 4.3.x Dockerfile 베이스 | — | `tomcat:8.5-jre8` | 5.0.x까지 JDK 8 베이스 이미지 (RULE-CL-004는 `jdk(8|11|17)` 패턴이라 `jre8`은 미탐지 → 보정 후보) |
| RULE-CL-002 (계정 하드코딩) | 14.5절: "context-datasource.xml에 계정 값 기재" | 전 Ref에서 주석 안(+5)에만 존재 → 탐지 0 | 실제 활성 설정은 내장 DB. 주석 속 MySQL·Oracle 예시 |

## 보정 후보

- `RULE-CL-004` 패턴을 `FROM .*(jdk|jre)(8|11|17)` 로 확장 (4.3.x~5.0.x의 `tomcat:8.5-jre8` 탐지)
- springmodules 2건 차이 원인 확인 후 규칙 파일 유형 보정
