# Techno kits for MD Drum Engine

16 kits, each with a 4-bar MIDI groove and a rendered demo (`.wav`, 8 bars, from the
real engine with OS 1.63). Load a `.mdkit` with **Load Kit…**, then drag the `.mid`
with the same name into a clip slot on the device's track and set Live's tempo to
the kit's BPM.

All kits share one track layout, so any groove plays sensibly on any kit:

| Track | MIDI | Role | Track | MIDI | Role |
|---|---|---|---|---|---|
| 01 | C1 36 | kick | 09 | G#1 44 | perc A |
| 02 | C#1 37 | kick layer / sub / rumble | 10 | A1 45 | perc B |
| 03 | D1 38 | clap | 11 | A#1 46 | low tom / conga |
| 04 | D#1 39 | snare / rim | 12 | B1 47 | high tom / conga |
| 05 | E1 40 | closed hat | 13 | C2 48 | bass / pad 1 |
| 06 | F1 41 | open hat | 14 | C#2 49 | bass / stab 2 |
| 07 | F#1 42 | ride / cymbal | 15 | D2 50 | crash / impact |
| 08 | G1 43 | shaker / noise | 16 | D#2 51 | tick |

## Kits

| Kit | BPM | Style | Kick (measured) | Mix RMS | Recipe source |
|---|---|---|---|---|---|
| 01 Warehouse Heavy | 132 | heavy warehouse techno | 51.8 Hz | -12.0 dB | Kick = TrabanT R1 exact; 2nd short kick layered on top as in R1. |
| 02 Deep FM | 126 | deep / dub-leaning techno | 43.1 Hz | -11.6 dB | Kick = ozon R2 set A exact (MOD 111 was his own estimate); GND-SN sub layer (R12) on G1. |
| 03 Rumble Machine | 134 | rumble techno | 47.1 Hz | -12.4 dB | Rumble: offbeat kick copy (T02) sent fully to a dark gated reverb (R9 + common rumble practice). |
| 04 Detroit Drive | 128 | Detroit / 909-style techno | 48.4 Hz | -20.2 dB | Hats follow R6 (MTAL 0, LPF 127, HPF just past centre). |
| 05 Minimal Click | 125 | minimal techno | 45.8 Hz | -16.2 dB | Designed from the recurring MD techniques listed below. |
| 06 Dub Chamber | 120 | dub techno | 45.1 Hz | -17.0 dB | Stab = two AM-modulated GND-SN voices (G2 + D3) into Rhythm Echo (dotted 8th) and reverb (R19). |
| 07 Hypnotic Loop | 130 | hypnotic techno | 54.5 Hz | -13.0 dB | Hat decay moved by a free triangle LFO (R15); bass = E12 retrig buzz (R8) on G2-ish. |
| 08 Industrial Grind | 136 | industrial techno | 45.8 Hz | -11.5 dB | Kick = TRX-B2 body + filtered noisy B2 layer with DIST and a little SRR (R7). |
| 09 Acid Buzz | 128 | acid techno | 47.8 Hz | -16.6 dB | Bass = E12-BD retrig buzz (R8): RTIM 33 ≈ C2, RTIM 17 ≈ B2; resonant track filter, trig LFO on FLTF. |
| 10 Hard Groove | 138 | hard groove / tribal techno | 49.8 Hz | -15.5 dB | Designed from the recurring MD techniques listed below. |
| 11 Peak Time | 134 | peak-time techno | 68.6 Hz | -16.2 dB | Kick + GND-SN sub on G1 (R12), GND-IM tick linked on every kick (R5/R11). |
| 12 Lo-Fi Broken | 124 | lo-fi broken techno | 45.1 Hz | -20.1 dB | Designed from the recurring MD techniques listed below. |
| 13 Ambient Pulse | 118 | ambient techno | 45.1 Hz | -12.7 dB | Pads = long AM GND-SN drones with a slow LFO on AMF (R19). |
| 14 Electro Steel | 130 | electro-techno | 40.4 Hz | -10.6 dB | Kick = TRX-B2 per R5: pitch in the 40s, upper page low 60s, lower page single digits; GND-IM linked. |
| 15 Schranz Pressure | 150 | schranz / hard techno | 56.5 Hz | -12.8 dB | Grit by DIST and a driven Dynamix (common MD hard-techno practice). |
| 16 Raw Jam | 135 | raw jam techno | 44.4 Hz | -16.1 dB | Toms on three tracks: 2 low, 3 mid, 2 high pitches as in R1. |

## Where the sounds come from

The recipes below come from Elektronauts threads. Exact numeric MD recipes are
rare there: people mostly share techniques or SysEx kits. What was published is
used as published, credited to its author:

- **R1** — TrabanT (2015), heavy techno kick on EFM-BD: PTCH 20 DEC 100 RAMP 22
  RDEC 105, EQF 12 EQG 45, FLTF 21 FLTW 57 FLTQ 84, layered with a short higher kick → kit 01.
- **R2** — ozon (2020), deep EFM-BD kick: PTCH 24 DEC 87 RAMP 72 RDEC 30 MOD 111 MDEC 28, FLTW 68 → kit 02.
- **R5** — TRX-B2 kick: pitch in the 40s, upper page low 60s, lower page single digits → kit 14.
- **R6** — TRX hats: MTAL 0, LPF 127, HPF just past centre → most TRX hat tracks.
- **R8** — E12 retrig buzz bass (RTRG 127, RTIM sets the note) → kits 07 and 09. Checked
  on the engine: RTIM 13 ≈ 153 Hz, 25 ≈ 86 Hz, 33 ≈ 66 Hz.
- Techniques: GND-SN sine sub under the kick (tuned to G1, PTCH 3 = 49 Hz), GND-IM tick
  layer, kick copy into a dark gated reverb for rumble, DIST + a little SRR for grit,
  LFO on hat decay, long AM GND-SN drones for dub/ambient pads.

Every track was then levelled by rendering it through the engine (VOL set so a single
hit reaches its role's peak), and every kit's full groove was checked for clipping
and brought towards −14 dB RMS. Echo TIME is tempo-synced: 8 = 1/16, 16 = 1/8,
24 = dotted 1/8, 32 = 1/4.

Regenerate with `python3 tools/make_techno_kits.py` (needs the built `render-script`
and your OS 1.63 file).
