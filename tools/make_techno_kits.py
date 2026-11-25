#!/usr/bin/env python3
"""Techno kits for MD Drum Engine: .mdkit + 4-bar .mid groove + rendered demo.

Track layout shared by every kit (MIDI note = 36 + track index):
 01 kick  02 kick layer/sub/rumble  03 clap  04 snare/rim  05 closed hat
 06 open hat  07 ride/cymbal  08 shaker/noise  09 perc A  10 perc B
 11 low tom/conga  12 high tom/conga  13 bass root  14 bass/stab 2nd note
 15 crash/impact  16 tick
Kicks marked R1/R2 use published Elektronauts values, credited in
presets/techno/README.md; everything else follows the recurring techniques from
the same threads and was tuned and levelled by measuring renders of the real
engine (tools/preset_lab.py).
"""
import json, struct, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from preset_lab import track, master, render, analyse, SR, MASTER_KEYS
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'presets' / 'techno'
PPQ = 96
TARGET_RMS_DB = -14.0
STEP = PPQ // 4

# Single-hit peak targets per role (pre Output gain); VOL is set from a render.
ROLE_PEAK = {0: .75, 1: .35, 2: .45, 3: .38, 4: .20, 5: .24, 6: .17, 7: .14, 8: .30, 9: .28,
             10: .38, 11: .32, 12: .50, 13: .34, 14: .28, 15: .18}
LFO_OFF = None


def lfo(dest, param, shape1=0, shape2=0, mode=0):
    return [dest, param, shape1, shape2, mode]

# ---------------------------------------------------------------- patterns
# One string per bar (or one string for all 4 bars). X=127 x=100 o=70 g=45 .=rest


def bars(*b):
    orig = list(b) or ['.' * 16]
    out = list(orig)
    while len(out) < 4:
        out.append(orig[len(out) % len(orig)])
    return out[:4]

FOUR = bars('X...X...X...X...')
OFF_HAT = bars('..x...x...x...x.')
SIXTEENTHS = bars('xoxoxoxoxoxoxoxo')
VEL = {'X': 127, 'x': 100, 'o': 70, 'g': 45}

# ---------------------------------------------------------------- kits
KITS = []


def kit(name, bpm, style, tracks, patterns, master_fx=None, swing=50, notes=''):
    KITS.append(dict(name=name, bpm=bpm, style=style, tracks=tracks, patterns=patterns,
                     master=master_fx or master(), swing=swing, notes=notes))

# 1 — R1 exact (TrabanT 2015): layered with a short higher kick, toms low/mid/high.
kit('01 Warehouse Heavy', 132, 'heavy warehouse techno', {
    0: track('EFM-BD', PTCH=20, DEC=100, RAMP=22, RDEC=105, EQF=12, EQG=45, FLTF=21, FLTW=57, FLTQ=84),
    1: track('EFM-BD', PTCH=44, DEC=22, RAMP=40, RDEC=40, MOD=30, FLTF=40, FLTW=87),
    2: track('TRX-CP', CLPY=70, TONE=58, HARD=110, RICH=80, ROOM=40, RSIZ=50, REV=40),
    4: track('TRX-CH', GAP=20, DEC=18, HPF=70, LPF=127, MTAL=0),
    5: track('TRX-OH', GAP=40, DEC=44, HPF=70, LPF=127, MTAL=0),
    6: track('TRX-CY', RICH=40, DEC=60, TOP=80, SIZE=50),
    10: track('P-I-MT', PTCH=12, DEC=40),
    11: track('P-I-MT', PTCH=34, DEC=36),
    15: track('GND-IM', UP=20, DOWN=10),
}, {0: FOUR, 1: FOUR, 2: bars('....X.......X...'), 4: OFF_HAT,
    5: bars('..............x.', '..............x.', '..............x.', '......x.......x.'),
    6: bars('x.o.x.o.x.o.x.o.'),
    10: bars('...........o....', '......o.......o.', '...........o....', '..o.....o..o....'),
    11: bars('.......o........', '...o..........o.', '.......o........', '.....o.......o.o'),
    15: FOUR},
    master(reverb={'DEC': 50, 'GATE': 90, 'LP': 90}), notes='Kick = TrabanT R1 exact; 2nd short kick layered on top as in R1.')

