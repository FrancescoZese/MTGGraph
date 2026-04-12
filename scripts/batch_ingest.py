"""Batch ingest multiple decklists, prompting for new archetypes interactively.

Usage:
    python -m scripts.batch_ingest raw/2026-04-10-*.md
    python -m scripts.batch_ingest raw/*.md --threshold 0.5

Ingests all given files. When a new archetype is needed, shows the top cards
and asks for name/slug/description interactively. Runs compute at the end.
"""
import glob
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
KNOWLEDGE_DIR = ROOT / "knowledge"
COMPUTED_DIR = ROOT / "computed"


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)

    threshold = 0.6
    if "--threshold" in args:
        idx = args.index("--threshold")
        threshold = float(args[idx + 1])
        args = args[:idx] + args[idx + 2:]

    # Expand globs
    files = []
    for pattern in args:
        expanded = sorted(glob.glob(pattern))
        files.extend(expanded)

    if not files:
        print("No files found")
        sys.exit(1)

    print(f"Ingesting {len(files)} lists (threshold={threshold})")
    print()

    # Import here to avoid slow startup
    from scripts.ingest import ingest_list
    from scripts.compute import write_graph

    ingested = 0
    skipped = 0
    new_archetypes = []

    for filepath in files:
        path = Path(filepath)
        raw_text = path.read_text()
        pilot = "unknown"

        # Quick extract pilot from frontmatter for display
        for line in raw_text.splitlines():
            if line.startswith("pilot:"):
                pilot = line.split(":", 1)[1].strip()
                break

        print(f"--- {path.name} ({pilot}) ---")

        result = ingest_list(raw_text, KNOWLEDGE_DIR, threshold=threshold)

        if result.get("duplicate_of"):
            print(f"  SKIP: duplicate")
            skipped += 1
            continue

        if result.get("needs_archetype"):
            print(f"  NEW ARCHETYPE needed")
            print(f"  Colors: {result['colors']}")
            print(f"  Top cards:")
            for card in result["top_cards"][:8]:
                print(f"    {card}")

            name = input("  Archetype name (or 'skip' to skip this list): ").strip()
            if name.lower() == "skip":
                print("  Skipped")
                skipped += 1
                continue

            slug = input(f"  Slug [{_auto_slug(name)}]: ").strip()
            if not slug:
                slug = _auto_slug(name)

            desc = input("  Description (1-2 sentences): ").strip()

            result = ingest_list(
                raw_text, KNOWLEDGE_DIR,
                threshold=threshold,
                archetype_name=name,
                archetype_slug=slug,
                archetype_description=desc,
            )
            new_archetypes.append(name)

        status = "NEW" if result.get("is_new_archetype") else "matched"
        print(f"  -> {result['archetype']} ({status})")
        ingested += 1

    print(f"\n{'='*50}")
    print(f"Ingested: {ingested}, Skipped: {skipped}")
    if new_archetypes:
        print(f"New archetypes: {', '.join(new_archetypes)}")

    if ingested > 0:
        print(f"\nRecomputing graph...")
        output = COMPUTED_DIR / "graph.json"
        write_graph(KNOWLEDGE_DIR, output)
        print(f"Done! Graph written to {output}")
        print(f"META.md updated at {KNOWLEDGE_DIR / 'META.md'}")


def _auto_slug(name: str) -> str:
    import re
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


if __name__ == "__main__":
    main()
