#!/bin/sh
# Cut the recorded footage (assets/footage/*.mp4) to the lengths the scenes use (assets/clips/*.mp4, 30 fps).
set -e
cd "$(dirname "$0")/.."
mkdir -p assets/clips
cut() { # name source start seconds
  ffmpeg -y -loglevel error -ss "$3" -t "$4" -i "assets/footage/$2.mp4" -an -vf fps=30 -c:v libx264 -preset slow -crf 16 \
    -pix_fmt yuv420p -g 15 -movflags +faststart "assets/clips/$1.mp4"
}
cut lobby   lobby_rush    1.0 8.4
cut kitchen kitchen_chaos 2.4 8.4
cut menu    menu_book     3.2 5.7
cut pantry  pantry        0.5 5.7
cut walk    walk          0.9 8.2
cut compare comparison    0.7 4.8
# kapi: three beats of the conversation, cut on the music's beats (2 s, 2.667 s, 3.6 s)
cut kapi_a kapi 0.3 2.0
cut kapi_b kapi 6.9 2.6667
cut kapi_c kapi 13.2 3.6
printf "file 'kapi_a.mp4'\nfile 'kapi_b.mp4'\nfile 'kapi_c.mp4'\n" > assets/clips/kapi.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i assets/clips/kapi.txt -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -g 15 -movflags +faststart assets/clips/kapi.mp4
rm assets/clips/kapi_a.mp4 assets/clips/kapi_b.mp4 assets/clips/kapi_c.mp4 assets/clips/kapi.txt
ls -la assets/clips
