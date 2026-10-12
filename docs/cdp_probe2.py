# 用 CDP 读 Chrome 真实界面语言（修正版：用 /json/list 而不是 PUT /json/new）

import json, subprocess, sys, time, urllib.request

def ensure(pkg):
    try:
        __import__(pkg.replace('-', '_')); return True
    except ImportError:
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', pkg], check=False)
        try:
            __import__(pkg.replace('-', '_')); return True
        except ImportError:
            return False

have_ws = ensure('websocket-client')
print('websocket-client:', have_ws)

CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PORT = 9555

subprocess.run(['taskkill', '/F', '/IM', 'chrome.exe'], capture_output=True)
time.sleep(2)

proc = subprocess.Popen([
    CHROME, '--lang=zh-CN',
    f'--remote-debugging-port={PORT}',
    '--no-first-run', '--no-default-browser-check',
    '--headless=new', '--disable-gpu',
    'data:text/html,<h1>probe</h1>'      # 直接开一个页面，避免 /json/new
])
time.sleep(10)

try:
    with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json/list', timeout=10) as r:
        targets = json.load(r)
    pages = [t for t in targets if t.get('type') == 'page']
    print('页面数:', len(pages))
    for t in pages:
        print('  -', t.get('url','')[:60])
    if not pages:
        raise RuntimeError('没有可用的 page target')
    ws_url = pages[0]['webSocketDebuggerUrl']
    print('WS:', ws_url)

    js = ("JSON.stringify({"
          "navLang:navigator.language,"
          "navLangs:navigator.languages,"
          "icuLocale:Intl.DateTimeFormat().resolvedOptions().locale,"
          "tz:Intl.DateTimeFormat().resolvedOptions().timeZone"
          "})")

    import websocket
    ws = websocket.create_connection(ws_url, timeout=20)
    # 需要先启用 Runtime
    ws.send(json.dumps({"id": 10, "method": "Runtime.enable"}))
    try:
        ws.recv()
    except Exception:
        pass
    ws.send(json.dumps({
        "id": 11, "method": "Runtime.evaluate",
        "params": {"expression": js, "returnByValue": True}
    }))
    while True:
        resp = json.loads(ws.recv())
        if resp.get('id') == 11:
            print('RESULT:', resp['result']['result']['value'])
            break
    ws.close()

    # 再取一次浏览器级信息
    with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json/version', timeout=10) as r:
        v = json.load(r)
    print('UA:', v.get('User-Agent'))
finally:
    proc.terminate()
    time.sleep(1)
    subprocess.run(['taskkill', '/F', '/IM', 'chrome.exe'], capture_output=True)
    print('done')