# 2 — R2 exact set A (ozon 2020): deep FM kick.
kit('02 Deep FM', 126, 'deep / dub-leaning techno', {
    0: track('EFM-BD', PTCH=24, DEC=87, RAMP=72, RDEC=30, MOD=111, MDEC=28, FLTW=68),
    1: track('GND-SN', PTCH=3, DEC=70),
    3: track('EFM-RS', PTCH=70, DEC=24, MOD=40, SNAR=40, REV=50, DEL=30),
    4: track('EFM-HH', PTCH=100, DEC=18, MOD=70, MFRQ=90),
    5: track('EFM-HH', PTCH=100, DEC=56, MOD=70, MFRQ=90),
    7: track('GND-NS', DEC=34, FLTF=90, FLTW=37),
    8: track('EFM-CB', PTCH=40, DEC=40, MOD=30, DEL=80, REV=40),
    12: track('GND-SN', PTCH=19, DEC=40, AMD=40, AMF=60, DEL=40),
}, {0: FOUR, 1: FOUR, 3: bars('......x.......o.', '......x.........', '......x.......o.', '......x...o.....'),
    4: bars('x.o.x.o.x.o.x.o.'), 5: OFF_HAT, 7: bars('.o.o.o.o.o.o.o.o'),
    8: bars('...x.......x....', '...x............', '...x.......x....', '...x......x.....'),
    12: bars('..x.....x.....x.', '..x...........x.')},
    master(echo={'TIME': 24, 'FB': 60, 'FLTF': 20, 'FLTW': 80, 'LEV': 110}, reverb={'DEC': 90, 'LP': 80, 'LEV': 100}),
    notes='Kick = ozon R2 set A exact (MOD 111 was his own estimate); GND-SN sub layer (R12) on G1.')

# 3 — rumble: kick copy into gated reverb (R9) with a dark track filter.
kit('03 Rumble Machine', 134, 'rumble techno', {
    0: track('TRX-BD', PTCH=40, DEC=60, RAMP=30, RDEC=40, STRT=20, CLIP=30),
    1: track('TRX-BD', PTCH=38, DEC=110, RAMP=10, FLTW=30, DIST=40, REV=127, VOL=70),
    2: track('EFM-CP', PTCH=80, DEC=44, REV=40),
    4: track('TRX-CH', GAP=16, DEC=14, HPF=76, LPF=127, MTAL=0),
    6: track('TRX-CY', RICH=50, DEC=50, TOP=90, SIZE=40),
    8: track('TRX-XC', PTCH=70, DEC=30, DIST=20, DEL=40),
    15: track('GND-IM', UP=30, DOWN=10),
}, {0: FOUR, 1: bars('..x...x...x...x.'), 2: bars('....X.......X...'), 4: SIXTEENTHS,
    6: bars('..x...x...x...x.'), 8: bars('.....x.........x', '.....x..x.......'), 15: FOUR},
    master(reverb={'DEC': 100, 'DAMP': 90, 'HP': 0, 'LP': 40, 'GATE': 70, 'LEV': 127}, dynamics={'TRHD': 100, 'RTIO': 40, 'MIX': 60}),
    notes='Rumble: offbeat kick copy (T02) sent fully to a dark gated reverb (R9 + common rumble practice).')

