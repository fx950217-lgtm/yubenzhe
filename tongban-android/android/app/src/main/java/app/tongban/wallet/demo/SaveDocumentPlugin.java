package app.tongban.wallet.demo;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.JsonReader;
import android.util.JsonToken;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.io.StringReader;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "SaveDocument")
public class SaveDocumentPlugin extends Plugin {
    private final AtomicBoolean saving = new AtomicBoolean(false);

    @PluginMethod
    public void save(PluginCall call) {
        String filename = call.getString("filename");
        String mimeType = call.getString("mimeType");
        String content = call.getString("content");
        try {
            DocumentPolicy.validate(filename, mimeType, content);
            try (JsonReader json = new JsonReader(new StringReader(content))) {
                json.setLenient(false);
                if (json.peek() != JsonToken.BEGIN_OBJECT) throw new IllegalArgumentException("备份内容必须是完整的 JSON 对象。");
                json.skipValue();
                if (json.peek() != JsonToken.END_DOCUMENT) throw new IllegalArgumentException("备份 JSON 含有多余内容。");
            }
        } catch (Exception error) {
            call.reject(error instanceof IllegalArgumentException ? error.getMessage() : "备份 JSON 内容无效。", "INVALID_DOCUMENT");
            return;
        }
        if (!saving.compareAndSet(false, true)) {
            call.reject("已有文件正在保存，请先完成或取消。", "SAVE_IN_PROGRESS");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (getActivity().isFinishing() || getActivity().isDestroyed()) {
                saving.set(false);
                call.reject("保存已取消，请重试。", "ACTIVITY_CLOSED");
                return;
            }
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/json");
            intent.putExtra(Intent.EXTRA_TITLE, filename);
            try {
                startActivityForResult(call, intent, "documentCreated");
            } catch (Exception error) {
                saving.set(false);
                call.reject("无法打开系统文件保存窗口。", "PICKER_UNAVAILABLE");
            }
        });
    }

    @ActivityCallback
    private void documentCreated(PluginCall call, ActivityResult result) {
        if (call == null) { saving.set(false); return; }
        if (result.getResultCode() != Activity.RESULT_OK) {
            saving.set(false);
            call.resolve(new JSObject().put("saved", false));
            return;
        }
        Uri destination = result.getData() == null ? null : result.getData().getData();
        if (destination == null || !"content".equals(destination.getScheme())) {
            saving.set(false);
            call.reject("系统未返回可保存的文件位置。", "INVALID_DESTINATION");
            return;
        }
        // Only the URI returned by the system picker is used. No caller-controlled path.
        execute(() -> {
            try {
                byte[] content = DocumentPolicy.validate(call.getString("filename"), call.getString("mimeType"), call.getString("content"));
                try (OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                    if (output == null) throw new IllegalStateException("Unavailable document stream");
                    output.write(content);
                    output.flush();
                }
                call.resolve(new JSObject().put("saved", true));
            } catch (Exception error) {
                // Do not expose URI, document contents, or provider details to logs / errors.
                call.reject("文件未能完整保存，请重新选择位置后重试。", "WRITE_FAILED");
            } finally {
                saving.set(false);
            }
        });
    }
}
