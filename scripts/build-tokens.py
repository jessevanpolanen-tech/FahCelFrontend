#!/usr/bin/env python3
"""Generate assets/ds/tokens.css from assets/ds/tokens.json.

tokens.json is copied verbatim from the FahCel design system artifact, so a
re-sync is: replace the JSON, run this, commit both. Stdlib only, like
build-locales.py; the generated CSS is committed so Vercel stays build-free.
Use --check to detect a stale tokens.css.
"""
import argparse
import json
import re
from pathlib import Path

DS = Path(__file__).resolve().parents[1] / 'assets' / 'ds'
ALIAS = re.compile(r'^\{([A-Za-z0-9][A-Za-z0-9_.-]*)\}$')


def value(v):
    m = ALIAS.match(v) if isinstance(v, str) else None
    return f'var(--{m[1]})' if m else str(v)


def build():
    t = json.loads((DS / 'tokens.json').read_text())
    themes = [th['id'] for th in t['color']['themes']]
    first = themes[0]
    per_theme = {th: [] for th in themes}
    for tok in t['color']['tokens']:
        val = tok['value']
        if isinstance(val, str):
            per_theme[first].append((tok['name'], val))
            continue
        for th in themes:
            # a theme without its own value inherits the first theme's, so only the first is emitted
            if th in val and (th == first or val[th] != val.get(first)):
                per_theme[th].append((tok['name'], val[th]))

    out = [f'/* {t["name"]} — generated from tokens.json by scripts/build-tokens.py. Do not edit. */', '']
    for f in t['type'].get('fonts', []):
        out.append('@font-face{font-family:"%s";src:url("%s") format("woff2");font-weight:%s;font-style:%s;font-display:swap}'
                   % (f['family'], f['file'], f.get('weight', '400'), f.get('style', 'normal')))
    out.append('')

    root = [f'  --{n}:{value(v)};' for n, v in per_theme[first]]
    root += [f'  --font-{k}:{v};' for k, v in t['type']['families'].items()]
    for fam in ('spacing', 'radius', 'shadow', 'layout'):
        root += [f'  --{tok["name"]}:{value(tok["value"])};' for tok in t.get(fam, {}).get('tokens', [])]
    out.append(f':root,[data-theme="{first}"]{{\n' + '\n'.join(root) + '\n}')
    for th in themes[1:]:
        # re-declare the first theme's aliases too, so var() resolves against this theme's values
        names = {n for n, _ in per_theme[th]}
        rows = per_theme[th] + [(n, v) for n, v in per_theme[first] if n not in names and ALIAS.match(str(v))]
        out.append(f'[data-theme="{th}"]{{\n' + '\n'.join(f'  --{n}:{value(v)};' for n, v in rows) + '\n}')
    return '\n'.join(out) + '\n'


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    css, target = build(), DS / 'tokens.css'
    if ap.parse_args().check:
        if not target.exists() or target.read_text() != css:
            raise SystemExit('tokens.css is stale: run scripts/build-tokens.py')
        print('tokens.css is current.')
    else:
        target.write_text(css)
        print('Wrote', target.relative_to(DS.parents[1]))
