#!/usr/bin/env python3
"""Checks a translated catalog file against the Polish one (the reference set of keys):
same keys in the same order, the key's {placeholders} in every value, "one"/"other" for
plurals, no empty values.

    python3 scripts/check_catalog.py common.json [de fr]
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'frontend', 'src', 'locales')
ph = lambda s: sorted(set(re.findall(r'\{(\w+)\}', s)))  # noqa: E731


def check(name, lang):
    ref = json.load(open(os.path.join(ROOT, 'pl', name)))
    path = os.path.join(ROOT, lang, name)
    if not os.path.exists(path):
        return [f'{lang}/{name}: missing']
    cat = json.load(open(path))
    out = []
    if list(cat) != list(ref):
        missing = [k for k in ref if k not in cat]
        extra = [k for k in cat if k not in ref]
        out += [f'missing: {k}' for k in missing] + [f'extra: {k}' for k in extra]
        if not missing and not extra:
            out.append('keys out of order')
    for k, v in cat.items():
        key = re.sub(r'^\[[^\]]*\] ', '', k)
        want = ph(key)
        if isinstance(ref.get(k), dict):
            if not isinstance(v, dict) or set(v) != {'one', 'other'}:
                out.append(f'plural needs one/other: {k}')
                continue
            for form, text in v.items():
                if not text.strip():
                    out.append(f'empty {form}: {k}')
                if form == 'other' and ph(text) != want:
                    out.append(f'placeholders {ph(text)} ≠ {want}: {k}')
        elif not isinstance(v, str) or not v.strip():
            out.append(f'empty: {k}')
        elif ph(v) != want:
            out.append(f'placeholders {ph(v)} ≠ {want}: {k}')
    return [f'{lang}/{name}: {p}' for p in out]


def main():
    name = os.path.basename(sys.argv[1])
    langs = sys.argv[2:] or ['de', 'fr']
    problems = [p for lang in langs for p in check(name, lang)]
    print('\n'.join(problems) if problems else 'ok')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
