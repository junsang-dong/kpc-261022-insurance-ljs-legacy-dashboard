// SYNTHETIC FIXTURE - NOT FOR BUILD
// 대외기관 고정길이 전문 처리: 문자셋 미지정 변환과 엔디언 가정을 재현
package egovframework.example.legacy;

import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;

public class FixedLengthParser {
    public String field(byte[] bytes, int from, int len) {
        byte[] part = new byte[len];
        System.arraycopy(bytes, from, part, 0, len);
        return new String(part).trim();
    }

    public int amount(byte[] header) {
        // POWER(Big-Endian) 기본 바이트 순서에 의존
        return ByteBuffer.wrap(header, 0, 4).getInt();
    }

    public long readLength(InputStream in) throws IOException {
        DataInputStream data = new DataInputStream(in);
        return data.readLong();
    }
}
