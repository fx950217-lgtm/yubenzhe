#!/usr/bin/env python3
"""Validate the separately prepared local QA snapshot; never replace its assets."""
import hashlib
import json
import pathlib

ASSETS = {
    'index.html', 'app.js', 'app.css', 'icon.png', 'icon.svg',
    'apple-touch-icon.png', 'manifest.webmanifest', 'privacy.html',
    'terms.html', 'qa-runtime.js',
}


def verify_frozen_web(root):
    root = pathlib.Path(root).resolve()
    web = root / 'App' / 'Web'
    if web.is_symlink() or not web.is_dir() or not web.resolve().is_relative_to(root):
        raise ValueError('QA web directory is missing or outside its isolated project')
    manifest = json.loads((root / 'local-qa-manifest.json').read_text(encoding='utf-8'))
    if (manifest.get('mode') != 'isolated-local-native-qa'
            or manifest.get('platform') != 'ios'
            or manifest.get('bundleId') != 'app.yubenzhe.wallet.localqa'
            or manifest.get('origin') != 'http://127.0.0.1:45932'):
        raise ValueError('Expected the explicitly prepared local QA identity and origin')
    hashes = json.loads((root / 'web-snapshot.json').read_text(encoding='utf-8'))
    if set(hashes) != ASSETS or hashes != manifest.get('qaWebSHA256'):
        raise ValueError('QA snapshot must match the separately recorded preparation manifest')
    if {file.name for file in web.iterdir()} != ASSETS:
        raise ValueError('Unexpected or missing QA web asset')
    for name in ASSETS:
        file = web / name
        if file.is_symlink() or not file.is_file():
            raise ValueError('QA web assets must be ordinary files: ' + name)
        if hashlib.sha256(file.read_bytes()).hexdigest() != hashes[name]:
            raise ValueError('Frozen QA web asset changed: ' + name)


if __name__ == '__main__':
    verify_frozen_web(pathlib.Path(__file__).resolve().parents[1])
    print('Frozen local QA assets verified; no production web assets were copied.')
