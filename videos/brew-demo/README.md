# brew · one day at the café (the demo film)

A 64-second film about brew, built with [HyperFrames](https://hyperframes.heygen.com): HTML scenes on one seekable
timeline. Every screen in it is the real page.

- `index.html` — the film: paper, cover wipes, the score, and the nine scenes mounted on the score's bar lines
- `compositions/` — the scenes (`s1-open` … `s9-close`), the day rail, and the registry grain component
- `tools/capture_footage.py` — records the real UI (replayed fixtures; a scripted backend for Kapi) with the installed Chrome
- `tools/cut_footage.sh` — cuts the recordings to scene length (`assets/clips/`)
- `tools/make_music.py` — synthesises the score (`assets/music/brew-day.wav`: 90 bpm, 24 bars, seeded)
- `renders/brew-demo.mp4` — the rendered film (not committed: about 75 MB)

The recordings, clips, the score and the render are not committed (they are rebuilt by the tools). From the repo root:

```sh
uv run python videos/brew-demo/tools/capture_footage.py   # ~2 min, needs Google Chrome and ffmpeg
sh videos/brew-demo/tools/cut_footage.sh
uv run python videos/brew-demo/tools/make_music.py
cd videos/brew-demo && npm run check && npx hyperframes render -o renders/brew-demo.mp4 --video-frame-format png
```

`npx hyperframes preview` opens the film in Studio, where every scene and clip can be edited on a timeline.
