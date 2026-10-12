#!/usr/bin/env python3
"""Copy only checked local frontend assets; never include downloads or admin."""
import argparse, hashlib, json, pathlib, shutil
ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = ('index.html', 'app.js', 'app.css', 'icon.png', 'icon.svg', 'manifest.webmanifest', 'apple-touch-icon.png', 'privacy.html', 'terms.html', 'app-policy.txt')
p = argparse.ArgumentParser()
p.add_argument('--source', type=pathlib.Path, default=ROOT.parent / 'tongban' / 'dist')
a = p.parse_args()
source = a.source.resolve()
consumer = json.loads((ROOT.parent / 'tongban' / 'package.json').read_text(encoding='utf-8'))
build_info = json.loads((source / 'build-info.json').read_text(encoding='utf-8'))
if build_info.get('version') != consumer['version'] or not build_info.get('builtAt'):
    raise SystemExit('Build the current consumer version before syncing native assets.')
for name in ASSETS:
    file = source / name
    if not file.is_file() or file.is_symlink():
        raise SystemExit('Missing regular application asset: ' + name)
html = (source / 'index.html').read_text(encoding='utf-8')
js = (source / 'app.js').read_text(encoding='utf-8')
if 'Content-Security-Policy' not in html or '愚笨者' not in html:
    raise SystemExit('Expected branded, policy-protected frontend build.')
if 'YubenzheNative' not in js:
    raise SystemExit('Frontend must support the native iOS lifecycle/export bridge.')
if 'bsc-testnet' not in js:
    raise SystemExit('Expected BSC testnet-only frontend.')
destination = ROOT / 'App' / 'Web'
staging = ROOT / '.web-staging'
def remove_generated(directory):
    if directory not in (destination, staging):
        raise SystemExit('Not an allowed generated web directory.')
    if directory.is_symlink():
        raise SystemExit('Generated web directory must not be a symbolic link.')
    if not directory.exists():
        return
    if not directory.is_dir() or not directory.resolve().is_relative_to(ROOT):
        raise SystemExit('Generated web directory is outside the native project.')
    shutil.rmtree(directory)
remove_generated(staging)
staging.mkdir()
for name in ASSETS: shutil.copyfile(source / name, staging / name)
remove_generated(destination)
staging.rename(destination)
manifest = {name: hashlib.sha256((destination / name).read_bytes()).hexdigest() for name in ASSETS}
(ROOT / 'web-snapshot.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
print(f'Copied {len(ASSETS)} frontend assets. No installers, admin, or web push worker included.')
