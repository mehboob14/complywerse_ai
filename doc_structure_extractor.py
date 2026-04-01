#!/usr/bin/env python3
"""
Adaptive, rule-based document structure parser (no LLM).

- Accepts plain-text input (use your own PDF/DOCX extractor first).
- Dynamically detects numbering/bullet patterns per document.
- Builds a hierarchical tree of sections/items, preserving verbatim text.
- Outputs JSON or ASCII tree.
- Standard library only.
"""
import argparse
import json
import re
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Tuple

# Optional PDF text extraction (recommended: pdfplumber; fallback: PyPDF2)
try:
    import pdfplumber  # type: ignore
except ImportError:  # pragma: no cover
    pdfplumber = None

try:
    from PyPDF2 import PdfReader  # type: ignore
except Exception:  # pragma: no cover
    PdfReader = None
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

# -----------------------------------------------------------------------------
# Marker detection
# -----------------------------------------------------------------------------

# Candidate regexes for markers (prefix-only)
MARKER_PATTERNS: List[Tuple[str, re.Pattern]] = [
    ("decimal_outline", re.compile(r"^(\d+(?:\.\d+)+)\b")),   # 1.1, 2.3.4
    ("digit", re.compile(r"^(\d+)[\.)]?\b")),                 # 1, 1)
    ("upper_letter_paren", re.compile(r"^\(([A-Z])\)")),       # (A)
    ("upper_letter_dot", re.compile(r"^([A-Z])\.")),            # A.
    ("lower_letter_paren", re.compile(r"^\(([a-z])\)")),       # (a)
    ("lower_letter_dot", re.compile(r"^([a-z])\.")),            # a.
    ("roman_paren", re.compile(r"^\(([ivxIVX]+)\)")),          # (i)
    ("roman_dot", re.compile(r"^([ivxIVX]+)\.")),               # i.
    ("bullet", re.compile(r"^[-•*]\s+")),                       # -, •, *
]

# Preferred ordering when inferring hierarchy (lower index = higher precedence)
MARKER_PRIORITY = [
    "decimal_outline",
    "digit",
    "upper_letter_paren",
    "upper_letter_dot",
    "lower_letter_paren",
    "lower_letter_dot",
    "roman_paren",
    "roman_dot",
    "bullet",
]


@dataclass
class LineInfo:
    raw: str
    marker_name: Optional[str]
    marker_text: Optional[str]
    remainder: str
    indent: int


@dataclass
class Node:
    id: str
    marker: Optional[str]
    text: str
    level: int
    children: List["Node"] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "marker": self.marker,
            "text": self.text,
            "level": self.level,
            "children": [c.to_dict() for c in self.children],
        }


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def is_noise(line: str) -> bool:
    s = line.strip()
    if not s:
        return True
    if s.startswith("<<") or s.startswith(">>"):
        return True
    if s in {"xref", "endobj", "trailer"}:
        return True
    if " obj" in s or s.endswith(" obj"):
        return True
    if re.match(r"^\d{6,}$", s):
        return True
    if re.match(r"^\d{1,10} \d{1,5} obj", s):
        return True
    return False


def normalize_lines(text: str) -> List[str]:
    """Split text into non-empty lines with stripped right whitespace; drop PDF object noise."""
    lines: List[str] = []
    for raw in text.splitlines():
        stripped = raw.rstrip("\r\n")
        if stripped.strip() and not is_noise(stripped):
            lines.append(stripped)
    return lines


def detect_marker(line: str) -> Tuple[Optional[str], Optional[str]]:
    """Return (marker_name, marker_text) for the first matching pattern."""
    for name, pattern in MARKER_PATTERNS:
        m = pattern.match(line)
        if m:
            return name, m.group(0).strip()
    return None, None


def strip_marker(line: str, marker_text: Optional[str]) -> str:
    if not marker_text:
        return line.strip()
    return line[len(marker_text) :].strip()


def compute_indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def marker_depth(marker_name: Optional[str], marker_text: Optional[str]) -> int:
    """Infer depth hint from marker form; higher number = deeper."""
    if marker_name == "decimal_outline" and marker_text:
        return marker_text.count(".") + 1
    return 1


# -----------------------------------------------------------------------------
# Pattern learning and level inference
# -----------------------------------------------------------------------------

def learn_levels(lines: List[LineInfo]) -> Dict[str, int]:
    """Assign hierarchy levels to marker types based on frequency and priority."""
    counts = Counter(li.marker_name for li in lines if li.marker_name)
    # Sort by frequency desc, then by priority list order
    ordered = sorted(
        counts.items(),
        key=lambda kv: (-kv[1], MARKER_PRIORITY.index(kv[0]) if kv[0] in MARKER_PRIORITY else 999),
    )
    level_map: Dict[str, int] = {}
    current_level = 1
    for name, _ in ordered:
        level_map[name] = current_level
        current_level += 1
    return level_map


