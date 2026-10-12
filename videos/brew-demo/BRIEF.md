---
workflow: general-video
flow: automation
storyboard: no
message: "brew looks like a cosy hand-drawn café, and under the ink a learned manager is running it, measurably better"
destination: youtube / README embed
aspect: 1920x1080
language: en
length: 64s
audience: engineers and reviewers meeting the project for the first time
narration: no
---

## Intent

A demo film for brew (the repo this folder lives in): a live digital twin of an independent café, drawn in ink, run by
an RL manager. The user asked to "go all in" with "crazy motion graphics" and "stunning background music". Chosen
telling: **one day at brew** — the café's own clock card runs the film (07:00 open, the 08:46 rush, the 08:30 espresso
outage, the 09:00 price change, the 13:30 pantry, Kapi), then the reveal of what runs it and the measured result, and
the day closes on a printed receipt. Left behind on purpose: the dark, neon "AI product" promo.

## Assets

- assets/footage/*.mp4 — the real UI, recorded from design/brew.html replaying the golden fixtures (and a live
  scripted backend for Kapi) by tools/capture_footage.py. Every screen in the film is the real page.
- assets/music/brew-day.wav — the score, synthesised by tools/make_music.py (90 bpm, 24 bars = 64 s), same idea as
  the café's own synthesised radio. Scene cuts sit on its bar lines.

## Customizations

- Cuts on the music's bar grid; count-ups on the arena numbers; the brand's own fonts (Gochi Hand, Patrick Hand,
  Caveat, Courier Prime) and palette (paper #fbf7f1, ink #1d1a1c, terracotta #e07e52).

## Notes

- Numbers come from README "Final arena" (10 seeds × 7 days, CRN-paired): A ₹62,112 · B ₹73,465 · C ₹96,948 ·
  D ₹104,885 per day. No other claims are invented.
- Autonomous run (the user said go all in): decisions are stated in the hand-off, not asked.
- HeyGen is not signed in, so the music catalogue was unavailable; the score is synthesised locally instead.
