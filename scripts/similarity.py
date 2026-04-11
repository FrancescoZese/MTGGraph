COPY_WEIGHTS = {4: 1.0, 3: 0.75, 2: 0.5, 1: 0.25}
SIDEBOARD_MULTIPLIER = 0.5


def card_weights(mainboard: dict[str, int], sideboard: dict[str, int]) -> dict[str, float]:
    """Convert mainboard/sideboard card counts to weighted representation.

    4-of = 1.0, 3-of = 0.75, 2-of = 0.5, 1-of = 0.25.
    Sideboard cards get an additional 0.5 multiplier.
    """
    weights = {}
    for name, count in mainboard.items():
        weights[name] = COPY_WEIGHTS.get(count, count / 4.0)
    for name, count in sideboard.items():
        weights[name] = COPY_WEIGHTS.get(count, count / 4.0) * SIDEBOARD_MULTIPLIER
    return weights


def weighted_jaccard(a: dict[str, float], b: dict[str, float]) -> float:
    """Compute weighted Jaccard similarity between two card weight dicts."""
    all_cards = set(a.keys()) | set(b.keys())
    if not all_cards:
        return 0.0

    intersection = sum(min(a.get(c, 0.0), b.get(c, 0.0)) for c in all_cards)
    union = sum(max(a.get(c, 0.0), b.get(c, 0.0)) for c in all_cards)

    if union == 0.0:
        return 0.0
    return intersection / union


def find_best_match(
    list_weights: dict[str, float],
    archetype_profiles: dict[str, dict[str, float]],
    threshold: float = 0.6,
) -> tuple[str | None, float]:
    """Find the archetype most similar to the given list.

    Returns (archetype_slug, similarity_score) or (None, 0.0) if none above threshold.
    """
    if not archetype_profiles:
        return None, 0.0

    best_slug = None
    best_score = 0.0

    for slug, profile in archetype_profiles.items():
        score = weighted_jaccard(list_weights, profile)
        if score > best_score:
            best_score = score
            best_slug = slug

    if best_score >= threshold:
        return best_slug, best_score
    return None, 0.0
