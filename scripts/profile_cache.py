"""Cached archetype profiles and dedup index for fast batch ingestion.

Loads all list files once, builds archetype profiles and a dedup index
in memory. Supports incremental updates when new lists are ingested.
"""
import json
from pathlib import Path

import yaml

from scripts.parser import parse_decklist
from scripts.similarity import card_weights


class ProfileCache:
    """In-memory cache of archetype profiles and list metadata for fast lookups."""

    def __init__(self, knowledge_dir: Path):
        self.knowledge_dir = Path(knowledge_dir)
        self.lists_dir = self.knowledge_dir / "lists"

        # archetype_slug -> {card_name: avg_weight, ...}
        self.profiles: dict[str, dict[str, float]] = {}

        # archetype_slug -> list of parsed decklists
        self._lists_by_arch: dict[str, list[dict]] = {}

        # set of (date, pilot, source) tuples for dedup
        self._dedup_keys: set[tuple[str, str, str]] = set()

        self._loaded = False

    def load(self):
        """Load all list files and build profiles + dedup index."""
        if self._loaded:
            return

        print("  Loading profile cache...", flush=True)
        count = 0
        for path in self.lists_dir.glob("*.md"):
            text = path.read_text()
            parsed = parse_decklist(text)
            meta = parsed["metadata"]

            # Dedup index
            key = (str(meta.get("date", "")),
                   str(meta.get("pilot", "")),
                   str(meta.get("source", "")))
            self._dedup_keys.add(key)

            # Group by archetype
            arch = meta.get("archetype")
            if arch:
                if arch not in self._lists_by_arch:
                    self._lists_by_arch[arch] = []
                self._lists_by_arch[arch].append(parsed)
            count += 1

        # Build profiles
        for slug, arch_lists in self._lists_by_arch.items():
            self.profiles[slug] = self._compute_profile(arch_lists)

        print(f"  Loaded {count} lists, {len(self.profiles)} archetype profiles", flush=True)
        self._loaded = True

    def is_duplicate(self, metadata: dict) -> bool:
        """Check if a list with same date+pilot+source already exists."""
        key = (str(metadata.get("date", "")),
               str(metadata.get("pilot", "")),
               str(metadata.get("source", "")))
        return key in self._dedup_keys

    def add_list(self, parsed: dict, archetype_slug: str):
        """Update cache after a new list has been ingested."""
        meta = parsed["metadata"]
        key = (str(meta.get("date", "")),
               str(meta.get("pilot", "")),
               str(meta.get("source", "")))
        self._dedup_keys.add(key)

        if archetype_slug not in self._lists_by_arch:
            self._lists_by_arch[archetype_slug] = []
        self._lists_by_arch[archetype_slug].append(parsed)

        # Recompute profile for this archetype only
        self.profiles[archetype_slug] = self._compute_profile(
            self._lists_by_arch[archetype_slug]
        )

    @staticmethod
    def _compute_profile(arch_lists: list[dict]) -> dict[str, float]:
        """Compute average card weight profile from a list of parsed decklists."""
        card_totals: dict[str, float] = {}
        count = len(arch_lists)
        if count == 0:
            return {}

        for parsed in arch_lists:
            weights = card_weights(parsed["mainboard"], parsed["sideboard"])
            for card, weight in weights.items():
                card_totals[card] = card_totals.get(card, 0.0) + weight

        return {card: total / count for card, total in card_totals.items()}
