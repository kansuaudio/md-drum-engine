# MD Drum Engine

A Max for Live instrument built on the ModuleDrum sound core: 16 tracks, 49 machines
from the GND, TRX, EFM, E12 and P-I families, per-track effects, LFOs and master
processing. Rhythm comes from MIDI clips or a controller in Ableton Live. The device
has no sequencer of its own.

The Elektron firmware is not included and is never copied into the device or embedded
in a Set. You point the device at your own Machinedrum UW OS 1.63 `.syx` file once,
and it reads the machine catalogue and parameters from it.

## Requirements

**Ableton Live 12 Suite and Max 9** on **macOS 12+** (Apple Silicon or Intel) or
**64-bit Windows 10/11**. One `.amxd` carries the native engines for both platforms,
macOS as `.mxo` (arm64 + x86_64) and Windows as `.mxe64` (x64); Max loads the one it
needs. The Windows binaries are built by `.github/workflows/windows.yml` with MSVC and
a static runtime, so no Visual C++ Redistributable is required.

The device is used in Live 12 on macOS. The Windows engine builds and passes the native
engine tests on Windows x64 in CI; the `.amxd` itself has not been run in Live on
Windows.

## Install

**When updating from any earlier version:** save your work and quit Ableton Live
completely, then start it again and load the new `MD Drum Engine 1.0.5.amxd`. The
native engines change between releases, and removing the old device from a track is not
enough - the host can keep using an external it has already loaded.

1. Put the single file `MD Drum Engine 1.0.5.amxd` somewhere permanent, such as your
   device library. It is a frozen build: interface, JavaScript and the native sound
   engine are packed inside it.
2. Add that folder to **Places** in Live's browser and drag `MD Drum Engine 1.0.5.amxd`
   onto a MIDI track. There is no separate folder of JavaScript or externals to install.
3. Press **Load OS 1.63...** and select `Elektron_SPS1-1UW_OS1.63.syx`. It must be the
   Machinedrum UW OS 1.63 firmware file, not a kit or pattern dump.
4. When **READY** appears, press **Audition** or send MIDI note 36. **Editor** opens the
   large panel.
5. Save the Live Set or a device preset to keep the chosen OS path.

The firmware is selected once per device instance or saved preset, and the absolute path
is stored. Keep the `.syx` somewhere permanent. If the file moves, or the Set is opened
on another computer, select it again with **Change OS...**.

## Machines and playing

The sixteen buttons along the bottom are the instrument's tracks. A click selects a
track. **Option (Mac) / Alt (Windows) + click** selects it and plays it; **Audition**
plays the selected track. Each track's red LED, in its dark socket, flashes brightly and
falls back when the engine has accepted a hit for that track from MIDI or from Audition.
The LEDs are independent, so triggering several tracks at once flashes all of them.
Selecting a track on its own produces no flash.

Click the machine name on the red display and pick a family and a machine from the menu.
If the list does not fit on one page, use **Previous / Next**. There are no per-machine
files: the catalogue and the parameters are read from the OS.

| Family | Machines |
|---|---:|
| GND | 3 |
| TRX | 13 |
| EFM | 8 |
| E12 | 16 |
| P-I | 9 |
| **Total** | **49** |

The top right of the red display shows the selected track's note in Live's piano-roll
notation together with its MIDI number: **C1 - MIDI 36** for track 01, **C#1 - MIDI 37**
for track 02, up to **D#2 - MIDI 51** for track 16. The label follows the track
selection; changing the machine on a track does not change its trigger note.

The main mapping is **note numbers 36-51 to tracks 01-16**. **Notes 0-15** reach the same
tracks 01-16 as well. Other note numbers trigger nothing. Note-off and velocity 0 do not
create a hit; the velocity of a positive note sets how hard the track is struck. Go by
the MIDI numbers, since octave naming differs between programs. **CC120 (All Sound Off)**
stops the sound and the effect tails, like the Panic button. **CC123 (All Notes Off)**
does not cut these one-shot hits.

Set rhythm, clip length, quantisation and arrangement in Live. Switching track or panel
page does not by itself change how any other track sounds.

## Sound control

| Page | Parameters |
|---|---|
| **SYN** | Up to eight parameters of the selected machine; unused knobs are disabled. |
| **FX** | AMD, AMF, EQF, EQG, FLTF, FLTW, FLTQ, SRR. |
| **ROUTE** | DIST, VOL, PAN, the DEL and REV sends, and LFOS, LFOD, LFOM. |
| **LFO** | Destination track and parameter, two shapes, FREE/TRIG/HOLD mode, speed, depth and mix. The last three match LFOS/LFOD/LFOM on ROUTE. |
| **MASTER** | **Echo**, **Reverb**, **EQ** and **Dynamics** subpages, eight parameters each. |

