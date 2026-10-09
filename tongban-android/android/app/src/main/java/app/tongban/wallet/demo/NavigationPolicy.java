package app.tongban.wallet.demo;

import java.net.URI;
import java.util.Set;
import java.util.HashSet;
import java.util.Arrays;

public final class NavigationPolicy {
    private static final Set<String> EXTERNAL_HOSTS = new HashSet<>(Arrays.asList("testnet.bscscan.com", "docs.bnbchain.org", "docs.ethers.org", "docs.ollama.com"));
    private static final Set<String> RPC_HOSTS = new HashSet<>(Arrays.asList("bsc-testnet-dataseed.bnbchain.org", "bsc-testnet.bnbchain.org"));
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
        return EXTERNAL_HOSTS.contains(uri.getHost()) || ("ollama.com".equals(uri.getHost()) && "/download".equals(uri.getPath()) && uri.getQuery() == null);
    }
    public static boolean isTestnetRpc(String raw) {
        URI uri = secureUri(raw);
        return uri != null && RPC_HOSTS.contains(uri.getHost()) && (uri.getPath().isEmpty() || "/".equals(uri.getPath())) && uri.getQuery() == null;
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
