package app.tongban.wallet.demo;

import android.Manifest;
import android.app.AlertDialog;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebView;
import android.os.Message;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/** Camera is the only WebView permission; audio, location, DRM, MIDI, etc. are denied. */
final class SafeChromeClient extends BridgeWebChromeClient {
    private final Bridge bridge;
    private final MainActivity activity;
    private final ActivityResultLauncher<String> cameraPermission;
    private PermissionRequest pending;
    private AlertDialog consent;

    SafeChromeClient(Bridge bridge, MainActivity activity) {
        super(bridge);
        this.bridge = bridge;
        this.activity = activity;
        cameraPermission = bridge.registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> finishCamera(Boolean.TRUE.equals(granted)));
    }

    @Override
    public void onPermissionRequest(PermissionRequest request) {
        if (pending != null || !NavigationPolicy.isLocal(bridge.getWebView().getUrl()) || !NavigationPolicy.mayUseCamera(request.getOrigin().toString(), request.getResources(), activity.hasRecentGesture())) {
            request.deny();
            return;
        }
        pending = request;
        consent = new AlertDialog.Builder(activity)
            .setTitle("允许扫码使用相机？")
            .setMessage("相机只用于本机识别二维码，不录音、不上传画面。你也可以取消后选择图片。")
            .setNegativeButton("取消", (dialog, which) -> finishCamera(false))
            .setPositiveButton("允许本次扫码", (dialog, which) -> {
                if (pending == request) cameraPermission.launch(Manifest.permission.CAMERA);
            })
            .setOnCancelListener(dialog -> finishCamera(false))
            .create();
        consent.show();
    }

    private void finishCamera(boolean granted) {
        PermissionRequest request = pending;
        pending = null;
        if (consent != null) { consent.dismiss(); consent = null; }
        if (request == null) return;
        if (granted && !activity.isFinishing() && !activity.isDestroyed() && NavigationPolicy.isLocal(bridge.getWebView().getUrl())) {
            request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
        } else request.deny();
    }

    void cancelCameraRequest() { finishCamera(false); }

    @Override
    public void onPermissionRequestCanceled(PermissionRequest request) {
        if (pending == request) { pending = null; if (consent != null) { consent.dismiss(); consent = null; } }
    }

    @Override
    public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
        callback.invoke(origin, false, false);
    }

    @Override
    public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
        return false;
    }
}
