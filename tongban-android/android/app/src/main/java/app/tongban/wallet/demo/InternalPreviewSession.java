package app.tongban.wallet.demo;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Only the outer cookie stays in memory. Product identity uses the existing frontend Bearer token. */
public final class InternalPreviewSession {
    public interface Exchange { Result send(String path, String method, Map<String,String> headers, byte[] body) throws IOException; }
    public static final class Result {
        public final int status;
        public final byte[] body;
        public final Map<String,String> headers;
        final List<String> cookies;
        final String location;
        public Result(int status, byte[] body, Map<String,String> headers, List<String> cookies, String location) {
            this.status=status; this.body=body; this.headers=headers; this.cookies=cookies; this.location=location;
        }
    }
    private final Exchange exchange;
    private final String accessMode;
    private final Map<String,String> cookies = new LinkedHashMap<>();
    private long generation = 0;
    private long expiresAt = 0;
    public InternalPreviewSession(Exchange exchange) { this(exchange, DeploymentConfig.ACCESS_MODE); }
    InternalPreviewSession(Exchange exchange, String accessMode) {
        if (!"internal-preview".equals(accessMode) && !"public".equals(accessMode)) throw new IllegalArgumentException("客户端访问模式无效。");
        java.net.URI origin = java.net.URI.create(InternalPreviewPolicy.REMOTE);
        if (!"https".equals(origin.getScheme()) || origin.getHost() == null || origin.getUserInfo() != null || origin.getRawQuery() != null || origin.getRawFragment() != null || (origin.getRawPath() != null && !origin.getRawPath().isEmpty())) throw new IllegalArgumentException("客户端服务地址必须是明确的 HTTPS 源。");
        this.exchange = exchange; this.accessMode = accessMode;
    }
    public String accessMode() { return accessMode; }
    private boolean publicAccess() { return "public".equals(accessMode); }
    public synchronized boolean authenticated() {
        if (System.currentTimeMillis() >= expiresAt) { cookies.clear(); expiresAt=0; }
        return cookies.containsKey("ybz_front_session");
    }
    public synchronized void clear() { generation++; cookies.clear(); expiresAt=0; }
    private synchronized String cookieHeader() {
        List<String> parts=new ArrayList<>(); for(Map.Entry<String,String> item:cookies.entrySet()) parts.add(item.getKey()+"="+item.getValue());
        StringBuilder result=new StringBuilder();for(String part:parts){if(result.length()>0)result.append("; ");result.append(part);}return result.toString();
    }
    private void acceptCookies(List<String> values) {
        if(publicAccess()||values==null)return;
        for(String value:values) {
            if(value==null)continue;
            String[] parts=value.split(";");String pair=parts[0].trim();int at=pair.indexOf('=');if(at<0)continue;
            String name=pair.substring(0,at), token=pair.substring(at+1);
            if(!name.equals("ybz_front_session"))continue;
            if(token.isEmpty()){cookies.remove(name);if(name.equals("ybz_front_session"))expiresAt=0;continue;}
            if(!token.matches("[a-f0-9]{64}"))continue;
            boolean secure=false,httpOnly=false;long age=3600;
            for(int i=1;i<parts.length;i++){String part=parts[i].trim();if(part.equalsIgnoreCase("secure"))secure=true;if(part.equalsIgnoreCase("httponly"))httpOnly=true;if(part.toLowerCase(Locale.ROOT).startsWith("max-age=")){try{age=Long.parseLong(part.substring(8));}catch(NumberFormatException ignored){age=0;}}}
            if(!secure||!httpOnly||age<=0){cookies.remove(name);continue;}
            cookies.put(name,token);if(name.equals("ybz_front_session"))expiresAt=System.currentTimeMillis()+Math.min(age,3600)*1000;
        }
    }
    private static Map<String,String> headers(String path,String cookie) {
        Map<String,String> result=new LinkedHashMap<>();result.put("Origin",InternalPreviewPolicy.originFor(path));result.put("Accept","application/json");
        if(!cookie.isEmpty())result.put("Cookie",cookie);return result;
    }
    public boolean login(String username,String password) throws IOException {
        if(publicAccess())throw new IllegalArgumentException("此版本无需内部访问凭证，请使用自己的产品账号登录。");
        InternalPreviewPolicy.validateLogin(username,password);
        final long revision; synchronized(this){clear();revision=generation;}
        Map<String,String> headers=headers("/login","");headers.put("Content-Type","application/x-www-form-urlencoded");
        byte[] body=("username="+URLEncoder.encode(username,"UTF-8")+"&password="+URLEncoder.encode(password,"UTF-8")).getBytes(StandardCharsets.UTF_8);
        Result result;
        try { result=exchange.send("/login","POST",headers,body); }
        finally { java.util.Arrays.fill(body,(byte)0); }
        synchronized(this){
            if(revision!=generation)throw new IOException("访问登录已取消，请重试。");
            if((result.status==302||result.status==303)&&"/".equals(result.location)){acceptCookies(result.cookies);if(authenticated())return true;}
            clear();throw new IOException(result.status==429?"尝试过于频繁，请稍后重试。":"内部账号或访问密码未通过验证。");
        }
    }
    public Result request(String path,String method,String body,Map<String,String> inputHeaders) throws IOException {
        Map<String,String> safe=InternalPreviewPolicy.validateRequest(path,method,body,inputHeaders);
        final long revision;final String cookie;
        synchronized(this){if(!publicAccess()&&!authenticated())return unauthorized();revision=generation;cookie=publicAccess()?"":cookieHeader();}
        Map<String,String> headers=headers(path,cookie);headers.putAll(safe);
        Result result=exchange.send(path,method,headers,body==null?null:body.getBytes(StandardCharsets.UTF_8));
        if(result.status>=300&&result.status<400&&result.status!=304)throw new IOException("产品接口返回了不允许的跳转。");
        synchronized(this){
            if(revision!=generation)throw new IOException("访问会话已变化，请重新登录。");
            if(result.status==401&&new String(result.body,StandardCharsets.UTF_8).contains("INTERNAL_PREVIEW_REQUIRED")){clear();return result;}
            if(result.status<400)acceptCookies(result.cookies);
        }
        return result;
    }
    public boolean status() throws IOException {
        // This is transport readiness, not product-account authentication.
        if(publicAccess())return true;
        synchronized(this){if(!authenticated())return false;}
        Result result=request("/api/chain-preview/config","GET",null,Collections.emptyMap());
        if(result.status==401)return false;
        if(result.status!=200)throw new IOException("暂时无法核对内部访问会话，请重试。");
        return authenticated();
    }
    public void logout() {
        final String cookie; synchronized(this){cookie=cookieHeader();clear();}
        if(publicAccess()||cookie.isEmpty())return;
        try {exchange.send("/logout","POST",headers("/logout",cookie),new byte[0]);}catch(IOException ignored){ /* Local revocation remains effective while offline. */ }
    }
    private static Result unauthorized(){return new Result(401,"{\"code\":\"INTERNAL_PREVIEW_REQUIRED\",\"error\":\"请先登录内部预览。\"}".getBytes(StandardCharsets.UTF_8),Collections.singletonMap("content-type","application/json; charset=utf-8"),Collections.emptyList(),null);}
}
