# Dashboard design

Module dashboards follow these two specs. Read the one that matches the surface before changing layout, type, or color.

| Surface | Spec |
|---------|------|
| Module dashboards, tables, status, navigation, forms | [enterprise-saas.md](enterprise-saas.md) |
| Amounts, scores, SLA days, counts in tables, gain/loss | [fintech-dashboard.md](fintech-dashboard.md) |

Enterprise SaaS is the page. Fintech is how numbers sit on that page: tabular figures, right-aligned, a sign as well as color, full precision, never truncated.

The home dashboard (`/dashboard`) is the first surface on these tokens (`.dash` in `grc-frontend/styles/dashboard.css`). Other module dashboards adopt the same class as they are revamped. Do not restyle the global sidebar or the product teal in the same change.
