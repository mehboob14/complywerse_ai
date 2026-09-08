# Modules and Capabilities

Every entry carries a status. **Do not promote a capability above its status when writing.**

- **`SHIPPED`** — built, reachable in the UI, safe to describe in the present tense
- **`BUILT — NOT TRUSTWORTHY`** — exists and runs, but does not yet produce reliable output
- **`IN PROGRESS`** — partially built
- **`PLANNED`** — designed, not built

---

## Compliance

**Framework libraries** · `SHIPPED`
34 frameworks ship with requirement code, title, description, verbatim text, domain and
per-requirement evidence asks. International standards and regional regulation, listed in
`01-PLATFORM-OVERVIEW.md`.

**Framework upload and parsing** · `SHIPPED`
A customer can upload a framework the platform does not ship — a regulator's PDF, an
internal standard — and have its requirements parsed into the same structure, then mapped
to the control set.

**Compliance assessments** · `SHIPPED`
Assessment campaigns against a framework, with per-requirement responses, evidence
attachment and an approval workflow.

**Certification journey** · `SHIPPED`
Tracks progress toward a named certification, with the lifecycle stages and the artifacts
each requires.

---

## The control plane

**Common control library** · `SHIPPED`
1,534 controls across 34 domains, each carrying implementation guidance, maturity levels,
assessment objectives and its crosswalk to every framework requirement it discharges. The
core of the product — see `04-CONTROL-PLANE.md`.

**Requirement coverage and disposition** · `SHIPPED`
Every requirement in every framework carries an explicit state: mapped to a control, or
dispositioned with a written reason (binds another party, outside the catalogue's domain,
or not yet assessed). 99.7% accounted for.

**Control workbench and effectiveness** · `SHIPPED`
Per-control state, ownership, implementation status and effectiveness assessment.

**Internal control register** · `SHIPPED`
The organisation's own controls where they extend beyond the shipped catalogue.

---

## Evidence

**Evidence management** · `SHIPPED`
Evidence requests, collection, review and approval, with each item linked to the controls
and requirements it satisfies and a retention position.

**Consolidated evidence sets** · `IN PROGRESS`
Each control's evidence asks — inherited from every framework requirement it discharges —
merged into one requestable set, each artifact citing every framework that asks for it.
**121 of the 300 highest-volume controls are consolidated**, taking 14,648 raw asks down to
1,840 artifacts. The rest still show their un-merged lists and are labelled as such in the
UI. This is a genuine differentiator once complete; describe it as in progress until then.

**Artifact catalogue** · `IN PROGRESS`
922 catalogue items defining the artifacts a tenant is expected to hold. Not yet
instantiated per tenant.

**Document management and attestation** · `SHIPPED`
Governance document lifecycle with versioning, review cycles, sign-off and attestation
campaigns.

---

## Risk

**Enterprise risk management** · `SHIPPED`
Risk register with assessment, treatment plans, ownership and monitoring. Advanced ERM
adds the extended taxonomy.

**Risk and control self-assessment (RCSA)** · `SHIPPED`

**Risk quantification** · `SHIPPED`
Quantitative risk expression alongside the qualitative register.

**Risk posture** · `SHIPPED`
Aggregate posture view across the register.

**AI risk assessment** · `SHIPPED`
Assisted drafting of risk assessments from templates. Assistive — a human owns the output.

---

## Governance

**Governance module** · `SHIPPED`
Policies, standards and procedures with their lifecycle, ownership and review cadence.

**Policy statement compliance and gap analysis** · `SHIPPED`
Decomposes policy documents into statements and assesses coverage against them.

**Policy exceptions** · `SHIPPED`
Exception register with rationale, compensating controls, approver and expiry.

**Board and committee management** · `SHIPPED`

**Regulatory change management** · `SHIPPED`
Tracks regulatory change with RSS ingestion of regulator feeds, impact assessment and the
downstream actions a change triggers.

---

## Third party and vendor

**Vendor risk management** · `SHIPPED`
Vendor register, due diligence, assessment and ongoing monitoring.

**Third-party risk assessment lifecycle (TPRA)** · `SHIPPED`
The staged assessment lifecycle from onboarding through periodic reassessment.

---

## Assets and technical security

**IT asset inventory** · `SHIPPED`
Asset register with ownership, classification and lifecycle.

**Asset discovery** · `SHIPPED`
Discovery of assets, including external attack-surface discovery.

**Cybersecurity assurance** · `SHIPPED`
External attack surface management with external risk and health scoring.

**Vulnerability management** · `SHIPPED`
Vulnerability register, workflow templates, remediation tracking and scanner integration.

**Continuous threat exposure management (CTEM) scope, choke points** · `IN PROGRESS`

---

## Audit and assurance

**Auditor portal** · `SHIPPED`
A scoped, read-only surface for an external auditor to review controls and evidence
without access to the wider platform.

**Statutory audit** · `SHIPPED`

**Audit planning** · `SHIPPED`

**Access review** · `SHIPPED`
Periodic user access recertification campaigns.

---

## Automation

**Compliance plugins / evidence engine** · **`BUILT — NOT TRUSTWORTHY`**
65 SaaS connectors carrying 130 declarative checks, plus AWS and Ubuntu CIS benchmark
plugins — 111 seeded plugins in a provisioned tenant. The collection works. The layer
binding a check to the control it proves does not yet. **Read
`05-AUTOMATION-AND-INTEGRATIONS.md` before writing about this.**

**Workflow automation engine** · `SHIPPED`
Configuration-driven workflow automation with customisable templates.

**Integrations** · `SHIPPED`
Integration connection management, credential handling and a connection wizard.

---

## Business continuity

**Business continuity management** · `SHIPPED`
Business impact analysis, continuity and recovery plans, and exercise records.

---

## Reporting and insight

**Dashboards and reporting** · `SHIPPED`
Enriched dashboards, report definitions, metric snapshots, targets and scorecards.

**ComplyChat** · `SHIPPED`
A built-in assistant that answers questions over the tenant's own compliance data.
Assistive; it does not compute or assert compliance status.

**AI recommendations** · `SHIPPED`
Assisted recommendations surfaced in-product. Assistive.

---

## Administration

**Multi-tenancy, RBAC, SSO, audit trail** · `SHIPPED`
Per-tenant database isolation, role-based access control, identity-provider integration
including Microsoft Entra ID, per-tenant password and session policy, and a privileged
action audit trail.

**Onboarding** · `SHIPPED`

**AI usage and budget controls** · `SHIPPED`
Per-tenant tracking and budgeting of AI usage.

---

## Regional specialisation worth naming

The platform carries dedicated support for **NCA** (Saudi National Cybersecurity Authority)
containers, KPIs, risk and vulnerability templates, and a **DCC** tool. This regional
depth is unusual and is a legitimate differentiator — most GRC platforms do not model
national regulator constructs directly.
