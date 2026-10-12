---
mode: autonomous
message: "brew looks like a cosy hand-drawn café, and under the ink a learned manager is running it, measurably better"
duration: 64s
music: assets/music/brew-day.wav (90 bpm, one bar = 2.6667 s; every cut is on a bar line)
---

# one day at brew

The café's day runs the film: the door opens at 07:00 and a receipt prints at 22:00. A cup walks a day rail along the
bottom edge and carries across every cut. Transitions: css-cover (staggered colour blocks) on each bar line.

## Frame 1 — the door opens (0 – 5.33 s, bars 1–2)
status: animated
src: compositions/s1-open.html
rules: spring-pop-entrance, svg-path-draw, counting-dynamic-scale
The logo pops letter by letter, the heart beats on the beat, three tickets drop onto a rail and swing, the clock card
lands on 07:00 and runs forward.

## Frame 2 — the morning rush (5.33 – 13.33 s, bars 3–5)
status: animated
src: compositions/s2-lobby.html
rules: coordinate-target-zoom, multi-phase-camera, spring-pop-entrance
Real lobby footage (08:08). Punch in on the ticket rail, then on the manager's decision card, then back out.

## Frame 3 — …an ML system (13.33 – 18.67 s, bars 6–7)
status: animated
src: compositions/s3-stack.html
rules: kinetic-beat-slam, waterfall-entry, svg-path-draw
The line slams, steps aside, and the six-layer decision stack builds from the ground up on the off-beats.

## Frame 4 — the espresso machine breaks (18.67 – 26.67 s, bars 8–10)
status: animated
src: compositions/s4-kitchen.html
rules: kinetic-beat-slam, spring-pop-entrance
Real kitchen footage; the machine goes down two beats in (flash, shake, DOWN stamp, hazard tape), policy D re-plans,
six chaos chips pop.

## Frame 5 — prices, rewritten in ink (26.67 – 32 s, bars 11–12)
status: animated
src: compositions/s5-menu.html
rules: coordinate-target-zoom, spring-pop-entrance
The 09:00 price change in the open menu book: ₹220 struck through, ₹215 inked in, then the page turns.

## Frame 6 — the pantry knows every lot (32 – 37.33 s, bars 13–14)
status: animated
src: compositions/s6-pantry.html
rules: counting-dynamic-scale, spring-pop-entrance
Pantry footage with three labels; −53 % waste with the rescue shelf (policy C, forked worlds) counts up.

## Frame 7 — ask Kapi (37.33 – 45.33 s, bars 15–17)
status: animated
src: compositions/s7-kapi.html
rules: coordinate-target-zoom, spring-pop-entrance
Three beats of one conversation, cut on the beat: hello, the bakes on the board, the order written as a ticket.

## Frame 8 — same customers, four managers (45.33 – 56 s, bars 18–21)
status: animated
src: compositions/s8-arena.html
rules: kinetic-beat-slam, stat-bars-and-fills, counting-dynamic-scale, particle-burst
The arena result as a bar race with count-ups; D lands on the bar line, +₹42,773 a day, three supporting chips and
the honest read.

## Frame 9 — closing time (56 – 64 s, bars 22–24)
status: animated
src: compositions/s9-close.html
rules: spring-pop-entrance, waterfall-entry
The day prints as a receipt; the logo lands on the last chord; `docker compose up`.