# 4 — Detroit 909-ish with TRX machines and R6 hats.
kit('04 Detroit Drive', 128, 'Detroit / 909-style techno', {
    0: track('TRX-BD', PTCH=42, DEC=52, RAMP=40, RDEC=36, STRT=30),
    2: track('TRX-CP', CLPY=64, TONE=64, HARD=127, RICH=64, ROOM=20, RSIZ=30, REV=30),
    3: track('TRX-RS', PTCH=70, DEC=24),
    4: track('TRX-CH', GAP=24, DEC=22, HPF=70, LPF=127, MTAL=0),
    5: track('TRX-OH', GAP=50, DEC=50, HPF=70, LPF=127, MTAL=0),
    6: track('TRX-CY', RICH=64, DEC=70, TOP=100, TTUN=70, SIZE=60),
    10: track('TRX-XT', PTCH=40, DEC=50, DAMP=60),
    11: track('TRX-XT', PTCH=70, DEC=44, DAMP=60),
}, {0: FOUR, 2: bars('....X.......X...'), 3: bars('.......o......o.', '..o....o........'),
    4: bars('X.x.X.x.X.x.X.xo'), 5: OFF_HAT, 6: bars('x...x...x...x...'),
    10: bars('........', '..........o.....', '', '.......o.....o..'),
    11: bars('.............o..', '', '.............o..', '...........o..o.')},
    master(reverb={'DEC': 50, 'LP': 100}), swing=54, notes='Hats follow R6 (MTAL 0, LPF 127, HPF just past centre).')

# 5 — minimal: short EFM/P-I percussion, clicks.
kit('05 Minimal Click', 125, 'minimal techno', {
    0: track('EFM-BD', PTCH=22, DEC=60, RAMP=50, RDEC=50, MOD=0, FLTW=100),
    3: track('EFM-RS', PTCH=90, DEC=14, MOD=60, HPF=60),
    4: track('P-I-HH', PTCH=80, DEC=20, CLSN=110),
    7: track('GND-NS', DEC=30, FLTF=100, FLTW=27),
    8: track('P-I-RS', PTCH=96, DEC=30, HARD=90),
    9: track('EFM-XT', PTCH=60, DEC=24, MOD=30, CLIC=100),
    13: track('E12-RS', PTCH=72, DEC=40, DEL=50),
    15: track('GND-IM', UP=10, DOWN=4),
}, {0: FOUR, 3: bars('.......x.....o..', '...o...x........'), 4: OFF_HAT, 7: bars('.ooo.ooo.ooo.ooo'),
    8: bars('..........x.....', '..x.......x.....'), 9: bars('.....o.........o', '.....o....o.....'),
    13: bars('...........x....', '', '...........x....', '.......x.......x'), 15: bars('x.g.x.g.x.g.x.g.')},
    master(echo={'TIME': 24, 'FB': 50, 'LEV': 100}), swing=56)

# 6 — dub chamber: echoing stabs and reverb (R19 GND layers for the chord feel).
kit('06 Dub Chamber', 120, 'dub techno', {
    0: track('TRX-BD', PTCH=36, DEC=70, RAMP=20, RDEC=30),
    1: track('GND-SN', PTCH=3, DEC=60),
    3: track('TRX-RS', PTCH=60, DEC=30, DEL=60, REV=50),
    4: track('TRX-CH', GAP=30, DEC=26, HPF=80, LPF=100, MTAL=0),
    7: track('GND-NS', DEC=36, FLTF=80, FLTW=47, REV=40),
    12: track('GND-SN', PTCH=35, DEC=40, AMD=50, AMF=80, FLTF=10, FLTW=60, DEL=80, REV=50),
    13: track('GND-SN', PTCH=44, DEC=40, AMD=50, AMF=80, FLTF=10, FLTW=60, DEL=80, REV=50),
}, {0: FOUR, 1: FOUR, 3: bars('............x...', '............x..o'), 4: OFF_HAT, 7: bars('.o.o.o.o.o.o.o.o'),
    12: bars('...x......x.....', '...x............'), 13: bars('...x......x.....', '...x............')},
    master(echo={'TIME': 24, 'FB': 72, 'FLTF': 30, 'FLTW': 60, 'LEV': 100}, reverb={'DEC': 110, 'LP': 70, 'LEV': 100}),
    notes='Stab = two AM-modulated GND-SN voices (G2 + D3) into Rhythm Echo (dotted 8th) and reverb (R19).')