**DEL and REV stay on the main panel** for the selected track, on SYN, FX, ROUTE, LFO
and MASTER alike. They mirror the matching sends on ROUTE and write the same stored
values.

**Echo and Reverb work through each track's sends.** **DEL** and **REV** default to
**0**, so changing MASTER alone adds nothing to a dry signal.

1. Select the track that your MIDI clip or Audition actually triggers.
2. Raise **DEL** for Echo or **REV** for Reverb on the main panel. There is no need to
   switch to ROUTE. **30-80** is a reasonable start; the maximum is **127**.
3. Open **MASTER > Echo** or **MASTER > Reverb** and check that **LEV** is above zero.
   Set the Echo time and feedback, or the Reverb decay, by ear.

On the MASTER page the device points out that the matching send is at zero on the
selected track. The hint changes nothing: neither the sends nor the wet amount are
raised for you. To automate DEL and REV, use `P20` and `P21` of that track.

- Drag a knob vertically to change its value.
- Hold **Shift** for fine adjustment.
- **Double-click** returns the default.
- **Output** sets the overall output volume.
- **Panic** stops the sound and clears the tails.
- **Editor** opens a 1120 x 250 panel; Live's device strip shows a compact 757 x 169
  version of it.

## Kits

**Load Kit... / Save Kit...** store a whole kit - sixteen machines with all their
settings plus the master effects - in a `.mdkit` file anywhere you like, and read it
back. Kit files can be shared.

The `presets/techno` folder holds sixteen techno kits, each with a matching 4-bar MIDI
groove. Load a `.mdkit`, then drag the `.mid` of the same name into a clip slot on the
device's track and set Live's tempo to the kit's BPM. All kits share one track layout,
so any groove plays sensibly on any kit. See `presets/techno/README.md` for the layout,
the kits and where their sounds come from.

The die on each track key rolls that track's sound: every SYN knob plus gentle use of
the filter, EQ, AM, SRR and DIST. The die in the top bar rolls all sixteen tracks.
Machines, VOL, PAN, DEL, REV and the LFOs are never touched by a roll. **Reset** returns
the default kit, and **Undo** restores the kit as it was before the last roll, Reset or
Load Kit.

Saving a device preset and **importing a hardware Machinedrum `.syx` kit are different
things**. Hardware kit import is not implemented.

## Automation and saving

Parameters have stable names bound to a track, such as `T01 P01`, `T01 P09`,
`T01 Machine` and `T01 LFO Shape 1`. A parameter's address does not depend on which
track is selected in the editor.

To modulate one, add an Ableton **LFO**, press its **Map** button, then click the knob
in the compact panel or in the **Editor** window. For the pitch of a TRX-BD, for
instance, select its track, the **SYN** page and the first pitch knob. The mapping stays
bound to that one parameter of that one track, `T01 P01`, so changing track or page on
screen afterwards does not redirect it. Changing the machine on that track keeps the
parameter number, while its meaning may change with the machine.

`P01-P08` are SYN, `P09-P16` are FX, `P17-P24` are ROUTE. Which SYN parameter a number
refers to depends on the selected machine. Choosing a machine loads its default SYN
values; the track's FX, ROUTE and LFO settings are kept.

The device exposes 513 sound parameters to Live's automation, machine selection and
overall volume included. Saved state covers the machines and settings of all sixteen
tracks, the LFOs, the master effects, the volume, the selected panel view and the
firmware path. Save the **Live Set** or a device preset once you have set things up.

## When the OS will not load

Check your macOS, Live and Max versions first, and that you are loading the current
`MD Drum Engine 1.0.5.amxd`. Both arm64 and x86_64 are supported. Restart Live
completely after an update. Select the **Machinedrum UW OS 1.63 `.syx`** file itself
through **Load OS 1.63... / Change OS...**; the path has to resolve to a readable file,
and an external disk has to be mounted.

Before reading the OS, the device checks that the built-in native engine answers. If the
external did not load, the panel reports **Engine unavailable - see Max Console** rather
than sitting in an OS-loading state. Errors from the native loader are printed to the
**Max Console** as well. This check does not interrupt a synchronous OS read that has
already hung.

The path from the dialog is converted to an absolute operating-system path, preserving
external volume names, spaces and Unicode. If an old preset carries a wrong path, select
the file again. The verified `Elektron_SPS1-1UW_OS1.63.syx` has SHA-256
`a58cd61f2efacfb07add0c643162fb4365c30e73831f2021c17b4aa3b42cabd5`.

