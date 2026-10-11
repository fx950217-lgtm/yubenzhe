package app.tongban.wallet.demo;

import android.os.Bundle;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityManager;
import android.content.Context;
import android.webkit.WebView;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private long lastTouch = -10000;
    private SafeChromeClient safeChromeClient;
    private boolean secureMainFrameBridge;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SaveDocumentPlugin.class);
        registerPlugin(InternalPreviewPlugin.class);
        registerPlugin(SaveArtifactPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        // Never permit Capacitor's legacy all-frame bridge fallback. Modern listener
        // registrations remain intact; an unsupported WebView fails closed.
        webView.removeJavascriptInterface("androidBridge");
        secureMainFrameBridge = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
            && !bridge.getConfig().isUsingLegacyBridge()
            && bridge.getAllowedOriginRules().size() == 1
            && bridge.getAllowedOriginRules().contains("https://localhost");
        WebView.setWebContentsDebuggingEnabled(false);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowFileAccessFromFileURLs(false);
        webView.getSettings().setAllowUniversalAccessFromFileURLs(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        // target=_blank uses ordinary navigation; no second WebView receives the native bridge.
        webView.getSettings().setSupportMultipleWindows(false);
        safeChromeClient = new SafeChromeClient(bridge, this);
        webView.setWebChromeClient(safeChromeClient);
        webView.setWebViewClient(new SafeWebViewClient(bridge));
    }

    boolean hasSecureMainFrameBridge() { return secureMainFrameBridge; }

    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        if (event.getActionMasked() == MotionEvent.ACTION_UP) lastTouch = SystemClock.elapsedRealtime();
        return super.dispatchTouchEvent(event);
    }

    boolean hasRecentGesture() {
        long age = SystemClock.elapsedRealtime() - lastTouch;
        AccessibilityManager accessibility = (AccessibilityManager) getSystemService(Context.ACCESSIBILITY_SERVICE);
        boolean assistedInput = accessibility != null && accessibility.isTouchExplorationEnabled();
        // TalkBack activation is not necessarily dispatched as a touch event. A native consent
        // dialog is still mandatory, including when Android's camera permission was granted before.
        return hasWindowFocus() && ((age >= 0 && age < 5000) || assistedInput);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_UP && (event.getKeyCode() == KeyEvent.KEYCODE_ENTER || event.getKeyCode() == KeyEvent.KEYCODE_DPAD_CENTER || event.getKeyCode() == KeyEvent.KEYCODE_SPACE)) lastTouch = SystemClock.elapsedRealtime();
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onStop() {
        if (safeChromeClient != null) safeChromeClient.cancelCameraRequest();
        super.onStop();
    }
}
