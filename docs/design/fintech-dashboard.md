# DESIGN.md — Fintech Dashboard

> Precision is the product. Every pixel communicates confidence. Numbers are the hero — everything else is infrastructure.

---

## 1. Design Overview

**Product type:** Financial dashboards — banking apps, trading platforms, payment tools, investment trackers
**Target audience:** Finance professionals, business owners, and consumers managing money. Mix of power users (traders, accountants) and casual users (personal banking). Ages 25-60.
**Design philosophy:** Trust through precision. Financial products earn trust by being exact, predictable, and transparent. No ambiguity — every number has context, every action has a clear consequence. The interface should feel like a well-organized ledger: structured, scannable, and impossible to misread.
**Personality keywords:** Precise, institutional, confident, transparent, secure
**Reference products:** Stripe Dashboard, Mercury, Wise, Revolut Business, Bloomberg Terminal (simplified)

### Brand Voice in UI
- **Headlines:** Declarative and factual. "Account Balance" not "Your Money at a Glance."
- **Body text:** Precise and unambiguous. Always include units, currencies, and timeframes.
- **Microcopy:** Reassuring without being casual. "Transfer initiated" not "Money's on its way! 🚀"
- **Numbers:** The most important content. Always formatted, always contextualized.

---

## 2. Color Palette

### Primary
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-primary` | #0052CC | Primary actions, active states, links |
| `--color-primary-hover` | #003D99 | Hover state for primary elements |
| `--color-primary-light` | #E6F0FF | Selected states, active backgrounds |
| `--color-primary-dark` | #002966 | Text on primary-light, high-emphasis links |

### Neutrals
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg` | #F7F8FA | Page background — slightly cool |
| `--color-surface` | #FFFFFF | Cards, panels, table backgrounds |
| `--color-surface-secondary` | #F0F2F5 | Nested panels, sidebar background |
| `--color-border` | #E1E4E8 | Standard borders, dividers |
| `--color-border-strong` | #C8CCD2 | Input borders, emphasized dividers |
| `--color-text-primary` | #0D1117 | Headings, monetary values, critical labels |
| `--color-text-secondary` | #424A53 | Body text, descriptions |
| `--color-text-muted` | #8B949E | Timestamps, metadata, helper text |

