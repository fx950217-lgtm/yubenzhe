package app.tongban.wallet.demo;

import static org.junit.Assert.*;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Test-only diagnostics for the signed release. Never reads tokens, inputs or signed-in content. */
@RunWith(AndroidJUnit4.class)
public class ReleaseWebViewDiagnosticTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();

    private String evaluate(WebView webView, String script) throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> webView.evaluateJavascript(script, result -> {
            value.set(result);
            completed.countDown();
        }));
        assertTrue("WebView evaluateJavascript timed out", completed.await(10, TimeUnit.SECONDS));
        return value.get();
    }

    private JSONObject snapshot(WebView webView) throws Exception {
        String result = evaluate(webView, "JSON.stringify((()=>{const gate=document.querySelector('.account-gate');return {" +
            "origin:location.origin,path:location.pathname,hash:location.hash,readyState:document.readyState," +
            "secureContext:globalThis.isSecureContext,locks:typeof navigator.locks,crypto:!!globalThis.crypto?.subtle," +
            "title:document.title,bodyChildren:document.body?.children.length,appChildren:document.querySelector('#app')?.children.length," +
            "anonymousGate:!!gate,anonymousText:gate?gate.innerText.slice(0,2200):null," +
            "scripts:[...document.scripts].map(s=>new URL(s.src||location.href).pathname)," +
            "errors:globalThis.__ybzReleaseDiagnostics||[]};})())");
        Object decoded = new JSONTokener(result).nextValue();
        assertTrue("snapshot must be a JSON string", decoded instanceof String);
        return new JSONObject((String)decoded);
    }

    private void report(String label, JSONObject data) {
        Bundle status = new Bundle();
        status.putString("stream", "\nYBZ_RELEASE_DIAGNOSTIC " + label + " " + data.toString() + "\n");
        instrumentation.sendStatus(0, status);
    }

    @Test public void signedReleaseStartsWithSecureWebView() throws Exception {
        org.junit.Assume.assumeTrue("Release-only diagnostics", (instrumentation.getTargetContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) == 0);
        String packageName = instrumentation.getTargetContext().getPackageName();
        assertEquals("app.yubenzhe.mobile", packageName);
        Intent intent = new Intent(Intent.ACTION_MAIN);
        intent.setComponent(new ComponentName(packageName, MainActivity.class.getName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity = instrumentation.startActivitySync(intent);
        assertTrue(activity instanceof MainActivity);
        MainActivity main = (MainActivity)activity;
        AtomicReference<WebView> reference = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> reference.set(main.getBridge().getWebView()));
        WebView webView = reference.get();
        assertNotNull(webView);
        SystemClock.sleep(2000);
        report("initial", snapshot(webView));
        assertTrue("document-start diagnostics supported", WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT));
        String probe = "(()=>{const errors=[];globalThis.__ybzReleaseDiagnostics=errors;" +
            "const clean=x=>String(x||'').replace(/(?:Bearer\\s+)?[A-Za-z0-9_-]{40,}/g,'[redacted]').slice(0,500);" +
            "addEventListener('error',e=>{if(errors.length<20)errors.push({type:'error',message:clean(e.message),file:String(e.filename||'').split('?')[0],line:e.lineno,col:e.colno,resource:e.target?.tagName||null})},true);" +
            "addEventListener('unhandledrejection',e=>{if(errors.length<20)errors.push({type:'rejection',name:clean(e.reason?.name),message:clean(e.reason?.message||e.reason)})});})()";
        instrumentation.runOnMainSync(() -> {
            WebViewCompat.addDocumentStartJavaScript(webView, probe, Collections.singleton("https://localhost"));
            webView.reload();
        });
        JSONObject state = null;
        for (int i = 0; i < 20; i++) {
            SystemClock.sleep(1000);
            state = snapshot(webView);
            if (state.optBoolean("anonymousGate") && !state.optString("anonymousText").contains("连接账号服务")) break;
            if (state.getJSONArray("errors").length() > 0) break;
        }
        JSONObject flags = new JSONObject();
        flags.put("package", packageName);
        flags.put("release", (main.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) == 0);
        flags.put("secureWindow", (main.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE) != 0);
        flags.put("secureMainFrameBridge", main.hasSecureMainFrameBridge());
        flags.put("webViewPackage", WebViewCompat.getCurrentWebViewPackage(main).versionName);
        report("native", flags);
        report("afterReload", state);
        assertTrue("release remains non-debuggable", flags.getBoolean("release"));
        assertTrue("FLAG_SECURE must remain enabled", flags.getBoolean("secureWindow"));
        assertTrue("secure native bridge required", flags.getBoolean("secureMainFrameBridge"));
        assertTrue("https secure context required", state.getBoolean("secureContext"));
        assertEquals("object", state.getString("locks"));
        assertEquals("no startup JavaScript errors", 0, state.getJSONArray("errors").length());
        assertTrue("anonymous login gate must be rendered", state.optBoolean("anonymousGate"));
        assertTrue("registration/login controls must appear", state.optString("anonymousText").contains("创建你的 YBZ 账号") || state.optString("anonymousText").contains("ID 和密码登录"));
    }
}
