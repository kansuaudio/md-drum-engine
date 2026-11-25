#!/usr/bin/env python3
"""Render kits/notes through the real engine (build-*/render-script) and measure them."""
import json, os, subprocess, tempfile, wave
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RENDER = ROOT / 'build-arm64' / 'render-script'
FIRMWARE = os.environ.get('MD_OS_SYX', str(Path.home() / 'Downloads/Elektron_SPS1-1UW_OS1.63 (1)/Elektron_SPS1-1UW_OS1.63.syx'))
CATALOG = {m['name']: m for m in json.load(open(ROOT / 'artifacts/machine-catalog.json'))}
FX = ['AMD', 'AMF', 'EQF', 'EQG', 'FLTF', 'FLTW', 'FLTQ', 'SRR']
ROUTE = ['DIST', 'VOL', 'PAN', 'DEL', 'REV', 'LFOS', 'LFOD', 'LFOM']
FX_DEFAULT = [0, 0, 64, 64, 0, 127, 0, 0]
ROUTE_DEFAULT = [0, 100, 64, 0, 0, 64, 0, 0]
MASTER_KEYS = ['reverb', 'echo', 'eq', 'dynamics']
MASTER_LABELS = [['DVOL','PRED','DEC','DAMP','HP','LP','GATE','LEV'], ['TIME','MOD','MFRQ','FB','FLTF','FLTW','MONO','LEV'],
                 ['LF','LG','HF','HG','PF','PG','PQ','GAIN'], ['ATCK','REL','TRHD','RTIO','KNEE','HP','OUTG','MIX']]
MASTER_DEFAULT = [[0,0,64,64,0,127,127,127],[24,0,0,32,0,127,0,127],[64]*8,[0,64,127,0,0,0,64,0]]
SR = 44100


def track(machine, **values):
    """A track from a machine name and named values (SYN labels, FX, ROUTE, lfo=[...])."""
    m = CATALOG[machine]
    params = list(m['defaults']) + FX_DEFAULT + ROUTE_DEFAULT
    lfo = values.pop('lfo', None)
    for name, v in values.items():
        if name in m['labels'] and name:
            params[m['labels'].index(name)] = v
        elif name in FX:
            params[8 + FX.index(name)] = v
        elif name in ROUTE:
            params[16 + ROUTE.index(name)] = v
        else:
            raise KeyError(f'{machine} has no parameter {name}')
    return {'machine': machine, 'id': m['id'], 'params': [int(x) for x in params], 'lfo': lfo}


def master(**groups):
    out = [list(g) for g in MASTER_DEFAULT]
    for key, values in groups.items():
        g = MASTER_KEYS.index(key)
        for name, v in values.items():
            out[g][MASTER_LABELS[g].index(name)] = v
    return out


def script(tracks, master_fx, notes, length, bpm=130):
    lines = [f'tempo {bpm}']
    for t, tr in enumerate(tracks):
        if tr is None:
            continue
        lines.append(f"machine {t} {tr['id']}")
        for k, v in enumerate(tr['params']):
            lines.append(f'param {t} {k} {v}')
        for k, v in enumerate(tr['lfo'] or [t, 0, 0, 0, 0]):
            lines.append(f'lfo {t} {k} {v}')
    for g in range(4):
        for k in range(8):
            lines.append(f'master {g} {k} {master_fx[g][k]}')
    for at, t, vel in notes:
        lines.append(f'note {int(at)} {t} {vel}')
    lines.append(f'length {int(length)}')
    return '\n'.join(lines) + '\n'


def read_wav(path):
    with wave.open(str(path)) as w:
        raw = w.readframes(w.getnframes())
    b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
    x = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
    x = np.where(x & 0x800000, x - 0x1000000, x) / 8388608.0
    return x.reshape(-1, 2)


def render(tracks, notes, seconds=2.0, master_fx=None, bpm=130, out=None):
    master_fx = master_fx or MASTER_DEFAULT
    with tempfile.TemporaryDirectory() as tmp:
        s = Path(tmp) / 's.txt'
        s.write_text(script(tracks, master_fx, notes, seconds * SR, bpm))
        wav = Path(out) if out else Path(tmp) / 'o.wav'
        r = subprocess.run([str(RENDER), FIRMWARE, str(s), str(wav)], capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(r.stderr[-500:])
        return read_wav(wav)


def analyse(x):
    """Peak, RMS, low fundamental (Hz, 40-260 ms window), centroid, -40 dB length."""
    mono = x.mean(axis=1)
    peak = float(np.abs(x).max())
    rms = float(np.sqrt((x ** 2).mean()))
    seg = mono[int(0.04 * SR):int(0.26 * SR)]
    if len(seg) > 0 and np.abs(seg).max() > 1e-5:
        spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n=1 << 16))
        freqs = np.fft.rfftfreq(1 << 16, 1 / SR)
        band = (freqs > 25) & (freqs < 400)
        f0 = float(freqs[band][np.argmax(spec[band])])
    else:
        f0 = 0.0
    full = np.abs(np.fft.rfft(mono[:int(0.5 * SR)]))
    freqs = np.fft.rfftfreq(len(mono[:int(0.5 * SR)]), 1 / SR)
    centroid = float((full * freqs).sum() / max(full.sum(), 1e-12))
    env = np.abs(mono)
    idx = np.nonzero(env > peak * 0.01)[0]
    length = float(idx[-1] / SR) if len(idx) else 0.0
    return {'peak': round(peak, 3), 'rms': round(rms, 4), 'f0': round(f0, 1), 'centroid': int(centroid), 'len': round(length, 3)}


def hit(tr, velocity=110, seconds=1.5, master_fx=None):
    tracks = [tr] + [None] * 15
    return analyse(render(tracks, [(0, 0, velocity)], seconds, master_fx))


if __name__ == '__main__':
    import time
    t = time.time()
    print(hit(track('EFM-BD')), round(time.time() - t, 2), 's')
