#!/usr/bin/env python3
"""Prepare a fresh Max 9 project for the final frozen instrument export."""
import argparse
import copy
import json
from pathlib import Path
import shutil
import time

ROOT = Path(__file__).resolve().parents[1]
NAME = 'MD Drum Engine'
DEFAULT_OUTPUT = ROOT / 'artifacts' / 'frozen-project' / NAME
DEPENDENCIES = {
    'md.bridge.js': ('code', 'javascript', 'TEXT'),
    'md.panel.js': ('code', 'javascript', 'TEXT'),
    'mdcoreengine~.mxo': ('externals', 'object', 'iLaX'),
    'mdparameterfocus.mxo': ('externals', 'object', 'iLaX'),
}
# Windows builds of the same classes (from the windows CI workflow). They sit
# beside the .mxo bundles in the project's search path but are not listed as
# dependencies: Max collects other-platform externals by name when freezing.
WINDOWS_EXTERNALS = ('mdcoreengine~.mxe64', 'mdparameterfocus.mxe64')


def project_manifest(now=None):
    timestamp = int(time.time()) + 2082844800 if now is None else now
    contents = {
        'patchers': {NAME + '.maxpat': {'kind': 'patcher', 'local': 1, 'toplevel': 1}},
        'code': {}, 'externals': {},
    }
    for name, (category, kind, _) in DEPENDENCIES.items():
        contents[category][name] = {'kind': kind, 'local': 1}
    return {
        'name': NAME, 'version': 1,
        'creationdate': timestamp, 'modificationdate': timestamp,
        'viewrect': [25, 70, 360, 500],
        'autoorganize': 1, 'hideprojectwindow': 0, 'showdependencies': 1,
        'autolocalize': 1, 'contents': contents, 'layout': {}, 'searchpath': {},
        'detailsvisible': 1,
        # The on-disk project uses the iiii FourCC; the Inspector enum index is 3.
        'amxdtype': 1768515945,
        'readonly': 0, 'devpathtype': 0, 'devpath': '.',
        'sortmode': 0, 'viewmode': 0, 'includepackages': 0,
    }


def project_patch(raw):
    patch = copy.deepcopy(raw)
    patcher = patch['patcher']
    patcher.pop('project', None)
    patcher['dependency_cache'] = [
        {
            'name': name, 'patcherrelativepath': '../' + category,
            'type': filetype, 'implicit': 1,
        }
        for name, (category, _, filetype) in DEPENDENCIES.items()
    ]
    return patch


def prepare(output, device):
    required = [device / (NAME + '.maxpat')] + [device / name for name in DEPENDENCIES]
    required += [device / name for name in WINDOWS_EXTERNALS]
    for path in required:
        if not path.exists():
            raise FileNotFoundError('Build the patch and native external first: ' + str(path))
    if output.exists():
        raise FileExistsError(
            'Refusing to replace an existing Max project. Choose a new --output directory: ' + str(output))
    patch = project_patch(json.loads(required[0].read_text()))
    output.mkdir(parents=True)
    for category in ['patchers', 'code', 'externals']:
        (output / category).mkdir()
    for name, (category, _, _) in DEPENDENCIES.items():
        src, dst = device / name, output / category / name
        if src.is_dir():
            shutil.copytree(src, dst, symlinks=True)
        else:
            shutil.copy2(src, dst)
    for name in WINDOWS_EXTERNALS:
        shutil.copy2(device / name, output / 'externals' / name)
    (output / 'patchers' / (NAME + '.maxpat')).write_text(
        json.dumps(patch, indent=2, ensure_ascii=False) + '\n')
    project = output / (NAME + '.maxproj')
    project.write_text(json.dumps(project_manifest(), indent=2) + '\n')
    return project


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT,
                        help='New project folder; existing folders are never overwritten.')
    args = parser.parse_args()
    project = prepare(args.output.expanduser().resolve(), ROOT / 'device')
    print(project)
    print('Open this .maxproj in Max 9, verify Instrument, Consolidate, then Export Max for Live Device.')
    print('Save the frozen export as: ' + str(project.parent / (NAME + '.amxd')))
    print('Keep the OS .syx file external; do not add it to this project.')


if __name__ == '__main__':
    main()