# 7 — hypnotic: LFO on hat decay (R15) and a 16th echo.
kit('07 Hypnotic Loop', 130, 'hypnotic techno', {
    0: track('EFM-BD', PTCH=18, DEC=80, RAMP=30, RDEC=80, MOD=20, FLTW=110),
    1: track('GND-SN', PTCH=3, DEC=60),
    4: track('TRX-CH', GAP=20, DEC=30, HPF=72, LPF=127, MTAL=0, LFOS=24, LFOD=60, lfo=lfo(4, 1, 0, 0, 0)),
    6: track('TRX-CY', RICH=30, DEC=40, TOP=70, SIZE=30),
    8: track('EFM-CB', PTCH=30, DEC=30, MOD=50, DEL=70),
    9: track('EFM-RS', PTCH=60, DEC=20, SNAR=30, DEL=50),
    12: track('E12-BD', STRT=0, RTRG=127, RTIM=25, DEC=50, FLTW=80, VOL=70),
}, {0: FOUR, 1: FOUR, 4: SIXTEENTHS, 6: bars('..x...x...x...x.'),
    8: bars('x..x..x..x..x...'), 9: bars('......x.......x.', '......x...x.....'),
    12: bars('..x..x....x..x..')},
    master(echo={'TIME': 8, 'FB': 50, 'LEV': 90}),
    notes='Hat decay moved by a free triangle LFO (R15); bass = E12 retrig buzz (R8) on G2-ish.')

# 8 — industrial: B2 + gnarl layer with DIST and SRR (R7), bit-crush, driven compressor.
kit('08 Industrial Grind', 136, 'industrial techno', {
    0: track('TRX-B2', PTCH=50, DEC=70, RAMP=96, HOLD=64, TICK=20, DIST=40),
    1: track('TRX-B2', PTCH=50, DEC=40, NOIS=60, FLTF=50, FLTW=77, SRR=20, DIST=30),
    2: track('E12-BC', PTCH=60, DEC=60, BC=90, REV=30),
    3: track('EFM-SD', PTCH=40, DEC=40, NOIS=90, NDEC=40, SRR=30, DIST=50),
    4: track('E12-CH', PTCH=70, DEC=30, HP=60, SRR=15),
    5: track('E12-OH', PTCH=70, DEC=60, HP=60, STOP=60, SRR=15),
    8: track('TRX-XC', PTCH=40, DEC=40, DIST=70, DTYP=100),
    14: track('E12-CC', PTCH=40, DEC=90, HP=30, SRR=40, REV=60),
}, {0: FOUR, 1: FOUR, 2: bars('....x.......x...', '....x.......x..o'), 3: bars('.......o.....x..', '..o....o.......x'),
    4: SIXTEENTHS, 5: OFF_HAT, 8: bars('.x.....x..x.....', '.x..x......x....'), 14: bars('X...............', '', '', '')},
    master(dynamics={'TRHD': 110, 'RTIO': 60, 'OUTG': 90, 'MIX': 80}, reverb={'DEC': 70, 'GATE': 60, 'LP': 60}),
    notes='Kick = TRX-B2 body + filtered noisy B2 layer with DIST and a little SRR (R7).')

# 9 — acid-ish buzz bass from E12 retrig (R8), two notes on two tracks.
kit('09 Acid Buzz', 128, 'acid techno', {
    0: track('TRX-BD', PTCH=42, DEC=56, RAMP=40, RDEC=30, STRT=20),
    2: track('TRX-CP', CLPY=60, HARD=110, ROOM=30, REV=30),
    4: track('TRX-CH', GAP=20, DEC=18, HPF=72, LPF=127, MTAL=0),
    5: track('TRX-OH', GAP=44, DEC=44, HPF=72, LPF=127, MTAL=0),
    12: track('E12-BD', STRT=0, RTRG=127, RTIM=33, DEC=40, FLTF=10, FLTW=60, FLTQ=90, LFOS=40, LFOD=70, lfo=lfo(12, 12, 0, 0, 1)),
    13: track('E12-BD', STRT=0, RTRG=127, RTIM=17, DEC=30, FLTF=20, FLTW=60, FLTQ=90, DEL=30),
}, {0: FOUR, 2: bars('....X.......X...'), 4: OFF_HAT, 5: bars('..............x.'),
    12: bars('x.xx..x.x..x.x..', 'x.x..xx.x.x...x.'), 13: bars('...x.......x....', '.......x.....x..')},
    master(echo={'TIME': 12, 'FB': 40, 'LEV': 80}),
    notes='Bass = E12-BD retrig buzz (R8): RTIM 33 ≈ C2, RTIM 17 ≈ B2; resonant track filter, trig LFO on FLTF.')

