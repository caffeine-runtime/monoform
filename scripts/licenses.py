#!/usr/bin/env python3
"""List the licence of every Go module linked into the binary and every npm
package shipped in the frontend bundle; fail on copyleft licences.

  scripts/licenses.py [path/to/binary]
"""
import json, os, re, subprocess, sys

BIN = sys.argv[1] if len(sys.argv) > 1 else "build/bin/monoform"
ALLOWED = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "CC0-1.0", "OFL-1.1", "Unlicense", "0BSD", "BlueOak-1.0.0", "Python-2.0", "PSF-2.0"}

def classify(text):
    t = " ".join(text.split())
    if "Mozilla Public License" in t: return "MPL-2.0"
    if re.search(r"GNU (AFFERO|LESSER|GENERAL) PUBLIC LICENSE", t, re.I): return "GPL-family"
    if "Apache License" in t and "Version 2.0" in t: return "Apache-2.0"
    if "Permission is hereby granted, free of charge" in t: return "MIT"
    if "Permission to use, copy, modify, and/or distribute" in t or "Permission to use, copy, modify, and distribute this software for any purpose" in t: return "ISC"
    if "Redistribution and use in source and binary forms" in t:
        return "BSD-3-Clause" if re.search(r"(Neither the name|names of its contributors)", t) else "BSD-2-Clause"
    if "CC0" in t or "Creative Commons Legal Code" in t: return "CC0-1.0"
    if "SIL OPEN FONT LICENSE" in t.upper(): return "OFL-1.1"
    if "This is free and unencumbered software released into the public domain" in t: return "Unlicense"
    return "UNKNOWN"

rows, bad = [], []
gomod = subprocess.run(["go", "env", "GOMODCACHE"], capture_output=True, text=True).stdout.strip()
out = subprocess.run(["go", "version", "-m", BIN], capture_output=True, text=True).stdout
lines = out.splitlines()
for i, line in enumerate(lines):
    parts = line.split()
    if len(parts) >= 3 and parts[0] == "dep":
        mod, ver = parts[1], parts[2]
        esc = re.sub(r"[A-Z]", lambda m: "!" + m.group(0).lower(), mod)
        d = os.path.join(gomod, f"{esc}@{ver}")
        nxt = lines[i + 1].split() if i + 1 < len(lines) else []
        if nxt[:1] == ["=>"]:
            # replace directive: a local path or another module
            target = nxt[1]
            d = target if target.startswith(".") or target.startswith("/") else os.path.join(gomod, re.sub(r"[A-Z]", lambda m: "!" + m.group(0).lower(), target) + "@" + nxt[2])
            mod = f"{mod} => {target}"
        lic = "UNKNOWN"
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if re.match(r"(UN)?(LICEN[CS]E|COPYING)", f, re.I):
                    lic = classify(open(os.path.join(d, f), errors="ignore").read()); break
        rows.append(("go", mod.replace('"', ''), ver, lic))

# npm packages that end up in dist (runtime dependencies and their deps).
lock = json.load(open("frontend/package-lock.json"))
for path, info in lock.get("packages", {}).items():
    if not path or info.get("dev") or info.get("optional") and info.get("dev"):
        continue
    name = path.split("node_modules/")[-1]
    lic = info.get("license", "UNKNOWN")
    if lic == "UNKNOWN":
        # No license field in package.json: read the package's licence file.
        d = os.path.join("frontend", path)
        for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            if re.match(r"(UN)?(LICEN[CS]E|COPYING)", f, re.I):
                lic = classify(open(os.path.join(d, f), errors="ignore").read()); break
    rows.append(("npm", name, info.get("version", ""), lic))

for kind, name, ver, lic in sorted(rows):
    ok = all(part.strip("() ") in ALLOWED for part in re.split(r" OR | AND ", lic)) if lic != "UNKNOWN" else False
    if lic.startswith("(") or " OR " in lic:
        ok = any(part.strip("() ") in ALLOWED for part in re.split(r" OR ", lic))
    print(f"{kind:3} {name:55} {ver:22} {lic}{'' if ok else '   <-- CHECK'}")
    if not ok: bad.append(name)
print(f"\n{len(rows)} packages, {len(bad)} need attention")
sys.exit(1 if bad else 0)
