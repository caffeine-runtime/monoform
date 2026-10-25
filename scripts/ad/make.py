#!/usr/bin/env python3
"""Makes the Monoform ad (build/bin/monoform-ad.mp4, 1080p60, ~49 s).

    scripts/readme-media.sh footage        # once: the app shots (build/bin/ad)
    python3 scripts/ad/make.py [--from S --to S] [--fps N] [--out FILE]

Cuts the footage into the five shots the ad shows (at the marks the demo
logged), as JPEG frames, and renders scripts/ad/ad.html frame by frame with
scripts/ad/render.mjs (Playwright + Chromium, ffmpeg); the music is the demo
folder's Goldberg recording (CC0). --from/--to render a part (no music), for a
quick look.
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import demo_files  # noqa: E402  (the media cache: fetch('goldberg.ogg'))

AD = os.path.join(ROOT, 'build', 'bin', 'ad')
# shot: (its pieces of the footage as (mark, seconds after it) pairs, the beat's start and end in
# ad.html — how long it is on screen). The pieces leave out what doesn't show the app at work:
# the previous file still open, a view that is loading.
SHOTS = {
    'md': ([(('md', 0.2), ('docs', -0.1))], 11.8, 16.2),
    'docs': ([(('docs', 1.5), ('docs', 5.4)), (('more', 0.0), ('more', 1.4))], 16.0, 20.4),  # report, CSV, the PDF
    'ai': ([(('ai', 1.0), ('split', -2.3))], 20.2, 27.0),  # without the long hold after the paste
    'more': ([(('more', 2.0), ('more', 3.4)), (('more', 4.4), ('ai', -0.3))], 26.8, 31.2),  # SVG; 3D and video
    'split': ([(('split', 1.0), ('end', -0.3))], 31.0, 35.4),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from', dest='start', type=float)
    ap.add_argument('--to', type=float)
    ap.add_argument('--fps', type=int, default=60)
    ap.add_argument('--out', default=os.path.join(ROOT, 'build', 'bin', 'monoform-ad.mp4'))
    args = ap.parse_args()
    footage = os.path.join(AD, 'footage.mp4')
    if not os.path.exists(footage):
        sys.exit('no build/bin/ad/footage.mp4: run scripts/readme-media.sh footage first')
    marks = json.load(open(os.path.join(AD, 'marks.json')))

    shots = {}
    for name, (pieces, a, b) in SHOTS.items():
        out = os.path.join(AD, 'frames', name)
        shutil.rmtree(out, ignore_errors=True)
        os.makedirs(out)
        count = 0
        for (m0, o0), (m1, o1) in pieces:
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-ss', f'{marks[m0] + o0:.3f}', '-to', f'{marks[m1] + o1:.3f}', '-i', footage,
                            '-vf', 'fps=30,scale=1600:-2:flags=lanczos', '-q:v', '2', '-start_number', str(count + 1),
                            os.path.join(out, '%04d.jpg')], check=True)
            count = len(glob.glob(os.path.join(out, '*.jpg')))
        visible = (b - a + 0.45) - 0.45  # from the window's entrance to the end of its exit
        speed = max(1.0, count / 30 / visible)
        shots[name] = {'dir': 'file://' + out, 'count': count, 'speed': round(speed, 3)}
        print(f'{name}: {count / 30:.1f} s of footage, shown at {speed:.2f}×')

    icons = sorted(glob.glob(os.path.join(ROOT, 'build', 'icon', 'file-*.svg')))
    cfg = {
        'font': 'file://' + os.path.join(ROOT, 'frontend', 'node_modules', '@fontsource-variable', 'inter', 'files', 'inter-latin-wght-normal.woff2'),
        'appIcon': open(os.path.join(ROOT, 'build', 'icon', 'appicon.svg')).read(),
        'fileIcons': [open(p).read() for p in icons],
        'shots': shots,
        'music': demo_files.fetch('goldberg.ogg'),
    }
    cfg_path = os.path.join(AD, 'config.json')
    with open(cfg_path, 'w') as f:
        json.dump(cfg, f)
    cmd = ['node', os.path.join(ROOT, 'scripts', 'ad', 'render.mjs'), cfg_path, args.out, '--fps', str(args.fps)]
    if args.start is not None:
        cmd += ['--from', str(args.start)]
    if args.to is not None:
        cmd += ['--to', str(args.to)]
    subprocess.run(cmd, check=True)


if __name__ == '__main__':
    main()