def line_level(li: LineInfo, level_map: Dict[str, int], prev_level: int, indent_size: int = 4) -> int:
    if li.marker_name:
        base = level_map.get(li.marker_name, prev_level or 1)
        depth_hint = marker_depth(li.marker_name, li.marker_text)
        return base + (depth_hint - 1)
    # No marker: use indentation heuristic relative to previous level
    return max(1, prev_level + (li.indent // max(indent_size, 1))) if prev_level else 1


# -----------------------------------------------------------------------------
# Tree builder
# -----------------------------------------------------------------------------

def build_tree(lines: List[LineInfo], indent_size: int = 4) -> List[Node]:
    level_map = learn_levels(lines)
    nodes: List[Node] = []
    stack: List[Node] = []

    def next_id(base: str, level: int) -> str:
        suffix = len(stack) + 1 if not base else len(stack[-1].children) + 1 if stack else 1
        return base if base else str(len(nodes) + 1)

    for idx, li in enumerate(lines):
        prev_level = stack[-1].level if stack else 0
        level = line_level(li, level_map, prev_level, indent_size)

        # Auto-parent if previous line ended with ':' and current has marker
        if idx > 0 and lines[idx - 1].raw.strip().endswith(":") and li.marker_name:
            level = (stack[-1].level + 1) if stack else 2

        node_id = str(len(nodes) + 1) if level == 1 else f"{stack[-1].id}.{len(stack[-1].children)+1}" if stack else str(len(nodes) + 1)
        node = Node(id=node_id, marker=li.marker_text, text=li.remainder, level=level)

        while stack and stack[-1].level >= level:
            stack.pop()
        if stack and stack[-1].level < level:
            stack[-1].children.append(node)
        else:
            nodes.append(node)
        stack.append(node)

    return nodes


# -----------------------------------------------------------------------------
# ASCII rendering
# -----------------------------------------------------------------------------

def render_ascii(nodes: List[Node]) -> str:
    lines: List[str] = []

    def walk(node: Node, prefix: str, is_last: bool):
        branch = "└── " if is_last else "├── "
        marker_part = f"{node.marker} " if node.marker else ""
        lines.append(f"{prefix}{branch}{marker_part}{node.text}".rstrip())
        child_prefix = f"{prefix}{'    ' if is_last else '│   '}"
        for i, child in enumerate(node.children):
            walk(child, child_prefix, i == len(node.children) - 1)

    for i, root in enumerate(nodes):
        walk(root, "", i == len(nodes) - 1)
    return "\n".join(lines)


# -----------------------------------------------------------------------------
# CLI
# -----------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Adaptive rule-based document structure parser (no LLM)")
    parser.add_argument("input", help="Path to text/PDF file (PDF requires pdfplumber or PyPDF2)")
    parser.add_argument("--indent-size", type=int, default=4, help="Spaces per indent level for bullets")
    parser.add_argument("--format", choices=["json", "ascii", "both"], default="ascii", help="Output format")
    parser.add_argument("--max-pages", type=int, default=None, help="Optional page cap for PDFs")
    return parser.parse_args()


def _load_pdf(path: str, max_pages: Optional[int]) -> str:
    if pdfplumber:
        chunks: List[str] = []
        with pdfplumber.open(path) as pdf:
            for idx, page in enumerate(pdf.pages):
                if max_pages is not None and idx >= max_pages:
                    break
                extracted = page.extract_text() or ""
                if extracted:
                    chunks.append(extracted)
        return "\n".join(chunks)
    if PdfReader:
        reader = PdfReader(path)
        chunks: List[str] = []
        for idx, page in enumerate(reader.pages):
            if max_pages is not None and idx >= max_pages:
                break
            chunks.append(page.extract_text() or "")
        return "\n".join(chunks)
    raise RuntimeError("PDF input provided but pdfplumber/PyPDF2 not installed. Install pdfplumber or PyPDF2, or provide extracted text.")


def load_text(path: str, max_pages: Optional[int] = None) -> str:
    if path.lower().endswith(".pdf"):
        return _load_pdf(path, max_pages)
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def process(text: str, indent_size: int) -> List[Node]:
    raw_lines = normalize_lines(text)
    line_infos: List[LineInfo] = []
    for line in raw_lines:
        marker_name, marker_text = detect_marker(line)
        remainder = strip_marker(line.strip(), marker_text)
        indent = compute_indent(line)
        line_infos.append(LineInfo(raw=line, marker_name=marker_name, marker_text=marker_text, remainder=remainder, indent=indent))
    return build_tree(line_infos, indent_size=indent_size)


def main():
    args = parse_args()
    text = load_text(args.input)
    tree = process(text, args.indent_size)

    if args.format in {"json", "both"}:
        json.dump([n.to_dict() for n in tree], fp=sys.stdout, indent=2, ensure_ascii=False)
        if args.format == "both":
            print("\n---")
    if args.format in {"ascii", "both"}:
        print(render_ascii(tree))


# -----------------------------------------------------------------------------
# Basic self-test
# -----------------------------------------------------------------------------

def _test_sample():
    sample = """
1 Scope
1.1 Purpose
(a) Sub-item A
(b) Sub-item B
1.2 Another
 - bullet one
 - bullet two
"""
    tree = process(sample, indent_size=4)
    print(render_ascii(tree))


if __name__ == "__main__":
    import sys
    main()
