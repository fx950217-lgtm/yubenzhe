package app.tongban.wallet.demo;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name="SaveArtifact")
public class SaveArtifactPlugin extends Plugin {
    private final AtomicBoolean saving=new AtomicBoolean(false);
    private byte[] pending;
    private String mime;
    @PluginMethod public void save(PluginCall call){
        getActivity().runOnUiThread(()->{
            if(!(getActivity() instanceof MainActivity)||!((MainActivity)getActivity()).hasSecureMainFrameBridge()||!NavigationPolicy.isLocal(getBridge().getWebView().getUrl())){call.reject("安全文件保存组件不可用。","UNTRUSTED_FRAME");return;}
            if(!saving.compareAndSet(false,true)){call.reject("请先完成或取消当前文件保存。","SAVE_IN_PROGRESS");return;}
            try{
                String filename=call.getString("filename"),encoded=call.getString("bodyBase64");
                mime=ArtifactPolicy.validateEnvelope(filename,call.getString("mimeType"),encoded);pending=Base64.decode(encoded,Base64.NO_WRAP);ArtifactPolicy.validateBytes(pending);
                Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(mime);intent.putExtra(Intent.EXTRA_TITLE,filename);
                startActivityForResult(call,intent,"artifactCreated");
            }catch(IllegalArgumentException error){clearPending();call.reject(error.getMessage(),"INVALID_ARTIFACT");}
            catch(Exception error){clearPending();call.reject("无法打开系统文件保存窗口。","PICKER_UNAVAILABLE");}
        });
    }
    @ActivityCallback private void artifactCreated(PluginCall call,ActivityResult result){
        if(call==null){clearPending();return;}
        if(result.getResultCode()!=Activity.RESULT_OK){clearPending();call.resolve(new JSObject().put("saved",false));return;}
        Uri destination=result.getData()==null?null:result.getData().getData();
        if(destination==null||!"content".equals(destination.getScheme())||pending==null){clearPending();call.reject("系统未返回可保存的文件位置。","INVALID_DESTINATION");return;}
        final byte[] content=pending;pending=null;
        execute(()->{
            try{ArtifactPolicy.validateBytes(content);try(OutputStream output=getContext().getContentResolver().openOutputStream(destination,"wt")){if(output==null)throw new IllegalStateException();output.write(content);output.flush();}call.resolve(new JSObject().put("saved",true));}
            catch(Exception error){call.reject("成果文件未能完整保存，请重新选择位置后重试。","WRITE_FAILED");}
            finally{java.util.Arrays.fill(content,(byte)0);clearPending();}
        });
    }
    private void clearPending(){if(pending!=null)java.util.Arrays.fill(pending,(byte)0);pending=null;mime=null;saving.set(false);}
    @Override protected void handleOnDestroy(){clearPending();super.handleOnDestroy();}
}
