#!/usr/bin/env python3
"""Regenerate docs/assets: README hero and protocol diagram (light + dark) and the GitHub social preview.

    python3 scripts/brand-assets.py
    # social-preview.png: render social-preview.svg at 1280x640, e.g. with headless Chrome:
    # chrome --headless=new --window-size=1280,640 --screenshot=docs/assets/social-preview.png file://$PWD/docs/assets/social-preview.svg
"""
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs" / "assets"
THEMES = {
    "light": dict(bg="#ffffff", fg="#0f172a", mut="#475569", card="#f8fafc", cardline="#e2e8f0", acc="#7c3aed", acc2="#0ea5e9", ok="#059669", dis="#e11d48"),
    "dark": dict(bg="#0d1117", fg="#e6edf3", mut="#9aa7b4", card="#161b22", cardline="#30363d", acc="#a78bfa", acc2="#38bdf8", ok="#34d399", dis="#fb7185"),
}
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
SEATS = ["Claude", "GPT", "Grok", "Gemini"]


def hero(t, w=1200, h=420, social=False):
    c = THEMES[t]
    sx, top, gap = (690, 70, 78) if not social else (760, 150, 92)
    ys = [top + i * gap for i in range(4)]
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="consensus: a panel of models debates until it agrees">',
           f'<rect width="{w}" height="{h}" rx="{0 if social else 16}" fill="{c["bg"]}"/>']
    if not social:
        out.append(f'<rect x="0.5" y="0.5" width="{w-1}" height="{h-1}" rx="16" fill="none" stroke="{c["cardline"]}"/>')
    tx, ty = (56, 150) if not social else (80, 250)
    big = 64 if not social else 84
    out += [f'<text x="{tx}" y="{ty}" font-family="{FONT}" font-size="{big}" font-weight="800" letter-spacing="-2" fill="{c["fg"]}">consensus</text>',
            f'<rect x="{tx}" y="{ty+22}" width="{big*1.1:.0f}" height="6" rx="3" fill="{c["acc"]}"/>']
    fs = 26 if not social else 32
    for i, line in enumerate(["A panel of frontier models argues", "until it agrees, and tells you", "what it still could not settle."]):
        out.append(f'<text x="{tx}" y="{ty+78+i*(fs+12)}" font-family="{FONT}" font-size="{fs}" font-weight="500" fill="{c["mut"]}">{line}</text>')
    cmd_y = ty + 78 + 3 * (fs + 12) + 22
    out.append(f'<text x="{tx}" y="{cmd_y}" font-family="{MONO}" font-size="{18 if not social else 22}" fill="{c["acc"]}">$ <tspan fill="{c["fg"]}">consensus "your hardest question"</tspan></text>')
    r = 26 if not social else 30
    for i, (name, y) in enumerate(zip(SEATS, ys)):
        out.append(f'<circle cx="{sx}" cy="{y}" r="{r}" fill="{c["card"]}" stroke="{c["acc2"] if i % 2 else c["acc"]}" stroke-width="2.5"/>')
        out.append(f'<text x="{sx}" y="{y+5}" text-anchor="middle" font-family="{FONT}" font-size="{13 if not social else 15}" font-weight="700" fill="{c["fg"]}">{name}</text>')
    for a, b, col in [(0, 1, "dis"), (1, 2, "dis"), (2, 3, "dis"), (0, 2, "ok"), (1, 3, "ok"), (0, 3, "ok")]:
        ya, yb = ys[a], ys[b]
        bulge = 40 + (b - a) * 38
        dash = ' stroke-dasharray="5 5"' if col == "dis" else ""
        out.append(f'<path d="M{sx+r},{ya} C{sx+r+bulge},{ya} {sx+r+bulge},{yb} {sx+r},{yb}" fill="none" stroke="{c[col]}" stroke-width="1.6"{dash} opacity="0.85"/>')
    cx = sx + r + 215
    mid = (ys[0] + ys[-1]) / 2
    x0 = sx + r + 150
    out.append(f'<path d="M{x0},{mid} L{cx-6},{mid}" stroke="{c["mut"]}" stroke-width="2"/><path d="M{cx-14},{mid-7} L{cx-3},{mid} L{cx-14},{mid+7}" fill="none" stroke="{c["mut"]}" stroke-width="2"/>')
    cw, ch = (230, 190) if not social else (250, 210)
    out.append(f'<rect x="{cx}" y="{mid-ch/2}" width="{cw}" height="{ch}" rx="14" fill="{c["card"]}" stroke="{c["acc"]}" stroke-width="2"/>')
    items = [("One answer", c["fg"], 700), ("Confidence: high", c["ok"], 600), ("Where they agreed", c["mut"], 500), ("Unresolved: 1", c["dis"], 600), ("Replayable debate", c["mut"], 500)]
    for i, (s, col, wt) in enumerate(items):
        out.append(f'<text x="{cx+20}" y="{mid-ch/2+38+i*34}" font-family="{FONT}" font-size="{17 if not social else 19}" font-weight="{wt}" fill="{col}">{s}</text>')
    ly = h - 30 if not social else h - 60
    out.append(f'<line x1="{sx-30}" y1="{ly}" x2="{sx}" y2="{ly}" stroke="{c["dis"]}" stroke-width="2" stroke-dasharray="5 5"/><text x="{sx+8}" y="{ly+5}" font-family="{FONT}" font-size="14" fill="{c["mut"]}">dispute</text>')
    out.append(f'<line x1="{sx+80}" y1="{ly}" x2="{sx+110}" y2="{ly}" stroke="{c["ok"]}" stroke-width="2"/><text x="{sx+118}" y="{ly+5}" font-family="{FONT}" font-size="14" fill="{c["mut"]}">agree</text>')
    out.append("</svg>")
    return "\n".join(out) + "\n"


