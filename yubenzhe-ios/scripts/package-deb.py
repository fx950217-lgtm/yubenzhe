#!/usr/bin/env python3
"""Package an actual compiled, ad-hoc signed app. No placeholder .deb is emitted."""
import argparse, gzip, hashlib, io, os, pathlib, re, tarfile, time
from verify_app import verify_app

ROOT = pathlib.Path(__file__).resolve().parents[1]

def tar_bytes(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        # dpkg requires parent directories to be declared before application files.
        directories = {str(parent) for name, _, _ in files
                       for parent in pathlib.PurePosixPath(name).parents if str(parent) != '.'}
        for name in sorted(directories, key=lambda value: (value.count('/'), value)):
            info = tarfile.TarInfo(name + '/')
            info.type, info.mode, info.uid, info.gid, info.mtime = tarfile.DIRTYPE, 0o755, 0, 0, 0
            info.uname, info.gname = 'root', 'wheel'
            archive.addfile(info)
        for name, data, mode in files:
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.uid, info.gid, info.mtime = len(data), mode, 0, 0, 0
            info.uname, info.gname = 'root', 'wheel'
            archive.addfile(info, io.BytesIO(data))
    return gzip.compress(output.getvalue(), mtime=0)

def ar_bytes(members):
    output = bytearray(b'!<arch>\n')
    for name, contents in members:
        header = f'{name + "/":<16}{0:<12}{0:<6}{0:<6}{"100644":<8}{len(contents):<10}`\n'.encode('ascii')
        assert len(header) == 60
        output += header + contents
        if len(contents) % 2: output += b'\n'
    return output

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--app', required=True, type=pathlib.Path)
    p.add_argument('--scheme', required=True, choices=['rootful', 'rootless'])
    p.add_argument('--output', type=pathlib.Path, default=ROOT / 'packages')
    a = p.parse_args()
    app = a.app.resolve()
    verify_app(app, ROOT / 'web-snapshot.json')
    architecture = 'iphoneos-arm64' if a.scheme == 'rootless' else 'iphoneos-arm'
    prefix = 'var/jb/Applications' if a.scheme == 'rootless' else 'Applications'
    destination = prefix + '/Yubenzhe.app'
    data_files = []
    for file in sorted(app.rglob('*')):
        if file.is_file():
            mode = 0o755 if os.access(file, os.X_OK) else 0o644
            data_files.append((destination + '/' + file.relative_to(app).as_posix(), file.read_bytes(), mode))
    control = ('Package: app.yubenzhe.wallet\nName: 愚笨者\nVersion: 0.12.1\n'
               f'Architecture: {architecture}\nMaintainer: Yubenzhe\nSection: Applications\n'
               'Depends: firmware (>= 15.4), uikittools\n'
               'Description: Private BSC testnet wallet and familiar-friends social preview.\n'
               ' Local wallet data stays on this device. No mainnet or custodial settlement.\n'
               f'Installed-Size: {(sum(len(x[1]) for x in data_files) + 1023) // 1024}\n')
    uicache = '/var/jb/usr/bin/uicache' if a.scheme == 'rootless' else '/usr/bin/uicache'
    shell = '/var/jb/bin/sh' if a.scheme == 'rootless' else '/bin/sh'
    postinst = f'#!{shell}\nset -e\nif [ "$1" = configure ]; then\n  "{uicache}" -p "/{destination}"\nfi\n'
    prerm = f'#!{shell}\nset -e\nif [ "$1" = remove ] || [ "$1" = deconfigure ]; then\n  "{uicache}" -u "/{destination}"\nfi\n'
    output = ar_bytes([('debian-binary', b'2.0\n'), ('control.tar.gz', tar_bytes([
        ('control', control.encode(), 0o644), ('postinst', postinst.encode(), 0o755), ('prerm', prerm.encode(), 0o755)
    ])), ('data.tar.gz', tar_bytes(data_files))])
    a.output.mkdir(parents=True, exist_ok=True)
    file = a.output / f'app.yubenzhe.wallet_0.12.1_{architecture}.deb'
    file.write_bytes(output)
    print(file)
    print('SHA256 ' + hashlib.sha256(output).hexdigest())

if __name__ == '__main__': main()
