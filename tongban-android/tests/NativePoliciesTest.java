package app.tongban.wallet.demo;

import java.util.Arrays;
import java.nio.charset.StandardCharsets;

public class NativePoliciesTest {
    private static int checks;
    private static void check(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }
    private static void reject(String filename, String type, String body) {
        boolean rejected = false;
        try { DocumentPolicy.validate(filename, type, body); } catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected, "Must reject unsafe document input");
    }
    public static void main(String[] args) {
        String filename = "tongban-bsc-testnet-0x1234.json";
        String body = "{\"value\":\"测试\"}";
        check(Arrays.equals(DocumentPolicy.validate(filename, "application/json", body), body.getBytes(StandardCharsets.UTF_8)), "Keep JSON bytes exact");
        for (String unsafe : new String[] {"../wallet.json", "C:\\wallet.json", "/wallet.json", "wallet.json.exe", "wallet\n.json", ".json", "name..json", "x".repeat(125) + ".json"}) reject(unsafe, "application/json", body);
        reject(filename, "text/html", body);
        reject(filename, "application/json", " ");
        reject(filename, "application/json", "x".repeat(DocumentPolicy.MAX_BYTES + 1));
        reject(filename, "application/json", "中".repeat(DocumentPolicy.MAX_BYTES / 2));
        check(DocumentPolicy.validate(filename, "application/json", "x".repeat(DocumentPolicy.MAX_BYTES)).length == DocumentPolicy.MAX_BYTES, "Inclusive UTF8 size boundary");
        check(NavigationPolicy.isLocal("https://localhost/index.html#messages"), "Local page");
        for (String unsafe : new String[] {"http://localhost", "https://localhost.evil.test/", "https://localhost@evil.test", "https://user@localhost/", "https://localhost:1234", "file:///etc/passwd", "javascript:alert(1)", "intent://example", "https://localhost\\@evil.test"}) check(!NavigationPolicy.isLocal(unsafe), "Reject nonlocal origin: " + unsafe);
        check(NavigationPolicy.mayOpenExternal("https://testnet.bscscan.com/tx/0x12", true), "Clicked testnet explorer link");
        check(!NavigationPolicy.mayOpenExternal("https://testnet.bscscan.com/", false), "No silent external navigation");
        check(NavigationPolicy.mayOpenExternal("https://app.remix.live/", true), "Clicked exact Remix root");
        check(!NavigationPolicy.mayOpenExternal("https://app.remix.live/", false), "No automatic DApp browser launch");
        for (String unsafe : new String[] {"https://app.remix.live", "https://app.remix.live/path", "https://app.remix.live//", "https://app.remix.live/./", "https://app.remix.live/%2f", "https://app.remix.live/?url=https://evil.test", "https://app.remix.live/#wallet", "https://app.remix.live:443/", "https://app.remix.live:8443/", "https://user:pass@app.remix.live/", "https://app.remix.live@evil.test/", "https://app.remix.live.evil.test/", "https://APP.REMIX.LIVE/", "http://app.remix.live/"}) check(!NavigationPolicy.mayOpenExternal(unsafe, true), "DApp URL must be exact: " + unsafe);
        for (String external : new String[] {"https://app.remix.live/", "https://testnet.bscscan.com/"}) {
            check(!NavigationPolicy.isLocal(external), "DApp cannot become a local document");
            check(!NavigationPolicy.isTestnetRpc(external), "DApp is never an RPC endpoint");
            check(!NavigationPolicy.isSocialApi(external), "DApp is never a background API endpoint");
            check(!NavigationPolicy.isSocialAvatar(external), "DApp cannot supply embedded content");
        }
        check(NavigationPolicy.mayOpenExternal("https://ollama.com/download", true), "Clicked official Ollama download");
        check(NavigationPolicy.mayOpenExternal("https://docs.ollama.com/quickstart", true), "Clicked official model documentation");
        for (String unsafe : new String[] {"https://ollama.com/", "https://ollama.com/download?redirect=evil", "https://ollama.com/download/windows", "https://ollama.com.evil.test/download", "https://ollama.com@evil.test/download", "http://ollama.com/download"}) check(!NavigationPolicy.mayOpenExternal(unsafe, true), "Model download URL must be exact");
        check(!NavigationPolicy.mayOpenExternal("https://ollama.com/download", false), "No automatic model download");
        String install = DeploymentConfig.PREVIEW_ORIGIN + "/install.html";
        check(NavigationPolicy.mayOpenExternal(install, true), "Clicked exact product installation page");
        check(!NavigationPolicy.mayOpenExternal(install, false), "No automatic installation page launch");
        for(String unsafe : new String[]{DeploymentConfig.PREVIEW_ORIGIN+"/",DeploymentConfig.PREVIEW_ORIGIN+"/downloads/app.apk",DeploymentConfig.PREVIEW_ORIGIN+"/internal/",DeploymentConfig.PREVIEW_ORIGIN+"/x/../install.html",install+"?from=app",install+"#download",install+"/",install.replace("https:","http:"),install.replace("://","://user@"),DeploymentConfig.PREVIEW_ORIGIN+".evil.test/install.html"})check(!NavigationPolicy.mayOpenExternal(unsafe,true),"Installation page must be exact");
        check(!NavigationPolicy.isLocal(install)&&!NavigationPolicy.isSocialApi(install)&&!NavigationPolicy.isSocialAvatar(install)&&!NavigationPolicy.isTestnetRpc(install),"Installation page never becomes embedded app content or RPC/API access");
        for (String unsafe : new String[] {"https://bscscan.com/", "https://testnet.bscscan.com.evil.test/", "https://testnet.bscscan.com@evil.test/", "https://user@testnet.bscscan.com/", "http://testnet.bscscan.com/", "intent://testnet.bscscan.com", "https://testnet.bscscan.com:88/"}) check(!NavigationPolicy.mayOpenExternal(unsafe, true), "External whitelist must be exact");
        check(NavigationPolicy.isTestnetRpc("https://bsc-testnet.bnbchain.org/"), "Approved testnet RPC");
        check(!NavigationPolicy.isTestnetRpc("https://bsc-dataseed.bnbchain.org"), "No mainnet RPC");
        check(!NavigationPolicy.isTestnetRpc("https://bsc-testnet.bnbchain.org/path?secret=x"), "No arbitrary RPC paths");
        for (String allowed : new String[] {"https://66.42.56.29/api/social/", "https://66.42.56.29/api/social/me", "https://66.42.56.29:443/api/social/messages?after=10", "https://66.42.56.29/api/social/conversations/1234-abc/messages"}) check(NavigationPolicy.isSocialApi(allowed), "Social API path allowed: " + allowed);
        for (String unsafe : new String[] {"http://66.42.56.29/api/social/me", "https://66.42.56.29:8443/api/social/me", "https://user:pass@66.42.56.29/api/social/me", "https://66.42.56.29.evil.test/api/social/me", "https://66.42.56.29/admin", "https://66.42.56.29/api/ai/jobs", "https://66.42.56.29/api/social", "https://66.42.56.29/api/socialevil/me", "https://66.42.56.29/api/social/../admin", "https://66.42.56.29/api/social/%2e%2e/admin", "https://66.42.56.29/api/social/%2fadmin", "https://66.42.56.29/api/social//me", "https://66.42.56.29/api/social/me#fragment", "https://66.42.56.29/api/social/%255cadmin"}) check(!NavigationPolicy.isSocialApi(unsafe), "Reject non-social API path: " + unsafe);
        String avatar = "https://66.42.56.29/api/social/avatars/6e9596a6-9481-4c35-acef-a0424051a4fb";
        check(NavigationPolicy.isSocialAvatar(avatar), "Fixed UUID avatar resource");
        check(!NavigationPolicy.isSocialApi(avatar), "Avatar route is separately constrained");
        check(!NavigationPolicy.mayOpenExternal(avatar, true), "Avatar cannot navigate app");
        for (String unsafe : new String[] {avatar + "?v=1", avatar + "#fragment", avatar + "/", avatar.replace("https:", "http:"), avatar.replace("66.42.56.29", "66.42.56.29:444"), avatar.replace("6e9596a6", "not-uuid"), avatar.replace("66.42.56.29", "user@66.42.56.29"), avatar.replace("/avatars/", "/avatars/%2e%2e/")}) check(!NavigationPolicy.isSocialAvatar(unsafe), "Avatar path must be exact");
        check(!NavigationPolicy.mayOpenExternal("https://66.42.56.29/api/social/me", true), "API permission never grants remote navigation");
        for (String path : new String[] {"/_capacitor_file_/private/key", "/_capacitor_content_/wallet", "/%5Fcapacitor_file_/private/key", "/_capacitor_http_interceptor_?url=https://evil.test"}) check(NavigationPolicy.isPrivateBridgePath("https://localhost" + path), "Private bridge paths blocked");
        String camera = "android.webkit.resource.VIDEO_CAPTURE";
        check(NavigationPolicy.mayUseCamera("https://localhost", new String[] {camera}, true), "User requested local camera");
        check(!NavigationPolicy.mayUseCamera("https://localhost", new String[] {camera}, false), "No automatic camera");
        check(!NavigationPolicy.mayUseCamera("https://evil.test", new String[] {camera}, true), "No remote camera");
        check(!NavigationPolicy.mayUseCamera("https://localhost", new String[] {camera, "android.webkit.resource.AUDIO_CAPTURE"}, true), "No combined microphone grant");
        check(!NavigationPolicy.mayUseCamera("https://localhost", new String[] {"android.webkit.resource.PROTECTED_MEDIA_ID"}, true), "Unknown permission denied");
        check(!NavigationPolicy.mayUseCamera("https://localhost", new String[] {}, true), "Empty permission denied");
        System.out.println(checks + " native policy assertions passed");
    }
}
