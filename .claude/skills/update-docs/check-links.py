#!/usr/bin/env python3
"""Resolve every relative link and #anchor across the repo's markdown docs.

Run from the repository root:

    python3 .claude/skills/update-docs/check-links.py

Exits non-zero and lists the offenders when a link points at a missing file or a
heading that does not exist. Files outside DOCS are checked as link *targets*
(their headings are read) but their own links are not walked.
"""
import re
import sys
from pathlib import Path

DOCS = [
    "README.md",
    "FEATURES.md",
    "UI-SHELL.md",
    "ARCHITECTURE.md",
    "WEB-COMPONENTS.md",
    "BUILD.md",
    "TESTING.md",
    "TROUBLESHOOTING.md",
    "content/CLAUDE.md",
    "WIDGET-REFERENZ.md",
]

LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
HEADING = re.compile(r"^(#{1,6})\s+(.*)$", re.MULTILINE)
CODE_FENCE = re.compile(r"^```.*?^```", re.MULTILINE | re.DOTALL)


def slug(title: str) -> str:
    """GitHub's heading slug: lowercase, punctuation dropped, spaces to hyphens."""
    text = title.strip().lower()
    text = re.sub(r"[`*_\[\]()]", "", text)
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    return re.sub(r"\s", "-", text.strip())


def anchors_of(path: Path) -> set[str]:
    body = CODE_FENCE.sub("", path.read_text(encoding="utf-8"))
    return {slug(title) for _, title in HEADING.findall(body)}


def main() -> int:
    root = Path.cwd()
    anchors: dict[str, set[str]] = {}
    problems: list[str] = []

    for name in DOCS:
        path = root / name
        if path.exists():
            anchors[name] = anchors_of(path)
        else:
            problems.append(f"{name}: listed in this script but missing from the repo")

    for name in DOCS:
        path = root / name
        if not path.exists():
            continue
        body = CODE_FENCE.sub("", path.read_text(encoding="utf-8"))
        for target in LINK.findall(body):
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            file_part, _, fragment = target.partition("#")
            if file_part:
                resolved = (path.parent / file_part).resolve()
                if not resolved.exists():
                    problems.append(f"{name} → {target}: no such file")
                    continue
                key = str(resolved.relative_to(root))
                known = anchors.get(key)
                if known is None and resolved.suffix == ".md":
                    known = anchors_of(resolved)
                if fragment and known is not None and fragment not in known:
                    problems.append(f"{name} → {target}: no such heading in {key}")
            elif fragment and fragment not in anchors[name]:
                problems.append(f"{name} → #{fragment}: no such heading here")

    if problems:
        print(f"{len(problems)} broken link(s):")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    print(f"all links resolve across {len(anchors)} documents")
    return 0


if __name__ == "__main__":
    sys.exit(main())
