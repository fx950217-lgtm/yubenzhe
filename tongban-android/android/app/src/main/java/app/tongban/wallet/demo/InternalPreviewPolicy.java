package app.tongban.wallet.demo;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/** The native session transport is a fixed product API, never a general URL proxy. */
public final class InternalPreviewPolicy {
    public static final String REMOTE = "https://66.42.56.29";
    public static final String LOCAL = "https://localhost";
    public static final int MAX_BODY_BYTES = 1024 * 1024;
    public static final int MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
    private InternalPreviewPolicy() {}
    public static void validateLogin(String username, String password) {
        if (username == null || !username.matches("[A-Za-z0-9_-]{3,40}") || password == null || password.length() < 16 || password.length() > 256 || password.indexOf('\0') >= 0) throw new IllegalArgumentException("内部账号或访问密码格式无效。");
    }
    public static boolean isAllowed(String path, String method) {
        if (path == null || path.length() > 4096 || !("GET".equals(method) || "POST".equals(method))) return false;
        try {
            URI uri = new URI(path);
            if (uri.isAbsolute() || uri.getRawAuthority() != null || uri.getRawFragment() != null || !path.startsWith("/") || path.startsWith("//")) return false;
            String raw = uri.getRawPath();
            if ("/api/chain-preview/config".equals(raw)) return "GET".equals(method) && uri.getRawQuery() == null;
            if (raw == null || !raw.matches("/api/social/[A-Za-z0-9_/-]*") || raw.contains("//")) return false;
            if (raw.startsWith("/api/social/avatars/")) return "GET".equals(method) && uri.getRawQuery() == null && raw.matches("/api/social/avatars/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}");
            String query = uri.getRawQuery();
            return query == null || (query.length() <= 4096 && !query.matches(".*[\\r\\n\\x00].*"));
        } catch (Exception ignored) { return false; }
    }
    public static String originFor(String path) { return path.startsWith("/api/social/") ? LOCAL : REMOTE; }
    public static Map<String, String> validateRequest(String path, String method, String body, Map<String, String> headers) {
        if (!isAllowed(path, method)) throw new IllegalArgumentException("请求不在允许的产品接口范围内。");
        if (body != null && body.getBytes(StandardCharsets.UTF_8).length > MAX_BODY_BYTES) throw new IllegalArgumentException("请求内容过大。");
        if ("GET".equals(method) && body != null && !body.isEmpty()) throw new IllegalArgumentException("查询不能携带请求正文。");
        Map<String, String> safe = new LinkedHashMap<>();
        if (headers != null) for (Map.Entry<String, String> entry : headers.entrySet()) {
            String key = entry.getKey().toLowerCase(Locale.ROOT), value = entry.getValue();
            if (value == null || value.length() > 1024 || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0 || value.indexOf('\0') >= 0) throw new IllegalArgumentException("请求头无效。");
            if ("authorization".equals(key)) {
                if (!value.matches("Bearer [-_A-Za-z0-9]{43}")) throw new IllegalArgumentException("产品会话格式无效。");
            } else if ("content-type".equals(key)) {
                if (!value.equalsIgnoreCase("application/json") && !value.equalsIgnoreCase("application/json; charset=utf-8")) throw new IllegalArgumentException("接口仅支持 JSON。");
            } else if ("accept".equals(key)) {
                if (!value.equals("application/json") && !value.equals("*/*")) throw new IllegalArgumentException("请求格式无效。");
            } else if (!"if-none-match".equals(key)) throw new IllegalArgumentException("不允许自定义该请求头。");
            if (safe.put(key, value) != null) throw new IllegalArgumentException("请求头重复。");
        }
        if ("POST".equals(method)) safe.put("content-type", "application/json");
        return safe;
    }
}