## What this version does not do

- No sequencer, patterns, songs or parameter locks inside the device.
- No import or export of hardware `.syx` kits and patterns.
- No UW ROM/RAM, INP, CTR or MID machines, and no user sample loading.
- Stereo output only; there are no separate audio outputs for the sixteen tracks.
- Hardware trigger and mute groups and the kit track level are not represented.
- No claim of identity with the hardware Machinedrum: no direct A/B against the
  hardware has been run.
- Compatibility outside the target environment above has not been checked.

## Build from source

You need **Python 3, CMake 3.22+, Ninja, the Xcode Command Line Tools or Xcode** with
macOS SDKs for arm64 and x86_64, and **Max 9** to export the AMXD. The build expects
`vendor/ModuleDrum`, `vendor/max-sdk-base` and a patched `vendor/dsp56300` with AsmJit,
at the commits recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md);
`.github/workflows/windows.yml` fetches exactly those for the Windows build. ModuleDrum's
GUI plugins and JUCE are not used.

```sh
python3 tools/build_universal.py
python3 tools/build_device.py
python3 tools/prepare_frozen_project.py
```

`build_universal.py` builds arm64 and x86_64 separately, merges them into
**`device/mdcoreengine~.mxo`** and **`device/mdparameterfocus.mxo`**, signs both bundles
and checks that both architectures are present. `build_device.py` generates the editable
`.amxd` and `.maxpat`; at this stage `device/MD Drum Engine.amxd` is not yet frozen.

`prepare_frozen_project.py` creates a fresh
**`artifacts/frozen-project/MD Drum Engine/MD Drum Engine.maxproj`**. Open it in Max 9
and check **Project Inspector > Max for Live Device Type > Instrument**. The project
includes both JavaScript files and both complete native bundles explicitly. Run
**Manage Project > Consolidate**, then **File > Export Max for Live Device...** and save
the result as **`artifacts/full-audit/MD Drum Engine/MD Drum Engine.amxd`**. The file and
its containing folder must both be named `MD Drum Engine`, with no extra nested folder of
that name. Do not add the firmware `.syx` to the project.

The preparer does not overwrite an existing project. To prepare again, give it a fresh
folder with `--output "/path/to/new/MD Drum Engine"`, and export the AMXD to the same
path as before.

Verify the export and build the release files:

```sh
python3 tools/verify_frozen_device.py \
  "artifacts/full-audit/MD Drum Engine/MD Drum Engine.amxd" \
  --report artifacts/frozen-device-verification.json
python3 tools/package_release.py
```

Verification compares the parameters, objects, connections, JavaScript and native bundles
in the export against the sources. The packager rejects JavaScript or patch sources
changed after verification, requires both arm64 and x86_64 in both verified native
bundles, copies the frozen file to `release/`, and writes the device archive, the source
archive and the checksums. Earlier releases are kept.

To also run the native smoke and FX tests, pass your own firmware:

```sh
python3 tools/build_universal.py --firmware "/absolute/path/Elektron_SPS1-1UW_OS1.63.syx"
```

Running the tests for both architectures needs Apple Silicon with Rosetta installed. The
script neither installs Rosetta nor copies the firmware; without `--firmware` it builds
and checks the bundles without loading an OS. When configuring CMake by hand,
`MODULEDRUM_ROOT`, `MODULEDRUM_BUILD`, `MAX_SDK_ROOT` and `MNM_DSP56300_DIR` point at
sources and dependencies you have already prepared.

The generated `device/MD Drum Engine.maxpat` and `device/MD Drum Engine.amxd` are
development output and are not tracked. The released `.amxd` embeds `md.bridge.js`,
`md.panel.js`, `mdcoreengine~.mxo` and the parameter-focus helper
`mdparameterfocus.mxo`; the diagnostic `md.qa.js` is not included in it.

## Credits and licences

The sound core is [K-X420/ModuleDrum](https://github.com/K-X420/ModuleDrum) at commit
[`bb0e4472425bc88e507b2352b1dd089f8b1447e7`](https://github.com/K-X420/ModuleDrum/commit/bb0e4472425bc88e507b2352b1dd089f8b1447e7).
ModuleDrum was written by KX on top of Monomodule by Shnolk and is distributed under the
**GNU AGPL v3**.

The licence text is in [LICENSE](LICENSE), the verified dependency notices in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the [licenses](licenses/) directory.
The native integration is in `src/`, the patch generator in `tools/`, and the interface
and bridge in `device/`.

This is an independent project and not an Elektron product. The Elektron and Machinedrum
names refer to the emulated instrument. Elektron firmware is part of neither the sources
nor the device.
