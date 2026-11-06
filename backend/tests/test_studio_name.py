"""The module is called the "Comply AI Studio" in every server text a person can read (errors, history, audit, the AI inventory).
Docstrings and comments may still say "AI Studio"; so may the OpenAPI tags, which only developers see in /docs."""
import ast
import pathlib
import re

GRC = pathlib.Path(__file__).resolve().parents[1] / "grc"
DEVELOPER_ONLY = {"Governance AI Studio", "Governance - AI Studio"}      # OpenAPI tags


def test_every_server_text_says_the_comply_ai_studio():
    old = []
    for path in GRC.rglob("*.py"):
        text = path.read_text(encoding="utf-8-sig")
        if "AI Studio" not in text:
            continue
        tree = ast.parse(text)
        docstrings = {id(n.body[0].value) for n in ast.walk(tree)
                      if isinstance(n, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
                      and n.body and isinstance(n.body[0], ast.Expr) and isinstance(n.body[0].value, ast.Constant)}
        for n in ast.walk(tree):
            if (isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docstrings
                    and n.value not in DEVELOPER_ONLY and re.search(r"(?<!Comply )AI Studio", n.value)):
                old.append(f"{path.relative_to(GRC)}:{n.lineno}")
    assert old == []
