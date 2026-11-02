"""Help Desk reference seed data: insert order, unique natural keys, FKs resolvable, unbranded."""
import json

from grc.modules.helpdesk_native.reference_seed import SEED_DIR, SPEC, load_rows


def _nk(row, key):
    return tuple(json.dumps(row.get(k), sort_keys=True) for k in key)


def test_every_table_has_a_file_and_unique_natural_keys():
    assert sorted(p.stem for p in SEED_DIR.glob("*.json")) == sorted(t for t, _, _ in SPEC)
    for table, key, _ in SPEC:
        rows = load_rows(table)
        assert rows, table
        keys = [_nk(r, key) for r in rows]
        assert len(keys) == len(set(keys)), f"{table}: duplicate natural key"


def test_every_fk_points_to_an_earlier_table_and_a_row_that_exists():
    order = [t for t, _, _ in SPEC]
    names = {t: {r[k[0]] for r in load_rows(t)} for t, k, _ in SPEC if len(k) == 1}
    for table, key, fks in SPEC:
        seen = set()
        for row in load_rows(table):
            for field, parent in fks.items():
                v = row.get(field)
                if v is None:
                    continue
                if parent == table:
                    assert v in seen, f"{table}: parent {v} after its child"
                else:
                    assert order.index(parent) < order.index(table)
                    assert v in names[parent], f"{table}.{field} -> {v} not in {parent}"
            if len(key) == 1:
                seen.add(row[key[0]])


def test_seed_content_carries_no_other_product_branding():
    text = " ".join(p.read_text(encoding="utf-8").lower() for p in SEED_DIR.glob("*.json"))
    for word in ("caiva", " ava ", "ava inventory", "frappe"):
        assert word not in text, word
