package app.tongban.wallet.demo;

import java.net.URI;
import java.util.Set;
import java.util.HashSet;
import java.util.Arrays;

public final class NavigationPolicy {
    private static final Set<String> EXTERNAL_HOSTS = new HashSet<>(Arrays.asList(DeploymentConfig.EXTERNAL_HOSTS));
    private static final Set<String> RPC_URLS = new HashSet<>(Arrays.asList(DeploymentConfig.RPC_URLS));
    // Exact system-browser destination. It is not an allowed WebView or RPC host.
    private static final String EXTERNAL_DAPP_ROOT = "https://app.remix.live/";
    private static final String EXTERNAL_INSTALL_PAGE = DeploymentConfig.PREVIEW_ORIGIN + "/install.html";
    private NavigationPolicy() {}

    private static URI secureUri(String raw) {
        try {
            URI uri = new URI(raw);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return null;
            return uri;
        } catch (Exception ignored) { return null; }
    }
    public static boolean isLocal(String raw) {
        URI uri = secureUri(raw);
        return uri != null && "localhost".equals(uri.getHost());
    }
    public static boolean mayOpenExternal(String raw, boolean userGesture) {
        URI uri = secureUri(raw);
        if (!userGesture || uri == null) return false;
        return EXTERNAL_DAPP_ROOT.equals(raw) || EXTERNAL_INSTALL_PAGE.equals(raw) || EXTERNAL_HOSTS.contains(uri.getHost()) || (DeploymentConfig.DOWNLOAD_URL.equals(raw) && uri.getQuery() == null);
    }
    public static boolean isTestnetRpc(String raw) {
        URI uri = secureUri(raw);
        return uri != null && RPC_URLS.contains(raw.replaceAll("/$", "")) && uri.getQuery() == null;
    }
    public static boolean isSocialApi(String raw) {
        URI uri = secureUri(raw);
        if (uri == null || !DeploymentConfig.PREVIEW_HOST.equals(uri.getHost()) || uri.getFragment() != null) return false;
        // Match raw paths, so encoded separators or dot segments never widen the API boundary.
        String path = uri.getRawPath();
        return path != null && path.matches("/api/social/[A-Za-z0-9_/-]*") && !path.contains("//") && !path.startsWith("/api/social/avatars/");
    }
    public static boolean isSocialAvatar(String raw) {
        URI uri = secureUri(raw);
        return uri != null && DeploymentConfig.PREVIEW_HOST.equals(uri.getHost()) && uri.getRawQuery() == null && uri.getFragment() == null &&
            uri.getRawPath().matches("/api/social/avatars/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}");
    }
    public static boolean isPrivateBridgePath(String raw) {
        try {
            String path = new URI(raw).getPath();
            return path != null && (path.startsWith("/_capacitor_file_") || path.startsWith("/_capacitor_content_") || path.startsWith("/_capacitor_http_interceptor_"));
        } catch (Exception ignored) { return true; }
    }
    public static boolean mayUseCamera(String origin, String[] resources, boolean recentGesture) {
        return recentGesture && isLocal(origin) && resources != null && resources.length == 1 && "android.webkit.resource.VIDEO_CAPTURE".equals(resources[0]);
    }
}
