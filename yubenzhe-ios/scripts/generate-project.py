#!/usr/bin/env python3
"""Create a self-contained dependency-free Xcode project without an XcodeGen install."""
import hashlib, pathlib, plistlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
objects = {}
def obj(key, **value):
    identifier = hashlib.sha256(key.encode()).hexdigest()[:24].upper()
    objects[identifier] = value
    return identifier
sources, resources, files = [], [], []
for name in ['AppDelegate.swift','LocalAssetServer.swift','BrowserViewController.swift','bridge.js','Web','Assets.xcassets','PrivacyInfo.xcprivacy','Info.plist']:
    filetype = ('sourcecode.swift' if name.endswith('.swift') else 'sourcecode.javascript' if name.endswith('.js') else 'folder.assetcatalog' if name.endswith('xcassets') else 'folder' if name == 'Web' else 'text.plist.xml')
    ref = obj('file:'+name, isa='PBXFileReference', lastKnownFileType=filetype, path=name, sourceTree='<group>')
    files.append(ref)
    if name != 'Info.plist':
        build = obj('build:'+name, isa='PBXBuildFile', fileRef=ref)
        (sources if name.endswith('.swift') else resources).append(build)
product = obj('product', isa='PBXFileReference', explicitFileType='wrapper.application', path='Yubenzhe.app', sourceTree='BUILT_PRODUCTS_DIR')
app_group = obj('appgroup', isa='PBXGroup', children=files, path='App', sourceTree='<group>')
products = obj('products', isa='PBXGroup', children=[product], name='Products', sourceTree='<group>')
group = obj('group', isa='PBXGroup', children=[app_group,products], sourceTree='<group>')
sources_phase = obj('sources', isa='PBXSourcesBuildPhase', buildActionMask=2147483647, files=sources, runOnlyForDeploymentPostprocessing=0)
resources_phase = obj('resources', isa='PBXResourcesBuildPhase', buildActionMask=2147483647, files=resources, runOnlyForDeploymentPostprocessing=0)
frameworks = obj('frameworks', isa='PBXFrameworksBuildPhase', buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0)
project_configs, target_configs = [], []
for name in ['Debug','Release']:
    project_settings = {'SDKROOT':'iphoneos','IPHONEOS_DEPLOYMENT_TARGET':'15.4','SWIFT_VERSION':'5.0','CLANG_ENABLE_MODULES':'YES','CLANG_ENABLE_OBJC_ARC':'YES','ENABLE_BITCODE':'NO','ONLY_ACTIVE_ARCH':'NO','ARCHS':'$(ARCHS_STANDARD)','SWIFT_STRICT_CONCURRENCY':'minimal','SWIFT_OPTIMIZATION_LEVEL':'-O' if name=='Release' else '-Onone','DEBUG_INFORMATION_FORMAT':'dwarf-with-dsym' if name=='Release' else 'dwarf'}
    target_settings = {'PRODUCT_NAME':'Yubenzhe','PRODUCT_BUNDLE_IDENTIFIER':'app.yubenzhe.wallet','INFOPLIST_FILE':'App/Info.plist','GENERATE_INFOPLIST_FILE':'NO','TARGETED_DEVICE_FAMILY':'1,2','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','CODE_SIGN_STYLE':'Automatic','CURRENT_PROJECT_VERSION':'8','MARKETING_VERSION':'0.8.0','LD_RUNPATH_SEARCH_PATHS':'$(inherited) @executable_path/Frameworks','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','SUPPORTS_MACCATALYST':'NO','SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD':'NO','SWIFT_EMIT_LOC_STRINGS':'YES'}
    project_configs.append(obj('project-config:'+name, isa='XCBuildConfiguration', buildSettings=project_settings, name=name))
    target_configs.append(obj('target-config:'+name, isa='XCBuildConfiguration', buildSettings=target_settings, name=name))
project_list = obj('project-configs', isa='XCConfigurationList', buildConfigurations=project_configs, defaultConfigurationIsVisible=0, defaultConfigurationName='Release')
target_list = obj('target-configs', isa='XCConfigurationList', buildConfigurations=target_configs, defaultConfigurationIsVisible=0, defaultConfigurationName='Release')
target = obj('target', isa='PBXNativeTarget', buildConfigurationList=target_list, buildPhases=[sources_phase,frameworks,resources_phase], buildRules=[], dependencies=[], name='Yubenzhe', productName='Yubenzhe', productReference=product, productType='com.apple.product-type.application')
project = obj('project', isa='PBXProject', attributes={'LastUpgradeCheck':'1600','TargetAttributes':{target:{'CreatedOnToolsVersion':'16.0'}}}, buildConfigurationList=project_list, compatibilityVersion='Xcode 14.0', developmentRegion='zh_CN', hasScannedForEncodings=0, knownRegions=['zh_CN','en','Base'], mainGroup=group, productRefGroup=products, projectDirPath='', projectRoot='', targets=[target])
output = {'archiveVersion':'1','classes':{},'objectVersion':'56','objects':objects,'rootObject':project}
(ROOT/'Yubenzhe.xcodeproj/project.pbxproj').write_bytes(plistlib.dumps(output, sort_keys=False))
scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="Yubenzhe.app" BlueprintName="Yubenzhe" ReferencedContainer="container:Yubenzhe.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="NO"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="Yubenzhe.app" BlueprintName="Yubenzhe" ReferencedContainer="container:Yubenzhe.xcodeproj"/></BuildableProductRunnable></LaunchAction><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>'''
(ROOT/'Yubenzhe.xcodeproj/xcshareddata/xcschemes/Yubenzhe.xcscheme').write_text(scheme)
print('Xcode project generated; this is not a compiled application.')
