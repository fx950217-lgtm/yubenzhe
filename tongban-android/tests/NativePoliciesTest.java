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
        check(NavigationPolicy.mayOpenExternal("https://ollama.com/download", true), "Clicked official Ollama download");
        check(NavigationPolicy.mayOpenExternal("https://docs.ollama.com/quickstart", true), "Clicked official model documentation");
        for (String unsafe : new String[] {"https://ollama.com/", "https://ollama.com/download?redirect=evil", "https://ollama.com/download/windows", "https://ollama.com.evil.test/download", "https://ollama.com@evil.test/download", "http://ollama.com/download"}) check(!NavigationPolicy.mayOpenExternal(unsafe, true), "Model download URL must be exact");
        check(!NavigationPolicy.mayOpenExternal("https://ollama.com/download", false), "No automatic model download");
        for (String unsafe : new String[] {"https://bscscan.com/", "https://testnet.bscscan.com.evil.test/", "https://testnet.bscscan.com@evil.test/", "https://user@testnet.bscscan.com/", "http://testnet.bscscan.com/", "intent://testnet.bscscan.com", "https://testnet.bscscan.com:88/"}) check(!NavigationPolicy.mayOpenExternal(unsafe, true), "External whitelist must be exact");
        check(NavigationPolicy.isTestnetRpc("https://bsc-testnet.bnbchain.org/"), "Approved testnet RPC");
        check(!NavigationPolicy.isTestnetRpc("https://bsc-dataseed.bnbchain.org"), "No mainnet RPC");
        check(!NavigationPolicy.isTestnetRpc("https://bsc-testnet.bnbchain.org/path?secret=x"), "No arbitrary RPC paths");
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
