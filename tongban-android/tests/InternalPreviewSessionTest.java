package app.tongban.wallet.demo;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class InternalPreviewSessionTest {
    private static int checks;
    private static void check(boolean condition,String message){checks++;if(!condition)throw new AssertionError(message);}
    private interface Run {void go() throws Exception;}
    private static void reject(Run work,String message)throws Exception{boolean failed=false;try{work.go();}catch(IllegalArgumentException|IOException expected){failed=true;}check(failed,message);}
    private static InternalPreviewSession.Result result(int status,String body,List<String> cookies,String location){return new InternalPreviewSession.Result(status,body.getBytes(StandardCharsets.UTF_8),Collections.singletonMap("content-type","application/json"),cookies,location);}
    private static final String OUTER="a".repeat(64),PRODUCT="b".repeat(43);
    private static final String FRONT_COOKIE="ybz_front_session="+OUTER+"; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600; Secure";
    private static final String PRODUCT_COOKIE="ybz_social="+PRODUCT+"; Path=/api/social; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure";
    private static class Fake implements InternalPreviewSession.Exchange {
        int calls;String path,method;Map<String,String> headers;byte[] body;Runnable whileSending;
        InternalPreviewSession.Result next=result(303,"",Arrays.asList(FRONT_COOKIE),"/");
        public InternalPreviewSession.Result send(String path,String method,Map<String,String> headers,byte[] body){calls++;this.path=path;this.method=method;this.headers=new LinkedHashMap<>(headers);this.body=body==null?null:body.clone();if(whileSending!=null)whileSending.run();return next;}
    }
    public static void main(String[] args)throws Exception{
        for(String path:new String[]{"/api/social/","/api/social/me","/api/social/messages?after=10","/api/social/ai/jobs","/api/social/workbench/tasks","/api/chain-preview/config"})check(InternalPreviewPolicy.isAllowed(path,"GET"),"approved product query");
        for(String path:new String[]{"https://evil.test/api/social/me","//evil.test/api/social/me","/admin","/api/ai/jobs","/login","/logout","/api/socialevil/me","/api/social/../admin","/api/social/%2e%2e/admin","/api/social/%2fadmin","/api/social//me","/api/social/me#fragment","/api/social/me\r\nx:1","/api/chain-preview/config?x=1"})check(!InternalPreviewPolicy.isAllowed(path,"GET"),"deny widened request path");
        check(!InternalPreviewPolicy.isAllowed("/api/chain-preview/config","POST"),"chain configuration is read-only");
        check(!InternalPreviewPolicy.isAllowed("/api/social/me","PUT"),"only existing GET POST API methods");
        String avatar="/api/social/avatars/6e9596a6-9481-4c35-acef-a0424051a4fb";
        check(InternalPreviewPolicy.isAllowed(avatar,"GET"),"avatar gets authenticated bytes");
        for(String path:new String[]{avatar+"?x=1",avatar+"/",avatar.replace("6e9596a6","not_uuid")})check(!InternalPreviewPolicy.isAllowed(path,"GET"),"avatar strict path");
        check(!InternalPreviewPolicy.isAllowed(avatar,"POST"),"no avatar writes by binary route");
        reject(()->InternalPreviewPolicy.validateRequest("/api/social/me","GET","data",null),"GET body rejected");
        reject(()->InternalPreviewPolicy.validateRequest("/api/social/me","POST","中".repeat(400000),null),"body cap uses bytes");
        for(String name:new String[]{"Cookie","Origin","Host","X-Forwarded-For","Sec-Fetch-Site"})reject(()->InternalPreviewPolicy.validateRequest("/api/social/me","GET",null,Collections.singletonMap(name,"injected")),"JS cannot inject privileged headers");
        reject(()->InternalPreviewPolicy.validateRequest("/api/social/me","GET",null,Collections.singletonMap("If-None-Match","x\r\nCookie:evil")),"header injection rejected");
        reject(()->InternalPreviewPolicy.validateRequest("/api/social/me","POST","{}",Collections.singletonMap("Content-Type","text/html")),"only JSON product body");
        reject(()->InternalPreviewPolicy.validateLogin("a","short"),"strict credential bounds");
        reject(()->InternalPreviewPolicy.validateLogin("tester","x".repeat(257)),"password maximum");
        Fake wire=new Fake();InternalPreviewSession session=new InternalPreviewSession(wire);
        check(!session.status(),"initial status needs no network");
        InternalPreviewSession.Result unauthorized=session.request("/api/social/me","GET",null,null);
        check(unauthorized.status==401&&new String(unauthorized.body,StandardCharsets.UTF_8).contains("INTERNAL_PREVIEW_REQUIRED"),"no unauthenticated product transport");check(wire.calls==0,"unauthed request remains blocked");
        check(session.login("tester","Synthetic-test-only-2026!"),"outer login succeeds");check("/login".equals(wire.path)&&"POST".equals(wire.method),"fixed login request");check(InternalPreviewPolicy.REMOTE.equals(wire.headers.get("Origin")),"login origin fixed remote");check(wire.headers.get("Cookie")==null,"login sends no stale session");
        wire.next=result(200,"{\"token\":\"test\"}",Arrays.asList(PRODUCT_COOKIE,"other=ignored; HttpOnly; Secure"),null);
        session.request("/api/social/login","POST","{}",Collections.emptyMap());check(InternalPreviewPolicy.LOCAL.equals(wire.headers.get("Origin")),"social uses registered native origin");check(wire.headers.get("Cookie").equals("ybz_front_session="+OUTER),"outer cookie sent only by native");
        wire.next=result(200,"{}",Collections.emptyList(),null);
        InternalPreviewSession.Result api=session.request("/api/social/me","GET",null,Collections.singletonMap("Authorization","Bearer "+PRODUCT));check(!wire.headers.get("Cookie").contains("ybz_social="),"product cookies are never retained");check(("Bearer "+PRODUCT).equals(wire.headers.get("authorization")),"product identity uses frontend Bearer token only");check(!wire.headers.get("Cookie").contains("other="),"unknown cookie ignored");check(!api.headers.containsKey("set-cookie"),"visible response has no cookie");
        wire.next=result(200,"{}",Arrays.asList(PRODUCT_COOKIE),null);session.request("/api/social/logout","POST","{}",Collections.singletonMap("Authorization","Bearer "+PRODUCT));
        session.request("/api/social/me","GET",null,Collections.emptyMap());check(!wire.headers.get("Cookie").contains("ybz_social=")&&!wire.headers.containsKey("authorization"),"late product Set-Cookie cannot resurrect a logged out account");
        wire.next=result(200,"{}",Collections.emptyList(),null);
        check(session.status(),"status checks server gate");check(wire.path.equals("/api/chain-preview/config")&&InternalPreviewPolicy.REMOTE.equals(wire.headers.get("Origin")),"config uses required same-origin boundary");
        wire.next=result(302,"",Collections.emptyList(),"https://evil.test/");reject(()->session.request("/api/social/me","GET",null,null),"API redirect rejected");check(session.authenticated(),"redirect never grants or changes auth");
        wire.next=result(401,"{\"code\":\"SESSION_EXPIRED\"}",Collections.emptyList(),null);session.request("/api/social/me","GET",null,null);check(session.authenticated(),"product signout does not accidentally drop outer login");
        wire.next=result(401,"{\"code\":\"INTERNAL_PREVIEW_REQUIRED\"}",Collections.emptyList(),null);session.request("/api/social/me","GET",null,null);check(!session.authenticated(),"expired outer login clears all native cookies");
        wire.next=result(303,"",Arrays.asList(FRONT_COOKIE),"https://evil.test/");reject(()->session.login("tester","Synthetic-test-only-2026!"),"login accepts only expected local redirect");check(!session.authenticated(),"hostile redirect cannot set session");
        wire.next=result(303,"",Arrays.asList(FRONT_COOKIE),"/");session.login("tester","Synthetic-test-only-2026!");wire.next=result(200,"{}",Collections.emptyList(),null);wire.whileSending=session::clear;reject(()->session.request("/api/social/me","GET",null,null),"late result from prior session rejected");wire.whileSending=null;
        wire.next=result(303,"",Arrays.asList(FRONT_COOKIE),"/");session.login("tester","Synthetic-test-only-2026!");session.logout();check(!session.authenticated(),"logout clears local session");check(wire.path.equals("/logout")&&InternalPreviewPolicy.REMOTE.equals(wire.headers.get("Origin")),"logout uses fixed endpoint");
        wire.next=result(303,"",Arrays.asList(FRONT_COOKIE.replace("Max-Age=3600","Max-Age=0")),"/");reject(()->session.login("tester","Synthetic-test-only-2026!"),"expired cookie rejected");
        System.out.println(checks+" internal preview policy/session assertions passed");
    }
}
