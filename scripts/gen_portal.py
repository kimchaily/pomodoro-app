#!/usr/bin/env python3
"""Generate the deploy portal (preview/index.html).

Run from the root of the gh-pages checkout. Scans preview/*/preview-meta.json
and writes a static page linking to production and every active PR preview.
No server-side listing or client fetch needed – the page is fully rendered
at deploy time, so it always matches what's actually published.

Usage: gen_portal.py --repo owner/name [--root .]
"""

import argparse
import html
import json
import os
from datetime import datetime, timezone


def load_previews(preview_dir):
    items = []
    if not os.path.isdir(preview_dir):
        return items
    for slug in sorted(os.listdir(preview_dir)):
        path = os.path.join(preview_dir, slug)
        if not os.path.isdir(path):
            continue  # skip index.html and stray files
        meta = {"slug": slug, "branch": slug, "pr": None, "updated": None, "sha": None}
        meta_file = os.path.join(path, "preview-meta.json")
        if os.path.isfile(meta_file):
            try:
                with open(meta_file, encoding="utf-8") as fh:
                    meta.update({k: v for k, v in json.load(fh).items() if v is not None})
            except (OSError, ValueError):
                pass
        items.append(meta)
    return items


def fmt_date(iso):
    if not iso:
        return ""
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%d.%m.%Y %H:%M UTC")
    except ValueError:
        return iso


def render(previews, repo):
    esc = html.escape
    now = datetime.now(timezone.utc).strftime("%d.%m.%Y %H:%M UTC")

    cards = []
    for p in previews:
        branch = esc(str(p.get("branch") or p["slug"]))
        slug = esc(p["slug"])
        pr = p.get("pr")
        meta_bits = []
        if pr:
            meta_bits.append(
                f'<a class="pr" href="https://github.com/{esc(repo)}/pull/{esc(str(pr))}" '
                f'target="_blank" rel="noopener">PR #{esc(str(pr))}</a>'
            )
        updated = fmt_date(p.get("updated"))
        if updated:
            meta_bits.append(f"<span>aktualisiert {esc(updated)}</span>")
        sha = p.get("sha")
        if sha:
            meta_bits.append(f"<code>{esc(str(sha))}</code>")
        meta_html = " · ".join(meta_bits) or "&nbsp;"
        # Not a single <a> wrapper: the meta contains a PR link, and nested
        # anchors are invalid HTML. Keep the branch title and "Öffnen" as
        # separate links instead.
        cards.append(
            f"""      <div class="card preview">
        <a class="branch" href="./{slug}/">{branch}</a>
        <span class="meta">{meta_html}</span>
        <a class="go" href="./{slug}/">Öffnen →</a>
      </div>"""
        )

    if previews:
        preview_section = "\n".join(cards)
    else:
        preview_section = (
            '      <p class="empty">Keine aktiven Vorschauen. '
            "Öffne einen Pull Request, um hier eine zu bekommen.</p>"
        )

    return f"""<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>🍅 Pomodoro – Deploy-Portal</title>
<style>
  :root {{
    --accent: #e25555; --bg: #f7f3ef; --card: #fff; --text: #2b2b2b;
    --muted: #8a8a8a; --line: #00000012; --shadow: 0 4px 18px #00000014;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --bg: #191a1f; --card: #24262d; --text: #ececec;
      --muted: #9a9aa3; --line: #ffffff1a; --shadow: 0 4px 18px #00000055;
    }}
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; min-height: 100vh; padding: 32px 16px 56px;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--text);
  }}
  .wrap {{ max-width: 560px; margin: 0 auto; }}
  h1 {{ font-size: 1.5rem; margin: 0 0 4px; }}
  .sub {{ color: var(--muted); margin: 0 0 26px; font-size: .9rem; }}
  h2 {{
    font-size: .8rem; text-transform: uppercase; letter-spacing: .5px;
    color: var(--muted); margin: 28px 0 10px;
  }}
  .card {{
    display: flex; flex-direction: column; gap: 4px;
    background: var(--card); border: 1px solid var(--line);
    border-radius: 14px; padding: 16px 18px; margin-bottom: 10px;
    text-decoration: none; color: inherit; box-shadow: var(--shadow);
    transition: transform .1s, border-color .2s;
  }}
  .card:hover {{ transform: translateY(-2px); border-color: var(--accent); }}
  .card.prod {{ border-left: 5px solid var(--accent); }}
  .card.preview {{ border-left: 5px solid #3a7bd5; }}
  .title, .branch {{ font-weight: 700; font-size: 1.05rem; word-break: break-word; }}
  a.branch {{ color: inherit; text-decoration: none; }}
  a.branch:hover {{ color: var(--accent); }}
  a.go {{ text-decoration: none; }}
  .meta {{ color: var(--muted); font-size: .82rem; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }}
  .meta code {{ font-size: .78rem; background: var(--line); padding: 1px 6px; border-radius: 6px; }}
  .meta a.pr {{ color: var(--accent); text-decoration: none; font-weight: 600; }}
  .go {{ color: var(--accent); font-weight: 600; font-size: .85rem; margin-top: 2px; }}
  .empty {{ color: var(--muted); background: var(--card); border: 1px dashed var(--line);
            border-radius: 14px; padding: 20px; text-align: center; }}
  footer {{ color: var(--muted); font-size: .78rem; margin-top: 34px; text-align: center; }}
</style>
</head>
<body>
  <div class="wrap">
    <h1>🍅 Pomodoro – Deploy-Portal</h1>
    <p class="sub">Produktion und alle offenen PR-Vorschauen an einem Ort.</p>

    <h2>Produktion</h2>
    <a class="card prod" href="../">
      <span class="title">Produktion (main)</span>
      <span class="meta">Aktueller Stand des <code>main</code>-Branches</span>
      <span class="go">Öffnen →</span>
    </a>

    <h2>PR-Vorschauen</h2>
{preview_section}

    <footer>Automatisch erzeugt am {now}</footer>
  </div>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="owner/name")
    ap.add_argument("--root", default=".", help="gh-pages root (default: cwd)")
    args = ap.parse_args()

    preview_dir = os.path.join(args.root, "preview")
    os.makedirs(preview_dir, exist_ok=True)
    previews = load_previews(preview_dir)
    out = os.path.join(preview_dir, "index.html")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(render(previews, args.repo))
    print(f"Portal geschrieben: {out} ({len(previews)} Vorschau(en))")


if __name__ == "__main__":
    main()
