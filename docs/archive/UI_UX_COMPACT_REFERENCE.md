# UI / UX Compact Reference

## Purpose

This document captures the UI and UX direction already applied in the Assets, Vulnerabilities, and Integrations areas so the same compact enterprise pattern can be rolled out across Governance next.

Target outcome:

- higher information density
- lower visual scale
- less empty space
- more useful graphs and status visuals
- cleaner white enterprise layout
- right-side large popups for forms and editing

---

## Core Design Direction

### 1. Compact enterprise density

The platform should feel closer to a dense enterprise tool instead of a spacious marketing dashboard.

Apply these rules:

- reduce oversized headings inside page bodies
- reduce vertical gaps from large spacing to compact spacing
- prefer more content visible above the fold
- keep cards and content blocks tighter
- show more important data on a single screen before scrolling

### 2. White, light, professional surfaces

Use a clean light layout everywhere:

- primary surface: white
- secondary surface: very light slate
- borders: light slate only
- active states: blue
- status states: soft tinted backgrounds with readable colored text

Avoid:

- dark slate panels in dashboard pages
- white text on content cards
- heavy gradients or glass effects
- unnecessary empty whitespace

---

## Standard Visual Tokens

### Surfaces

- page background: light slate or white
- cards: white
- secondary cards or grouped blocks: light slate
- modals / panels: white only

### Borders

- use subtle borders to separate content
- borders should guide structure without visual heaviness

### Text sizing

- body text should stay compact and consistent
- labels should generally be smaller than values
- section headers inside pages should be smaller than top navigation titles
- avoid repeating a large page heading inside the content body if the route title is already in the top header

Recommended scale:

- small labels and metadata
- normal body text for values and row content
- modest section headings, not oversized headings

---

## Density Rules for Content Pages

### Page container

- keep a small but visible top and left padding around the whole content area
- keep the main content aligned consistently with other dashboard pages
- reduce unnecessary outer margin

### Cards and sections

- use tighter internal padding
- prefer multiple compact cards in a row instead of one oversized block
- put summary metrics, chips, and quick status indicators at the top

### Rows and lists

- rows should be compact and readable
- hover state should be subtle
- actions should stay inline and lightweight
- dense rows are preferred over large roomy cards when the content is tabular or repetitive

### Tabs

- tabs should be compact, thin, and easy to scan
- use blue for the active state
- keep tab labels readable but small

---

## Popup / Drawer Standard

### Direction

All major create, edit, and link forms should open on the **right side** as large slide-over panels.

### Rules

- use right-side panels for forms instead of centered popups when possible
- keep the page visible behind the panel
- use large width for complex forms
- keep the content vertically dense
- use two-column layouts where it improves scan speed
- labels stay compact
- inputs remain standard height unless they are long text areas

### Use centered dialogs only for:

- delete confirmation
- small approval prompts
- short status changes

### Form density rules

- keep fields close together
- reduce label size
- reduce input padding slightly
- keep long text areas only where needed
- use one screen for as many fields as possible without harming readability

---

## Graph and Chart Guidance

Generic counts alone are not enough.

Instead of only showing:

- total numbers
- flat badges
- raw count summaries

Prefer more intuitive visuals such as:

- coverage bars
- severity distribution blocks
- CIA rating bars
- risk score trend indicators
- status mix charts
- remediation progress visuals
- control coverage progress
- asset criticality visual summaries

### Chart styling rules

- use solid colors
- avoid washed-out generic visuals
- charts should be compact and immediately understandable
- place legends and labels close to the chart
- keep chart containers white and bordered
- no dark chart blocks inside light dashboard pages

---

## Information Density Principles

### What to maximize

- visible rows
- side-by-side details
- summary insights
- quick actions
- status information
- compact charts
- key metadata in the first screen

### What to reduce

- empty whitespace
- oversized headings
- tall row height
- unnecessary repeated titles
- large blank card bodies
- generic counters without visual explanation

---

## Top Header Behavior

### Rule

The page title should primarily live in the shared top header.

### Therefore

- avoid showing another oversized duplicate heading below
- let the page body start with real content quickly
- keep the header area action-focused
- move edit, add, assess, refresh, filter, and status actions into the top action row where possible

### Sub-page behavior

For detail pages:

- start with compact summary chips and actions
- immediately show metrics, visual summaries, or tabs
- avoid wasting the first screen on repeated titles and large decorative spacing

---

## Module Patterns Already Established

### Assets module reference pattern

Established in:

- main asset list page
- asset detail page
- add/edit asset right-side drawer

Patterns used:

- compact summary cards
- CIA rating bars
- control coverage progress bar
- white card layout with light borders
- smaller text scale on detail views
- large right-side editing panel
- denser tabbed layout

### Vulnerabilities module reference pattern

Established in:

- main vulnerability listing
- vulnerability creation drawer
- vulnerability detail page

Patterns used:

- compact detail header
- white page surface
- dense data tables for linked items
- softer status colors
- smaller action buttons
- AI recommendation block styled as a contained insight card
- readable but compact tabs and sections

### Integrations module reference pattern

Established in integration listing and connection views.

Patterns used:

- collapsible dense rows
- compact operational status layout
- cleaner spacing between sections
- stronger information grouping
- better scan flow for connected systems and actions

---

## Governance Rollout Rules

When updating Governance pages, apply the same approach:

### Must do

- move toward white surfaces everywhere
- reduce text scale where pages feel too large
- increase density in cards, tables, and tabs
- introduce intuitive charts instead of only numeric counts
- keep popups on the right for larger forms
- maximize what users can see in one screen
- use lighter borders and tighter row structures
- keep headings consistent with Assets and Vulnerabilities

### Must avoid

- dark cards on dashboard content pages
- oversized body headings
- too much top whitespace
- centered large forms when a right drawer is better
- generic stat tiles without visual meaning

---

## Governance Implementation Checklist

Use this checklist during rollout:

- [ ] page starts with useful content quickly
- [ ] top and left page padding matches compact dashboard spacing
- [ ] no oversized duplicate page heading inside content area
- [ ] white card surfaces only
- [ ] light borders only
- [ ] tables and rows are compact
- [ ] buttons are smaller and denser
- [ ] popups are right-side drawers where appropriate
- [ ] charts are intuitive and not generic
- [ ] important content fits in a single screen as much as possible
- [ ] free space is reduced without hurting readability

---

## Practical Summary

The standard going forward is:

**smaller scale + more information + white enterprise surfaces + intuitive visual summaries + right-side dense forms**

This is the reference to follow for Governance and any other remaining modules.
