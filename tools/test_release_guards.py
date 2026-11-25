#!/usr/bin/env python3
"""Regression checks for release guards using temporary copies of a frozen export.

By default, use the current package paths and device/ patch source. To audit a
previous release, pass --device, --report and its --source-archive. No device,
source archive or release output is modified.
"""
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import package_release as package
import verify_frozen_device as verify

OPTIONS = None


class MemoryDevice:
    name = 'fault-injected.amxd'

    def __init__(self, data):
        self.data = data

    def read_bytes(self):
        return self.data


class ReleaseGuards(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='md-release-guards-')
        cls.source = Path(cls.temporary.name) / 'device'
        cls.source.mkdir()
        cls.raw = OPTIONS.device.read_bytes()
        manifest = json.loads(OPTIONS.report.read_text())
        if hashlib.sha256(cls.raw).hexdigest() != manifest['sha256']:
            raise ValueError('Fixture report does not match frozen device')
        cls.payloads = {entry['name']: cls.raw[entry['offset']:entry['offset'] + entry['bytes']]
                        for entry in manifest['entries']}
        for name in ('md.bridge.js', 'md.panel.js'):
            (cls.source / name).write_bytes(cls.payloads[name])
        for name in verify.NATIVE_CLASSES:
            with zipfile.ZipFile(io.BytesIO(cls.payloads[name + '/zipfile'])) as archive:
                for member in archive.infolist():
                    path = Path(member.filename)
                    if path.is_absolute() or '..' in path.parts:
                        raise ValueError('Unsafe fixture archive member')
                archive.extractall(cls.source)
        if OPTIONS.source_archive:
            with zipfile.ZipFile(OPTIONS.source_archive) as archive:
                cls.patch_bytes = archive.read('machinedrum/device/MD Drum Engine.maxpat')
        else:
            cls.patch_bytes = (package.ROOT / 'device/MD Drum Engine.maxpat').read_bytes()
        (cls.source / 'MD Drum Engine.maxpat').write_bytes(cls.patch_bytes)
        cls.frozen_patch = json.loads(cls.payloads['MD Drum Engine.maxpat'].rstrip(b'\0'))['patcher']
        cls.source_patch = json.loads(cls.patch_bytes)['patcher']
        cls.report = verify.audit(MemoryDevice(cls.raw), cls.source)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        (self.source / 'MD Drum Engine.maxpat').write_bytes(self.patch_bytes)
        for name in ('md.bridge.js', 'md.panel.js'):
            (self.source / name).write_bytes(self.payloads[name])

    def test_real_max_serialization_is_accepted(self):
        self.assertTrue(self.report['patch_matches_source'])
        self.assertEqual(self.report['automatable_parameter_count'], 513)
        package.require_verified_sources(self.report, self.source)
        package.require_universal_bundles(self.report, self.source)

    def test_changed_midi_mapping_in_frozen_export_is_rejected(self):
        self.assertEqual(self.raw.count(b'split 36 51'), 1)
        altered = self.raw.replace(b'split 36 51', b'split 35 50')
        with self.assertRaisesRegex(ValueError, 'object text differs'):
            verify.audit(MemoryDevice(altered), self.source)

    def test_changed_parameter_identity_in_frozen_export_is_rejected(self):
        self.assertIn(b'T01 P01', self.raw)
        altered = self.raw.replace(b'T01 P01', b'T01 P00')
        with self.assertRaisesRegex(ValueError, 'parameter identities'):
            verify.audit(MemoryDevice(altered), self.source)

    def test_changed_connection_in_frozen_export_is_rejected(self):
        altered, count = re.subn(rb'("source"\s*:\s*\[\s*"notein"\s*,\s*)0',
                                rb'\g<1>2', self.raw, count=1)
        self.assertEqual(count, 1)
        with self.assertRaisesRegex(ValueError, 'patch connections differ'):
            verify.audit(MemoryDevice(altered), self.source)

    def test_disabled_parameter_is_rejected(self):
        altered = copy.deepcopy(self.frozen_patch)
        box = next(item['box'] for item in altered['boxes'] if item['box']['id'] == 'md_t01_p01')
        box['parameter_enable'] = 0
        with self.assertRaisesRegex(ValueError, 'parameter_enable'):
            verify.compare_patch(altered, self.source_patch)

    def test_nested_editor_script_change_is_rejected(self):
        altered = copy.deepcopy(self.frozen_patch)
        editor = next(item['box']['patcher'] for item in altered['boxes'] if item['box']['id'] == 'editor')
        panel = next(item['box'] for item in editor['boxes'] if item['box']['id'] == 'editor_panel')
        panel['filename'] = 'different.js'
        with self.assertRaisesRegex(ValueError, 'editor_panel.*filename'):
            verify.compare_patch(altered, self.source_patch)

    def test_parameter_range_change_is_rejected(self):
        altered = copy.deepcopy(self.frozen_patch)
        box = next(item['box'] for item in altered['boxes'] if item['box']['id'] == 'md_t01_p01')
        box['saved_attribute_attributes']['valueof']['parameter_mmax'] = 100
        with self.assertRaisesRegex(ValueError, 'parameter_mmax'):
            verify.compare_patch(altered, self.source_patch)

    def test_explicit_connection_order_is_checked(self):
        source = copy.deepcopy(self.source_patch)
        actual = copy.deepcopy(self.frozen_patch)
        line = source['lines'][0]['patchline']
        line['order'] = 42
        with self.assertRaisesRegex(ValueError, 'connection order differs'):
            verify.compare_patch(actual, source)

    def test_stale_javascript_fails_before_packaging(self):
        (self.source / 'md.panel.js').write_bytes(self.payloads['md.panel.js'] + b'\n// later edit\n')
        with self.assertRaisesRegex(ValueError, 'JavaScript source differs'):
            package.require_verified_sources(self.report, self.source)

    def test_stale_patch_source_fails_before_packaging(self):
        (self.source / 'MD Drum Engine.maxpat').write_bytes(self.patch_bytes + b'\n')
        with self.assertRaisesRegex(ValueError, 'Patch source changed'):
            package.require_verified_sources(self.report, self.source)

    def test_old_report_requires_new_patch_verification(self):
        report = copy.deepcopy(self.report)
        report.pop('patch_matches_source')
        with self.assertRaisesRegex(ValueError, 'lacks verification'):
            package.require_verified_sources(report, self.source)

    def test_missing_javascript_record_is_rejected(self):
        report = copy.deepcopy(self.report)
        report['javascript'].pop()
        with self.assertRaisesRegex(ValueError, 'both expected JavaScript'):
            package.require_verified_sources(report, self.source)

    def test_thin_native_cannot_be_packaged_as_universal(self):
        with patch.object(package.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'arm64\n', '')):
            with self.assertRaisesRegex(ValueError, 'requires arm64 and x86_64'):
                package.require_universal_bundles(self.report, self.source)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', type=Path, default=package.FROZEN)
    parser.add_argument('--report', type=Path, default=package.FROZEN_REPORT)
    parser.add_argument('--source-archive', type=Path)
    OPTIONS, remaining = parser.parse_known_args()
    unittest.main(argv=[__file__] + remaining)
