#!/usr/bin/env python3
"""Turns a demo scene's timing log into an ffmpeg filter for its recording.

    demo_timeline.py CUTS SPEEDS DURATION [MARKS]

CUTS ("a-b,…") are waits to drop; SPEEDS ("a-b:k,…") are stretches the scene
ran k times slower (slow motion for what software rendering draws slowly),
sped up k times again; times are seconds from "demo: rec". MARKS ("name:t,…")
are section marks. Prints JSON: "filter", an ffmpeg -filter_complex chain from
[0:v] to [cut] (kept pieces trimmed, sped and joined), and "marks", the marks on
the edited timeline.
"""
import json
import sys


def pairs(s):
    return [tuple(map(float, x.split('-'))) for x in s.split(',') if x]


def pieces(cuts, speeds, duration):
    """Kept (start, end, speed) pieces of the raw timeline, in order."""
    bounds = {0.0, duration}
    for a, b in cuts:
        bounds |= {a, b}
    for a, b, _ in speeds:
        bounds |= {a, b}
    edges = sorted(t for t in bounds if 0 <= t <= duration)
    out = []
    for a, b in zip(edges, edges[1:]):
        mid = (a + b) / 2
        if b - a < 1e-3 or any(c0 <= mid < c1 for c0, c1 in cuts):
            continue
        k = next((k for s0, s1, k in speeds if s0 <= mid < s1), 1.0)
        if out and out[-1][2] == k and abs(out[-1][1] - a) < 1e-6:
            out[-1] = (out[-1][0], b, k)
        else:
            out.append((a, b, k))
    return out


def edited(t, kept):
    """Where raw time t lands on the edited timeline."""
    pos = 0.0
    for a, b, k in kept:
        if t <= a:
            break
        pos += (min(t, b) - a) / k
    return round(pos, 3)


def main():
    cuts = pairs(sys.argv[1])
    speeds = [(*map(float, r.split(':')[0].split('-')), float(r.split(':')[1])) for r in sys.argv[2].split(',') if r]
    duration = float(sys.argv[3])
    marks = [m.split(':') for m in (sys.argv[4] if len(sys.argv) > 4 else '').split(',') if m]
    kept = pieces(cuts, speeds, duration)
    parts = [f'[0:v]trim=start={a:.3f}:end={b:.3f},setpts=(PTS-STARTPTS)/{k:g}[p{i}]' for i, (a, b, k) in enumerate(kept)]
    join = ''.join(f'[p{i}]' for i in range(len(kept))) + f'concat=n={len(kept)}:v=1:a=0[cut]'
    print(json.dumps({'filter': ';'.join(parts + [join]), 'marks': {n: edited(float(t), kept) for n, t in marks}}))


if __name__ == '__main__':
    main()
