import UIKit
import WebKit
import UniformTypeIdentifiers

final class BrowserViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, UIDocumentPickerDelegate {
    private var webView: WKWebView!
    private var server: LocalAssetServer?
    private var privacyCover = UILabel()
    private var pendingExport: ((Any?, String?) -> Void)?
    private var temporaryExport: URL?
    private var loaded = false
    private var failedClosed = false
    private let externalHosts: Set<String> = ["testnet.bscscan.com", "docs.bnbchain.org", "docs.ethers.org"]

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 252/255, green: 250/255, blue: 1, alpha: 1)
        let content = WKUserContentController()
        if let url = Bundle.main.url(forResource: "bridge", withExtension: "js"), let js = try? String(contentsOf: url, encoding: .utf8) {
            content.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        content.addScriptMessageHandler(self, contentWorld: .page, name: "exportJSON")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = content
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        webView = WKWebView(frame: .zero, configuration: configuration)
        if #available(iOS 16.4, *) { webView.isInspectable = false }
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        privacyCover.isUserInteractionEnabled = true
        privacyCover.backgroundColor = view.backgroundColor
        privacyCover.text = "愚笨者\n正在准备…"
        privacyCover.numberOfLines = 0
        privacyCover.textAlignment = .center
        privacyCover.font = .systemFont(ofSize: 22, weight: .semibold)
        privacyCover.frame = view.bounds
        privacyCover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(privacyCover)
        guard let root = Bundle.main.url(forResource: "Web", withExtension: nil) else { fail("应用资源不完整，请更新安装包。"); return }
        let home = URL(fileURLWithPath: NSHomeDirectory()).standardizedFileURL
        guard home.path.contains("/Containers/Data/Application/"), UUID(uuidString: home.lastPathComponent) != nil else {
            fail("安装环境没有独立应用数据容器，已停止打开钱包。请使用受支持的安装方式。")
            return
        }
        protectPersistentFiles()
        server = LocalAssetServer(root: root)
        server?.start { [weak self] result in
            switch result {
            case .success: self?.webView.load(URLRequest(url: URL(string: LocalAssetServer.origin + "/index.html")!))
            case .failure: self?.fail("本机应用服务未能启动，请关闭并重新打开。")
            }
        }
    }

    private func isLocal(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == "http" && url.host == "127.0.0.1" && url.port == Int(LocalAssetServer.port)
            && url.user == nil && url.password == nil && url.query == nil
            && ["/", "/index.html"].contains(url.path)
    }

    private func openExternal(_ action: WKNavigationAction) {
        guard action.navigationType == .linkActivated, let url = action.request.url,
              url.scheme == "https", let host = url.host, externalHosts.contains(host),
              url.user == nil, url.password == nil, url.port == nil || url.port == 443 else { return }
        UIApplication.shared.open(url)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.targetFrame?.isMainFrame == true && isLocal(navigationAction.request.url) { decisionHandler(.allow) }
        else { openExternal(navigationAction); decisionHandler(.cancel) }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        openExternal(navigationAction); return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        protectPersistentFiles()
        webView.evaluateJavaScript("Boolean(window.isSecureContext && window.crypto && window.crypto.subtle && window.YubenzheNative)") { [weak self] value, error in
            guard let self else { return }
            if error != nil || value as? Bool != true { self.fail("系统网页组件不支持安全钱包功能，请更新 iOS 后重试。"); return }
            self.resumeSafely()
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard frame.isMainFrame, isLocal(frame.request.url), presentedViewController == nil else { completionHandler(); return }
        let alert = UIAlertController(title: "愚笨者", message: String(message.prefix(2000)), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard frame.isMainFrame, isLocal(frame.request.url), presentedViewController == nil else { completionHandler(false); return }
        let alert = UIAlertController(title: "愚笨者", message: String(message.prefix(2000)), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { loaded = false; privacyCover.isHidden = false; webView.reload() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { fail("应用页面未能打开，请重新启动。") }
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let trusted = frame.isMainFrame && isLocal(frame.request.url) && origin.protocol == "http" && origin.host == "127.0.0.1" && origin.port == Int(LocalAssetServer.port)
        decisionHandler(trusted && type == .camera ? .prompt : .deny)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.name == "exportJSON", message.frameInfo.isMainFrame, isLocal(message.frameInfo.request.url), isLocal(webView.url),
              let object = message.body as? [String: Any], let filename = object["filename"] as? String,
              filename.range(of: "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\\.json$", options: .regularExpression) != nil,
              object["mimeType"] as? String == "application/json", let content = object["content"] as? String,
              let data = content.data(using: .utf8), data.count <= 256 * 1024,
              let json = try? JSONSerialization.jsonObject(with: data), json is [String: Any],
              pendingExport == nil, presentedViewController == nil else { replyHandler(nil, "导出请求无效或已有保存窗口打开。"); return }
        pendingExport = replyHandler
        let alert = UIAlertController(title: "保存文件", message: "将使用系统文件选择器保存 \(filename)。请妥善保管导出的文件；钱包备份请与密码分开保管。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { [weak self] _ in self?.finishExport(saved: false) })
        alert.addAction(UIAlertAction(title: "选择位置", style: .default) { [weak self] _ in self?.export(data, filename: filename) })
        present(alert, animated: true)
    }

    private func export(_ data: Data, filename: String) {
        do {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
            var url = directory.appendingPathComponent(filename)
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            var values = URLResourceValues(); values.isExcludedFromBackup = true; try url.setResourceValues(values)
            temporaryExport = url
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            picker.delegate = self
            present(picker, animated: true)
        } catch { finishExport(saved: false, error: "备份未能写入临时文件，请重试。") }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finishExport(saved: !urls.isEmpty) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finishExport(saved: false) }
    private func finishExport(saved: Bool, error: String? = nil) {
        let callback = pendingExport; pendingExport = nil
        if let url = temporaryExport { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        temporaryExport = nil
        callback?(error == nil ? ["saved": saved] : nil, error)
    }

    func hideSensitiveContent() {
        guard isViewLoaded else { return }
        privacyCover.text = "愚笨者\n请返回应用继续"
        webView.isUserInteractionEnabled = false
        privacyCover.isHidden = false
        webView.setCameraCaptureState(.none)
        webView.evaluateJavaScript("window.__ybAppState && window.__ybAppState(false)")
    }

    func resumeSafely() {
        guard isViewLoaded, loaded, !failedClosed, UIApplication.shared.applicationState == .active else { return }
        webView.evaluateJavaScript("window.__ybAppState && window.__ybAppState(false)") { [weak self] result, error in
            guard let self else { return }
            guard error == nil, result as? Bool == true else { self.fail("钱包锁定组件未就绪，请关闭应用后重试。"); return }
            guard !self.failedClosed, UIApplication.shared.applicationState == .active else { return }
            self.webView.isUserInteractionEnabled = true
            self.privacyCover.isHidden = true
        }
    }

    private func protectPersistentFiles() {
        let home = URL(fileURLWithPath: NSHomeDirectory()).standardizedFileURL
        guard home.path.contains("/Containers/Data/Application/"), UUID(uuidString: home.lastPathComponent) != nil else { return }
        for directory in [FileManager.SearchPathDirectory.libraryDirectory, .documentDirectory] {
            guard var url = FileManager.default.urls(for: directory, in: .userDomainMask).first else { continue }
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            try? url.setResourceValues(values)
            try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
        }
    }

    func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(.deny) }

    private func fail(_ message: String) {
        failedClosed = true
        webView?.isUserInteractionEnabled = false
        webView?.stopLoading()
        webView?.setCameraCaptureState(.none)
        webView?.evaluateJavaScript("window.__ybAppState && window.__ybAppState(false)")
        privacyCover.text = message
        privacyCover.isHidden = false
    }
    deinit { server?.stop() }
}