def protocol(t):
    c = THEMES[t]
    w, h = 1100, 250
    steps = [("1  Propose", "every seat answers", "independently, in parallel"), ("2  Critique", "anonymized answers A, B, C", "falsifiable disputes, verdicts"),
             ("3  Revise", "concede or rebut", "every dispute, then rewrite"), ("4  Synthesize", "one answer, confidence,", "dissent, what changed")]
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="Protocol: propose, critique, revise, repeat until converged, synthesize">',
           f'<rect width="{w}" height="{h}" rx="16" fill="{c["bg"]}"/>']
    bw, bh, y0 = 220, 110, 40
    xs = [30 + i * (bw + 50) for i in range(4)]
    for i, (x, (a, b, d)) in enumerate(zip(xs, steps)):
        col = c["acc"] if i in (0, 3) else c["acc2"]
        out.append(f'<rect x="{x}" y="{y0}" width="{bw}" height="{bh}" rx="12" fill="{c["card"]}" stroke="{col}" stroke-width="2"/>')
        out.append(f'<text x="{x+18}" y="{y0+36}" font-family="{FONT}" font-size="20" font-weight="700" fill="{c["fg"]}">{a}</text>')
        out.append(f'<text x="{x+18}" y="{y0+66}" font-family="{FONT}" font-size="15" fill="{c["mut"]}">{b}</text>')
        out.append(f'<text x="{x+18}" y="{y0+88}" font-family="{FONT}" font-size="15" fill="{c["mut"]}">{d}</text>')
        if i < 3:
            ax = x + bw + 6
            out.append(f'<path d="M{ax},{y0+bh/2} L{ax+36},{y0+bh/2}" stroke="{c["mut"]}" stroke-width="2"/><path d="M{ax+29},{y0+bh/2-6} L{ax+38},{y0+bh/2} L{ax+29},{y0+bh/2+6}" fill="none" stroke="{c["mut"]}" stroke-width="2"/>')
    x1, x2 = xs[1] + bw / 2, xs[2] + bw / 2
    yb = y0 + bh
    out.append(f'<path d="M{x2},{yb+4} C{x2},{yb+62} {x1},{yb+62} {x1},{yb+10}" fill="none" stroke="{c["dis"]}" stroke-width="2" stroke-dasharray="6 5"/><path d="M{x1-6},{yb+18} L{x1},{yb+6} L{x1+6},{yb+18}" fill="none" stroke="{c["dis"]}" stroke-width="2"/>')
    out.append(f'<text x="{(x1+x2)/2}" y="{yb+76}" text-anchor="middle" font-family="{FONT}" font-size="15" fill="{c["mut"]}">repeat while any seat still disputes an answer (up to --rounds); a captain moderates and can end a stalemate</text>')
    out.append("</svg>")
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for t in THEMES:
        (OUT / f"hero-{t}.svg").write_text(hero(t))
        (OUT / f"protocol-{t}.svg").write_text(protocol(t))
    (OUT / "social-preview.svg").write_text(hero("dark", 1280, 640, social=True))
