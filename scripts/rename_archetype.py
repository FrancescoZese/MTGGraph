"""Rename an archetype across the entire knowledge base.

Usage:
    python -m scripts.rename_archetype <old-slug> <new-slug> <new-name>

Example:
    python -m scripts.rename_archetype unknown-1 mono-red-burn "Mono Red Burn"

This will:
1. Rename the archetype markdown file
2. Update the name in its frontmatter
3. Update the archetype field in all lists that reference it
"""
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).parent.parent
KNOWLEDGE_DIR = ROOT / "knowledge"


def rename_archetype(old_slug: str, new_slug: str, new_name: str) -> dict:
    archetypes_dir = KNOWLEDGE_DIR / "archetypes"
    lists_dir = KNOWLEDGE_DIR / "lists"

    old_path = archetypes_dir / f"{old_slug}.md"
    new_path = archetypes_dir / f"{new_slug}.md"

    if not old_path.exists():
        return {"error": f"Archetype file not found: {old_path}"}

    if new_path.exists() and old_slug != new_slug:
        return {"error": f"Target archetype already exists: {new_path}"}

    # Read existing archetype file
    text = old_path.read_text()
    parts = text.split("---", 2)
    fm = yaml.safe_load(parts[1]) or {}
    body = parts[2].strip() if len(parts) > 2 else ""

    # Update name
    fm["name"] = new_name

    # Write new file
    content = "---\n" + yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False) + "---\n"
    if body:
        content += body + "\n"
    new_path.write_text(content)

    # Remove old file if slug changed
    if old_slug != new_slug and old_path.exists():
        old_path.unlink()

    # Update all lists that reference the old slug
    updated_lists = 0
    for list_path in lists_dir.glob("*.md"):
        text = list_path.read_text()
        parts = text.split("---", 2)
        if len(parts) < 2:
            continue
        fm = yaml.safe_load(parts[1]) or {}
        if fm.get("archetype") == old_slug:
            fm["archetype"] = new_slug
            body = parts[2] if len(parts) > 2 else ""
            new_content = "---\n" + yaml.dump(fm, default_flow_style=False) + "---" + body
            list_path.write_text(new_content)
            updated_lists += 1

    return {
        "old_slug": old_slug,
        "new_slug": new_slug,
        "new_name": new_name,
        "lists_updated": updated_lists,
    }


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)

    old_slug = sys.argv[1]
    new_slug = sys.argv[2]
    new_name = sys.argv[3]

    result = rename_archetype(old_slug, new_slug, new_name)

    if "error" in result:
        print(f"ERROR: {result['error']}")
        sys.exit(1)

    print(f"Renamed: {old_slug} -> {new_slug} ({new_name})")
    print(f"Lists updated: {result['lists_updated']}")


if __name__ == "__main__":
    main()
