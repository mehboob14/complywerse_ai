# Control Catalog Structure Report

## Purpose

The Control Catalog page currently lists all workbench controls in a flat table. When the tenant has thousands of framework controls, the page becomes hard to scan and feels unstructured. The goal is to understand how the Control Library is built, why it feels more structured, and how the Control Catalog can be structured in a similar way without corrupting framework seed data or forcing the frontend to load 3000+ rows at once.

This report is planning only. It does not implement the change.

## Current Control Library Build Flow

### 1. Framework seed files

Framework seed files live under:

```text
backend/grc/seed_data/frameworks/*.json
```

Each file contains:

```json
{
  "metadata": {},
  "controls": [
    {
      "control_id": "...",
      "title": "...",
      "domain": "...",
      "category": "..."
    }
  ]
}
```

Example from HIPAA:

```text
domain: Administrative Safeguards
category: Security Management Process
```

These are framework-native hierarchy fields. They represent the official or source-framework structure.

### 2. Parsed framework controls

Seeded or uploaded framework controls are stored as `ParsedFrameworkControl` rows.

Important fields:

```text
ParsedFrameworkControl.domain
ParsedFrameworkControl.category
ParsedFrameworkControl.control_id
ParsedFrameworkControl.title
ParsedFrameworkControl.description
```

Relevant model:

```text
backend/grc/models/_17_framework_upload_parsing_models.py
```

The seed import path preserves `domain` and `category` from JSON. That means the raw framework structure is already available in the database.

### 3. Common Control Library grouping

The Control Library is not just a flat list of parsed controls. It creates a normalized grouping layer.

Key tables/models:

```text
CommonControlGroup
CommonControlGroupMapping
NormalizedControl
NormalizedControlLink
```

Relevant files:

```text
backend/grc/models/_09_1_unified_common_control_library_models.py
backend/grc/models/_08_normalized_control_model.py
backend/grc/modules/control_library/routers/groups.py
backend/grc/modules/control_library/services/baseline_builder.py
backend/grc/modules/control_library/services/normalization.py
backend/grc/modules/control_library/services/extend_baseline.py
```

Conceptually, the Control Library view is:

```text
Library domain
  Common control group
    Normalized control
      Source framework controls
```

This is why the Control Library feels structured. It is showing normalized groupings, not raw framework rows.

## Current Control Catalog Flow

The Control Catalog page is a workbench surface, not the same thing as the normalized library page.

Frontend:

```text
grc-frontend/src/app/(dashboard)/controls/page.tsx
```

Backend:

```text
backend/grc/modules/control_library/routers/workbench.py
```

The page calls:

```text
GET /control-library/workbench/controls
```

That endpoint combines three source types:

```text
framework controls
internal/risk controls
promoted normalized controls
```

Current behavior:

```text
source tabs -> flat table -> paginated rows
```

It does return domains for filtering, but it does not return a hierarchy. It does not return:

```text
domain -> category -> controls
```

or:

```text
library domain -> common group -> controls
```

## Main Problem

The problem is not simply that there are 3000+ controls. The real problem is that the Control Catalog is showing a large workbench dataset as one flat list.

Current flat structure:

```text
All controls
  Control row
  Control row
  Control row
  ...
```

Desired structured experience:

```text
Domain
  Category or common group
    Control row
    Control row
```

The frontend should not solve this by fetching all controls and grouping them locally. That would be fragile and slow as the catalog grows.

## Important Domain Mismatch

There are two valid domain systems in the product.

### Framework-native domains

These come from seed files and uploaded frameworks.

Example:

```text
HIPAA domain: Administrative Safeguards
HIPAA category: Security Management Process
```

These should be preserved because they represent the framework's own structure.

### Control Library domains

These come from normalization and common-control grouping.

Example conceptually:

```text
Access Control
Security Operations
Governance
Data Protection
```

These are product/library grouping domains. They are useful for cross-framework normalization, but they may not match native seed domains one-to-one.

### Conclusion

A mismatch between seed domains and Control Library domains is not automatically a data bug. It may be expected because they describe different things:

```text
seed domain = source framework hierarchy
library domain = normalized cross-framework grouping
```

Seed JSON should only be changed if the seed value is actually wrong, missing, duplicated incorrectly, or corrupted. It should not be changed just to make the Control Catalog visually match the Control Library.

## Recommended Diagnostic Report Before Implementation

Before building the UI change, create a backend diagnostic endpoint or script that reports:

```text
framework name
seed domain
seed category
parsed control count
mapped to CommonControlGroup count
mapped to NormalizedControl count
unmapped count
library domain when mapped
library group when mapped
domain mismatch count
```

The report should answer:

```text
Which parsed controls have no library mapping?
Which seed domains map cleanly to one library domain?
Which seed domains split across many library domains?
Which library domains collect controls from many seed domains?
Are any seed domains null, empty, or suspicious?
```

