#!/usr/bin/env python3
"""Build a signed flat APT repository from validated Debian package archives."""
import argparse, datetime, gzip, hashlib, html, io, json, pathlib, re, shutil, subprocess, tarfile, urllib.parse, tempfile
from verify_app import macho_ios_arm64_bytes


def read_ar(raw):
    if not raw.startswith(b'!<arch>\n'): raise ValueError('Not a Debian ar archive')
    files, offset = {}, 8
    while offset < len(raw):
        header = raw[offset:offset + 60]
        if len(header) != 60 or header[-2:] != b'`\n': raise ValueError('Invalid ar header')
        name, length = header[:16].decode().strip().rstrip('/'), int(header[48:58])
        offset += 60
        if length < 0 or offset + length > len(raw) or name in files: raise ValueError('Invalid ar member')
        files[name] = raw[offset:offset + length]
        offset += length + length % 2
    if files.get('debian-binary') != b'2.0\n': raise ValueError('Invalid Debian package version')
    return files


def package_control(file):
    members = read_ar(file.read_bytes())
    if set(members) != {'debian-binary', 'control.tar.gz', 'data.tar.gz'}: raise ValueError('Unexpected Debian members')
    with tarfile.open(fileobj=io.BytesIO(members['control.tar.gz']), mode='r:gz') as archive:
        control = archive.extractfile('control').read().decode('utf-8')
    fields = {}
    for line in control.splitlines():
        if line.startswith(' '): continue
        if ': ' not in line: raise ValueError('Malformed control field')
        key, value = line.split(': ', 1)
        if key in fields: raise ValueError('Duplicate field')
        fields[key] = value
    if fields.get('Package') != 'app.yubenzhe.wallet': raise ValueError('Unexpected app')
    if fields.get('Version') != '0.8.0': raise ValueError('Unexpected version')
    arch = fields.get('Architecture')
    if arch not in ('iphoneos-arm', 'iphoneos-arm64'): raise ValueError('Unexpected architecture')
    if any(key in fields for key in ('Filename', 'MD5sum', 'SHA256', 'Size')): raise ValueError('Generated fields may not be supplied')
    prefix = 'var/jb/Applications/Yubenzhe.app/' if arch == 'iphoneos-arm64' else 'Applications/Yubenzhe.app/'
    with tarfile.open(fileobj=io.BytesIO(members['data.tar.gz']), mode='r:gz') as archive:
        for item in archive:
            if not item.isfile() or not item.name.startswith(prefix) or '..' in pathlib.PurePosixPath(item.name).parts:
                raise ValueError('Unsafe package member')
        if prefix + 'Yubenzhe' not in archive.getnames(): raise ValueError('Executable missing')
        macho_ios_arm64_bytes(archive.extractfile(prefix + 'Yubenzhe').read())
    return control, fields


def safe_url(value):
    result = urllib.parse.urlsplit(value)
    if result.scheme != 'https' or not result.hostname or result.username or result.password or result.query or result.fragment:
        raise ValueError('Repository address must be an absolute HTTPS URL without credentials or query')
    if result.hostname.endswith(('.invalid', '.example')) or result.hostname in ('localhost', 'example.com', '127.0.0.1'):
        raise ValueError('Use the real deployment hostname')
    return value.rstrip('/') + '/'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--packages', required=True, type=pathlib.Path)
    p.add_argument('--output', required=True, type=pathlib.Path)
    p.add_argument('--base-url', required=True)
    p.add_argument('--signing-key', required=True, help='Existing local GPG key fingerprint; never a key file/password')
    a = p.parse_args()
    base = safe_url(a.base_url)
    if not re.fullmatch('[A-Fa-f0-9]{40,64}', a.signing_key): raise SystemExit('Use a full GPG signing-key fingerprint')
    if not shutil.which('gpg'): raise SystemExit('GPG is required; no unsigned repository will be advertised')
    packages = sorted(a.packages.glob('*.deb'))
    if not packages: raise SystemExit('No compiled packages: refusing to advertise an empty or fake install source')
    parsed, identities = [], set()
    for file in packages:
        if file.is_symlink() or not re.fullmatch('[a-zA-Z0-9._-]+', file.name): raise SystemExit('Unsafe package filename')
        control, fields = package_control(file)
        identity = (fields['Package'], fields['Version'], fields['Architecture'])
        if identity in identities: raise SystemExit('Duplicate package identity')
        identities.add(identity); parsed.append((file, control))
    destination = a.output.resolve()
    if destination.exists(): raise SystemExit('Choose a fresh output directory; existing repository was not changed')
    destination.parent.mkdir(parents=True, exist_ok=True)
    a.output = pathlib.Path(tempfile.mkdtemp(prefix='.ios-repo-staging-', dir=destination.parent))
    pool = a.output / 'pool'; pool.mkdir(exist_ok=True)
    entries = []
    for file, control in parsed:
        data = file.read_bytes(); (pool / file.name).write_bytes(data)
        entries.append(control.rstrip() + '\n' + f'Filename: pool/{file.name}\nSize: {len(data)}\nMD5sum: {hashlib.md5(data).hexdigest()}\nSHA256: {hashlib.sha256(data).hexdigest()}\n')
    index = ('\n'.join(entries) + '\n').encode()
    (a.output / 'Packages').write_bytes(index)
    (a.output / 'Packages.gz').write_bytes(gzip.compress(index, mtime=0))
    date = datetime.datetime.now(datetime.timezone.utc).strftime('%a, %d %b %Y %H:%M:%S +0000')
    release = f'Origin: Yubenzhe\nLabel: 愚笨者私有安装源\nSuite: stable\nCodename: stable\nVersion: 0.8.0\nArchitectures: iphoneos-arm iphoneos-arm64\nDescription: Private preview; BSC testnet only\nDate: {date}\nSHA256:\n'
    for name in ('Packages', 'Packages.gz'):
        data = (a.output / name).read_bytes(); release += f' {hashlib.sha256(data).hexdigest()} {len(data)} {name}\n'
    (a.output / 'Release').write_text(release)
    for filename, flags in [('InRelease', ['--clearsign']), ('Release.gpg', ['--armor', '--detach-sign'])]:
        subprocess.run(['gpg', '--batch', '--yes', '--local-user', a.signing_key, '--output', str(a.output / filename), *flags, str(a.output / 'Release')], check=True)
    public = subprocess.run(['gpg', '--armor', '--export', a.signing_key], check=True, capture_output=True).stdout
    if not public.startswith(b'-----BEGIN PGP PUBLIC KEY BLOCK-----'): raise SystemExit('Public signing key unavailable')
    (a.output / 'repository-key.asc').write_bytes(public)
    (a.output / 'source.list').write_text('deb ' + base + ' ./\n')
    (a.output / 'status.json').write_text(json.dumps({'name': '愚笨者', 'version': '0.8.0', 'repository': base, 'packages': len(parsed), 'signingFingerprint': a.signing_key, 'deviceVerified': False}, ensure_ascii=False, indent=2) + '\n')
    a.output.rename(destination)
    print('Signed repository generated; device installation remains unverified: ' + str(destination))

if __name__ == '__main__': main()
