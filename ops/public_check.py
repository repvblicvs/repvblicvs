#!/usr/bin/env python3
"""Check staged/public source for common accidental private disclosure."""
from __future__ import annotations
import argparse
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_EMAILS = {"repvblicvs@gmail.com", "310353846+repvblicvs@users.noreply.github.com"}
EMAIL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
RULES = [("absolute home path", re.compile(r"/(?:Users|home)/[A-Za-z0-9_.-]+")),
         ("credential-shaped value", re.compile(r"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_(?:live|test)_[A-Za-z0-9]{12,}|AIza[A-Za-z0-9_-]{25,})")),
         ("private key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
         ("payment account identifier", re.compile(r"\bacct_[A-Za-z0-9]{8,}\b"))]

def issues(path: str, data: str) -> list[str]:
    found = []
    if any(p in {".private", "customer-work", ".env"} for p in Path(path).parts):
        found.append("private file included")
    for label, pattern in RULES:
        if pattern.search(data):
            found.append(label)
    if any(m.group(0).lower() not in ALLOWED_EMAILS for m in EMAIL.finditer(data)):
        found.append("email outside public allowlist")
    private_terms = ROOT / ".private" / "denylist.txt"
    if private_terms.exists():
        for term in private_terms.read_text().splitlines():
            if len(term.strip()) >= 3 and term.strip().casefold() in data.casefold():
                found.append("private denylist match")
                break
    return found

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged", action="store_true", help="inspect staged blob contents")
    args = parser.parse_args()
    command = ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"] if args.staged else ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"]
    paths = subprocess.check_output(command, cwd=ROOT).decode().split("\0")
    failed = False
    count = 0
    for path in sorted(set(filter(None, paths))):
        if args.staged:
            raw = subprocess.check_output(["git", "show", ":" + path], cwd=ROOT)
        else:
            raw = (ROOT / path).read_bytes()
        try:
            data = raw.decode("utf-8")
        except UnicodeDecodeError:
            print(f"REFUSED {path}: binary requires separate review")
            failed = True
            continue
        count += 1
        matches = issues(path, data)
        if matches:
            print(f"REFUSED {path}: {', '.join(matches)}")
            failed = True
    print(f"Public source check: {'REFUSED' if failed else 'PASS'} ({count} text files)")
    return int(failed)

if __name__ == "__main__":
    sys.exit(main())
