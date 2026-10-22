// SYNTHETIC FIXTURE - NOT FOR BUILD
// IBM JDK 전용 보안 프로바이더 사용을 재현
package egovframework.example.legacy;

import com.ibm.crypto.provider.IBMJCE;
import java.security.Security;

public class IbmCryptoUtil {
    static {
        Security.addProvider(new IBMJCE());
    }

    public void loadNativeSigner() {
        System.loadLibrary("kbsecure"); // AIX용 .a 라이브러리
    }
}
