# Third-party notices

This document covers the dependencies of the native externals **mdcoreengine~.mxo** and
**mdparameterfocus.mxo** and of their builds. Each licence was checked against the files
of the local sources actually used. The components keep their own copyright and terms.

## ModuleDrum and Monomodule

- [ModuleDrum](https://github.com/K-X420/ModuleDrum) by KX; a fork of
  [Monomodule](https://github.com/shnolk/monomodule) by Shnolk.
- Commit used: `bb0e4472425bc88e507b2352b1dd089f8b1447e7`.
- Licence: **GNU Affero General Public License v3.0**. The full text is copied unchanged
  into [LICENSE](LICENSE) from `vendor/ModuleDrum/LICENSE`.
- The static libraries `mdcore` and `mnmcore` are used. The Max integration sources are
  in `src/` and are marked AGPL-3.0.
- Original statement of authorship: `vendor/ModuleDrum/README.md`, the Licence and
  Credits sections.

## Compiled dependencies

| Component | Purpose and origin | Verified licence |
|---|---|---|
| [dsp56300](https://github.com/dsp56300/dsp56300) | DSP emulator; commit `c051afad31612c2d2c7a81a7ab23e1c5ac9e61af`, with the ModuleDrum patch | [GNU GPL v3](licenses/dsp56300-GPL-3.0.md) |
| [AsmJit](https://github.com/asmjit/asmjit) | JIT backend of dsp56300; submodule commit `3577608cab0bc509f856ebf6e41b2f9d9f71acc4`; (c) 2008-2020 The AsmJit Authors | [zlib](licenses/AsmJit-zlib.txt) |
| [Musashi](https://github.com/kstenerud/Musashi) | CPU emulator as adapted in ModuleDrum; the upstream CMake names commit `313ebf1`; (c) Karl Stenerud | [MIT-style notice](licenses/Musashi-LICENSE.txt) |
| SoftFloat Release 2b | John R. Hauser; the revision reworked for MAME and included in Musashi | [original SoftFloat notice](licenses/SoftFloat-2b-NOTICE.txt), [origin of this revision](licenses/SoftFloat-2b-README.txt) |

SoftFloat carries separate terms: Musashi's MIT notice does not replace its licence. The
original four paragraphs from the head of `softfloat.c` are kept here, together with the
full accompanying README stating which revision this is.

The dsp56300 patch is at `vendor/ModuleDrum/ext/patches/0001-dsp56300-mnm.patch`, and the
changes are described in `vendor/ModuleDrum/THIRD_PARTY_NOTICES.md`. This is therefore a
modified version of dsp56300. The patch is under GPL v3, as stated upstream.

## Max SDK

[Max SDK Base](https://github.com/Cycling74/max-sdk-base), (c) 2021 Cycling '74, commit
`c03a2922a2a8ff149165a1e2ea134e9321d6e202`, is used for its headers, the external support
files and linking against the host API.

The full verified permissive licence text is copied from `vendor/max-sdk-base/LICENSE.md`
into [Cycling74-Max-SDK-LICENSE.md](licenses/Cycling74-Max-SDK-LICENSE.md). Neither Max
itself nor Ableton Live is included in this package.

## What this build contains

With `MNM_BUILD_PLUGIN=OFF`, the core and the Max wrapper are used. JUCE, the VST3 SDK,
AudioUnitSDK and ModuleDrum's GUI plugins are not part of this external build. Intel
ITT/vtune is not included in the macOS configuration of dsp56300 that is used.

ModuleDrum also cites the reverse-engineering material
[machinedrum-kit](https://github.com/janne808/machinedrum-kit),
[MCL](https://github.com/jmamma/MCL) and
[elektron-firmware-tool](https://github.com/mischa85/elektron-firmware-tool). Per the
upstream notices, no code of theirs is included in ModuleDrum; they are cited as
documentation sources.

## Firmware and the instrument's name

Elektron firmware remains a separate user file and is not distributed with the device.
The names Elektron, Machinedrum and Monomachine belong to their owner and are used here
to identify the corresponding hardware. This integration is not affiliated with Elektron
and is not an official Elektron product.

When conveying a modified build, keep these notices, the licence texts and the
corresponding sources of the integration and of the components used. The attached
licences state the exact terms.
