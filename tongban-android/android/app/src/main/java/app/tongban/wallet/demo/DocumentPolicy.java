package app.tongban.wallet.demo;

import java.nio.charset.StandardCharsets;

/** Small, platform-independent boundary; never accepts a destination path. */
public final class DocumentPolicy {
    public static final int MAX_BYTES = 256 * 1024;
    private DocumentPolicy() {}

    public static byte[] validate(String filename, String mimeType, String content) {
        if (filename == null || !filename.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,119}\\.json") || filename.contains("..")) {
            throw new IllegalArgumentException("文件名必须是安全的 JSON 文件名，不能包含路径。");
        }
        if (!"application/json".equals(mimeType)) throw new IllegalArgumentException("只支持 JSON 备份文件。");
        if (content == null || content.trim().isEmpty() || content.length() > MAX_BYTES) {
            throw new IllegalArgumentException("备份内容为空或超过 256 KiB。");
        }
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IllegalArgumentException("备份内容超过 256 KiB。");
        return bytes;
    }
}
