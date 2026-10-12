# brew · one day at the café (the demo film)

A 62-second film about brew, built with [HyperFrames](https://hyperframes.heygen.com): HTML scenes on one seekable
timeline, cut to the beat of its music. Every screen in it is the real page.

- `index.html` — the film: the beat kit (`BREW`), paper, the transition overlays, the music, eleven scenes
- `beats.js` — the music's eighth-note grid and every drum hit on it (generated)
- `compositions/` — the scenes (`s0-open` … `s10-close`) and the day rail
- `tools/capture_footage.py` — records the real UI (replayed fixtures; a scripted backend for Kapi) with the installed Chrome
- `tools/cut_footage.sh` — cuts the recordings into the shots the scenes use (`assets/clips/`)
- `tools/analyze_music.py` — finds the track's tempo, phase and hits, writes `beats.js` and the 62-second `track.wav`
- `tools/make_music.py` — the first cut's synthesised score (not used by the current cut)
- `STORYBOARD.md` — what happens on which beat

**The music is not in this repository.** The film is cut to "Champion" by Mojo Soundtrack, which is licensed stock
music: put your licensed copy at `assets/music/src/champion.wav`. The recordings, the clips and the render are not
committed either; they are rebuilt by the tools. From the repo root:

```sh
uv run python videos/brew-demo/tools/capture_footage.py   # ~2 min, needs Google Chrome and ffmpeg
sh videos/brew-demo/tools/cut_footage.sh
uv run python videos/brew-demo/tools/analyze_music.py
cd videos/brew-demo && npm run check && npx hyperframes render -o renders/brew-demo.mp4 --crf 19
```

`npx hyperframes preview` opens the film in Studio, where every scene and clip can be edited on a timeline.
