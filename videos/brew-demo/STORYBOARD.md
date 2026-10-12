---
mode: autonomous
message: "brew looks like a cosy hand-drawn café, and under the ink a learned manager is running it, measurably better"
duration: 62s
music: assets/music/track.wav — 168 eighth-notes a minute (a bar is 8 eighths, 2.857 s), first stomp at 4.755 s
---

# one day at brew — the cut to the beat

Everything is timed in eighth-notes of the music (`beats.js`, written by `tools/analyze_music.py`; `BREW.t(e)` in
`index.html`). The stomp motif hits eighths 0, 1, 2, 5, 6 of almost every bar: things appear on those hits (`pop`),
what is already on screen is kicked by every hit (`bump`), and the hand-drawn lines boil on each one. The music has
four parts and the film follows them: a quiet drone, sparse stomps (the café tour), the full band from eighth 64 (what
runs the café), stomps again from eighth 128 (closing time).

## Frame 1 — the sketch, then the logo (0 – 7.61 s)
status: animated
src: compositions/s0-open.html
rules: svg-path-draw, kinetic-beat-slam, spring-pop-entrance
The drone is a pencil: a cup, a guideline, a line of handwriting. First stomp: the logo. Next two: the heart, the
underline. Then the clock and the door sign. Out: a whip pan.

## Frame 2 — the morning rush (7.61 – 13.33 s, eighths 8–24)
status: animated
src: compositions/s1-lobby.html
rules: coordinate-target-zoom, multi-phase-camera, svg-path-draw
Lobby footage. Bar one: stamp, title, the rail circled by hand. Bar two: three stomps are three snap zooms (rail,
queue, decision card). Out: straight through the window.

## Frame 3 — the espresso machine breaks (13.33 – 19.04 s, eighths 24–40)
status: animated
src: compositions/s2-kitchen.html
rules: kinetic-beat-slam, spring-pop-entrance
"wait for it…" on the odd hits, then the downbeat of the second bar is 08:30:00 in the footage: flash, shake, DOWN,
lightning. Tape, the re-plan, six chaos buttons in two bursts. Out: the hazard tape wipes the frame.

## Frame 4 — prices, rewritten in ink (19.04 – 21.90 s, eighths 40–48)
status: animated
src: compositions/s3-menu.html
rules: coordinate-target-zoom, svg-path-draw
Push in on the menu book; the price change lands on a hit, is struck through by hand, and ₹215 lands on the next.
Out: pushed up.

## Frame 5 — the pantry knows every lot (21.90 – 24.76 s, eighths 48–56)
status: animated
src: compositions/s4-pantry.html
rules: counting-dynamic-scale, spring-pop-entrance
Labels on the stomps, −53 % on a hit. Out: an ink iris.

## Frame 6 — the sentence (24.76 – 27.61 s, eighths 56–64)
status: animated
src: compositions/s5-sentence.html
rules: kinetic-beat-slam
"a cosy little café…" by hand on two stomps; then the drum roll: "that / happens / to / be", one word an eighth,
each bigger, each on a new colour.

## Frame 7 — an ML system (27.61 – 36.18 s, eighths 64–88)
status: animated
src: compositions/s6-system.html
rules: kinetic-beat-slam, waterfall-entry, svg-path-draw
THE DROP: the words slam with the full band. Bar two: the six-layer stack is stomped in from the ground up (three
hits, two hits, one). Bar three: the RL manager is circled and crowned.

## Frame 8 — four decisions (36.18 – 39.04 s, eighths 88–96)
status: animated
src: compositions/s7-verbs.html
rules: kinetic-beat-slam, coordinate-target-zoom
Four full-bleed flash cards, a quarter-note each, over the screen each decision is made on: prep, charge, cook
first, rescue.

## Frame 9 — ask Kapi (39.04 – 41.90 s, eighths 96–104)
status: animated
src: compositions/s8-kapi.html
rules: coordinate-target-zoom, spring-pop-entrance
Two shots of one conversation with a hard cut on the half bar: the bakes on the board, the order as a ticket.
Out: the colour block.

## Frame 10 — same customers, four managers (41.90 – 50.47 s, eighths 104–128)
status: animated
src: compositions/s9-arena.html
rules: kinetic-beat-slam, stat-bars-and-fills, counting-dynamic-scale, particle-burst
The claim on two stomps. A, B, C on three stomps; D runs for two eighths and lands on the downbeat: +₹42,773 a day,
a crown, three chips, the honest read through the fill. Out: night falls.

## Frame 11 — closing time (50.47 – 62 s, eighths 128–160)
status: animated
src: compositions/s10-close.html
rules: spring-pop-entrance, svg-path-draw
The band drops out. The receipt feeds one notch per stomp while the project's three rules land; then the logo, the
heart and the line on three stomps, `docker compose up`, and out with the music's fade.
