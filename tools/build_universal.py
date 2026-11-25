#!/usr/bin/env python3
"""Build/merge macOS arm64 and x86_64 native externals. Firmware stays external."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
CLASSES = ('mdcoreengine~', 'mdparameterfocus')


def run(*args):
    subprocess.run([str(a) for a in args], check=True, cwd=ROOT)


def merge(arm, intel, output):
    # Check both complete inputs before replacing either destination bundle.
    for cls in CLASSES:
        for path, arch in [(arm, 'arm64'), (intel, 'x86_64')]:
            bundle = path / (cls + '.mxo')
            exe = bundle / 'Contents/MacOS' / cls
            run('/usr/bin/lipo', exe, '-verify_arch', arch)
            run('/usr/bin/codesign', '--verify', '--deep', '--strict', bundle)
            if output.resolve() == path.resolve():
                raise ValueError('Output directory must differ from both architecture inputs')
    output.mkdir(parents=True, exist_ok=True)
    # Build and verify both complete replacements before touching a live bundle.
    # Rewriting a mapped Mach-O inode can terminate Max during code-sign checks.
    # Renames preserve the loaded inode and retain the previous signed bundles.
    with tempfile.TemporaryDirectory(prefix='.md-native-stage-', dir=output.parent) as temporary:
        staging = Path(temporary)
        for cls in CLASSES:
            bundle = staging / (cls + '.mxo')
            shutil.copytree(arm / bundle.name, bundle)
            exe = bundle / 'Contents/MacOS' / cls
            run('/usr/bin/lipo', '-create', arm / bundle.name / 'Contents/MacOS' / cls,
                intel / bundle.name / 'Contents/MacOS' / cls, '-output', exe)
            run('/usr/bin/codesign', '--force', '--sign', '-', bundle)
            run('/usr/bin/lipo', exe, '-verify_arch', 'arm64', 'x86_64')
            run('/usr/bin/codesign', '--verify', '--deep', '--strict', bundle)
        backup = None
        installed = []
        try:
            for cls in CLASSES:
                name = cls + '.mxo'
                destination = output / name
                previous = None
                if destination.exists():
                    if backup is None:
                        prefix = 'native-before-' + datetime.now().strftime('%Y%m%d-%H%M%S-')
                        backup = Path(tempfile.mkdtemp(prefix=prefix, dir=output.parent))
                    previous = backup / name
                    destination.rename(previous)
                installed.append((destination, previous))
                (staging / name).rename(destination)
        except Exception:
            # Restore the prior complete set if an installation rename fails.
            for destination, previous in reversed(installed):
                if destination.exists():
                    destination.rename(staging / ('failed-' + destination.name))
                if previous is not None:
                    previous.rename(destination)
            raise
        if backup is not None:
            print('Previous native bundles retained in ' + str(backup))


def build(architecture, destination, firmware):
    core = ROOT / 'vendor/ModuleDrum'
    core_build = core / ('build-' + architecture)
    dsp = ROOT / 'vendor/dsp56300'
    if not dsp.exists():
        dsp = core / 'build/_deps/dsp56300-src'
    if not dsp.exists():
        raise FileNotFoundError('Patched dsp56300 sources are required (included in source release)')
    run('cmake', '-S', core, '-B', core_build, '-G', 'Ninja',
        '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_OSX_ARCHITECTURES=' + architecture,
        '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0', '-DMNM_BUILD_PLUGIN=OFF',
        '-DMNM_BUILD_TESTS=OFF', '-DMNM_DSP56300_DIR=' + str(dsp))
    run('cmake', '--build', core_build, '--target', 'mdcore', '--parallel', '4')
    wrapper = ROOT / ('build-' + architecture)
    run('cmake', '-S', ROOT, '-B', wrapper, '-G', 'Ninja',
        '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_OSX_ARCHITECTURES=' + architecture,
        '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0', '-DMODULEDRUM_BUILD=' + str(core_build),
        '-DMD_DEVICE_OUTPUT_DIRECTORY=' + str(destination))
    run('cmake', '--build', wrapper, '--target', 'mdengine', 'mdparameterfocus',
        'engine-smoke', 'fx-regression', 'native-audit', '--parallel', '4')
    for cls in CLASSES:
        run('/usr/bin/codesign', '--force', '--sign', '-', destination / (cls + '.mxo'))
    if firmware:
        results = ROOT / 'artifacts' / ('universal-check-' + architecture)
        results.mkdir(parents=True, exist_ok=True)
        # Running the other CPU architecture requires host OS support (Rosetta
        # for x86_64 on Apple Silicon); no software is installed by this script.
        run('/usr/bin/arch', '-' + architecture, wrapper / 'engine-smoke', firmware, results)
        run('/usr/bin/arch', '-' + architecture, wrapper / 'fx-regression', firmware)
        run('/usr/bin/arch', '-' + architecture, wrapper / 'native-audit', firmware)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--merge-only', action='store_true')
    parser.add_argument('--arm64', type=Path, default=ROOT / 'artifacts/native-arm64')
    parser.add_argument('--x86_64', type=Path, default=ROOT / 'artifacts/native-x86_64')
    parser.add_argument('--output', type=Path, default=ROOT / 'device')
    parser.add_argument('--firmware', type=Path, help='Optional local .syx for runtime tests; never packaged')
    args = parser.parse_args()
    arm, intel, output = (p.resolve() for p in (args.arm64, args.x86_64, args.output))
    firmware = args.firmware.resolve() if args.firmware else None
    if not args.merge_only:
        build('arm64', arm, firmware)
        build('x86_64', intel, firmware)
    merge(arm, intel, output)
    print('Verified universal native bundles in ' + str(output))


if __name__ == '__main__':
    main()
