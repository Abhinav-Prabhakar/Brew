#!/bin/sh
# Cut the recorded footage (assets/footage/*.mp4) to the shots the scenes use (assets/clips/*.mp4, 30 fps).
# Offsets are chosen so that what happens in the footage lands on a drum hit (see beats.js): the espresso machine
# breaks one bar into the kitchen shot, the menu price changes on the fifth eighth of the menu shot.
set -e
cd "$(dirname "$0")/.."
rm -rf assets/clips && mkdir -p assets/clips
cut() { # name source start seconds
  ffmpeg -y -loglevel error -ss "$3" -t "$4" -i "assets/footage/$2.mp4" -an -vf fps=30 -c:v libx264 -preset slow -crf 16 \
    -pix_fmt yuv420p -g 15 -movflags +faststart "assets/clips/$1.mp4"
}
cut lobby    lobby_rush    1.0   5.9
cut kitchen  kitchen_chaos 0.893 5.9
cut menu     menu_book     3.214 3.0
cut pantry   pantry        0.5   3.0
cut kapi1    kapi          8.6   1.5
cut kapi2    kapi          14.2  1.6
cut v_prep   lobby_rush    7.0   0.8
cut v_price  menu_book     5.3   0.8
cut v_cook   kitchen_chaos 0.1   0.8
cut v_rescue pantry        6.5   0.8
ls -la assets/clips