### Financial Semantic
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-positive` | #1A7F37 | Gains, credits, positive balance changes, inflows |
| `--color-positive-light` | #DAFBE1 | Positive badge bg, gain indicator bg |
| `--color-negative` | #CF222E | Losses, debits, negative changes, outflows |
| `--color-negative-light` | #FFEBE9 | Negative badge bg, loss indicator bg |
| `--color-warning` | #BF8700 | Pending transactions, review required |
| `--color-warning-light` | #FFF8C5 | Warning banner bg |
| `--color-info` | #0052CC | Informational (shares primary blue) |

### Dark Mode
| Token | Light | Dark |
|-------|-------|------|
| `--color-bg` | #F7F8FA | #0D1117 |
| `--color-surface` | #FFFFFF | #161B22 |
| `--color-surface-secondary` | #F0F2F5 | #1C2128 |
| `--color-border` | #E1E4E8 | #30363D |
| `--color-text-primary` | #0D1117 | #F0F6FC |
| `--color-text-secondary` | #424A53 | #8B949E |
| `--color-positive` | #1A7F37 | #3FB950 |
| `--color-negative` | #CF222E | #F85149 |

### Color Rules
- Green means money in. Red means money out. No exceptions. Never use these for non-financial semantics.
- Primary blue is strictly for actions — buttons, links, focus states. Never decorative.
- Monetary values use `--color-text-primary` (black) unless showing gain/loss, then positive/negative.
- All backgrounds are cool-toned (slight blue-gray). Warm tones feel informal for finance.
- Gradients are prohibited. Financial products communicate through clarity, not flair.

---

## 3. Typography

### Font Stack
- **Primary:** "SF Pro Display", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
- **Monospace:** "SF Mono", "JetBrains Mono", ui-monospace, monospace
- **Why SF Pro / Inter:** Maximum legibility for numbers. Excellent tabular figures. Professional without being cold.

### Type Scale
| Level | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|------|--------|-------------|----------------|-------|
| Display | 36px | 600 | 1.15 | -0.5px | Portfolio total, account balance hero |
| H1 | 24px | 600 | 1.25 | -0.3px | Page titles |
| H2 | 20px | 600 | 1.30 | -0.2px | Section headings, card titles |
| H3 | 16px | 600 | 1.40 | 0px | Subsection titles |
| H4 | 13px | 600 | 1.40 | 0.4px | Column headers, overlines (uppercase) |
| Body | 14px | 400 | 1.60 | 0px | Descriptions, transaction details |
| Small | 12px | 400 | 1.50 | 0px | Metadata, timestamps |
| Mono-lg | 24px | 600 | 1.25 | 0px | Large monetary values |
| Mono-md | 16px | 500 | 1.40 | 0px | Table monetary values |
| Mono-sm | 13px | 400 | 1.50 | 0px | Transaction IDs, reference numbers |

### Typography Rules
- All monetary values use `font-variant-numeric: tabular-nums`. Non-negotiable — columns must align.
- Currency symbols precede the number with no space: $1,250.00, €850.00, GHS 2,400.00.
- Negative values: use minus sign AND red color. Never parentheses-only — too ambiguous.
- Percentage changes: always include + or - sign and the % symbol. "+12.4%" not "12.4%".
- Dates in tables: use compact format "Apr 6, 2026". Full date in detail views: "April 6, 2026".
- Transaction IDs and reference numbers always use monospace.

---

## 4. Component Styles

### Buttons
**Primary**
```
Background: var(--color-primary) → #0052CC
Text: #FFFFFF
Padding: 8px 16px
Border-radius: 6px
Font: 14px/500
Min-height: 36px
Hover: #003D99
Active: #002966
Disabled: opacity 0.4
Focus-visible: 2px solid #0052CC, 2px offset
```

**Secondary**
```
Background: transparent
Border: 1px solid var(--color-border-strong)
Text: var(--color-text-primary)
Hover: var(--color-surface-secondary) bg
```

**Destructive**
```
Background: var(--color-negative) → #CF222E
Text: #FFFFFF
Hover: #A40E26
Used for: cancel transactions, close accounts, remove beneficiaries
```

### Button Rules
- Financial actions always require confirmation. "Transfer $500" → confirmation modal → "Confirm Transfer $500".
- Destructive financial actions require typing confirmation (e.g., type "CLOSE" to close account).
- Amount buttons: display the amount on the button itself. "Send $500.00" not just "Send".
- Loading state on financial actions: spinner + "Processing..." — never remove the button during processing.

### Inputs
```
Background: #FFFFFF
Border: 1px solid var(--color-border-strong) → #C8CCD2
Border-radius: 6px
Padding: 8px 12px
Height: 36px
Font: 14px/400
Focus: border #0052CC, ring 0 0 0 3px rgba(0,82,204,0.12)
Error: border #CF222E, ring 0 0 0 3px rgba(207,34,46,0.08)
```

### Currency Input (Special)
```
Left addon: currency code (USD, EUR, GHS) in --color-text-muted, bg --color-surface-secondary
Input: right-aligned, tabular-nums, 16px/500
Decimal separator: period (.) — locale-aware display
Thousand separator: comma (,)
Placeholder: "0.00" right-aligned
```

### Cards — Balance Card
```
Background: var(--color-surface)
Border: 1px solid var(--color-border)
Border-radius: 8px
Padding: 24px
Structure:
  Label: 13px/500, --color-text-muted, uppercase, letter-spacing 0.4px
  Balance: 36px/600 mono, --color-text-primary
  Change: 14px/500, positive green or negative red, with ↑/↓ icon
  Subtext: 12px, --color-text-muted, "as of Apr 6, 2026 3:42 PM"
```

### Cards — Transaction Card
```
Background: var(--color-surface)
Border-bottom: 1px solid var(--color-border) (list style, not individual cards)
Padding: 16px 0
Structure:
  Left: 36px icon circle (category icon, bg --color-surface-secondary)
  Middle: merchant/description (14px/500) + date (12px muted)
  Right: amount (16px/500 mono, green for credit, default for debit) + status badge
