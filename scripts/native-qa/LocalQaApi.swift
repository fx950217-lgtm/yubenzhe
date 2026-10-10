import Foundation
import WebKit

/// Compiled only into the separate local QA app. No configurable host or production fallback.
final class LocalQaApi: NSObject, WKScriptMessageHandlerWithReply, WKScriptMessageHandler, URLSessionDataDelegate {
    static let origin = "http://127.0.0.1:45932"
    static let upstream = "http://127.0.0.1:18914"
    static let limit = 1024 * 1024
    var onTheme: ((String) -> Void)?
    private let lock = NSLock()
    private final class Pending {
        var data = Data()
        var response: HTTPURLResponse?
        let completion: (Result<(Int, [String: String], Data), Error>) -> Void
        init(_ completion: @escaping (Result<(Int, [String: String], Data), Error>) -> Void) { self.completion = completion }
    }
    private var pending: [Int: Pending] = [:]
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 18
        let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
        return URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
    }()
    private static func denied() -> NSError { NSError(domain: "YubenzheLocalQA", code: 1, userInfo: [NSLocalizedDescriptionKey: "本机验收服务未连接或请求不被允许。请检查本机服务和 USB 通道。"]) }
    private static func matches(_ value: String, _ pattern: String) -> Bool {
        guard let found = value.range(of: pattern, options: .regularExpression) else { return false }
        return found == value.startIndex..<value.endIndex
    }
    static func validPath(_ path: String) -> Bool {
        path.utf8.count <= 2048 && !path.contains("//") && !path.contains("..") &&
        matches(path, "^/api/social/[A-Za-z0-9_/-]*(\\?[A-Za-z0-9_%=&.+-]{0,512})?$")
    }
    static func avatarPath(_ path: String) -> Bool {
        matches(path, "^/api/social/avatars/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$")
    }
    private static func trusted(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == "http" && url.host == "127.0.0.1" && url.port == 45932 &&
            url.user == nil && url.password == nil && url.query == nil && ["/", "/index.html"].contains(url.path)
    }
    private func trusted(_ message: WKScriptMessage) -> Bool {
        message.frameInfo.isMainFrame && Self.trusted(message.frameInfo.request.url) && Self.trusted(message.webView?.url)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "localQATheme", trusted(message), let input = message.body as? [String: Any],
              let theme = input["theme"] as? String, ["light", "dark", "eyecare"].contains(theme) else { return }
        onTheme?(theme)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.name == "localQA", trusted(message), let input = message.body as? [String: Any] else {
            replyHandler(nil, Self.denied().localizedDescription); return
        }
        perform(input) { result in
            switch result {
            case .failure: replyHandler(nil, Self.denied().localizedDescription)
            case .success(let (status, headers, bytes)):
                let transformed = Self.localAvatarJSON(bytes, contentType: headers["content-type"] ?? "")
                replyHandler(["status": status, "headers": headers, "bodyBase64": transformed.base64EncodedString()], nil)
            }
        }
    }
    /// Avatar URLs remain within this app's static loopback origin; app.js is unchanged.
    static func localAvatarJSON(_ bytes: Data, contentType: String) -> Data {
        guard contentType.lowercased().contains("application/json"), let value = try? JSONSerialization.jsonObject(with: bytes) else { return bytes }
        func avatars(_ value: Any) -> Any {
            if let rows = value as? [Any] { return rows.map(avatars) }
            guard let object = value as? [String: Any] else { return value }
            var output = object.mapValues(avatars)
            if let path = object["avatarImage"] as? String, avatarPath(path) { output["avatarImage"] = origin + path }
            return output
        }
        return (try? JSONSerialization.data(withJSONObject: avatars(value), options: [.fragmentsAllowed])) ?? bytes
    }
    func perform(_ input: [String: Any], completion: @escaping (Result<(Int, [String: String], Data), Error>) -> Void) {
        guard let path = input["path"] as? String, Self.validPath(path), let method = input["method"] as? String,
              ["GET", "POST"].contains(method), let body = input["body"] as? String, let bytes = body.data(using: .utf8),
              bytes.count <= Self.limit, method != "GET" || bytes.isEmpty,
              let incoming = input["headers"] as? [String: String], let url = URL(string: Self.upstream + path) else { completion(.failure(Self.denied())); return }
        if !bytes.isEmpty, (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any] == nil { completion(.failure(Self.denied())); return }
        var request = URLRequest(url: url)
        request.httpMethod = method; request.httpBody = method == "POST" ? bytes : nil
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("localhost:18914", forHTTPHeaderField: "Host")
        // The trusted native adapter uses the existing native API client identifier.
        // This never accepts or forwards an Origin supplied by page JavaScript.
        request.setValue("https://localhost", forHTTPHeaderField: "Origin")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (name, value) in incoming {
            let key = name.lowercased()
            guard ["authorization", "content-type", "if-none-match"].contains(key) else { continue }
            guard value.utf8.count <= 512, !value.contains("\r"), !value.contains("\n") else { completion(.failure(Self.denied())); return }
            if key == "authorization" && value.range(of: "^Bearer [-_A-Za-z0-9]{43}$", options: .regularExpression) == nil { completion(.failure(Self.denied())); return }
            if key == "content-type" && value != "application/json" { completion(.failure(Self.denied())); return }
            request.setValue(value, forHTTPHeaderField: key)
        }
        if method == "POST" { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let task = session.dataTask(with: request)
        lock.lock()
        guard pending.count < 32 else { lock.unlock(); task.cancel(); completion(.failure(Self.denied())); return }
        pending[task.taskIdentifier] = Pending(completion)
        lock.unlock(); task.resume()
    }
    private func finish(_ task: URLSessionTask, error: Error? = nil) {
        lock.lock(); let item = pending.removeValue(forKey: task.taskIdentifier); lock.unlock()
        guard let item else { return }
        let result: Result<(Int, [String: String], Data), Error>
        if let error { result = .failure(error) }
        else if let response = item.response {
            var headers: [String: String] = [:]
            for name in ["content-type", "etag", "cache-control"] { if let value = response.value(forHTTPHeaderField: name) { headers[name] = value } }
            result = .success((response.statusCode, headers, item.data))
        } else { result = .failure(Self.denied()) }
        DispatchQueue.main.async { item.completion(result) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil); task.cancel(); finish(task, error: Self.denied())
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse, response.url?.host == "127.0.0.1", response.url?.port == 18914,
              (100...599).contains(response.statusCode), !(300...399).contains(response.statusCode) || response.statusCode == 304,
              response.expectedContentLength <= Int64(Self.limit) else { completionHandler(.cancel); finish(dataTask, error: Self.denied()); return }
        lock.lock(); pending[dataTask.taskIdentifier]?.response = response; lock.unlock(); completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        let item = pending[dataTask.taskIdentifier], fits = (item?.data.count ?? Self.limit) + data.count <= Self.limit
        if fits { item?.data.append(data) }
        lock.unlock()
        if !fits { dataTask.cancel(); finish(dataTask, error: Self.denied()) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) { finish(task, error: error) }
    func stop() { session.invalidateAndCancel() }
}
