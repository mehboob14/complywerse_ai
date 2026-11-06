"""Placeholders: issued once per exact value, restored exactly, safe inside JSON, and never guessed."""
import json
import random

from grc.services.ai_gateway import tokens
from grc.services.ai_gateway.tokens import TokenMap, restore


def test_a_value_always_gets_the_same_placeholder_and_each_type_counts_from_one():
    scope = TokenMap()
    a, b = scope.token("PERSON", "Ali Raza"), scope.token("PERSON", "Sara Khan")
    assert (a, b) == ("<PERSON_1>", "<PERSON_2>")
    assert scope.token("PERSON", "Ali Raza") == "<PERSON_1>"
    assert scope.token("HOST", "db01") == "<HOST_1>"
    assert len(scope) == 3 and scope.labels == {"PERSON", "HOST"}


def test_the_exact_spelling_is_what_is_restored():
    scope = TokenMap()
    upper, lower = scope.token("ORG", "ACME BANK"), scope.token("ORG", "Acme Bank")
    assert upper != lower                                   # a quote of either spelling still matches the document
    text, _ = restore(f"{upper} and {lower}", scope)
    assert text == "ACME BANK and Acme Bank"


def test_a_placeholder_already_in_the_input_is_never_issued_again():
    scope = TokenMap(["an earlier stage wrote <PERSON_1> and <PERSON_2>"])
    assert scope.token("PERSON", "Ali Raza") == "<PERSON_3>"
    text, stats = restore("<PERSON_1> met <PERSON_3>", scope)
    assert text == "<PERSON_1> met Ali Raza" and stats == {"restored": 1, "unknown": 0}     # theirs is left, ours restored


def test_variations_the_model_makes_still_restore():
    scope = TokenMap()
    scope.token("PERSON", "Ali Raza")
    scope.token("IP_PRIV", "10.0.0.5")
    for variant in ("<PERSON_1>", "<person_1>", "[PERSON_1]", "< PERSON_1 >", "{Person_1}", "(PERSON_1)", "PERSON_1"):
        text, stats = restore(f"Owner: {variant}.", scope)
        assert text == "Owner: Ali Raza.", variant
        assert stats["restored"] == 1
    assert restore("from <IP_PRIV_1> to <IP_PRIV_1>", scope)[0] == "from 10.0.0.5 to 10.0.0.5"


def test_a_bare_placeholder_inside_a_longer_identifier_is_left_alone():
    scope = TokenMap()
    scope.token("PERSON", "Ali Raza")
    assert restore("MAX_PERSON_1_LIMIT and xPERSON_1", scope)[0] == "MAX_PERSON_1_LIMIT and xPERSON_1"


def test_a_placeholder_the_model_made_up_is_removed_not_guessed():
    scope = TokenMap()
    scope.token("PERSON", "Ali Raza")
    text, stats = restore("<PERSON_1> asked <PERSON_7>", scope)
    assert text == "Ali Raza asked [removed]" and stats == {"restored": 1, "unknown": 1}
    assert restore("<NAME_3> is not ours", scope)[0] == "<NAME_3> is not ours"       # another scheme: not touched


def test_json_stays_valid_when_a_value_has_quotes_backslashes_or_newlines():
    scope = TokenMap()
    tricky = 'Ali "The Man" Raza\\Ltd\nline two'
    token = scope.token("PERSON", tricky)
    answer = json.dumps({"owner": token, "note": f"ask {token}"})
    restored, _ = restore(answer, scope)
    assert json.loads(restored) == {"owner": tricky, "note": f"ask {tricky}"}
    fenced = "```json\n" + answer + "\n```"
    assert json.loads(restore(fenced, scope)[0].strip("`").removeprefix("json")) == {"owner": tricky, "note": f"ask {tricky}"}
    plain, _ = restore(f"Owner is {token}", scope)
    assert plain == f"Owner is {tricky}"                    # prose is restored as it was, not escaped


def test_blanking_keeps_offsets_so_what_is_left_can_be_scanned():
    text = "see <PERSON_1> and <REMOVED_SECRET> ok"
    masked = tokens.mask_tokens(text)
    assert len(masked) == len(text) and masked.startswith("see ") and "PERSON" not in masked and "REMOVED" not in masked


def test_text_that_only_starts_like_json_is_not_escaped():
    scope = TokenMap()
    token = scope.token("PERSON", 'x"y')
    assert restore(f"{{draft}} owner {token}", scope)[0] == '{draft} owner x"y'
    assert restore(f"[Draft] owner {token}", scope)[0] == '[Draft] owner x"y'


def test_round_trip_property_on_random_text():
    rng = random.Random(7)
    values = ["Ali Raza", "10.0.0.5", "db01.corp.local", 'x"y', "back\\slash", "Zoë Müller", "新しい", "a b  c"]
    words = ["the", "owner", "of", "risk", "is", "and", "uses", "{", "}", "[", "]", "<", ">", ",", ".", "\n", '"']
    for _ in range(200):
        scope = TokenMap()
        parts, original = [], []
        for _ in range(rng.randint(3, 25)):
            if rng.random() < 0.4:
                v = rng.choice(values)
                original.append(v)
                parts.append(scope.token("T", v))
            else:
                w = rng.choice(words)
                original.append(w)
                parts.append(w)
        sep = " "
        sanitized, plain = sep.join(parts), sep.join(original)
        assert restore(sanitized, scope)[0] == plain