# 10 — hard groove: toms, congas, rim, shaker, swing.
kit('10 Hard Groove', 138, 'hard groove / tribal techno', {
    0: track('EFM-BD', PTCH=22, DEC=70, RAMP=40, RDEC=60, MOD=10, FLTW=110),
    2: track('EFM-CP', PTCH=84, DEC=40, REV=30),
    3: track('TRX-RS', PTCH=80, DEC=20),
    4: track('TRX-CH', GAP=20, DEC=16, HPF=74, LPF=127, MTAL=0),
    6: track('TRX-CY', RICH=70, DEC=40, TOP=110, SIZE=40),
    7: track('TRX-MA', ATT=10, SUS=10, RATL=90),
    10: track('P-I-MT', PTCH=20, DEC=40, HARD=110),
    11: track('P-I-MT', PTCH=44, DEC=36, HARD=110),
    9: track('P-I-ML', PTCH=70, DEC=40),
}, {0: FOUR, 2: bars('....x.......x...'), 3: bars('..o..o....o..o..', '..o..o.o..o.....'),
    4: bars('x.x.x.x.x.x.x.x.'), 6: bars('..x...x...x...x.'), 7: SIXTEENTHS,
    10: bars('...o..o.....o...', '...o.....o..o..o'), 11: bars('.o.....o.o......', '.o......o..o.o..'),
    9: bars('......o.......o.', '..o...o.........')},
    master(reverb={'DEC': 40, 'GATE': 80, 'LP': 90}), swing=56)

# 11 — peak time: FM kick + sine sub (R12), big clap in reverb.
kit('11 Peak Time', 134, 'peak-time techno', {
    0: track('EFM-BD', PTCH=19, DEC=74, RAMP=56, RDEC=70, MOD=12, FLTW=110),
    1: track('GND-SN', PTCH=3, DEC=64),
    2: track('TRX-CP', CLPY=80, TONE=70, HARD=127, RICH=90, ROOM=60, RSIZ=70, REV=80),
    4: track('TRX-CH', GAP=20, DEC=20, HPF=72, LPF=127, MTAL=0),
    5: track('TRX-OH', GAP=50, DEC=50, HPF=72, LPF=127, MTAL=0),
    6: track('TRX-CY', RICH=64, DEC=80, TOP=100, SIZE=70),
    14: track('TRX-CY', RICH=90, DEC=120, TOP=60, SIZE=110, REV=60),
    15: track('GND-IM', UP=24, DOWN=10),
}, {0: FOUR, 1: FOUR, 2: bars('....X.......X...'), 4: bars('x.x.x.x.x.x.x.x.'), 5: OFF_HAT,
    6: bars('x...x...x...x...'), 14: bars('X...............', '', '', ''), 15: FOUR},
    master(reverb={'DEC': 80, 'LP': 90, 'LEV': 110}, dynamics={'TRHD': 100, 'RTIO': 30, 'OUTG': 80, 'MIX': 70}),
    notes='Kick + GND-SN sub on G1 (R12), GND-IM tick linked on every kick (R5/R11).')

# 12 — lo-fi broken: SRR and bit-crush, syncopated kick.
kit('12 Lo-Fi Broken', 124, 'lo-fi broken techno', {
    0: track('E12-BD', PTCH=64, DEC=80, SRR=25, DIST=30),
    2: track('E12-SD', PTCH=60, DEC=60, HP=20, SRR=30),
    4: track('E12-CH', PTCH=80, DEC=24, HP=60, SRR=20),
    5: track('E12-OH', PTCH=80, DEC=50, HP=60, STOP=70, SRR=20),
    8: track('E12-BC', PTCH=70, DEC=40, BC=70),
    12: track('E12-SH', PTCH=64, DEC=30, SLEW=60),
}, {0: bars('X.....x...X.....', 'X.....x.......x.'), 2: bars('....x.......x...', '....x.....o.x...'),
    4: bars('x.o.x.o.x.o.x.o.'), 5: bars('......x.......x.'), 8: bars('...o......o.....', '.o.....o..o....o'),
    12: SIXTEENTHS},
    master(reverb={'DEC': 50, 'LP': 70}), swing=55)