```

### Tables — Transaction Table
```
Header: bg --color-surface-secondary, 13px/600 uppercase, letter-spacing 0.4px, --color-text-muted
Row border: 1px solid var(--color-border) bottom
Cell padding: 12px 16px
Row hover: --color-surface-secondary bg
Columns:
  Date: left-aligned, 14px, "Apr 6" format
  Description: left-aligned, 14px/500
  Category: left-aligned, badge style
  Amount: RIGHT-aligned, mono, tabular-nums, green/red/default
  Balance: RIGHT-aligned, mono, tabular-nums, --color-text-muted
  Status: center-aligned, badge
```

### Badges — Transaction Status
```
Padding: 2px 8px
Border-radius: 12px (pill shape for fintech)
Font: 11px/600

Completed: bg #DAFBE1, text #1A7F37
Pending:   bg #FFF8C5, text #BF8700
Failed:    bg #FFEBE9, text #CF222E
Processing: bg #E6F0FF, text #0052CC
Refunded:  bg #F0F2F5, text #424A53
```

### Modals — Confirmation (Financial Action)
```
Overlay: rgba(0, 0, 0, 0.5) — darker than standard for gravitas
Panel: white, 12px radius, 24px padding
Max-width: 440px
Structure:
  Icon: 48px warning/info icon, centered
  Title: 20px/600, centered, "Confirm Transfer"
  Summary: key-value pairs (From, To, Amount, Fee) in 14px, bordered rows
  Total: 16px/600, separated by border, right-aligned
  Buttons: "Cancel" secondary left, "Confirm Transfer — $500.00" primary right
