#!/usr/bin/env python3
"""Write preview-meta.json for a preview deployment.

Used by the Pages workflow so the deploy portal can show the real branch
name, PR number and last-updated time for each preview.
"""

import argparse
import json
import os
from datetime import datetime, timezone


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="preview directory (e.g. preview/<slug>)")
    ap.add_argument("--slug", required=True)
    ap.add_argument("--branch", default="")
    ap.add_argument("--pr", default="")
    ap.add_argument("--sha", default="")
    args = ap.parse_args()

    os.makedirs(args.dir, exist_ok=True)
    meta = {
        "slug": args.slug,
        "branch": args.branch or args.slug,
        "pr": int(args.pr) if args.pr.isdigit() else None,
        "sha": args.sha or None,
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    with open(os.path.join(args.dir, "preview-meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
    print(f"Metadaten geschrieben: {args.dir}/preview-meta.json")


if __name__ == "__main__":
    main()
