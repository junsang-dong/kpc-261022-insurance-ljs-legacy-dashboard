// SYNTHETIC FIXTURE - NOT FOR BUILD
// eGov 3.x 구 패키지 경로를 재현하는 가상 파일 (정적 분석 전용)
package egovframework.example.legacy;

import egovframework.rte.fdl.cmmn.EgovAbstractServiceImpl;
import egovframework.rte.fdl.property.EgovPropertyService;
import egovframework.rte.psl.dataaccess.EgovAbstractDAO;
import egovframework.rte.ptl.mvc.tags.ui.pagination.PaginationInfo;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpSession;

public class EgovLegacyImports extends EgovAbstractServiceImpl {
    public String currentUser(HttpServletRequest request) {
        HttpSession session = request.getSession();
        return (String) session.getAttribute("loginId");
    }
}
