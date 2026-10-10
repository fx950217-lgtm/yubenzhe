package app.tongban.wallet.demo;

import android.util.Base64;
import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/** Present only in the isolated .localqa application; never compiled into the release application. */
final class LocalQaApi {
    private static final int LIMIT=1024*1024;
    private final WebView view;
    private final Activity activity;
    private volatile String shellState="{}";
    private final ExecutorService executor=Executors.newFixedThreadPool(4);
    private final AtomicInteger active=new AtomicInteger();
    LocalQaApi(WebView view,Activity activity){this.view=view;this.activity=activity;}
    @JavascriptInterface public String themeInfo(){return shellState;}
    @JavascriptInterface public void setTheme(String theme){
        if(theme==null)return;
        final String color=theme.equals("dark")?"#10151f":theme.equals("eyecare")?"#dde8d0":theme.equals("light")?"#f7f9fc":null;
        if(color==null)return;
        view.post(()->{if(view.getUrl()==null||!NavigationPolicy.isLocal(view.getUrl()))return;int value=Color.parseColor(color);Window window=activity.getWindow();view.setBackgroundColor(value);window.getDecorView().setBackgroundColor(value);window.setStatusBarColor(value);window.setNavigationBarColor(value);boolean dark=theme.equals("dark");int flags=window.getDecorView().getSystemUiVisibility(),mask=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;window.getDecorView().setSystemUiVisibility(dark?flags&~mask:flags|mask);if(Build.VERSION.SDK_INT>=30){WindowInsetsController controller=window.getInsetsController();if(controller!=null){int appearance=WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;controller.setSystemBarsAppearance(dark?0:appearance,appearance);}}try{JSONObject state=new JSONObject();state.put("theme",theme);state.put("background",color);state.put("statusBarColor",String.format("#%08x",window.getStatusBarColor()));state.put("navigationBarColor",String.format("#%08x",window.getNavigationBarColor()));state.put("darkIcons",!dark);shellState=state.toString();}catch(Exception ignored){} });
    }
    static String validPath(String path){
        if(path==null||path.length()>2048||!path.matches("/api/social/[A-Za-z0-9_/-]*(\\?[A-Za-z0-9_%=&.+-]{0,512})?")||path.contains("//")||path.contains(".."))throw new IllegalArgumentException("QA path denied");
        return path;
    }
    static String avatarPath(String url){
        String prefix="https://66.42.56.29";
        if(url!=null&&url.startsWith(prefix)){String path=url.substring(prefix.length());if(path.matches("/api/social/avatars/[a-fA-F0-9-]{36}"))return path;}
        return null;
    }
    @JavascriptInterface public void request(String id,String serialized){
        if(id==null||!id.matches("[a-fA-F0-9-]{36}")||serialized==null)return;
        view.post(()->{
            if(view.getUrl()==null||!NavigationPolicy.isLocal(view.getUrl())||NavigationPolicy.isPrivateBridgePath(view.getUrl())){reply(id,error());return;}
            if(serialized.getBytes(StandardCharsets.UTF_8).length>LIMIT){reply(id,error());return;}
            if(active.incrementAndGet()>32){active.decrementAndGet();reply(id,error());return;}
            executor.execute(()->{JSONObject result;try{result=perform(new JSONObject(serialized));}catch(Exception ignored){result=error();}finally{active.decrementAndGet();}reply(id,result);});
        });
    }
    private void reply(String id,JSONObject result){view.post(()->{if(view.getUrl()!=null&&NavigationPolicy.isLocal(view.getUrl())&&!NavigationPolicy.isPrivateBridgePath(view.getUrl()))view.evaluateJavascript("window.__ybzQaReply("+JSONObject.quote(id)+","+result.toString()+");",null);});}
    private static JSONObject error(){JSONObject result=new JSONObject();try{result.put("error","LOCAL_QA_UNAVAILABLE");}catch(Exception ignored){}return result;}
    static JSONObject perform(JSONObject input) throws Exception {
        String method=input.getString("method"),path=validPath(input.getString("path")),body=input.optString("body","");
        if(!method.equals("GET")&&!method.equals("POST"))throw new IllegalArgumentException("QA method denied");
        byte[] bytes=body.getBytes(StandardCharsets.UTF_8);
        if(bytes.length>LIMIT||method.equals("GET")&&bytes.length!=0)throw new IllegalArgumentException("QA body denied");
        if(bytes.length>0)new JSONObject(body);
        HttpURLConnection connection=(HttpURLConnection)new URL("http://localhost:18914"+path).openConnection();
        connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(10000);connection.setReadTimeout(15000);connection.setRequestMethod(method);
        connection.setRequestProperty("Origin","https://localhost");connection.setRequestProperty("Accept","application/json");
        JSONObject headers=input.optJSONObject("headers");
        if(headers!=null)for(String name:new String[]{"authorization","content-type","if-none-match"})if(headers.has(name)){
            String value=headers.getString(name);
            if(value.length()>512||value.contains("\r")||value.contains("\n"))throw new IllegalArgumentException("QA header denied");
            if(name.equals("authorization")&&!value.matches("Bearer [-_A-Za-z0-9]{43}"))throw new IllegalArgumentException("QA authorization denied");
            if(name.equals("content-type")&&!value.equals("application/json"))throw new IllegalArgumentException("QA content type denied");
            connection.setRequestProperty(name,value);
        }
        try{
            if(method.equals("POST")){connection.setRequestProperty("Content-Type","application/json");connection.setDoOutput(true);connection.setFixedLengthStreamingMode(bytes.length);try(java.io.OutputStream output=connection.getOutputStream()){output.write(bytes);}}
            int status=connection.getResponseCode();if(status>=300&&status<400&&status!=304)throw new IllegalArgumentException("QA redirects denied");
            ByteArrayOutputStream output=new ByteArrayOutputStream();
            try(InputStream stream=status>=400?connection.getErrorStream():connection.getInputStream()){if(stream!=null){byte[] buffer=new byte[8192];for(int count;(count=stream.read(buffer))!=-1;){if(output.size()+count>LIMIT)throw new IllegalArgumentException("QA response too large");output.write(buffer,0,count);}}}
            JSONObject result=new JSONObject(),responseHeaders=new JSONObject();
            for(String name:new String[]{"content-type","etag","cache-control"}){String value=connection.getHeaderField(name);if(value!=null)responseHeaders.put(name,value);}
            result.put("status",status);result.put("headers",responseHeaders);result.put("bodyBase64",Base64.encodeToString(output.toByteArray(),Base64.NO_WRAP));return result;
        }finally{connection.disconnect();}
    }
    static WebResourceResponse avatar(String path){
        try{JSONObject input=new JSONObject();input.put("method","GET");input.put("path",validPath(path));JSONObject result=perform(input),headers=result.getJSONObject("headers");String contentType=headers.optString("content-type","application/octet-stream").split(";")[0];Map<String,String> outputHeaders=new HashMap<>();outputHeaders.put("Cache-Control","no-store");return new WebResourceResponse(contentType,"utf-8",result.getInt("status"),"Local QA",outputHeaders,new ByteArrayInputStream(Base64.decode(result.getString("bodyBase64"),Base64.NO_WRAP)));}
        catch(Exception ignored){return new WebResourceResponse("text/plain","utf-8",503,"Unavailable",new HashMap<>(),new ByteArrayInputStream(new byte[0]));}
    }
}
