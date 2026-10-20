"""Builds the README diagrams as themed pages, docs/diagrams/*.html (SVG inside).

The PNGs next to them are screenshots of these pages at their natural size:

    python scripts/build_diagrams.py
    chrome --headless=new --window-size=1200,600 --screenshot=docs/diagrams/architecture.png docs/diagrams/architecture.html
    chrome --headless=new --window-size=1200,820 --screenshot=docs/diagrams/sign-in-flow.png docs/diagrams/sign-in-flow.html
"""
from html import escape

BG = "#0A0A0D"; CARD = "#1E1E25"; LINE = "rgba(255,255,255,.14)"; TEXT = "#F4F4F6"; MUTED = "#A3A3AE"
RED = "#FF2D55"; PURPLE = "#9B5CFF"; GREEN = "#47A248"

HEAD = f"""<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;background:{BG};overflow:hidden}}
text{{font-family:"Segoe UI",system-ui,sans-serif}}
</style>"""

DEFS = f"""<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{RED}"/><stop offset="1" stop-color="{PURPLE}"/></linearGradient>
<radialGradient id="glow" cx="20%" cy="0%" r="80%"><stop offset="0" stop-color="{RED}" stop-opacity=".16"/><stop offset="1" stop-color="{RED}" stop-opacity="0"/></radialGradient>
<radialGradient id="glow2" cx="95%" cy="100%" r="70%"><stop offset="0" stop-color="{PURPLE}" stop-opacity=".16"/><stop offset="1" stop-color="{PURPLE}" stop-opacity="0"/></radialGradient>
<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="{TEXT}"/></marker>
<marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="{RED}"/></marker>
<marker id="ap" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="{PURPLE}"/></marker>
<marker id="ag" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="{GREEN}"/></marker>
</defs>"""


def t(x, y, s, size=16, fill=TEXT, weight=400, anchor="start", extra=""):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" font-weight="{weight}" text-anchor="{anchor}" {extra}>{escape(s)}</text>'


def card(x, y, w, h, title, sub, accent=None, sub2=None):
    stroke = accent or LINE
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{CARD}" stroke="{stroke}" stroke-width="{1.6 if accent else 1}"/>']
    if accent:
        out.append(f'<rect x="{x}" y="{y+14}" width="4" height="{h-28}" rx="2" fill="{accent}"/>')
    out.append(t(x + 22, y + 36, title, 19, TEXT, 650))
    out.append(t(x + 22, y + 60, sub, 14, MUTED))
    if sub2:
        out.append(t(x + 22, y + 80, sub2, 14, MUTED))
    return "".join(out)


def region(x, y, w, h, label, color=MUTED):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="26" fill="rgba(255,255,255,.025)" stroke="{LINE}" stroke-dasharray="6 6"/>'
            + t(x + 24, y + 34, label, 13, color, 700, extra='letter-spacing="1.6"'))


def pill(x, y, w, label, color):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="30" rx="15" fill="rgba(255,45,85,.14)" stroke="{color}" stroke-width="1"/>'
            + t(x + w / 2, y + 20, label, 13.5, "#FF8AA0", 650, "middle"))


