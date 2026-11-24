# Trance Studio

A rebuild of [trance](https://github.com/ohgodhowdidthis/trance), the hypnosis session creator. The visuals
are ported from the original C++ player, and the workflow is a single editor where you build a session,
preview it, watch it fullscreen and export it as a video.

**Photosensitivity warning:** sessions contain rapidly flashing images, text and spinning patterns. They may
trigger seizures in people with photosensitive epilepsy. Don't use Trance Studio or watch its videos if this
applies to you, and stop immediately if you feel unwell.

Features:

- Help built in: a manual (F1, also in [docs/manual](docs/manual/README.md)), a step-by-step tutorial that
  builds your first session, a getting-started checklist and descriptive tooltips on every control.
- Live preview that updates as you edit.
- A timeline with independent rows for looks (visual style), theme blocks (which media and phrases are
  shown) and audio. Audio goes on two channels, Foreground and Background, each with its own volume and
  mute. Clips play at full length and can overlap. The session runs until the last item on any row ends.
- A media page for browsing large folders and adding images and videos to themes.
- Fullscreen viewing inside the editor (F5, Esc to return).
- MP4 export (H.264 and AAC) from 720p to 4K, including vertical and square, at 30 or 60 fps. GPU
  encoding (NVENC, AMF or Quick Sync) is used when available.
- Runs on Windows and Linux.

## Download

Get the latest version from the [releases page](https://github.com/Ashyy0205/TranceStudio/releases).

On Windows, `Trance-Studio-Setup-<version>.exe` installs the app and `Trance-Studio-<version>-Portable.exe`
runs without installing. The files are not code-signed, so Windows SmartScreen may warn the first time; choose
More info, then Run anyway.

On Linux, the `.AppImage` runs on most distributions: make it executable (`chmod +x`) and run it. Ubuntu 22.04
and newer need `libfuse2` for AppImages. On Debian and Ubuntu you can install the `.deb` instead.

## Rendering from the command line

A saved session can be rendered to a video without opening the editor:

```sh
"Trance Studio.exe" --render my.trance --out my.mp4 [--seconds 60] [--width 1920 --height 1080] [--fps 30] [--quality fast|medium|high] [--seed 42] [--software]
```

On Linux, run the AppImage (or `trance-studio` when installed from the .deb) with the same options.

## Building from source

Requires Node.js 22 or newer.

```sh
npm install
npm run dist   # installers for this platform, in dist/
```

## How it relates to the original

The rendering engine in `src/renderer/engine/` follows trance's C++ player closely:

| Original (C++) | Port |
| --- | --- |
| `shaders.h` | `shaders.ts`, same projection and spiral maths in GLSL ES 3.00 |
| `visual/cyclers.cpp` | `cyclers.ts` |
| `visual/visual.cpp` (8 visual types) | `visuals.ts`, with the same constants and timings |
| `visual/api.cpp` | `api.ts` |
| `director.cpp` | `director.ts` (logic) and `gl.ts` (drawing) |
| `theme_bank.cpp`, `util.h` Shuffler | `themeBank.ts`, `random.ts` |
| `media/async_streamer.cpp` | `streamer.ts` |
| `media/font.cpp` | `text.ts` |
| `main.cpp` play loop | `player.ts`, same tick clock (speed 120 matches the original) |

The preview, fullscreen view and exporter all use this engine, so the preview matches the export.

Deliberate differences from the original:

- Images load asynchronously on the render thread, which removes the threading races that crashed trance.
- Images are downscaled when loaded to about 1.25x the output size, so memory use stays bounded.
- When a look block starts and the current visual isn't enabled in it, the visual switches straight away.
  The original waited for the visual's cycle to finish, which could take up to 20 seconds.
- Themes without fonts use the bundled Anton font. The original showed no text in that case.
- Images that fail to load are skipped instead of showing as black.
- In themes that only have videos, styles that would show a still image show the live video. The original
  showed frozen frames from the video, which made Accelerate and Super fast look jerky.
- Videos keep streaming after theme changes. The original paused loading for 5 seconds, so clips ran out
  of frames and played back and forth.
- There is no blank frame when the visual style changes.
- Videos play at their own frame rate. The original showed every frame at 15 fps, which slowed down
  30 and 60 fps video.
- Videos are decoded with ffmpeg, so MP4, MOV and MKV work alongside GIF and WebM. Text can use any
  Unicode characters and mixed case.

## Licence

Trance Studio is released under the MIT licence (see [LICENSE](LICENSE)). It is based on trance by
ohgodhowdidthis, released under the WTFPL. The app includes FFmpeg (GPL-3.0), the Anton font (SIL Open Font
License) and other open-source components; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
