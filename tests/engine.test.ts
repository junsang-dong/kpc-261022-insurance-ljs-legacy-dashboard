import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { blankComments, extractVersions, globToRegExp, scanFiles } from '../src/shared/rules-engine/index.ts';
import type { RulesFile } from '../src/shared/types/index.ts';

const rules = (JSON.parse(readFileSync('public/data/rules.json', 'utf8')) as RulesFile).rules;
const hits = (path: string, content: string, ruleId: string, opts = {}) =>
  scanFiles([{ path, content }], rules, opts).findings.filter((f) => f.ruleId === ruleId);

describe('주석 제거', () => {
  it('Java 주석은 제외하되 줄 번호는 유지한다', () => {
    const src = '// import com.ibm.X;\n/* import com.ibm.Y;\n */\nimport com.ibm.Z;\n';
    const out = blankComments(src, 'c');
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    const f = hits('A.java', src, 'RULE-OS-001');
    expect(f.map((x) => x.line)).toEqual([4]);
  });
  it('문자열 안의 // 는 주석으로 오인하지 않는다', () => {
    // 문자열 안의 // 뒤에 오는 실제 코드가 주석으로 지워지지 않아야 한다
    expect(hits('A.java', 'String u = "http://x"; import com.ibm.Q;', 'RULE-OS-001')).toHaveLength(1);
    expect(hits('A.java', 'String u = "x"; // import com.ibm.Q;', 'RULE-OS-001')).toHaveLength(0);
    expect(blankComments('String u = "http://x"; // tail', 'c')).toContain('http://x');
  });
  it('XML·JSP 주석 안의 설정은 탐지하지 않고, keepSuppressed면 플래그와 함께 반환한다', () => {
    const xml = '<!-- <bean class="org.apache.commons.dbcp.BasicDataSource"/> -->\n<bean class="x"/>';
    expect(hits('context.xml', xml, 'RULE-FW-013')).toHaveLength(0);
    const kept = hits('context.xml', xml, 'RULE-FW-013', { keepSuppressed: true });
    expect(kept).toHaveLength(1);
    expect(kept[0].inComment).toBe(true);
  });
  it('includeComments 규칙(셸 shebang)은 주석 줄도 탐지한다', () => {
    expect(hits('run.ksh', '#!/bin/ksh\necho hi\n', 'RULE-OS-002')).toHaveLength(1);
  });
});

describe('glob · 파일 유형', () => {
  it('슬래시 없는 패턴은 어느 디렉터리의 파일명과도 매치된다', () => {
    expect(globToRegExp('pom-core.xml').test('a/b/pom-core.xml')).toBe(true);
    expect(globToRegExp('**/img/**').test('src/main/webapp/img/a.png')).toBe(true);
    expect(globToRegExp('pom-core.xml').test('pom.xml')).toBe(false);
  });
  it('exclude 대상 템플릿 POM은 탐지에서 빠진다', () => {
    const pom = '<source>1.8</source>';
    const r = scanFiles(
      [{ path: 'pom.xml', content: pom }, { path: 'pom-core.xml', content: pom }],
      rules,
      { excludeGlobs: ['pom-core.xml'] },
    );
    expect(r.findings.filter((f) => f.ruleId === 'RULE-JDK-010').map((f) => f.filePath)).toEqual(['pom.xml']);
  });
});

describe('규칙 샘플', () => {
  it('RULE-JDK-003 문자셋 미지정 변환', () => {
    expect(hits('A.java', 'String s = new String(bytes);', 'RULE-JDK-003')).toHaveLength(1);
    expect(hits('A.java', 'String s = new String(bytes, UTF_8);', 'RULE-JDK-003')).toHaveLength(0);
  });
  it('RULE-FW-023 은 info 심각도', () => {
    expect(rules.find((r) => r.id === 'RULE-FW-023')?.severity).toBe('info');
  });
  it('RULE-CL-002 계정 하드코딩', () => {
    expect(hits('ds.xml', '<property name="password" value="sa"/>', 'RULE-CL-002')).toHaveLength(1);
  });
});

describe('버전 추출', () => {
  it('POM 속성 참조(${...})를 해석한다', () => {
    const pom = '<properties><java.version>21</java.version></properties><release>${java.version}</release>';
    expect(extractVersions([{ path: 'pom.xml', content: pom }]).java).toBe('21');
  });
  it('주석 처리된 값은 무시한다', () => {
    const pom = '<!-- <java.version>8</java.version> --><properties><java.version>17</java.version></properties>';
    expect(extractVersions([{ path: 'pom.xml', content: pom }]).java).toBe('17');
  });
  it('web.xml 스키마에서 Servlet 버전을 읽는다', () => {
    const x = '<web-app xsi:schemaLocation="http://xmlns.jcp.org/xml/ns/javaee http://xmlns.jcp.org/xml/ns/javaee/web-app_3_1.xsd" version="3.1">';
    expect(extractVersions([{ path: 'src/main/webapp/WEB-INF/web.xml', content: x }]).servlet).toBe('3.1');
  });
});