# 13 — ambient pulse: GND drones with AM (R19), soft kick, long reverb.
kit('13 Ambient Pulse', 118, 'ambient techno', {
    0: track('TRX-BD', PTCH=36, DEC=80, RAMP=10, RDEC=30, FLTW=90),
    1: track('GND-SN', PTCH=3, DEC=90),
    4: track('GND-NS', DEC=32, FLTF=100, FLTW=27, REV=40),
    12: track('GND-SN', PTCH=19, DEC=120, AMD=60, AMF=70, DEL=60, REV=110, LFOS=10, LFOD=40, lfo=lfo(12, 9, 0, 0, 0)),
    13: track('GND-SN', PTCH=28, DEC=120, AMD=60, AMF=74, PAN=40, DEL=60, REV=110),
    9: track('EFM-RS', PTCH=50, DEC=30, DEL=90, REV=80),
}, {0: FOUR, 1: FOUR, 4: bars('.o.o.o.o.o.o.o.o'), 12: bars('x...............', '', 'x.......', ''),
    13: bars('', 'x...............', '', '........x.......'), 9: bars('..........o.....', '......o.........')},
    master(reverb={'DEC': 120, 'DAMP': 50, 'LP': 80, 'LEV': 100}, echo={'TIME': 48, 'FB': 64, 'LEV': 100}),
    notes='Pads = long AM GND-SN drones with a slow LFO on AMF (R19).')

# 14 — electro steel: B2 808-ish kick (R5 approx), clave, FM hats.
kit('14 Electro Steel', 130, 'electro-techno', {
    0: track('TRX-B2', PTCH=44, DEC=62, RAMP=62, HOLD=62, TICK=6, NOIS=4, DIRT=6, DIST=2),
    1: track('GND-IM', UP=20, DOWN=6),
    2: track('TRX-SD', PTCH=70, DEC=40, SNAP=90, TONE=50),
    4: track('EFM-HH', PTCH=110, DEC=14, MOD=80),
    5: track('EFM-HH', PTCH=110, DEC=50, MOD=80),
    8: track('TRX-CL', PTCH=70, DEC=30),
    9: track('TRX-CB', PTCH=64, DEC=40),
}, {0: bars('X.....x...X.....', 'X.....x...X...x.'), 1: bars('X.....x...X.....', 'X.....x...X...x.'),
    2: bars('....x.......x...'), 4: SIXTEENTHS, 5: bars('......x.......x.'),
    8: bars('...x..x....x....', '...x..x.......x.'), 9: bars('..........x.....', '', '..........x.....', '.......x........')},
    master(reverb={'DEC': 40, 'LP': 100}), notes='Kick = TRX-B2 per R5: pitch in the 40s, upper page low 60s, lower page single digits; GND-IM linked.')

# 15 — schranz pressure: fast, distorted, relentless hats.
kit('15 Schranz Pressure', 150, 'schranz / hard techno', {
    0: track('TRX-B2', PTCH=52, DEC=60, RAMP=100, HOLD=50, TICK=40, DIRT=40, DIST=70),
    1: track('EFM-BD', PTCH=50, DEC=20, MOD=60, FLTF=50, FLTW=77, DIST=60),
    2: track('EFM-CP', PTCH=90, DEC=30, DIST=40),
    4: track('TRX-CH', GAP=10, DEC=12, HPF=80, LPF=127, MTAL=40),
    5: track('TRX-OH', GAP=30, DEC=30, HPF=80, LPF=127, MTAL=40),
    8: track('EFM-CB', PTCH=20, DEC=20, MOD=90, DIST=50),
    10: track('P-I-MT', PTCH=16, DEC=30, HARD=127, DIST=30),
}, {0: FOUR, 1: FOUR, 2: bars('....x.......x...'), 4: bars('xxxxxxxxxxxxxxxx'), 5: OFF_HAT,
    8: bars('.x.x.x.x.x.x.x.x'), 10: bars('......o.......o.', '..o...o...o.....')},
    master(dynamics={'TRHD': 105, 'RTIO': 70, 'OUTG': 90, 'MIX': 80}, eq={'LG': 72}),
    notes='Grit by DIST and a driven Dynamix (common MD hard-techno practice).')

