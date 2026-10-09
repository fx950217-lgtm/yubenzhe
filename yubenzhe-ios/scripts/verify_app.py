#!/usr/bin/env python3
"""Reject placeholders, simulator binaries, missing web snapshots, or wrong identity."""
import hashlib, json, pathlib, plistlib, struct, subprocess

EXPECTED_ID = 'app.yubenzhe.wallet'

def macho_ios_arm64_bytes(raw):
    if len(raw) < 32: raise ValueError('No valid Mach-O executable')
    magic = struct.unpack_from('<I', raw)[0]
    if magic != 0xFEEDFACF: raise ValueError('Only a thin arm64 device executable is supported')
    _, cpu, _, filetype, commands, size, _, _ = struct.unpack_from('<8I', raw)
    if cpu != 0x0100000C or filetype != 2 or 32 + size > len(raw):
        raise ValueError('Executable must be arm64 MH_EXECUTE')
    position, device = 32, False
    for _ in range(commands):
        if position + 8 > 32 + size: raise ValueError('Invalid Mach-O load commands')
        command, length = struct.unpack_from('<II', raw, position)
        if length < 8 or position + length > 32 + size: raise ValueError('Invalid load command size')
        if command == 0x32:
            if length < 24: raise ValueError('Invalid platform command')
            platform = struct.unpack_from('<I', raw, position + 8)[0]
            if platform != 2: raise ValueError('This is not an iOS device binary')
            device = True
        if command == 0x25: device = True
        if command in (0x24, 0x2f, 0x30): raise ValueError('Wrong Apple device platform')
        position += length
    if not device: raise ValueError('Missing iOS deployment platform')

def macho_ios_arm64(binary):
    return macho_ios_arm64_bytes(binary.read_bytes())

def verify_preview_entitlements(entitlements):
    expected = {'application-identifier': EXPECTED_ID,
                'com.apple.private.security.container-required': EXPECTED_ID}
    if entitlements != expected:
        raise ValueError('Preview signature must contain only the app identity and its required container')

def verify_app(app, expected_manifest=None, verify_signature=True):
    app = pathlib.Path(app).resolve()
    if not app.is_dir() or app.suffix != '.app': raise ValueError('A compiled .app directory is required')
    for item in app.rglob('*'):
        if item.is_symlink(): raise ValueError('Symlink not allowed in this dependency-free app')
    with (app / 'Info.plist').open('rb') as file: info = plistlib.load(file)
    if info.get('CFBundleIdentifier') != EXPECTED_ID: raise ValueError('Incorrect app bundle identifier')
    if info.get('CFBundleShortVersionString') != '0.11.0': raise ValueError('Unexpected app version')
    if info.get('CFBundleVersion') != '12': raise ValueError('Unexpected app build number')
    executable = info.get('CFBundleExecutable', '')
    if not executable or pathlib.PurePath(executable).name != executable: raise ValueError('Unsafe executable path')
    macho_ios_arm64(app / executable)
    web = app / 'Web'
    expected_names = {'index.html', 'app.js', 'app.css', 'icon.png', 'icon.svg', 'manifest.webmanifest', 'apple-touch-icon.png'}
    if {x.name for x in web.iterdir()} != expected_names: raise ValueError('Unexpected or missing web asset')
    if expected_manifest:
        checksums = json.loads(pathlib.Path(expected_manifest).read_text())
        for name in expected_names:
            if hashlib.sha256((web / name).read_bytes()).hexdigest() != checksums.get(name):
                raise ValueError('Web asset does not match the recorded build: ' + name)
    if verify_signature:
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True, capture_output=True)
        signed = subprocess.run(['codesign', '-d', '--entitlements', ':-', str(app)], check=True, capture_output=True)
        verify_preview_entitlements(plistlib.loads(signed.stdout))
    return info