```

### Navigation — Sidebar
```
Width: 240px fixed
Background: #0D1117 (dark sidebar for financial authority)
Logo: white version, 48px height area
Nav items: 36px height, 12px horizontal padding
Active: left 3px #0052CC accent bar, text white, bg rgba(255,255,255,0.08)
Inactive: text rgba(255,255,255,0.6)
Hover: text white, bg rgba(255,255,255,0.04)
Section labels: 11px/600 uppercase, rgba(255,255,255,0.3), letter-spacing 0.5px
Dividers: 1px rgba(255,255,255,0.08)
```

---

## 5. Layout & Spacing

### Grid System
- **Max content width:** 1200px
- **Columns:** 12-column
- **Gutter:** 24px
- **Page margin:** 32px desktop, 16px mobile
- **Sidebar:** 240px dark sidebar, always visible on desktop

### Spacing Scale (4px base)
| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | Icon-text gap |
| `--space-2` | 8px | Related element gaps |
| `--space-3` | 12px | Table cell padding |
| `--space-4` | 16px | Card padding mobile, form gaps |
| `--space-5` | 20px | Between form fields |
| `--space-6` | 24px | Card padding desktop |
| `--space-8` | 32px | Page margins, section gaps |
| `--space-12` | 48px | Major section separators |

### Responsive Breakpoints
| Name | Width | Behavior |
|------|-------|----------|
| Mobile | < 640px | Sidebar hidden, single column, bottom sheet for actions |
| Tablet | 640px – 1024px | Sidebar collapsed to icons, 2-column grid |
| Desktop | > 1024px | Full sidebar, multi-column layouts |

### Layout Rules
- Balance/summary cards span full width at top of dashboard — always visible without scrolling.
- Transaction tables are the primary content — they get maximum available width.
- Charts sit beside summary cards on desktop, stack below on tablet/mobile.
- Fixed sidebar on desktop — content area scrolls independently.
- Sticky table headers — financial tables often have many rows.

---

## 6. Elevation & Depth

### Shadow Scale
| Level | Value | Usage |
|-------|-------|-------|
| None | `none` | Default surfaces, table rows |
| XS | `0 1px 2px rgba(0,0,0,0.04)` | Card default (subtle presence) |
| SM | `0 2px 8px rgba(0,0,0,0.06)` | Dropdowns, date pickers |
| MD | `0 4px 16px rgba(0,0,0,0.08)` | Toasts, floating summaries |
| LG | `0 8px 32px rgba(0,0,0,0.12)` | Modals, confirmation dialogs |

### Depth Philosophy
- Cards have a subtle XS shadow by default — they need slight elevation to feel like "containers of value."
- The dark sidebar provides depth through color contrast, not shadow.
- Modals for financial confirmations use LG shadow + darker overlay for gravitas.
- Tooltips showing balance details use SM shadow.

---

## 7. Iconography & Imagery

### Icons
- **Library:** Lucide icons
- **Default size:** 18px nav, 16px inline, 20px standalone
- **Stroke width:** 1.5px
- **Color:** Inherit text color. Semantic icons use semantic colors.

### Transaction Category Icons
| Category | Icon | Circle BG |
|----------|------|-----------|
| Transfer | arrow-right-left | #E6F0FF |
| Payment | credit-card | #F0F2F5 |
| Income | arrow-down-left | #DAFBE1 |
| Expense | arrow-up-right | #FFEBE9 |
| Fee | percent | #FFF8C5 |
| Refund | rotate-ccw | #F0F2F5 |

### Charts
- **Library:** Recharts or D3
- **Line charts:** 2px stroke, dot on hover only, area fill at 0.06 opacity
- **Bar charts:** 8px radius top corners, 2px gap between bars
- **Color sequence:** #0052CC, #1A7F37, #BF8700, #CF222E, #8B949E
- **Grid lines:** 1px dashed #E1E4E8, horizontal only
- **Axis labels:** 12px, --color-text-muted
- **Tooltips:** white card, SM shadow, value in mono bold

### Imagery
- No decorative photography. Financial dashboards are data-only.
- Company logos (for transactions): 24px × 24px, circular, with 1px border fallback.
- QR codes: for payment addresses, white bg with 16px padding, 8px radius container.

---

## 8. Animation & Motion

### Timing
| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Instant | 0ms | — | Toggle states |
| Micro | 100ms | ease-out | Button hover, focus ring |
| Fast | 150ms | ease-out | Tooltip, dropdown |
| Standard | 200ms | ease-in-out | Modal, sidebar |
| Number | 600ms | cubic-bezier(0.16, 1, 0.3, 1) | Balance count-up animation |

### Motion Rules
- Balance values animate on first load — count up from 0 to actual value over 600ms.
- Transaction list items fade in with 30ms stagger between rows.
- Chart lines draw in from left to right over 800ms on first load.
- No motion on subsequent data updates — instant swap to avoid distraction.
- `prefers-reduced-motion`: disable count-up, chart draw, stagger. Keep opacity fades.
- Never animate monetary values during user input — it creates doubt about accuracy.

---

## 9. Design Guardrails

### Do
- Right-align all monetary values and numeric columns in tables.
- Always show currency code or symbol with monetary values.
- Include timestamps on all financial data: "Updated 2 minutes ago" or exact time.
- Show transaction fees explicitly — never hide costs in totals.
- Use confirmation modals for all financial actions over $0.
- Display running balance in transaction history.
- Format large numbers with separators: 1,000,000.00 not 1000000.

### Don't
- Don't round monetary values unless explicitly labeled as approximate.
- Don't use color alone to indicate positive/negative — always pair with +/- sign or ↑/↓ icon.
- Don't auto-refresh while user is filling out a form — it can cause data loss.
- Don't use animations on monetary values after initial load.
- Don't truncate monetary values — ever. Show the full amount.
- Don't use playful language, emojis, or casual tone in financial contexts.
- Don't use warm colors for backgrounds — cool grays communicate institutional trust.
- Don't hide important information behind hover states — all critical data visible at rest.

---

## 10. Accessibility Standards

### Compliance Level
WCAG 2.1 AA. Financial services in many jurisdictions require this legally.

### Color Contrast
| Element | Minimum Ratio | Verified |
|---------|---------------|----------|
| Body text (#424A53) on white | 4.5:1 | 8.1:1 ✓ |
| Primary text (#0D1117) on white | 4.5:1 | 17.4:1 ✓ |
| Positive (#1A7F37) on positive-light (#DAFBE1) | 4.5:1 | 4.6:1 ✓ |
| Negative (#CF222E) on negative-light (#FFEBE9) | 4.5:1 | 5.2:1 ✓ |
| White on dark sidebar (#0D1117) | 4.5:1 | 17.4:1 ✓ |

### Keyboard Navigation
- Tab order: sidebar → page header → balance cards → primary content
- Focus-visible: 2px solid #0052CC, 2px offset
- Tables: arrow keys navigate cells, Enter opens transaction detail
- Forms: Tab moves between fields, Enter submits (with confirmation)
- Escape: closes modals, dropdowns, and popovers

### Screen Reader
- Monetary values: `aria-label="Balance: one thousand two hundred fifty dollars and zero cents"` for screen readers.
- Positive/negative indicators: pair color with `aria-label` text ("+$50.00, gain" not just "+$50.00").
- Transaction tables: use `<th scope="col">`, `<caption>` for table description.
- Live balance updates: `aria-live="polite"` with descriptive announcement.

### Touch Targets
- All interactive elements: 36px minimum desktop, 44px minimum mobile.
- Table rows on mobile: 48px minimum for tappable rows.

---

## 11. Edge Cases & Error Patterns

### Empty States
```
Container: centered, max-width 400px, padding 48px
Icon: 48px, --color-text-muted
Headline: 16px/600, "No transactions yet"
Description: 14px/400, muted, instructional
CTA: Primary button, "Make your first transfer"
```

### Loading States
- **Balance:** Skeleton block matching Display size, pulse animation.
- **Transaction table:** 5 skeleton rows with column-width-matched blocks.
- **Charts:** Skeleton rectangle matching chart area with pulse.
- **Action buttons:** Spinner replaces text, button disabled, "Processing..." label.

### Error States
- **Failed transaction:** Inline alert at top of detail view, red left border, clear explanation.
- **API error:** Banner at top of page: "Unable to load account data. Retrying..." with auto-retry.
- **Form validation:** Inline below field. For amount fields: "Insufficient funds. Available: $1,200.00."
- **Session timeout:** Modal overlay: "Your session has expired for security. Please sign in again."

### Security Patterns
- Session timeout warning at 4 minutes: "Your session will expire in 1 minute. Continue?"
- Mask account numbers by default: ****4521. Reveal on click with "Show" toggle.
- Sensitive actions require re-authentication (password or biometric).
- Activity log accessible from settings: "Last login: Apr 6, 2026, 2:14 PM from Accra, GH."

### Overflow & Long Content
- Transaction descriptions: truncate at 40 characters in table, full text in detail view.
- Account names: truncate at 30 characters with ellipsis, tooltip on hover.
- Monetary values: NEVER truncate. If the column is too narrow, widen it or wrap the row.

---

## 12. Agent Instructions

> Explicit rules for AI coding agents generating fintech UI.

### Before Generating
1. Read this entire DESIGN.md before writing any code.
2. Use CSS custom properties for all tokens.
3. Import Inter (400, 500, 600) and JetBrains Mono (400, 500).
4. Set `font-variant-numeric: tabular-nums` globally on the body.

### CSS Reset Baseline
```css
*, *::before, *::after { box-sizing: border-box; margin: 0; }
body {
  font-family: 'Inter', -apple-system, sans-serif;
  font-size: 14px; line-height: 1.6; color: #424A53;
  background: #F7F8FA;
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
}
```

### Agent Prompt Templates

**Dashboard:**
"Build a fintech dashboard with dark sidebar, balance card showing total balance with change indicator, a line chart of balance over 30 days, and a recent transactions table with date, description, category badge, amount (right-aligned, green/red), and running balance."

**Transaction detail:**
"Create a transaction detail page: header with amount (Display size, green for credit), status badge, merchant name, date/time, category, reference number (mono). Below: timeline showing status changes. Bottom: related transactions list."

**Transfer form:**
"Build a money transfer form: from account selector, to account/beneficiary, amount with currency input, memo field, fee display, total display. Sticky 'Review Transfer' button. Confirmation modal showing all details before final submit."

### Common AI Agent Mistakes to Avoid
- Left-aligning monetary values in tables — always right-align numbers.
- Using proportional fonts for monetary values — always use monospace with tabular-nums.
- Not including currency symbols/codes with amounts.
- Using green/red without +/- signs — color alone is insufficient.
- Rounding monetary values (showing $1.2K instead of $1,200.00).
- Allowing monetary value truncation — amounts must always be fully visible.
- Using warm-toned backgrounds — fintech surfaces are cool-gray.
- Skipping confirmation modals on financial actions.
- Making the sidebar light — fintech authority comes from a dark sidebar.