# 16 — raw jam: physical-model kit (P-I) with toms (R1 tom idea).
kit('16 Raw Jam', 135, 'raw jam techno', {
    0: track('P-I-BD', PTCH=40, DEC=50, HARD=100, HAMR=90, TENS=30, DAMP=100),
    1: track('GND-SN', PTCH=3, DEC=60),
    2: track('P-I-SD', PTCH=60, DEC=50, HARD=90, RING=20),
    4: track('P-I-HH', PTCH=90, DEC=24, CLSN=110),
    5: track('P-I-HH', PTCH=90, DEC=60, CLSN=40),
    6: track('P-I-RC', PTCH=70, DEC=70),
    10: track('P-I-MT', PTCH=14, DEC=40),
    11: track('P-I-MT', PTCH=30, DEC=36),
    9: track('P-I-MT', PTCH=48, DEC=30),
}, {0: FOUR, 1: FOUR, 2: bars('....x.......x...'), 4: OFF_HAT, 5: bars('..............x.'),
    6: bars('x.o.x.o.x.o.x.o.'), 10: bars('..o.....o.......', '..o.......o..o..'),
    11: bars('.....o.........o', '.....o....o.....'), 9: bars('.......o........', '...o...o.....o..')},
    master(reverb={'DEC': 50, 'GATE': 90, 'LP': 90}), notes='Toms on three tracks: 2 low, 3 mid, 2 high pitches as in R1.')

# ---------------------------------------------------------------- output


def note_events(k, bars_count=4):
    swing_ticks = round((k['swing'] - 50) / 50 * STEP)
    events = []
    for t, pattern in k['patterns'].items():
        for b, bar in enumerate(pattern[:bars_count]):
            for s, ch in enumerate(bar.ljust(16, '.')[:16]):
                if ch in VEL:
                    tick = (b * 16 + s) * STEP + (swing_ticks if s % 2 else 0)
                    events.append((tick, t, VEL[ch]))
    return sorted(events)


