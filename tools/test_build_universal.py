#!/usr/bin/env python3
"""Verify safe replacement of potentially mapped native bundle executables."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('universal', Path(__file__).with_name('build_universal.py'))
universal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(universal)

class SafeMerge(unittest.TestCase):
    def fixture(self, root):
        for folder in ('arm', 'intel', 'output'):
            for name in universal.CLASSES:
                exe = root / folder / (name + '.mxo') / 'Contents/MacOS' / name
                exe.parent.mkdir(parents=True)
                exe.write_bytes(folder.encode())
        return [root / x for x in ('arm', 'intel', 'output')]

    @staticmethod
    def fake_tools(*args):
        args = [str(a) for a in args]
        if '-create' in args:
            Path(args[-1]).write_bytes(Path(args[2]).read_bytes() + Path(args[3]).read_bytes())

    def test_replacement_preserves_old_open_inode_and_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); arm, intel, output = self.fixture(root)
            exe = output / (universal.CLASSES[0] + '.mxo') / 'Contents/MacOS' / universal.CLASSES[0]
            inode = exe.stat().st_ino
            with exe.open('rb') as mapped, patch.object(universal, 'run', self.fake_tools):
                universal.merge(arm, intel, output)
                self.assertEqual(mapped.read(), b'output')
                self.assertEqual(exe.read_bytes(), b'armintel')
                self.assertNotEqual(exe.stat().st_ino, inode)
                backups = list(root.glob('native-before-*'))
                self.assertEqual(len(backups), 1)
                saved = backups[0] / exe.relative_to(output)
                self.assertEqual(saved.stat().st_ino, inode)
                for cls in universal.CLASSES:
                    self.assertEqual((backups[0] / (cls + '.mxo') / 'Contents/MacOS' / cls).read_bytes(), b'output')

    def test_bad_second_staged_bundle_changes_neither_destination(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); arm, intel, output = self.fixture(root)
            def reject(*args):
                if '--force' in args and str(args[-1]).endswith('mdparameterfocus.mxo'):
                    raise RuntimeError('simulated code-sign failure')
                self.fake_tools(*args)
            with patch.object(universal, 'run', reject), self.assertRaises(RuntimeError):
                universal.merge(arm, intel, output)
            for cls in universal.CLASSES:
                self.assertEqual((output / (cls + '.mxo') / 'Contents/MacOS' / cls).read_bytes(), b'output')
            self.assertEqual(list(root.glob('native-before-*')), [])

    def test_second_install_failure_restores_both_original_bundles(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); arm, intel, output = self.fixture(root)
            original_rename = Path.rename
            inodes = {(output / (cls + '.mxo') / 'Contents/MacOS' / cls):
                      (output / (cls + '.mxo') / 'Contents/MacOS' / cls).stat().st_ino
                      for cls in universal.CLASSES}
            def fail_second_install(source, destination):
                if source.parent.name.startswith('.md-native-stage-') and source.name == 'mdparameterfocus.mxo':
                    raise OSError('simulated second installation failure')
                return original_rename(source, destination)
            with patch.object(universal, 'run', self.fake_tools), patch.object(Path, 'rename', fail_second_install), self.assertRaises(OSError):
                universal.merge(arm, intel, output)
            for exe, inode in inodes.items():
                self.assertEqual(exe.read_bytes(), b'output')
                self.assertEqual(exe.stat().st_ino, inode)

if __name__ == '__main__':
    unittest.main()
