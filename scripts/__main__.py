"""CLI entry points for MTGGraph.

Usage:
    python -m scripts ingest <file_or_text>    Ingest a decklist
    python -m scripts compute                  Recompute graph.json
    python -m scripts serve                    Serve the web app locally
"""
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
KNOWLEDGE_DIR = ROOT / "knowledge"
COMPUTED_DIR = ROOT / "computed"
WEB_DIR = ROOT / "web"


def cmd_ingest(args):
    from scripts.ingest import ingest_list

    if not args:
        print("Usage: python -m scripts ingest <file_path>")
        sys.exit(1)

    path = Path(args[0])
    if path.exists():
        raw_text = path.read_text()
    else:
        print(f"File not found: {path}")
        sys.exit(1)

    threshold = 0.6
    arch_name = None
    arch_slug = None
    arch_desc = ""

    def _get_flag(flag):
        if flag in args:
            idx = args.index(flag)
            return args[idx + 1]
        return None

    threshold = float(_get_flag("--threshold") or 0.6)
    arch_name = _get_flag("--name")
    arch_slug = _get_flag("--slug")
    arch_desc = _get_flag("--desc") or ""

    result = ingest_list(
        raw_text, KNOWLEDGE_DIR,
        threshold=threshold,
        archetype_name=arch_name,
        archetype_slug=arch_slug,
        archetype_description=arch_desc,
    )

    if result.get("duplicate_of"):
        print(f"SKIPPED: duplicate of {result['duplicate_of']}")
        sys.exit(0)

    if result.get("needs_archetype"):
        print("New archetype needed! Top cards:")
        for card in result["top_cards"]:
            print(f"  {card}")
        print(f"Colors: {result['colors']}")
        print("\nRe-run with --name 'Archetype Name' --slug archetype-slug --desc 'Description'")
        sys.exit(0)

    status = "NEW archetype" if result["is_new_archetype"] else "matched"
    print(f"Archetype: {result['archetype']} ({status})")
    print(f"List saved: {result['list_path']}")


def cmd_compute(args):
    from scripts.compute import write_graph

    output = COMPUTED_DIR / "graph.json"
    write_graph(KNOWLEDGE_DIR, output)
    print(f"Graph written to {output}")


def cmd_serve(args):
    import http.server
    import functools

    port = 8080
    if args:
        port = int(args[0])

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    server = http.server.HTTPServer(("", port), handler)
    print(f"Serving at http://localhost:{port}")
    server.serve_forever()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]
    args = sys.argv[2:]

    commands = {
        "ingest": cmd_ingest,
        "compute": cmd_compute,
        "serve": cmd_serve,
    }

    if command not in commands:
        print(f"Unknown command: {command}")
        print(__doc__)
        sys.exit(1)

    commands[command](args)


if __name__ == "__main__":
    main()
