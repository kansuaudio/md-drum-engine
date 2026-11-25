#!/usr/bin/env python3
"""Read-only audit of Max's ampf/ptch/mx@c frozen export against device/.

This parser describes the observed collective format in this export. It checks
chunk boundaries, every payload, the ZIP CRCs and all native bundle files without
extracting or executing any embedded content. Only --report writes a JSON report.
"""
import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NATIVE_CLASSES = ('mdcoreengine~', 'mdparameterfocus')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def be32(data, offset):
    return struct.unpack_from('>I', data, offset)[0]


def native_architectures(path):
    """Inspect a matched local Mach-O file; do not execute its code."""
    result = subprocess.run(
        ['/usr/bin/lipo', '-archs', str(path)], check=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    architectures = sorted(set(result.stdout.split()))
    require(bool(architectures), 'No Mach-O architectures reported: ' + str(path))
    return architectures


# Max writes default-valued attributes implicitly and resolves inlet/outlet
# boxes when it saves a generated patch. Compare behavior, not editor metadata.
PARAMETER_DEFAULTS = {
    'parameter_mmin': 0.0, 'parameter_mmax': 127.0,
    'parameter_invisible': 0, 'parameter_initial_enable': 0,
}
BOX_FIELDS = (
    'varname', 'filename', 'parameter_enable', 'jsarguments',
    'presentation', 'presentation_rect',
)


def box_kind(box):
    if box.get('maxclass') == 'newobj' and box.get('text') in {'inlet', 'outlet'}:
        return box['text']
    return box.get('maxclass')


def compare_patch(frozen, source, context='patcher'):
    require(frozen.get('parameters', {}) == source.get('parameters', {}),
            context + ': parameter identities or banks differ from source')
    for key in ('openinpresentation', 'latency'):
        require(frozen.get(key, 0) == source.get(key, 0),
                context + ': patch attribute differs from source: ' + key)
    expected_boxes = {item['box']['id']: item['box'] for item in source['boxes']}
    actual_boxes = {item['box']['id']: item['box'] for item in frozen['boxes']}
    require(len(actual_boxes) == len(frozen['boxes']) and len(expected_boxes) == len(source['boxes']),
            context + ': duplicate box identity')
    require(actual_boxes.keys() == expected_boxes.keys(), context + ': box identities differ from source')
    for identity, expected in expected_boxes.items():
        actual = actual_boxes[identity]
        label = context + '/' + identity
        require(box_kind(actual) == box_kind(expected), label + ': object class differs from source')
        if box_kind(expected) not in {'inlet', 'outlet'}:
            require(actual.get('text', '') == expected.get('text', ''),
                    label + ': object text differs from source')
        for key in BOX_FIELDS:
            default = [] if key == 'jsarguments' else 0 if key in {'parameter_enable', 'presentation'} else None
            require(actual.get(key, default) == expected.get(key, default),
                    label + ': object attribute differs from source: ' + key)
        expected_value = expected.get('saved_attribute_attributes', {}).get('valueof', {})
        actual_value = actual.get('saved_attribute_attributes', {}).get('valueof', {})
        for key, value in expected_value.items():
            # Max normalizes enum displays to the enum unit style when saved.
            if key == 'parameter_unitstyle' and expected_value.get('parameter_type') == 2 and value == 0:
                value = 9
            require(actual_value.get(key, PARAMETER_DEFAULTS.get(key)) == value,
                    label + ': parameter attribute differs from source: ' + key)
        require(('patcher' in actual) == ('patcher' in expected), label + ': nested patch missing')
        if 'patcher' in expected:
            compare_patch(actual['patcher'], expected['patcher'], label)
    def connections(patch):
        return Counter((tuple(item['patchline']['source']), tuple(item['patchline']['destination']))
                       for item in patch.get('lines', []))
    require(connections(frozen) == connections(source), context + ': patch connections differ from source')
    # Unspecified fan-out order is assigned by Max. Preserve explicitly declared
    # order whenever the generator supplies one.
    actual_orders = Counter((tuple(item['patchline']['source']), tuple(item['patchline']['destination']),
                             item['patchline'].get('order')) for item in frozen.get('lines', []))
    expected_orders = Counter((tuple(item['patchline']['source']), tuple(item['patchline']['destination']),
                               item['patchline']['order']) for item in source.get('lines', [])
                              if 'order' in item['patchline'])
    require(not expected_orders - actual_orders, context + ': explicit patch connection order differs from source')


def audit(path, source):
    raw = path.read_bytes()
    require(raw[:12] == b'ampf\x04\x00\x00\x00iiii', 'Unexpected device header')
    require(raw[12:16] == b'ptch', 'Missing patch chunk')
    require(struct.unpack_from('<I', raw, 16)[0] == len(raw) - 20, 'Patch chunk length mismatch')
    base = 20
    require(raw[base:base+4] == b'mx@c', 'Device is not a frozen Max collective')
    require(be32(raw, base+4) == 16 and be32(raw, base+8) == 0, 'Unexpected collective header')
    directory = base + be32(raw, base+12)
    require(raw[directory:directory+4] == b'dlst', 'Missing collective directory')
    end = directory + be32(raw, directory+4)
    require(end == len(raw), 'Unaccounted bytes after collective directory')
    at = directory + 8
    entries, payloads = [], {}
    while at < end:
        require(raw[at:at+4] == b'dire', 'Invalid directory entry')
        size = be32(raw, at+4)
        require(size >= 8 and at+size <= end, 'Invalid entry size')
        fields, field_at = {}, at+8
        while field_at < at+size:
            tag = raw[field_at:field_at+4].decode('ascii')
            field_size = be32(raw, field_at+4)
            require(field_size >= 8 and field_at+field_size <= at+size, 'Invalid directory field')
            require(tag not in fields, 'Duplicate directory field')
            fields[tag] = raw[field_at+8:field_at+field_size]
            field_at += field_size
        name = fields['fnam'].rstrip(b'\0').decode('utf-8')
        require(name not in payloads, 'Duplicate collective filename')
        offset = base + be32(fields['of32'], 0)
        length = be32(fields['sz32'], 0)
        require(base+16 <= offset <= offset+length <= directory, 'Payload outside collective data')
        payload = raw[offset:offset+length]
        payloads[name] = payload
        entries.append({'name': name, 'offset': offset, 'bytes': length, 'sha256': sha256(payload)})
        at += size
    require(at == end, 'Directory length mismatch')
    cursor = base+16
    for entry in sorted(entries, key=lambda e: e['offset']):
        require(entry['offset'] == cursor, 'Gap or overlapping payload in collective')
        cursor += entry['bytes']
    require(cursor == directory, 'Unaccounted collective payload bytes')
    expected = {'MD Drum Engine.maxpat', 'md.bridge.js', 'md.panel.js'}
    for name in NATIVE_CLASSES:
        expected.update({name+'.mxo', name+'/zipfile', name+'/executable', name+'/plist'})
    require(set(payloads) == expected, 'Unexpected or missing collective asset')
    checks = []
    for name in ['md.bridge.js', 'md.panel.js']:
        local = (source/name).read_bytes()
        require(payloads[name] == local, 'JS differs from device/: '+name)
        checks.append({'name': name, 'bytes': len(local), 'sha256': sha256(local), 'matches_source': True})
    bundle_checks, apple_metadata, archive_names, bundles = [], [], [], []
    for name in NATIVE_CLASSES:
        require(payloads[name+'.mxo'] == bytes(4), 'Unexpected external marker: '+name)
        bundle_root = source/(name+'.mxo')
        bundle_files = {str(p.relative_to(source)): p for p in bundle_root.rglob('*') if p.is_file()}
        require(bool(bundle_files), 'Missing source bundle: '+name)
        current_checks, current_metadata = [], []
        with zipfile.ZipFile(io.BytesIO(payloads[name+'/zipfile'])) as archive:
            require(archive.testzip() is None, 'Embedded bundle ZIP CRC failure: '+name)
            archive_files = [i for i in archive.infolist() if not i.is_dir()]
            require(len({i.filename for i in archive_files}) == len(archive_files),
                    'Duplicate bundle ZIP file: '+name)
            archive_names.extend(i.filename for i in archive_files)
            native_names = {i.filename for i in archive_files if not i.filename.startswith('__MACOSX/')}
            require(native_names == set(bundle_files), 'Bundle ZIP file set differs from device/: '+name)
            for item in archive_files:
                content = archive.read(item)
                record = {'name': item.filename, 'bytes': len(content), 'sha256': sha256(content)}
                if item.filename.startswith('__MACOSX/'):
                    require(Path(item.filename).name.startswith('._'), 'Unexpected ZIP auxiliary asset')
                    current_metadata.append(record)
                    continue
                require(content == bundle_files[item.filename].read_bytes(),
                        'Embedded bundle differs: '+item.filename)
                record['matches_source'] = True
                current_checks.append(record)
        executable_path = bundle_root/'Contents'/'MacOS'/name
        executable = executable_path.read_bytes()
        plist = (bundle_root/'Contents'/'Info.plist').read_bytes()
        require(payloads[name+'/executable'] == executable, 'Raw executable copy differs: '+name)
        require(payloads[name+'/plist'] == plist, 'Raw Info.plist copy differs: '+name)
        bundle_checks.extend(current_checks)
        apple_metadata.extend(current_metadata)
        bundles.append({
            'class': name, 'bundle': name+'.mxo', 'files': current_checks,
            'archive_sha256': sha256(payloads[name+'/zipfile']),
            'executable_sha256': sha256(executable), 'plist_sha256': sha256(plist),
            'architectures': native_architectures(executable_path),
            'external_marker_valid': True, 'raw_and_zip_copies_match': True,
            'zip_crc_valid': True, 'apple_double_metadata': current_metadata,
        })
    patch = json.loads(payloads['MD Drum Engine.maxpat'].rstrip(b'\0'))['patcher']
    source_patch_bytes = (source/'MD Drum Engine.maxpat').read_bytes()
    source_patch = json.loads(source_patch_bytes)['patcher']
    compare_patch(patch, source_patch)
    states = [b['box'].get('restore', []) for b in patch['boxes'] if 'pattr md_saved' in b['box'].get('text', '')]
    require(len(states) == 1 and len(states[0]) == 2 and states[0][0] == 'MDENGINESTATE1', 'Missing default saved state')
    state = json.loads(states[0][1])
    require(state.get('firmware') == '', 'Export contains a preselected firmware path')
    require(len(state.get('tracks', [])) == 16, 'Saved kit has wrong track count')
    require({d['name'] for d in patch.get('dependency_cache', [])} == ({'md.bridge.js', 'md.panel.js'} | {name+'.mxo' for name in NATIVE_CLASSES}), 'Unexpected patch dependency')
    for name in NATIVE_CLASSES:
        require(any(b['box'].get('text') == name for b in patch['boxes']), 'Patch does not use expected native class: '+name)
    firmware_names = [n for n in list(payloads)+archive_names if n.lower().endswith('.syx')]
    require(not firmware_names, 'Firmware asset is embedded')
    return {
        'status': 'PASS', 'artifact_name': path.name, 'bytes': len(raw), 'sha256': sha256(raw),
        'format': 'ampf instrument -> little-endian ptch length -> mx@c collective; big-endian dlst/dire field sizes',
        'collective_base_offset': base, 'directory_offset': directory,
        'payload_coverage_complete': True, 'entries': entries,
        'javascript': checks, 'native_bundle': bundle_checks, 'native_bundles': bundles,
        'patch_matches_source': True, 'source_patch_sha256': sha256(source_patch_bytes),
        'automatable_parameter_count': sum(bool(item['box'].get('parameter_enable')) for item in patch['boxes']),
        'native_executable_raw_and_zip_match': True, 'zip_crc_valid': True,
        'apple_double_metadata': apple_metadata, 'firmware_entry_names': firmware_names,
        'saved_firmware_path_empty': True, 'firmware_payload_embedded': False,
        'firmware_absence_basis': 'The complete collective contains only the JSON patch, byte-identical JS, the byte-identical native bundles and their raw executable/plist copies. Each ZIP has only matching bundle files and AppleDouble metadata; the patch saved firmware field is empty.',
        'extraction_layout': 'Read each entry at collective_base + of32 for sz32 bytes. Each <class>/zipfile is a standard ZIP containing the complete corresponding <class>.mxo directory; JavaScript entries are UTF-8 files. No extraction is needed for this audit.',
        'source_changes': False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('device', type=Path)
    parser.add_argument('--source', type=Path, default=ROOT/'device')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    result = audit(args.device, args.source)
    output = json.dumps(result, indent=2, ensure_ascii=False)+'\n'
    if args.report:
        args.report.write_text(output)
    print(output)


if __name__ == '__main__':
    main()
