import gzip, importlib.util, io, pathlib, plistlib, struct, sys, tarfile, tempfile, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from verify_app import macho_ios_arm64, verify_preview_entitlements, verify_app

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
package = load('package', 'package-deb.py')
repo = load('repo', 'build-repo.py')

class PackagingChecks(unittest.TestCase):
    def test_preview_entitlements_require_identity_and_own_container(self):
        good = {'application-identifier': 'app.yubenzhe.wallet',
                'com.apple.private.security.container-required': 'app.yubenzhe.wallet'}
        verify_preview_entitlements(good)
        self.assertEqual(plistlib.loads((ROOT/'App/Preview.entitlements').read_bytes()), good)
        for bad in ({}, {'application-identifier': 'app.yubenzhe.wallet'},
                    dict(good, **{'application-identifier': 'another.app'}),
                    dict(good, **{'com.apple.private.security.container-required': False}),
                    dict(good, **{'com.apple.private.security.no-sandbox': True}),
                    dict(good, **{'platform-application': True})):
            with self.assertRaises(ValueError): verify_preview_entitlements(bad)
    def binary(self, platform=2, cpu=0x0100000C):
        return struct.pack('<8I',0xFEEDFACF,cpu,0,2,1,24,0,0)+struct.pack('<6I',0x32,24,platform,0x0f0400,0x110000,0)
    def check_binary(self, data):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory)/'binary';path.write_bytes(data);return macho_ios_arm64(path)
    def test_macho_device_load_command(self): self.check_binary(self.binary())
    def test_reject_simulator(self):
        with self.assertRaisesRegex(ValueError,'not an iOS device'): self.check_binary(self.binary(platform=7))
    def test_reject_macos(self):
        with self.assertRaises(ValueError): self.check_binary(self.binary(platform=1))
    def test_reject_intel(self):
        with self.assertRaises(ValueError): self.check_binary(self.binary(cpu=0x01000007))
    def test_reject_placeholder_and_truncated(self):
        for data in (b'web zip',self.binary()[:-1],b'PK'+bytes(64)):
            with self.assertRaises(ValueError): self.check_binary(data)
    def test_debian_roundtrip(self):
        raw=package.ar_bytes([('debian-binary',b'2.0\n'),('control.tar.gz',b'abc'),('data.tar.gz',b'even')])
        self.assertEqual(repo.read_ar(raw),{'debian-binary':b'2.0\n','control.tar.gz':b'abc','data.tar.gz':b'even'})
    def test_invalid_ar(self):
        for raw in (b'',b'PKstub',b'!<arch>\nnotvalid'):
            with self.assertRaises(ValueError):repo.read_ar(raw)
    def test_archive_paths_and_executable_modes(self):
        data=package.tar_bytes([('Applications/Yubenzhe.app/Yubenzhe',b'fixture',0o755)])
        with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as tar:
            members=tar.getmembers()
            self.assertEqual([m.name for m in members if m.isdir()], ['Applications', 'Applications/Yubenzhe.app'])
            info=tar.getmember('Applications/Yubenzhe.app/Yubenzhe')
            self.assertEqual(info.mode,0o755);self.assertEqual(info.uid,0);self.assertEqual(info.mtime,0)
            self.assertTrue(all(m.isdir() for m in members[:-1]))
    def test_https_repo_validation(self):
        self.assertEqual(repo.safe_url('https://release.yubenzhe.org/ios/repo'),'https://release.yubenzhe.org/ios/repo/')
        for url in ('http://host/repo','https://u:p@host','https://host?a=b','https://host#hash','https://example.com/repo','https://localhost/','javascript:alert(1)'):
            with self.assertRaises(ValueError):repo.safe_url(url)
    def test_app_and_build_version_are_checked_before_packaging(self):
        with tempfile.TemporaryDirectory() as directory:
            app = pathlib.Path(directory)/'Yubenzhe.app'; app.mkdir()
            info = {'CFBundleIdentifier':'app.yubenzhe.wallet', 'CFBundleShortVersionString':'0.12.0', 'CFBundleVersion':'14', 'CFBundleExecutable':'Yubenzhe'}
            (app/'Info.plist').write_bytes(plistlib.dumps(info)); (app/'Yubenzhe').write_bytes(self.binary())
            web = app/'Web'; web.mkdir()
            for name in ('index.html','app.js','app.css','icon.png','icon.svg','manifest.webmanifest','apple-touch-icon.png'):
                (web/name).write_bytes(b'fixture')
            self.assertEqual(verify_app(app, verify_signature=False)['CFBundleVersion'], '14')
            for key, wrong in (('CFBundleVersion','11'), ('CFBundleShortVersionString','0.10.0')):
                changed = dict(info); changed[key] = wrong; (app/'Info.plist').write_bytes(plistlib.dumps(changed))
                with self.assertRaisesRegex(ValueError, 'Unexpected app'): verify_app(app, verify_signature=False)
    def test_social_csp_keeps_a_fixed_https_api_prefix(self):
        source = (ROOT/'App/LocalAssetServer.swift').read_text(encoding='utf-8')
        policy = source.split('let policy = "',1)[1].split('"',1)[0]
        connect = next(d.strip().split() for d in policy.split(';') if d.strip().startswith('connect-src'))
        self.assertEqual(connect, ['connect-src', "'self'", 'https://bsc-testnet-dataseed.bnbchain.org', 'https://bsc-testnet.bnbchain.org', 'https://66.42.56.29/api/social/'])
        images = next(d.strip().split() for d in policy.split(';') if d.strip().startswith('img-src'))
        self.assertEqual(images, ['img-src', "'self'", 'data:', 'blob:', 'https://66.42.56.29/api/social/avatars/'])
        self.assertIn("frame-src 'none'", policy)
        self.assertIn("object-src 'none'", policy)
    def test_project_references_are_resolvable(self):
        with (ROOT/'Yubenzhe.xcodeproj/project.pbxproj').open('rb') as file:data=plistlib.load(file)
        objects=data['objects']
        self.assertIn(data['rootObject'],objects)
        for obj in objects.values():
            for key in ('fileRef','buildConfigurationList','mainGroup','productRefGroup','productReference'):
                if key in obj:self.assertIn(obj[key],objects)
            for key in ('children','buildConfigurations','buildPhases','files','targets'):
                for reference in obj.get(key,[]):self.assertIn(reference,objects)
        info=plistlib.loads((ROOT/'App/Info.plist').read_bytes())
        self.assertFalse(info.get('NSAppTransportSecurity',{}).get('NSAllowsArbitraryLoads',False))
        self.assertNotIn('NSMicrophoneUsageDescription',info)
        self.assertEqual(info['CFBundleDisplayName'],'愚笨者')
        self.assertEqual(info['CFBundleShortVersionString'], '0.12.0')
        self.assertEqual(info['CFBundleVersion'], '14')
        for obj in objects.values():
            settings = obj.get('buildSettings', {})
            if 'MARKETING_VERSION' in settings:
                self.assertEqual(settings['MARKETING_VERSION'], '0.12.0')
                self.assertEqual(settings['CURRENT_PROJECT_VERSION'], '14')

if __name__=='__main__':unittest.main()
