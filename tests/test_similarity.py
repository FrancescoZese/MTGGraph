import pytest
from scripts.similarity import card_weights, weighted_jaccard, find_best_match


def test_card_weights_mainboard():
    mainboard = {"Ragavan, Nimble Pilferer": 4, "Ajani, Nacatl Pariah": 2}
    sideboard = {}
    weights = card_weights(mainboard, sideboard)
    assert weights["Ragavan, Nimble Pilferer"] == 1.0
    assert weights["Ajani, Nacatl Pariah"] == 0.5


def test_card_weights_with_sideboard():
    mainboard = {"Lightning Bolt": 4}
    sideboard = {"Rest in Peace": 2}
    weights = card_weights(mainboard, sideboard)
    assert weights["Lightning Bolt"] == 1.0
    # sideboard 2-of: 0.5 * 0.5 sideboard multiplier = 0.25
    assert weights["Rest in Peace"] == 0.25


def test_card_weights_all_counts():
    mainboard = {"A": 4, "B": 3, "C": 2, "D": 1}
    sideboard = {}
    weights = card_weights(mainboard, sideboard)
    assert weights == {"A": 1.0, "B": 0.75, "C": 0.5, "D": 0.25}


def test_weighted_jaccard_identical():
    a = {"Ragavan": 1.0, "Bolt": 0.75}
    b = {"Ragavan": 1.0, "Bolt": 0.75}
    assert weighted_jaccard(a, b) == pytest.approx(1.0)


def test_weighted_jaccard_disjoint():
    a = {"Ragavan": 1.0}
    b = {"Tarmogoyf": 1.0}
    assert weighted_jaccard(a, b) == pytest.approx(0.0)


def test_weighted_jaccard_partial():
    a = {"Ragavan": 1.0, "Bolt": 0.75, "Phlage": 1.0}
    b = {"Ragavan": 1.0, "Bolt": 0.75, "Tarmogoyf": 1.0}
    # intersection: min(1,1) + min(0.75,0.75) = 1.75
    # union: max(1,1) + max(0.75,0.75) + max(1,0) + max(0,1) = 1 + 0.75 + 1 + 1 = 3.75
    # jaccard = 1.75 / 3.75
    assert weighted_jaccard(a, b) == pytest.approx(1.75 / 3.75)


def test_find_best_match_above_threshold():
    list_weights = {"Ragavan": 1.0, "Phlage": 1.0, "Bolt": 0.75}
    profiles = {
        "boros-energy": {"Ragavan": 0.95, "Phlage": 0.88, "Bolt": 0.70},
        "tron": {"Wurmcoil Engine": 1.0, "Karn Liberated": 1.0},
    }
    match, score = find_best_match(list_weights, profiles, threshold=0.5)
    assert match == "boros-energy"
    assert score > 0.5


def test_find_best_match_below_threshold():
    list_weights = {"Ragavan": 1.0, "Phlage": 1.0}
    profiles = {
        "tron": {"Wurmcoil Engine": 1.0, "Karn Liberated": 1.0},
    }
    match, score = find_best_match(list_weights, profiles, threshold=0.6)
    assert match is None
    assert score == 0.0


def test_find_best_match_empty_profiles():
    list_weights = {"Ragavan": 1.0}
    match, score = find_best_match(list_weights, {}, threshold=0.6)
    assert match is None
    assert score == 0.0
