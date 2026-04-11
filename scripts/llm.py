import anthropic


def create_archetype(card_names: list[str], colors: list[str]) -> dict:
    """Ask the LLM to name and describe a new archetype based on its cards.

    Returns dict with 'name', 'slug', 'description'.
    """
    color_map = {"W": "White", "U": "Blue", "B": "Black", "R": "Red", "G": "Green"}
    color_str = ", ".join(color_map.get(c, c) for c in colors)

    top_cards = card_names[:20]
    cards_str = "\n".join(f"- {name}" for name in top_cards)

    client = anthropic.Anthropic()
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=300,
        messages=[
            {
                "role": "user",
                "content": f"""Name this Modern MTG deck archetype and write a 2-3 sentence description.

Colors: {color_str}
Key cards:
{cards_str}

Respond in exactly this format (no markdown, no extra text):
NAME: <archetype name>
SLUG: <lowercase-hyphenated-slug>
DESCRIPTION: <2-3 sentence description>

Use established MTG archetype naming conventions. If this resembles a known archetype, use that name.""",
            }
        ],
    )

    text = message.content[0].text
    lines = text.strip().splitlines()
    result = {}
    for line in lines:
        if line.startswith("NAME:"):
            result["name"] = line.split(":", 1)[1].strip()
        elif line.startswith("SLUG:"):
            result["slug"] = line.split(":", 1)[1].strip()
        elif line.startswith("DESCRIPTION:"):
            result["description"] = line.split(":", 1)[1].strip()

    return result
