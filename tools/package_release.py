#!/usr/bin/env python3
"""Package the verified frozen device and complete sources, without firmware."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import struct
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'release'
VERSION = '1.0.3'
NATIVE_CLASSES = ('mdcoreengine~', 'mdparameterfocus')
REQUIRED_ARCHITECTURES = {'arm64', 'x86_64'}
FROZEN = ROOT / 'artifacts' / 'full-audit' / 'MD Drum Engine' / 'MD Drum Engine.amxd'
FROZEN_REPORT = ROOT / 'artifacts' / ('frozen-device-verification-' + VERSION + '.json')
SOURCE_DEVICE_FILES = [
    'MD Drum Engine.amxd', 'MD Drum Engine.maxpat',
    'md.bridge.js', 'md.panel.js', 'md.qa.js',
]
REPORTS = [
    'bridge-integration-audit.log', 'panel-context-1.0.3.log',
    'max-integration-1.0.3.json', 'max-integration-1.0.3.reopen.json',
    'qa-1.0.3-arm64/native-audit.log', 'qa-1.0.3-arm64/engine-smoke.log', 'qa-1.0.3-arm64/fx-regression.log',
    'qa-1.0.3-x64/native-audit.log', 'qa-1.0.3-x64/engine-smoke.log', 'qa-1.0.3-x64/fx-regression.log',
    'native-release-verification-1.0.3.json',
    'native-audit-verification-1.0.3.json',
    'full-audit-qa/native-alias-verification.json',
    'qa-1.0.3-arm64/native-audit-result.json',
    'qa-1.0.3-arm64/engine-smoke-result.json',
    'qa-1.0.3-arm64/fx-regression-result.json',
    'qa-1.0.3-x64/native-audit-result.json',
    'qa-1.0.3-x64/engine-smoke-result.json',
    'qa-1.0.3-x64/fx-regression-result.json',
    'source-build-verification-1.0.2.json',
    'panel-sends-1.0.2.log',
    'engine-smoke-1.0.1.log', 'fx-regression-1.0.1.log',
    'engine-smoke-x64-1.0.1.log', 'fx-regression-x64-1.0.1.log', 'max-integration-1.0.1.json',
    'bridge-loading-1.0.1.log', 'panel-activity-1.0.1.log',
    'native-path-verification-1.0.1.json',
    'engine-smoke-sync.log', 'machine-catalog.json', 'max-integration.json',
    'max-integration.reopen.json', 'max-ui-callbacks.json',
    'live-integration.json', 'live-integration.reopen.json',
    'frozen-device-verification.json', 'frozen-device-verification-1.0.json',
    'frozen-device-verification-1.0.1.json', 'frozen-device-verification-1.0.2.json',
    'frozen-device-verification-' + VERSION + '.json',
]
SKIP_DIRS = {'.git', '__pycache__', 'build', 'build-x64', 'build-arm64', 'build-x86_64', 'node_modules', '.DS_Store'}


def files(path, skip=()):
    if not path.exists():
        raise FileNotFoundError(path)
    if path.is_file():
        yield path
        return
    for parent, dirs, names in os.walk(path):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and d not in skip)
        for name in sorted(names):
            p = Path(parent) / name
            if name in {'.DS_Store', '.git'} or p.suffix.lower() in {'.syx', '.pyc'}:
                continue
            if p.is_file():
                yield p


def add_tree(archive, path, target, skip=()):
    for p in files(path, skip):
        rel = p.relative_to(path) if path.is_dir() else Path(p.name)
        archive.write(p, str(Path(target) / rel))


def frozen_bytes(path):
    """Reject an unfrozen JSON wrapper; Max export stores a collective in ptch."""
    data = path.read_bytes()
    if data[:12] != b'ampf\x04\x00\x00\x00iiii':
        raise ValueError('Expected an instrument AMXD exported by Max: ' + str(path))
    offset = 12
    while offset + 8 <= len(data):
        tag = data[offset:offset + 4]
        size = struct.unpack_from('<I', data, offset + 4)[0]
        start, end = offset + 8, offset + 8 + size
        if end > len(data):
            raise ValueError('Truncated AMXD chunk: ' + str(path))
        if tag == b'ptch':
            if data[start:start + 4] != b'mx@c':
                raise ValueError('AMXD is not frozen: ' + str(path))
            return data
        offset = end
    raise ValueError('No ptch chunk in AMXD: ' + str(path))


def digest(path):
    return {
        'name': path.name, 'bytes': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def require_verified_sources(report, source=ROOT / 'device'):
    """Reject source edits made after the frozen export was last verified."""
    patch = source / 'MD Drum Engine.maxpat'
    if report.get('patch_matches_source') is not True or report.get('source_patch_sha256') != hashlib.sha256(patch.read_bytes()).hexdigest():
        raise ValueError('Patch source changed or lacks verification; rerun verify_frozen_device.py before packaging.')
    records = report.get('javascript', [])
    names = [record.get('name') for record in records]
    if len(names) != 2 or set(names) != {'md.bridge.js', 'md.panel.js'}:
        raise ValueError('Frozen verification must include both expected JavaScript files.')
    for record in records:
        path = source / record['name']
        if record.get('matches_source') is not True or record.get('sha256') != hashlib.sha256(path.read_bytes()).hexdigest():
            raise ValueError('JavaScript source differs from the verified frozen export: ' + record['name'])


def require_universal_bundles(report, source=ROOT / 'device'):
    """Tie each inspected local universal binary to the verified frozen payload."""
    records = report.get('native_bundles', [])
    names = [record.get('class') for record in records]
    if len(names) != len(NATIVE_CLASSES) or set(names) != set(NATIVE_CLASSES):
        raise ValueError('Frozen verification must include both expected native bundles.')
    for record in records:
        name = record['class']
        executable = source / (name + '.mxo') / 'Contents' / 'MacOS' / name
        sha = hashlib.sha256(executable.read_bytes()).hexdigest()
        if record.get('executable_sha256') != sha:
            raise ValueError('Local native binary differs from the verified frozen export: ' + name)
        result = subprocess.run(
            ['/usr/bin/lipo', '-archs', str(executable)], check=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        architectures = set(result.stdout.split())
        if not REQUIRED_ARCHITECTURES.issubset(architectures):
            raise ValueError('Universal release requires arm64 and x86_64 in ' + name)
        if 'architectures' in record and set(record['architectures']) != architectures:
            raise ValueError('Architecture metadata differs from the verified native binary: ' + name)


def main():
    frozen = frozen_bytes(FROZEN)
    report = json.loads(FROZEN_REPORT.read_text())
    if report.get('status') != 'PASS' or report.get('sha256') != hashlib.sha256(frozen).hexdigest():
        raise ValueError('Run verify_frozen_device.py on the current export before packaging.')
    if report.get('firmware_payload_embedded') is not False or report.get('saved_firmware_path_empty') is not True:
        raise ValueError('Frozen verification must confirm no firmware and an empty saved firmware path.')
    require_verified_sources(report)
    require_universal_bundles(report)
    DEST.mkdir(exist_ok=True)
    prefix = 'MD Drum Engine ' + VERSION
    direct = DEST / (prefix + '.amxd')
    shutil.copy2(FROZEN, direct)
    assert direct.read_bytes() == frozen

    documents = ['START HERE.txt', 'README.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE']
    audit_document = 'AUDIT-' + VERSION + '.txt'
    if (ROOT / audit_document).is_file():
        documents.append(audit_document)

    runtime = DEST / ('MD-Drum-Engine-' + VERSION + '-macOS-universal.zip')
    with zipfile.ZipFile(runtime, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.write(direct, prefix + '/' + direct.name)
        for name in documents:
            archive.write(ROOT / name, prefix + '/' + name)
        add_tree(archive, ROOT / 'licenses', prefix + '/licenses')

    source = DEST / ('MD-Drum-Engine-' + VERSION + '-source.zip')
    with zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in REPORTS:
            path = ROOT / 'artifacts' / name
            if path.exists():
                archive.write(path, 'machinedrum/artifacts/' + name)
        # Preserve the exact Max-exported artifact at the path expected by this tool.
        archive.write(FROZEN, 'machinedrum/' + str(FROZEN.relative_to(ROOT)))
        for name in ['src', 'tools', 'licenses']:
            add_tree(archive, ROOT / name, 'machinedrum/' + name)
        for name in ['CMakeLists.txt'] + documents:
            archive.write(ROOT / name, 'machinedrum/' + name)
        for name in SOURCE_DEVICE_FILES:
            archive.write(ROOT / 'device' / name, 'machinedrum/device/' + name)
        for name in ['ModuleDrum', 'max-sdk-base']:
            add_tree(archive, ROOT / 'vendor' / name, 'machinedrum/vendor/' + name)
        # This is the already-patched core actually used by the linked libraries.
        # wxWidgets is only for the optional debugger; it is not linked or built.
        dsp_sources = ROOT / 'vendor/ModuleDrum/build/_deps/dsp56300-src'
        if not dsp_sources.exists():
            dsp_sources = ROOT / 'vendor/dsp56300'
        add_tree(archive, dsp_sources, 'machinedrum/vendor/dsp56300', ('wxWidgets',))
        archive.writestr('machinedrum/BUILD-OFFLINE.txt', '''Build universal macOS native bundles (arm64 + x86_64) from this source archive.
Requirements: Python 3, CMake 3.22+, Ninja, Xcode CLI tools with a macOS SDK
supporting both architectures, and Max 9 for the frozen AMXD export.
The patched dsp56300 and AsmJit sources are included; no source download is needed.
Run these commands from the extracted machinedrum directory:

python3 tools/build_universal.py
python3 tools/build_device.py
python3 tools/prepare_frozen_project.py

build_universal.py builds each architecture separately, merges both complete
native bundles into device/, signs them locally and verifies both architectures.
For optional runtime smoke and FX checks, add --firmware "/absolute/path/to/Elektron_SPS1-1UW_OS1.63.syx".
Those checks require a host capable of running both architectures (Apple Silicon
with Rosetta installed). The script does not install Rosetta or copy the firmware.
Without --firmware, cross-compilation and bundle checks do not require a firmware file.

The Python patch generator creates editable files; its device/MD Drum Engine.amxd is NOT frozen.
Open artifacts/frozen-project/MD Drum Engine/MD Drum Engine.maxproj in Max 9.
Verify Project Inspector > Max for Live Device Type is Instrument.
The project explicitly includes md.bridge.js, md.panel.js and both complete native bundles: mdcoreengine~.mxo and mdparameterfocus.mxo.
Choose Manage Project > Consolidate, then File > Export Max for Live Device.
Save the export as artifacts/full-audit/MD Drum Engine/MD Drum Engine.amxd.
For a rebuild, this deliberately replaces the release artifact already included at that path.
Max may propose a containing folder; keep exactly one MD Drum Engine folder at that location.
python3 tools/verify_frozen_device.py "artifacts/full-audit/MD Drum Engine/MD Drum Engine.amxd" --report artifacts/frozen-device-verification-1.0.3.json
After verification passes, run python3 tools/package_release.py.
Packaging requires both arm64 and x86_64 in each verified native bundle.
Do not add the OS .syx file to the Max project.

The source archive includes the exact frozen release artifact under artifacts/full-audit/MD Drum Engine/.
The source scripts, editable patch and generated unfrozen wrapper are under device/.
Firmware is external and is not in either archive.
The patched dsp56300 sources correspond to c051afad31612c2d2c7a81a7ab23e1c5ac9e61af plus ModuleDrum/ext/patches/0001-dsp56300-mnm.patch.
ModuleDrum source corresponds to bb0e4472425bc88e507b2352b1dd089f8b1447e7.
The GUI/debugger wxWidgets tree is not needed by this core-only build and is omitted.
''')

    for path in [runtime, source]:
        with zipfile.ZipFile(path) as archive:
            assert archive.testzip() is None
            assert not any(n.lower().endswith('.syx') for n in archive.namelist())
    with zipfile.ZipFile(runtime) as archive:
        members = archive.namelist()
        assert sum(n.endswith('.amxd') for n in members) == 1
        assert not any(n.endswith(('.js', '.maxpat')) or '.mxo/' in n for n in members)
        assert archive.read(prefix + '/' + direct.name) == frozen

    result = [digest(path) for path in [direct, runtime, source]]
    (DEST / ('SHA256-' + VERSION + '.json')).write_text(json.dumps(result, indent=2) + '\n')
    # Retain old releases and include their hashes in the aggregate index.
    all_releases = sorted(set(DEST.glob('*.zip')) | set(DEST.glob('*.amxd')))
    (DEST / 'SHA256.json').write_text(
        json.dumps([digest(path) for path in all_releases], indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
