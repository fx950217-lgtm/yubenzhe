package app.tongban.wallet.demo;

import static org.junit.Assert.*;

import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Explicit, bounded release-APK UI actions. Credentials enter only the normal login form. */
@RunWith(AndroidJUnit4.class)
public class ReleaseWebViewActionsTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private WebView webView;
    private boolean sendTaskAction=false;
    private String submissionStage="not-submitted";

    private Object js(String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> webView.evaluateJavascript(script, result -> {value.set(result);done.countDown();}));
        assertTrue("UI action evaluation timed out", done.await(10, TimeUnit.SECONDS));
        return new JSONTokener(value.get()).nextValue();
    }
    private boolean yes(String expression) throws Exception { return Boolean.TRUE.equals(js("Boolean("+expression+")")); }
    private void until(String expression, String reason, int seconds) throws Exception {
        for(int i=0;i<seconds*4;i++){if(yes(expression))return;SystemClock.sleep(250);}
        fail(reason);
    }
    private void click(String selector) throws Exception {
        assertTrue("Required UI control is missing or disabled", yes("(()=>{const e=document.querySelector("+JSONObject.quote(selector)+");if(!e||e.disabled)return false;e.click();return true})()"));
    }
    private void fill(String selector,String value) throws Exception {
        assertTrue("Required UI field is missing or disabled", yes("(()=>{const e=document.querySelector("+JSONObject.quote(selector)+");if(!e||e.disabled)return false;e.value="+JSONObject.quote(value)+";e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()"));
    }
    private void submit(String selector) throws Exception {
        assertTrue("Required UI form is missing or invalid", yes("(()=>{const f=document.querySelector("+JSONObject.quote(selector)+");if(!f||!f.reportValidity())return false;f.requestSubmit();return true})()"));
    }
    private void verifyOwner(String expected) throws Exception {
        // Navigation reads only the public ID rendered by the actual authenticated profile UI.
        js("location.hash='#mine';true");
        until("document.querySelector('.mine-user-id')?.textContent.trim()==="+JSONObject.quote("ID "+expected),"Authenticated profile differs from the requested test account",20);
    }
    private void devices() throws Exception {
        js("location.hash='#workbench/devices';true");
        until("document.querySelector('.rw-device-list')?.getAttribute('aria-busy')==='false'","Device list did not load",20);
    }
    private void report(JSONObject result) {
        Bundle status=new Bundle();status.putString("stream","\nYBZ_RELEASE_UI_ACTION "+result.toString()+"\n");instrumentation.sendStatus(0,status);
    }

    @Test public void runExplicitReleaseUIAction() throws Exception {
        try{performExplicitReleaseUIAction();}
        finally{
            if(sendTaskAction){
                Bundle status=new Bundle();
                status.putString("stream","\nYBZ_RELEASE_UI_SUBMISSION "+new JSONObject().put("stage",submissionStage).put("terminal",true).toString()+"\n");
                instrumentation.sendStatus(0,status);
            }
        }
    }
    private void performExplicitReleaseUIAction() throws Exception {
        String encoded=InstrumentationRegistry.getArguments().getString("ybzPrivateInput");
        org.junit.Assume.assumeTrue("Explicit private test input required",encoded!=null&&!encoded.isEmpty());
        JSONObject input=new JSONObject(new String(Base64.decode(encoded,Base64.NO_WRAP),StandardCharsets.UTF_8));
        String action=input.optString("action"),owner=input.optString("userId");
        sendTaskAction=action.equals("send-task");
        assertTrue("Unsupported test action",action.matches("login|login-pair|pair|device-session|send-task|task-result"));
        assertTrue("Expected public account ID required",owner.matches("[A-Za-z0-9_]{5,24}"));
        String pkg=instrumentation.getTargetContext().getPackageName();
        assertEquals("app.yubenzhe.mobile",pkg);
        assertEquals("Target must be the non-debuggable release",0,instrumentation.getTargetContext().getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE);
        Intent intent=new Intent(Intent.ACTION_MAIN).setComponent(new ComponentName(pkg,MainActivity.class.getName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        MainActivity main=(MainActivity)instrumentation.startActivitySync(intent);
        instrumentation.runOnMainSync(()->webView=main.getBridge().getWebView());
        until("document.readyState==='complete'","Page did not finish loading",20);
        assertTrue("FLAG_SECURE must stay enabled",(main.getWindow().getAttributes().flags&WindowManager.LayoutParams.FLAG_SECURE)!=0);
        JSONObject result=new JSONObject().put("action",action).put("accountId",owner).put("release",true).put("secureWindow",true);
        if(action.equals("login")||action.equals("login-pair")){
            until("document.querySelector('.account-gate [data-mode=login]')||document.querySelector('.account-gate input[name=userId]')","Expected an anonymous login page; existing sessions are never overwritten",20);
            if(yes("document.querySelector('.account-gate [data-mode=login]')"))click(".account-gate [data-mode=login]");
            String password=input.optString("password");
            assertTrue("Private test password is missing",password.length()>=6&&password.length()<=128);
            fill(".account-gate input[name=userId]",owner);fill(".account-gate input[name=password]",password);
            submit(".account-gate [data-account-form]");
            until("!document.querySelector('.account-gate')","Real account login failed; no automatic retry",30);
            if(input.optBoolean("expectOnboarding",true))until("document.querySelector('.device-onboarding[open]')","Expected the first-login device guide",20);
            result.put("loginVerified",true).put("onboardingShown",yes("document.querySelector('.device-onboarding[open]')"));
            verifyOwner(owner);
        } else {
            assertFalse("Login through the normal UI first",yes("document.querySelector('.account-gate')"));
            verifyOwner(owner);
        }
        if(action.equals("pair")||action.equals("login-pair")){
            String code=input.optString("machineCode");
            assertTrue("Explicit machine code required",code.matches("(?i)(?:YBZ-)?[A-Z2-9]{4}-?[A-Z2-9]{4}"));
            boolean guide=yes("document.querySelector('.device-onboarding[open]')");
            result.put("usedFirstLoginGuide",guide);
            if(input.optBoolean("requireOnboarding",false))assertTrue("First-login guide is required for this acceptance",guide);
            if(guide){
                String[] expectedTitles={"人做决策，机器干活","去电脑装 YBZ","找到电脑上的机器码","输入机器码，连接电脑"};
                boolean fullGuide=true,downloadLinkChecked=false;
                for(int i=0;i<3;i++){
                    fullGuide=fullGuide&&yes("document.querySelector('#device-onboarding-title')?.textContent==="+JSONObject.quote(expectedTitles[i]));
                    if(yes("document.querySelector('[data-onboarding-form]')"))break;
                    if(yes("document.querySelector('.device-onboarding a')")){assertTrue("Native download must be a normal absolute link",yes("(()=>{const a=document.querySelector('.device-onboarding a');return a.href==='https://66.42.56.29/install.html'&&!a.target})()"));downloadLinkChecked=true;}
                    click("[data-onboarding=next]");
                }
                fullGuide=fullGuide&&downloadLinkChecked&&yes("document.querySelector('#device-onboarding-title')?.textContent==="+JSONObject.quote(expectedTitles[3]));
                if(input.optBoolean("requireOnboarding",false))assertTrue("All four onboarding steps must be verified",fullGuide);
                fill("[data-onboarding-form] input[name=machineCode]",code);submit("[data-onboarding-form]");
                until("!document.querySelector('.device-onboarding[open]')","Pairing was not confirmed; do not automatically resubmit the code",30);
                result.put("fourStepGuideVerified",fullGuide).put("absoluteInstallLinkVerified",downloadLinkChecked);
            }else{
                devices();click("[data-device=connect]");fill("[data-device-claim] input[name=machineCode]",code);submit("[data-device-claim]");
                until("!document.querySelector('[data-device-claim]')","Pairing was not confirmed; do not automatically resubmit the code",30);
            }
            devices();until("document.querySelectorAll('[data-device-id]').length>0","No paired device visible",20);
            Object ids=js("JSON.stringify([...document.querySelectorAll('[data-device-id]')].map(e=>e.dataset.deviceId))");
            result.put("deviceIds",new org.json.JSONArray((String)ids)).put("pairVerified",true);
        }
        if(action.equals("device-session")||action.equals("send-task")||action.equals("task-result")){
            String id=input.optString("deviceId");assertTrue("Owned device ID required",id.matches("[a-fA-F0-9-]{36}"));
            assertFalse("Complete or explicitly skip onboarding before opening a device",yes("document.querySelector('.device-onboarding[open]')"));
            devices();String selector="[data-device=provider-chat][data-provider=codex][data-id='"+id+"']";
            until("(()=>{const b=document.querySelector("+JSONObject.quote(selector)+");return b&&!b.disabled})()","Codex is not available on the requested device",60);
            click(selector);until("document.querySelector('.ac-chat [data-ac-form]')","Device conversation did not open",20);
            result.put("deviceId",id).put("conversationVisible",true).put("codexConnected",yes("document.querySelector('.ac-online.is-online')"));
            if(action.equals("send-task")){
                String prompt=input.optString("prompt"),expected=input.optString("expectedText");
                assertTrue("Explicit task prompt and unique expected marker required",prompt.length()>0&&prompt.length()<=8000&&expected.length()>0&&expected.length()<200&&prompt.contains(expected));
                until("(()=>{const f=document.querySelector('.ac-chat [data-ac-form]'),e=f?.querySelector('textarea[name=prompt]');return document.querySelector('.ac-online.is-online')&&e&&!e.disabled&&!e.readOnly})()","Task editor is not ready; no request was sent",30);
                assertTrue("Existing drafts or uncertain requests must be reviewed, never overwritten",yes("(()=>{const f=document.querySelector('[data-ac-form]');return f?.querySelector('textarea[name=prompt]')?.value===''&&!f?.querySelector('button[type=submit]')?.textContent.includes('重试')})()"));
                String previous=(String)js("JSON.stringify([...document.querySelectorAll('.ac-task[data-task-id]')].map(e=>e.dataset.taskId))");
                fill("[data-ac-form] textarea[name=prompt]",prompt);
                until("document.querySelector('[data-ac-form] button[type=submit]')?.disabled===false","Task submit is unavailable; no request was sent",20);
                // From this point onward any exception is an uncertain send, even
                // when JS evaluation dies before returning. Never auto-resubmit.
                submissionStage="submit-attempted";
                submit("[data-ac-form]");
                String newTask="(()=>{const previous="+previous+";return [...document.querySelectorAll('.ac-task[data-task-id]')].find(e=>!previous.includes(e.dataset.taskId)&&e.querySelector('strong + p')?.textContent==="+JSONObject.quote(prompt.trim())+")})()";
                until(newTask,"Task submission result unknown; do not submit again",45);
                Object taskId=js("("+newTask+")?.dataset.taskId");
                assertTrue("Server task ID was not confirmed",taskId instanceof String&&((String)taskId).matches("[a-fA-F0-9-]{36}"));
                submissionStage="confirmed";
                result.put("taskId",taskId).put("submittedFromAndroidUI",true).put("sendCount",1).put("replyVerified",false).put("noDecisionApproved",true);
            }
            if(action.equals("task-result")){
                String task=input.optString("taskId"),expected=input.optString("expectedAnswer","ybz-acceptance.txt");
                assertTrue("Task ID required",task.matches("[a-fA-F0-9-]{36}"));assertTrue("Expected answer marker too long",expected.length()>0&&expected.length()<200);
                String taskSelector="[data-task-id='"+task+"']";
                until("(()=>{const e=document.querySelector("+JSONObject.quote(taskSelector)+");return e&&[...e.querySelectorAll('.ac-answer')].some(row=>row.textContent.includes("+JSONObject.quote(expected)+"))})()","Expected real task reply has not appeared",60);
                result.put("taskId",task).put("expectedReplyVisible",true).put("artifactDownloadVisible",yes("document.querySelector("+JSONObject.quote(taskSelector+" [data-ac=download]")+")"));
            }
        }
        report(result);
    }
}