This separates real data defects from expected normalization differences.

## Recommended Product Direction

Use a hybrid structure for the Control Catalog.

### Why hybrid

The catalog contains mixed source types:

```text
framework
internal/risk
normalized
```

Some framework controls are mapped into the Control Library. Some are not. Internal controls may have only internal category/sub-category. Promoted normalized controls already have library domain information.

So the best catalog grouping should be:

```text
Use Control Library grouping where mapping exists.
Fallback to native seed domain/category where mapping does not exist.
```

## Proposed Backend Structure

Add a tree-style endpoint instead of changing the existing list endpoint directly.

Suggested endpoint:

```text
GET /control-library/workbench/control-tree
```

Suggested query params:

```text
source=all|framework|internal|normalized
q=
framework_id=
domain=
status=
effectiveness=
assignee_id=
grouping=hybrid|native|library
```

Suggested response shape:

```json
{
  "total": 3434,
  "grouping": "hybrid",
  "domains": [
    {
      "key": "library:Access Control",
      "label": "Access Control",
      "source": "library",
      "total": 120,
      "categories": [
        {
          "key": "group:Identity and Access Management",
          "label": "Identity and Access Management",
          "total": 45,
          "controls_preview": [],
          "has_more": true
        }
      ]
    },
    {
      "key": "native:Administrative Safeguards",
      "label": "Administrative Safeguards",
      "source": "native",
      "total": 67,
      "categories": [
        {
          "key": "native:Security Management Process",
          "label": "Security Management Process",
          "total": 5,
          "controls_preview": [],
          "has_more": false
        }
      ]
    }
  ],
  "source_counts": {
    "all": 3434,
    "framework": 3429,
    "internal": 5,
    "normalized": 0
  }
}
```

For loading controls inside a category/group:

```text
GET /control-library/workbench/control-tree/children
```

Suggested params:

```text
domain_key=
category_key=
skip=
limit=
same filters as control-tree
```

This prevents loading thousands of rows in the frontend.

## Proposed UI Structure

The Control Catalog page should keep the current workbench features:

```text
source tabs
search
framework filter
domain filter
progress filter
effectiveness filter
assignees
drawer/details
```

But the result area should change from a single flat table to a structured tree:

```text
Domain accordion row
  Category/group row
    Control table rows
```

Default behavior:

```text
show domain rows collapsed
auto-expand first domain or selected filter domain
show counts at domain and category/group level
lazy-load children when expanded
keep My Work as flat or grouped by progress, depending on user need
```

Recommended first UI version:

```text
All Controls: grouped tree
My Work: keep flat table
```

Reason: My Work is usually smaller and action-focused. All Controls is the page that becomes messy with 3000+ rows.

## Implementation Phases

### Phase 1 - Diagnostic only

Create a backend diagnostic script or endpoint.

Output:

```text
seed domain/category counts
library domain/group counts
mapped/unmapped counts
mismatch examples
null/empty domain checks
```

No UI changes in this phase.

### Phase 2 - Backend tree API

Create `control-tree` endpoint.

Support grouping modes:

```text
native
library
hybrid
```

Recommended default:

```text
hybrid
```

### Phase 3 - Frontend tree view

Replace the flat All Controls table with:

```text
domain accordion
category/group nested rows
lazy-loaded control rows
```

Keep filters and drawer behavior.

### Phase 4 - Data cleanup only if needed

If diagnostics show bad seed data:

```text
fix seed JSON
add backfill script for ParsedFrameworkControl.domain/category
do not overwrite valid official framework hierarchy
```

## Key Decisions Needed

1. Should Control Catalog default to `hybrid`, `native`, or `library` grouping?
2. Should unmapped framework controls appear under native seed domain/category or under `Unmapped`?
3. Should promoted normalized controls appear under library domain only?
4. Should internal/risk controls use `category/sub_category` as native hierarchy?
5. Should My Work remain flat or also use the same grouping?

## Recommended Answers

```text
Default grouping: hybrid
Unmapped framework controls: native seed domain/category
Promoted normalized controls: library domain/group
Internal controls: internal category/sub-category
My Work: keep flat for first version
```

## Final Recommendation

Do not force seed domains to match Control Library domains. Instead, keep both concepts:

```text
native framework hierarchy
normalized library hierarchy
```

Then structure the Control Catalog through a backend tree endpoint that can choose the right hierarchy per control.

The safest target experience is:

```text
Control Catalog
  Library grouped controls where mapping exists
  Native framework grouped controls where mapping does not exist
  Internal controls grouped by internal category
  Lazy-loaded rows under each group
```

This gives the user the same structured feeling as Control Library while preserving accurate framework data and avoiding a heavy 3000+ row frontend fetch.
