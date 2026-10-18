"""A document started from a template of the platform's catalogue (an NCA template, a standard or an artifact template): the
library page hands the AI Studio the template's Markdown; it opens as a studio draft made safe, with one title and its sections,
and the checks and a whole-document draft follow that template's sections."""
import grc.models as m
from grc.modules.governance.studio import drafting, templates

from test_studio_flow import world          # noqa: F401  (world is a fixture)

# what the NCA extractor gives for a Word template: its sections as level-1 headings, the title a plain line, placeholders in <>
NCA = """Malware Protection Policy Template

| DATE |  |
| --- | --- |
| VERSION |  |

<!-- Replace the bracketed prompts below, then save. -->

# Purpose

This policy protects \\<organization name\\>'s assets against malware.<script>alert(1)</script>

# Scope

All information and technology assets.\x00

## Servers

Servers run anti-malware software.

# Policy Requirements

1. Anti-malware software shall be installed on every workstation.
"""


def start(world, **body):
    return world.http.post(world.api("/sessions"), json={"kind": "new", **body})


def test_a_catalogue_template_opens_as_a_studio_draft_made_safe_with_one_title_and_its_sections(world):
    r = start(world, title="Anti-Malware Protection Policy", doc_type="policy", content=NCA, template_name="NCA template: Anti-Malware Protection",
              instructions={"focus_areas": "Workstations and servers"})
    assert r.status_code == 200, r.text
    s = r.json()
    assert (s["kind"], s["doc_type"], s["template_id"], s["document_id"], s["revision"]) == ("new", "policy", "catalogue", None, 1)
    assert s["base_label"] == "Started from NCA template: Anti-Malware Protection" and s["settings"]["template_name"] == "NCA template: Anti-Malware Protection"
    assert s["instructions"]["focus_areas"] == "Workstations and servers" and s["instructions"]["entity_name"]   # the organisation's name, as for any new document
    text = s["content"]
    assert text.startswith("# Anti-Malware Protection Policy\n\nMalware Protection Policy Template\n")
    assert "## Purpose" in text and "## Scope" in text and "### Servers" in text and "## Policy Requirements" in text
    assert "<script" not in text and "alert(1)" not in text and "<!--" not in text and "\x00" not in text
    assert "\\<organization name\\>" in text and "| DATE |  |" in text                 # the template's own text and tables are kept
    assert world.db.query(m.GovernanceDocument).count() == 2                           # nothing in the library until Move to library


def test_the_checks_and_a_whole_document_draft_follow_the_templates_sections(world):
    s = start(world, title="Anti-Malware Protection Policy", doc_type="policy", content=NCA, template_name="NCA template: Anti-Malware Protection").json()
    world.http.put(world.api(f"/sessions/{s['id']}/content"), json={"content": "# Anti-Malware Protection Policy\n\n## Purpose\n\nText.\n", "base_revision": 1})
    missing = [i for i in world.http.post(world.api(f"/sessions/{s['id']}/checks")).json()["issues"] if i["rule"] == "section_missing"]
    said = " ".join(i["message"] for i in missing)
    assert "Scope" in said and "Policy Requirements" in said and "Approval" not in said     # the template's sections, not the platform's policy scaffold
    session = world.db.get(m.StudioSession, s["id"])
    world.db.refresh(session)
    sections, _scaffold, custom = drafting.sections_for(world.db, session)
    assert [x.heading for x in sections] == ["Purpose", "Scope", "Policy Requirements"] and custom["name"] == "NCA template: Anti-Malware Protection"
    told = drafting._shared_text(session, {}, "", custom, "")
    assert "The template this document was started from (NCA template: Anti-Malware Protection). Follow its sections" in told and "## Scope" in told
    assert templates.structure_for(world.db, "policy", "catalogue", session)["sections"][1]["title"] == "Scope"


def test_a_template_that_cannot_start_a_document_is_refused_with_a_sentence(world):
    for body, words in ((dict(content="   <!-- only a comment -->  "), "no text"),
                        (dict(content="# X\n\n" + "word " * 60_000), "too long"),
                        (dict(content="# X\n\nText.\n", doc_type="framework"), "cannot be written")):
        r = start(world, **{"title": "X", "doc_type": "policy", **body})
        assert r.status_code == 400 and words in r.json()["detail"], r.text
    assert world.db.query(m.StudioSession).count() == 0


def test_without_content_a_new_document_still_starts_from_the_studios_own_template(world):
    s = start(world, title="Access Control Policy", doc_type="policy", template_name="ignored").json()
    assert s["template_id"] == "builtin:policy" and "template_name" not in s["settings"]
    library = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10, "content": "# Not used\n"}).json()
    assert library["document_id"] == 10 and "Not used" not in library["content"]


def test_a_catalogue_template_with_one_title_keeps_its_headings():
    t = templates.from_markdown("# Board Charter\n\n**Type:** Charter\n\n## Purpose\n\nWhy.\n\n## Membership\n\nWho.\n", title="Board Charter",
                                name="Board Charter (standard template)", doc_type="charter")
    assert t["content"] == "# Board Charter\n\n**Type:** Charter\n\n## Purpose\n\nWhy.\n\n## Membership\n\nWho.\n"
    assert [x["title"] for x in t["structure"]["sections"]] == ["Purpose", "Membership"]
    untitled = templates.from_markdown("## Purpose\n\nWhy.\n", title="Access *Rules*", name="", doc_type="other")
    assert untitled["content"].startswith("# Access \\*Rules\\*\n\n## Purpose") and untitled["name"] == "Access *Rules*"
