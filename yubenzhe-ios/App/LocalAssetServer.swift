import Foundation
import Network

/// Stable, loopback-only origin preserves local wallet storage between launches.
/// Never serves arbitrary paths or accepts remote connections.
final class LocalAssetServer {
    static let port: UInt16 = 45931
    static let origin = "http://127.0.0.1:\(port)"
    static let assetTypes = [
        "index.html": "text/html; charset=utf-8", "app.js": "application/javascript; charset=utf-8",
        "app.css": "text/css; charset=utf-8", "icon.svg": "image/svg+xml", "icon.png": "image/png",
        "manifest.webmanifest": "application/manifest+json", "apple-touch-icon.png": "image/png"
    ]
    private let queue = DispatchQueue(label: "app.yubenzhe.loopback")
    private var listener: NWListener?
    private let root: URL
    private var connections: [UUID: NWConnection] = [:]

    init(root: URL) { self.root = root }

    func start(completion: @escaping (Result<Void, Error>) -> Void) {
        do {
            let parameters = NWParameters.tcp
            parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: Self.port)!)
            parameters.allowLocalEndpointReuse = false
            let listener = try NWListener(using: parameters)
            self.listener = listener
            var completed = false
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready where !completed:
                    completed = true
                    DispatchQueue.main.async { completion(.success(())) }
                case .failed(let error):
                    completed = true
                    DispatchQueue.main.async { completion(.failure(error)) }
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
            listener.start(queue: queue)
        } catch { completion(.failure(error)) }
    }

    private func accept(_ connection: NWConnection) {
        guard case .hostPort(let host, _) = connection.endpoint,
              String(describing: host) == "127.0.0.1", connections.count < 24 else {
            connection.cancel(); return
        }
        let id = UUID()
        connections[id] = connection
        connection.stateUpdateHandler = { [weak self, weak connection] state in
            if case .cancelled = state { self?.connections.removeValue(forKey: id) }
            if case .failed = state { connection?.cancel() }
        }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 8) { [weak connection] in connection?.cancel() }
        receive(connection, bytes: Data())
    }

    private func receive(_ connection: NWConnection, bytes: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, done, error in
            guard let self else { connection.cancel(); return }
            var bytes = bytes
            if let data { bytes.append(data) }
            guard bytes.count <= 16384, error == nil else { connection.cancel(); return }
            if bytes.range(of: Data("\r\n\r\n".utf8)) != nil { self.respond(connection, request: bytes) }
            else if done { connection.cancel() }
            else { self.receive(connection, bytes: bytes) }
        }
    }

    private func respond(_ connection: NWConnection, request: Data) {
        guard let text = String(data: request, encoding: .utf8) else { connection.cancel(); return }
        let lines = text.components(separatedBy: "\r\n")
        let parts = (lines.first ?? "").split(separator: " ")
        let headers = lines.dropFirst().filter { !$0.isEmpty }
        let host = headers.first { $0.lowercased().hasPrefix("host:") }?.dropFirst(5).trimmingCharacters(in: .whitespaces)
        guard parts.count == 3, parts[0] == "GET", parts[2] == "HTTP/1.1",
              host == "127.0.0.1:\(Self.port)" else {
            send(connection, status: "400 Bad Request", body: Data(), type: "text/plain"); return
        }
        let rawPath = String(parts[1])
        let name = rawPath == "/" ? "index.html" : String(rawPath.dropFirst())
        guard rawPath.first == "/", let mimeType = Self.assetTypes[name],
              let bytes = try? Data(contentsOf: root.appendingPathComponent(name)) else {
            send(connection, status: "404 Not Found", body: Data(), type: "text/plain"); return
        }
        send(connection, status: "200 OK", body: bytes, type: mimeType)
    }

    private func send(_ connection: NWConnection, status: String, body: Data, type: String) {
        let policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://bsc-testnet-dataseed.bnbchain.org https://bsc-testnet.bnbchain.org; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
        let header = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: \(policy)\r\nPermissions-Policy: camera=(self), microphone=(), geolocation=()\r\nReferrer-Policy: no-referrer\r\n\r\n"
        var response = Data(header.utf8)
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }

    func stop() {
        listener?.cancel()
        queue.async { [weak self] in
            self?.connections.values.forEach { $0.cancel() }
            self?.connections.removeAll()
        }
    }
    deinit { listener?.cancel() }
}
