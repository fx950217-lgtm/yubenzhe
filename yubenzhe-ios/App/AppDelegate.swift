import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private var controller: BrowserViewController?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let browser = BrowserViewController()
        controller = browser
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = browser
        window?.makeKeyAndVisible()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) { controller?.hideSensitiveContent() }
    func applicationDidEnterBackground(_ application: UIApplication) { controller?.hideSensitiveContent() }
    func applicationDidBecomeActive(_ application: UIApplication) { controller?.resumeSafely() }
}
