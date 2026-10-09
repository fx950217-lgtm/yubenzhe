#!/usr/bin/env python3
"""Copy only checked local frontend assets; never include downloads or admin."""
import argparse, hashlib, json, pathlib, shutil
ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = ('index.html', 'app.js', 'app.css', 'icon.svg', 'manifest.webmanifest', 'apple-touch-icon.png')
p = argparse.ArgumentParser()
p.add_argument('--source', type=pathlib.Path, default=ROOT.parent / 'tongban' / 'dist')
a = p.parse_args()
source = a.source.resolve()
for name in ASSETS:
    file = source / name
    if not file.is_file() or file.is_symlink():
        raise SystemExit('Missing regular application asset: ' + name)
html = (source / 'index.html').read_text()
js = (source / 'app.js').read_text()
if 'Content-Security-Policy' not in html or '愚笨者' not in html:
    raise SystemExit('Expected branded, policy-protected frontend build.')
if 'YubenzheNative' not in js:
    raise SystemExit('Frontend must support the native iOS lifecycle/export bridge.')
if 'bsc-testnet' not in js:
    raise SystemExit('Expected BSC testnet-only frontend.')
destination = ROOT / 'App' / 'Web'
destination.mkdir(exist_ok=True)
for file in destination.iterdir():
    if file.is_file(): file.unlink()
for name in ASSETS: shutil.copyfile(source / name, destination / name)
manifest = {name: hashlib.sha256((destination / name).read_bytes()).hexdigest() for name in ASSETS}
(ROOT / 'web-snapshot.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('Copied six frontend assets. No installers or admin included.')