def arrow(d, color=TEXT, marker="ah", both=False, dash=False, width=2.2):
    start = f' marker-start="url(#{marker})"' if both else ""
    dashes = ' stroke-dasharray="7 6"' if dash else ""
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"{dashes} marker-end="url(#{marker})"{start}/>'


def label(x, y, s, size=13.5, color=MUTED, anchor="middle", bg=True):
    w = len(s) * size * 0.54 + 20
    rect = (f'<rect x="{x - w/2 if anchor=="middle" else x-10}" y="{y-size-3}" width="{w}" height="{size+10}" rx="8" fill="{BG}" opacity=".92"/>' if bg else "")
    return rect + t(x, y, s, size, color, 500, anchor)


def page(w, h, body):
    return (HEAD + f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{DEFS}'
            f'<rect width="{w}" height="{h}" fill="{BG}"/><rect width="{w}" height="{h}" fill="url(#glow)"/><rect width="{w}" height="{h}" fill="url(#glow2)"/>'
            + body + "</svg>")


# ---------------------------------------------------------------- architecture --------
def architecture():
    b = []
    b.append(t(48, 58, "How Ekho fits together", 30, TEXT, 700))
    b.append(t(48, 90, "Audio stays on the phone. Only text reaches the server.", 17, MUTED))

    b.append(region(40, 124, 470, 440, "ON THE PHONE", "#FF8AA0"))
    b.append(card(64, 176, 196, 92, "React UI", "screens in a WebView"))
    b.append(card(300, 176, 190, 92, "Native shell", "Expo: record, store, share"))
    b.append(arrow("M262 222 H298", both=True, width=2))
    b.append(label(280, 206, "bridge", 12.5, MUTED, bg=False))
    b.append(card(64, 340, 196, 92, "whisper.cpp", "speech-to-text, on device", RED))
    b.append(card(300, 340, 190, 92, "SQLite + audio", "source of truth", RED))
    b.append(arrow("M345 268 L215 338", RED, "ar", width=2))
    b.append(arrow("M410 268 V338", RED, "ar", width=2))
    b.append(pill(64, 508, 236, "Audio never leaves this box", RED))

    b.append(region(630, 124, 290, 440, "THE SERVER  (DOCKER + CADDY, AWS)", MUTED))
    b.append(card(654, 176, 242, 100, "FastAPI", "accounts, sync, search", RED))
    b.append(card(654, 340, 242, 100, "MCP server + OAuth", "read-only tools for assistants", PURPLE))
    b.append(arrow("M490 214 C560 214 580 226 652 226", TEXT, "ah", width=2.4))
    b.append(label(572, 192, "text only", 13, TEXT))
    b.append(label(572, 262, "outbox sync", 12.5, MUTED))

    b.append(card(968, 160, 200, 120, "MongoDB Atlas", "Search, Vector Search,", GREEN, "aggregation, TTL indexes"))
    b.append(arrow("M896 226 H966", GREEN, "ag", both=True, width=2.4))
    b.append(label(931, 206, "queries", 12.5, MUTED))

    b.append(card(968, 336, 200, 108, "Claude, ChatGPT", "and other MCP assistants", PURPLE))
    b.append(arrow("M896 390 H966", PURPLE, "ap", both=True, width=2.4))
    b.append(label(931, 370, "MCP", 12.5, MUTED))
    b.append(arrow("M775 340 C775 312 800 296 1010 284", PURPLE, "ap", width=1.8, dash=True))
    b.append(label(900, 318, "reads lectures, scoped to the user", 12.5, "#C7A8FF"))
    b.append(t(1168, 560, "Ekho", 14, "#555560", 600, "end"))
    return page(1200, 600, "".join(b))


# ---------------------------------------------------------------- sign-in / MCP flow ---
def oauth_flow():
    W, H = 1200, 820
    xs = {"you": 150, "ai": 470, "ekho": 800, "db": 1060}
    b = []
    b.append(t(48, 52, "How an assistant connects and answers", 30, TEXT, 700))
    b.append(t(48, 84, "OAuth sign-in once, then read-only tools scoped to the signed-in user.", 17, MUTED))

    heads = [("you", "You", "student", None), ("ai", "Claude / ChatGPT", "the assistant", PURPLE),
             ("ekho", "Ekho server", "MCP + OAuth", RED), ("db", "MongoDB Atlas", "Search + Vector Search", GREEN)]
    for key, title, sub, acc in heads:
        x = xs[key]
        b.append(f'<line x1="{x}" y1="170" x2="{x}" y2="{H-40}" stroke="{LINE}" stroke-width="1.5" stroke-dasharray="3 7"/>')
        b.append(f'<rect x="{x-95}" y="104" width="190" height="64" rx="14" fill="{CARD}" stroke="{acc or LINE}" stroke-width="{1.6 if acc else 1}"/>')
        b.append(t(x, 132, title, 17, TEXT, 650, "middle"))
        b.append(t(x, 154, sub, 13, MUTED, 400, "middle"))

    steps = [
        ("you", "ai", "Add Ekho as a connector (paste its address)", False, TEXT),
        ("ai", "ekho", "Discover endpoints (RFC 9728, RFC 8414), register or fetch client metadata", False, TEXT),
        ("ai", "you", "Open the Ekho sign-in page", True, TEXT),
        ("you", "ekho", "Sign in with Google and approve (read-only)", False, RED),
        ("ekho", "ai", "One-time code, then a short-lived token (PKCE, bound to this server)", True, RED),
        ("ai", "ekho", 'Ask: find_similar, search_lectures, topics ...', False, PURPLE),
        ("ekho", "db", "$vectorSearch, $search, aggregation, filtered to the user", False, GREEN),
        ("db", "ekho", "Matching passages", True, GREEN),
        ("ekho", "ai", "Results, labelled as data and never as instructions", True, PURPLE),
    ]
    y = 226
    markers = {TEXT: "ah", RED: "ar", PURPLE: "ap", GREEN: "ag"}
    for i, (a, c, text, dashed, color) in enumerate(steps, 1):
        x1, x2 = xs[a], xs[c]
        direction = 1 if x2 > x1 else -1
        b.append(arrow(f"M{x1} {y} H{x2 - 2*direction}", color, markers[color], dash=dashed, width=2.4))
        b.append(f'<circle cx="{x1 + (-26 if direction < 0 else -26)}" cy="{y}" r="0" fill="none"/>')
        mid = (x1 + x2) / 2
        b.append(label(mid, y - 12, text, 14.5, TEXT if color == TEXT else color if color != RED else "#FF8AA0"))
        # step badge on the left margin
        b.append(f'<circle cx="52" cy="{y}" r="15" fill="url(#g)"/>' + t(52, y + 5, str(i), 14, "#fff", 700, "middle"))
        y += 66
    b.append(t(48, H - 18, "Tokens are single-purpose: valid only for this server, rotated on every refresh, revoked as a set if reuse is detected.", 14, "#82828C"))
    return page(W, H, "".join(b))


if __name__ == "__main__":
    open("docs/diagrams/architecture.html", "w", encoding="utf-8").write(architecture())
    open("docs/diagrams/sign-in-flow.html", "w", encoding="utf-8").write(oauth_flow())
    print("written")
