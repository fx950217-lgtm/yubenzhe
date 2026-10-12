package app.tongban.wallet.demo;

import android.util.Base64;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "InternalPreview")
public class InternalPreviewPlugin extends Plugin {
    private final InternalPreviewSession session = new InternalPreviewSession(new InternalPreviewHttps());
    private final AtomicBoolean loginPending = new AtomicBoolean(false);
    private interface Work { void run() throws Exception; }
    private void trusted(PluginCall call, Work work) {
        getActivity().runOnUiThread(() -> {
            // Capacitor's modern bridge checks sourceOrigin AND isMainFrame. The Activity
            // removes the legacy all-frame addJavascriptInterface fallback before page load.
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                    || getBridge().getConfig().isUsingLegacyBridge()
                    || !(getActivity() instanceof MainActivity)
                    || !((MainActivity)getActivity()).hasSecureMainFrameBridge()
                    || !NavigationPolicy.isLocal(getBridge().getWebView().getUrl())
                    || NavigationPolicy.isPrivateBridgePath(getBridge().getWebView().getUrl())) {
                call.reject("安全访问组件不可用，请更新 Android System WebView 后重试。", "UNTRUSTED_FRAME");return;
            }
            execute(() -> {
                try { work.run(); }
                catch (IllegalArgumentException error) { call.reject(error.getMessage(), "INVALID_PREVIEW_REQUEST"); }
                catch (Exception error) { call.reject("内部访问验证或网络请求未完成，请核对账号与连接后重试。", "INTERNAL_PREVIEW_NETWORK"); }
            });
        });
    }
    @PluginMethod public void status(PluginCall call) { trusted(call, () -> call.resolve(new JSObject().put("mode",session.accessMode()).put("authenticated",session.status()))); }
    @PluginMethod public void login(PluginCall call) {
        trusted(call, () -> {
            if(!loginPending.compareAndSet(false,true)){call.reject("正在验证内部访问，请稍候。","LOGIN_PENDING");return;}
            try { session.login(call.getString("username"),call.getString("password"));call.resolve(new JSObject().put("authenticated",true)); }
            finally {loginPending.set(false);}
        });
    }
    @PluginMethod public void logout(PluginCall call) { trusted(call, () -> {session.logout();call.resolve(new JSObject().put("mode",session.accessMode()).put("authenticated","public".equals(session.accessMode())));}); }
    @PluginMethod public void request(PluginCall call) {
        trusted(call, () -> {
            JSObject supplied=call.getObject("headers",new JSObject());Map<String,String> headers=new LinkedHashMap<>();
            for(Iterator<String> it=supplied.keys();it.hasNext();){String key=it.next();Object value=supplied.opt(key);if(!(value instanceof String))throw new IllegalArgumentException("请求头必须是文本。");headers.put(key,(String)value);}
            InternalPreviewSession.Result result=session.request(call.getString("path"),call.getString("method","GET"),call.getString("body"),headers);
            JSObject visible=new JSObject();for(Map.Entry<String,String> header:result.headers.entrySet())visible.put(header.getKey(),header.getValue());
            call.resolve(new JSObject().put("status",result.status).put("bodyBase64",Base64.encodeToString(result.body,Base64.NO_WRAP)).put("headers",visible));
        });
    }
    @Override protected void handleOnDestroy() {session.clear();super.handleOnDestroy();}
}
