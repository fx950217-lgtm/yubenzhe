import Foundation

@main
struct LocalQaPolicyChecks {
    static func main() throws {
        for path in ["/api/social/state", "/api/social/messages?after=123&limit=100", "/api/social/avatars/12345678-1234-1234-1234-123456789abc"] { precondition(LocalQaApi.validPath(path)) }
        for path in ["https://example.com/api/social/state", "//example.com/api/social/state", "/api/admin/state", "/api/social/../admin", "/api/social/state\n", "/api/social/state#fragment", "/api/social/%2e%2e/admin", "/api/social/state?x=" + String(repeating: "x", count: 513)] { precondition(!LocalQaApi.validPath(path)) }
        let avatar = "/api/social/avatars/12345678-1234-1234-1234-123456789abc"
        precondition(LocalQaApi.avatarPath(avatar))
        precondition(!LocalQaApi.avatarPath(avatar + "\n"))
        precondition(!LocalQaApi.avatarPath(avatar + "?token=secret"))
        let payload: [String: Any] = ["profile": ["avatarImage": avatar, "nickname": "synthetic"], "other": "https://example.com", "nested": [["avatarImage": "/api/admin/private"]]]
        let data = try JSONSerialization.data(withJSONObject: payload)
        let transformed = try JSONSerialization.jsonObject(with: LocalQaApi.localAvatarJSON(data, contentType: "application/json")) as! [String: Any]
        precondition((transformed["profile"] as! [String: Any])["avatarImage"] as! String == LocalQaApi.origin + avatar)
        precondition((transformed["nested"] as! [[String: Any]])[0]["avatarImage"] as! String == "/api/admin/private")
        precondition(LocalQaApi.localAvatarJSON(data, contentType: "image/png") == data)
        let api = LocalQaApi()
        let valid: [String: Any] = ["path": "/api/social/state", "method": "GET", "headers": [String: String](), "body": ""]
        let invalid: [[String: Any]] = [
            [:], ["path": "/api/admin/state", "method": "GET", "headers": [:], "body": ""],
            ["path": "/api/social/state", "method": "DELETE", "headers": [:], "body": ""],
            ["path": "/api/social/state", "method": "GET", "headers": [:], "body": "{}"],
            ["path": "/api/social/state", "method": "POST", "headers": [:], "body": "not JSON"],
            ["path": "/api/social/state", "method": "POST", "headers": [:], "body": "[]"],
            ["path": "/api/social/state", "method": "POST", "headers": [:], "body": String(repeating: "x", count: LocalQaApi.limit + 1)],
            valid.merging(["headers": ["authorization": "Bearer wrong"]]) { _, replacement in replacement },
            valid.merging(["headers": ["content-type": "text/html"]]) { _, replacement in replacement },
            valid.merging(["headers": ["if-none-match": "one\r\ninjected"]]) { _, replacement in replacement }
        ]
        for input in invalid {
            var rejected = false
            api.perform(input) { result in if case .failure = result { rejected = true } }
            precondition(rejected, "Invalid requests must fail before creating a network task")
        }
        print("iOS QA Swift path, payload and avatar policy checks passed; no network request sent.")
    }
}
