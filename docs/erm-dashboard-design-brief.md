# Design Brief — Risk Management (ERM) Overview Dashboard

You are redesigning the **Risk Management overview page** of ComplyVerse, an enterprise GRC
platform. Audience: **board members and executives first** (glance, don't read), risk analysts
second (they click through for detail). You have full freedom over layout, hierarchy, and the
chart concept — the constraints below are the product's established system, not suggestions.

**The prime directive: at first sight the page is 100% graphical.** No metric lists, no
tables of numbers, no explanatory sentences above the fold — a wall of rich, confident data
visualization that reads like a premium enterprise product (think Datadog / Bloomberg-terminal
polish, in a light theme). Every number a viewer needs beyond the visuals lives one click away
in a popup, never on the page.

## 1. What this page is

The landing dashboard of the ERM module. It summarizes ten functional areas ("sections"),
each scored 0–100 by backend formulas, blended into one module performance score. Five
sections are live today (Risk Register, Risk Assessments, RCSA, Internal Controls, Vendor
Risk); five more arrive soon (KRIs, Appetite, Mitigation Actions, Reviews, Incidents) — the
design must scale gracefully from 5 to 10 section cards without relayout.

## 2. The data contract (backend is fixed — design around it)

`GET /erm/dashboard/sections-overview` returns:

```json
{
  "sections": {
    "register": {
      "label": "Risk Register", "weight": 0.18, "score": 65.6,
      "metrics": [
        { "label": "Exposure containment", "weight": 0.25, "score": 77.8,
          "numerator": 2, "denominator": 9, "inverse": true, "target": 85,
          "formula": "1 - (active risks with residual >= 12 / scored active risks)" },
        { "label": "Risk reduction", "weight": 0.20, "score": 33.1,
          "numerator": 39.0, "denominator": 118.0, "target": 85,
          "formula": "(sum inherent - sum residual) / sum inherent" }
      ],
      "counts": { "total": 12, "active": 11, "critical_open": 0 }
    }
  },
  "performance": { "score": 58.7, "grade": "fair",
    "components": [ { "label": "Risk Register", "score": 65.6, "weight": 0.18 } ] },
  "attention_queue": {
    "critical_open_risks": 0, "unscored_active_risks": 2, "blocked_questions": 1,
    "overdue_ai_reviews": 1, "rcsa_open_findings": 1, "controls_tests_overdue": 1,
    "vendor_overdue_reassessments": 1, "vendor_critical_findings": 1,
    "vendor_overdue_remediations": 1, "total": 9 }
}
```

Sections have **2–7 metrics each** (varies). `score` can be `null` (no data yet) — never fake it.
Supporting endpoints also available: risk counts by severity band + avg inherent/residual
(0–25 scale), a 5×5 likelihood×impact heatmap (cell counts + risk titles on hover,
inherent/residual toggle), and the full risk list (for a top-risks-by-residual view).

## 3. Non-negotiable product conventions ("the essence")

1. **Graphics on the page, formulas in popups.** The dashboard shows NO formula text, no
   numerator/denominator, no explanation prose. Every scored card/graph is clickable and opens
   a **centered popup — the page stays visible behind it, dimmed and blurred** — containing
   the recent detail and the math:
   score ring + grade pill, one row per metric (label, weight chip `w 20%`, count `6/12`,
   bold colored %, thin colored progress bar, formula in muted small text), and a footer with
   the worked equation (`Score = 78×25% + 33×20% + … = 66`). This modal layout already
   exists and stays as-is; design the page, not the modal.
2. **Score bands** (used everywhere, never invent others): ≥80 strong `#059669` green,
   ≥60 fair `#d97706` amber, <60 weak `#e11d48` rose, null "no data" slate `#94a3b8`.
   Target line/reference where relevant: 85.
3. **Per-module chart identity — ONE graph, enterprise-rich.** The area covering the module
   sections must use exactly **one kind of graph** repeated across every section card — a
   single visual system, not a mix. It must look **expensive**: refined proportions, purposeful
   color from the score bands, micro-details (target markers, subtle depth, crisp hover
   states) — the centerpiece an executive would screenshot for a board deck. The sibling
   Governance dashboard already uses concentric radial rings, so ERM's family must be
   **anything except circles/rings/donuts/gauges**, applied uniformly: same card size, same
   geometry whether a section has 2 metrics or 7.
4. **Board-first density.** A director should read the module's health in under 5 seconds:
   biggest-worst first, color = judgment, numbers only where they carry decisions. No
   repeating the same figure in multiple widgets.

## 4. Content inventory to arrange (you decide structure and order)

- **Module performance**: score 0–100 + grade (excellent/good/fair/poor). Clickable → its
  own breakdown popup (already built).
- **Attention queue**: 9 named counts + total; each item deep-links to the page that clears
  it. Counts are actions-needed, NOT parts of a whole — do not pie/donut them.
- **Section cards** (5 now → 10): label, weight ("18% of module score"), score, band, and
  its metrics' scores — this is where your chart family shows each metric vs the 85 target.
  Clickable → detail popup.
- **Risk heatmap**: the classic 5×5 likelihood×impact matrix, red-to-green cells, count per
  cell, hover reveals risk titles, inherent/residual toggle. This is the module's signature
  visual — keep it prominent, restyle freely.
- **Top risks**: ~8 highest-residual risks; severity badge (Critical ≥20, High ≥12, Medium
  ≥6, Low <6 on the 0–25 scale) and an inherent→residual reduction indicator.

## 5. Technical frame (the build target)

Next.js 14 app-router client page, Tailwind CSS 3.4 utility classes, **recharts** as the only
chart library, lucide-react icons, light theme (white cards, `#e2e8f0` hairline borders,
rounded-xl, subtle shadows, no heavy gradients). No new dependencies. Empty/zero states must
look intentional. Responsive: 2-column tablet, 4-column desktop grid rhythm.

## 6. What was tried and rejected (don't repeat)

- Radial ring cards → rejected here (reserved for the Governance module).
- Plain vertical column charts per card, unlabeled fat bars with gray background tracks →
  "looks so bad": bars read as random rectangles without labels; chunky at card scale.
- A dozen overlapping widgets (speedometer + sunburst + bow-tie + dot plot + ladders all
  showing the same counts) → deleted; do not reintroduce redundant encodings.
- Text-dense metric lists on the dashboard → belongs in the popup only.
- Labeled horizontal progress-bar rows per metric (label + bar + target tick, stacked) →
  rejected: that is a *list with decoration*, not a graph — and it duplicates the popup's
  metric rows. The card must carry an actual chart.

## 7. Deliverable

A full page design (structure + the section-card chart concept + hero treatment + heatmap
and top-risks styling) that a developer can implement 1:1 with the stack above. Explain in
one paragraph why your chosen chart family survives 2-vs-7 metrics per card and stays
readable at ~300px card width.