def write_mid(path, events, bpm, total_ticks):
    msgs = []
    for tick, t, vel in events:
        msgs.append((tick, 0x90, 36 + t, vel))
        msgs.append((tick + STEP // 2, 0x80, 36 + t, 0))
    msgs.sort(key=lambda m: (m[0], m[1] == 0x90))
    data = b'\x00\xff\x51\x03' + int(60_000_000 / bpm).to_bytes(3, 'big') + b'\x00\xff\x58\x04\x04\x02\x18\x08'
    last = 0

    def vlq(x):
        out = [x & 0x7f]; x >>= 7
        while x:
            out.insert(0, (x & 0x7f) | 0x80); x >>= 7
        return bytes(out)
    for tick, status, note, vel in msgs:
        data += vlq(tick - last) + bytes([status, note, vel]); last = tick
    data += vlq(max(0, total_ticks - last)) + b'\xff\x2f\x00'
    path.write_bytes(b'MThd' + struct.pack('>IHHH', 6, 0, 1, PPQ) + b'MTrk' + struct.pack('>I', len(data)) + data)


def kit_tracks(k):
    from preset_lab import CATALOG
    default = [track('GND-SN', DEC=0, VOL=0) for _ in range(16)]
    tracks = []
    for t in range(16):
        tr = k['tracks'].get(t, default[t])
        tr = dict(tr)
        tr['lfo'] = tr.get('lfo') or [t, 0, 0, 0, 0]
        tracks.append(tr)
    return tracks


def mdkit_text(k, tracks):
    lines = ['{', '  "format": "MD Drum Engine kit",', '  "version": 1,', '  "name": ' + json.dumps(k['name'][3:]) + ',',
             '  "style": ' + json.dumps(k['style']) + ',', '  "bpm": ' + str(k['bpm']) + ',', '  "notes": ' + json.dumps(k['notes']) + ',', '  "tracks": [']
    for t, tr in enumerate(tracks):
        row = {'track': t + 1, 'machine': tr['machine'], 'id': tr['id'], 'params': tr['params'], 'lfo': tr['lfo']}
        lines.append('    ' + json.dumps(row, separators=(',', ':')) + (',' if t < 15 else ''))
    lines += ['  ],', '  "master": {']
    for g in range(4):
        lines.append('    ' + json.dumps(MASTER_KEYS[g]) + ': ' + json.dumps(k['master'][g]) + (',' if g < 3 else ''))
    lines += ['  }', '}']
    return '\n'.join(lines) + '\n'


def samples_per_tick(bpm):
    return SR * 60 / bpm / PPQ


def level(k, tracks):
    """Set each used track's VOL so a single hit reaches its role's peak target."""
    report = {}
    for t in k['tracks']:
        tr = tracks[t]
        for _ in range(3):
            solo = [None] * 16; solo[t] = tr
            a = analyse(render(solo, [(SR // 2, t, 110)], 2.5, k['master'], k['bpm'])[SR // 2:])
            if a['peak'] < 1e-4:
                raise RuntimeError(f"{k['name']} T{t+1} {tr['machine']} is silent")
            vol = tr['params'][17]
            want = vol * (ROLE_PEAK[t] / a['peak']) ** 0.5  # amplitude ~ VOL^2
            tr['params'][17] = int(max(8, min(127, round(want))))
            if abs(tr['params'][17] - vol) <= 1:
                break
        report[t] = dict(a, machine=tr['machine'], vol=tr['params'][17])
    return report


def main(only=None):
    OUT.mkdir(parents=True, exist_ok=True)
    summary = []
    for k in KITS:
        if only and not k['name'].startswith(only):
            continue
        tracks = kit_tracks(k)
        report = level(k, tracks)
        events = note_events(k)
        total = 4 * 16 * STEP
        spt = samples_per_tick(k['bpm'])
        demo_notes = [(round((tick + rep * total) * spt), t, vel) for rep in range(2) for tick, t, vel in events]
        # Whole mix: about -14 dB RMS like the other kits, with clipping
        # well under 0.05% of samples (VOL scales amplitude ~ VOL^2).
        clipped = False
        for _ in range(14):
            mix = render(tracks, demo_notes, 8 * 4 * 60 / k['bpm'] + 1.5, k['master'], k['bpm'])
            clip = float((np.abs(mix) >= 0.999).mean())
            rms_db = 20 * np.log10(max(float(np.sqrt((mix ** 2).mean())), 1e-9))
            if clip >= 0.0005:
                gain, clipped = 0.94, True
            elif not clipped and rms_db < TARGET_RMS_DB - 1 and min(tracks[t]['params'][17] for t in k['tracks']) < 127:
                gain = min(1.12, (10 ** ((TARGET_RMS_DB - rms_db) / 20)) ** 0.5)
            else:
                break
            for t in k['tracks']:
                tracks[t]['params'][17] = max(8, min(127, round(tracks[t]['params'][17] * gain)))
        base = OUT / k['name']
        (base.with_suffix('.mdkit')).write_text(mdkit_text(k, tracks))
        write_mid(base.with_suffix('.mid'), events, k['bpm'], total)
        render(tracks, demo_notes, 8 * 4 * 60 / k['bpm'] + 1.5, k['master'], k['bpm'], out=base.with_suffix('.wav'))
        peak = float(np.abs(mix).max()); rms = float(np.sqrt((mix ** 2).mean()))
        summary.append({'kit': k['name'], 'bpm': k['bpm'], 'style': k['style'], 'mix_peak': round(peak, 3),
                        'mix_rms_db': round(20 * np.log10(max(rms, 1e-9)), 1), 'clip_fraction': round(clip, 5),
                        'kick_f0': report[0]['f0'], 'tracks': {f'T{t+1:02d}': report[t] for t in sorted(report)}})
        print(f"{k['name']:24s} peak {peak:.3f} rms {20*np.log10(rms):.1f} dB clip {clip:.5f} kick {report[0]['f0']} Hz", flush=True)
    (OUT / 'levels.json').write_text(json.dumps(summary, indent=1) + '\n')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
