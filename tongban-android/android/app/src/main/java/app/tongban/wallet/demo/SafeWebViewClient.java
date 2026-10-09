package app.tongban.wallet.demo;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.util.Collections;

final class SafeWebViewClient extends BridgeWebViewClient {
    SafeWebViewClient(Bridge bridge) { super(bridge); }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        String url = request.getUrl().toString();
        if (NavigationPolicy.isLocal(url) && !NavigationPolicy.isPrivateBridgePath(url)) return false;
        if (request.isForMainFrame() && NavigationPolicy.mayOpenExternal(url, request.hasGesture())) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, request.getUrl());
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                view.getContext().startActivity(intent);
            } catch (ActivityNotFoundException ignored) { /* No external browser: stay in the app. */ }
        }
        return true;
    }

    @Override
    @SuppressWarnings("deprecation")
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        // Older callback has no trustworthy gesture information; never launch an external app.
        return !NavigationPolicy.isLocal(url) || NavigationPolicy.isPrivateBridgePath(url);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String url = request.getUrl().toString();
        if ((NavigationPolicy.isLocal(url) && !NavigationPolicy.isPrivateBridgePath(url)) || (!request.isForMainFrame() && (NavigationPolicy.isTestnetRpc(url) || NavigationPolicy.isSocialApi(url) || NavigationPolicy.isSocialAvatar(url)))) {
            return super.shouldInterceptRequest(view, request);
        }
        return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
}
