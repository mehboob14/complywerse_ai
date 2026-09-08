# Automation and Integrations

> **Read this whole file before writing anything about automation.** The connector count is
> impressive and the temptation to lead with "automated compliance" is strong. The engine
> does not yet do what that phrase implies, and saying it does would be a false claim about
> a compliance product.

## Status

**`BUILT — NOT TRUSTWORTHY`**

The collection engine works. The layer that decides *which control a check proves* does
not. Until that is fixed, the engine proves that a connector authenticated — not that a
control operates.

## What exists

**65 SaaS providers**, each with declarative checks — 130 in the catalogue. Adding a
provider is a catalogue entry rather than new code.

`airtable · anthropic · asana · auth0 · azure_devops · bamboohr · better_stack · bitbucket ·
calendly · clerk · clickup · cloudflare · confluence · databricks · datadog · digitalocean ·
dropbox · fastly · github · gitlab · google_workspace · grafana · heroku · hubspot ·
intercom · jamf · jira · jumpcloud · kandji · linear · mailgun · microsoft_365 · monday ·
neon · netlify · notion · okta · one_password · onelogin · openai · opsgenie · pagerduty ·
posthog · postmark · qovery · render · resend · rippling · semgrep · sendgrid · sentinelone ·
sentry · servicenow · signoz · slack · snyk · sonarcloud · stripe · supabase · tailscale ·
tenable · twilio · vercel · zendesk · zoom`

Alongside these, benchmark plugin sets for **AWS Foundations (CIS v3.0)** and
**Ubuntu 22.04 (CIS v2.0)**, and a SOC 2 quantitative set. A provisioned tenant carries
**111 seeded plugins**.

The connector list is genuinely strong and covers the identity, source control, ticketing,
HR, monitoring and endpoint systems a mid-size technology organisation actually runs.
**It is safe to describe the connector coverage.** It is the inference drawn from a check
result that is not safe.

## How it works

A *runner* knows how to talk to a class of system. A *plugin* is a declarative check
executed by a runner — it names the endpoint, the shape of the response and the condition
constituting a pass. Results become findings; findings attach to controls.

- **`live_api`** — HTTP SaaS providers, token or OAuth authenticated
- **`aws_readonly`** — read-only AWS API calls for infrastructure benchmarks

## Why it is not trustworthy yet

Two defects, both in the binding layer rather than the collection:

1. **Checks are bound at connector level rather than per check.** A storage-backup check and
   a firewall check from the same provider are treated as interchangeable evidence.

2. **Each SOC 2 criterion is then inherited by every control mapping to it.** One criterion
   reaches 37 controls. A single passing check therefore lights up dozens of controls it
   says nothing about.

The worst of this has been fixed — checks now attach only where they name a criterion the
control actually maps to, a control's status is computed only from its own findings, and a
check that collected nothing reports "not assessed" rather than "pass". **That last fix
alone stopped 187 of 239 checks from being able to report success on empty data.**

But the binding still needs re-authoring properly, and that is a compliance-judgement task:
every check must name the specific SCF assessment objective it proves. It cannot be
automated, because a machine binding inflates coverage roughly twentyfold.

## The rule this creates

> **Do not publish, quote or imply a compliance percentage derived from automated checks.**
> Not in a post, not in a screenshot, not in a demo video, not in a customer-facing dashboard
> mock-up.

This applies to any phrasing that implies the platform currently measures compliance
automatically: *"X% compliant automatically"*, *"continuous compliance monitoring"*,
*"always audit-ready"*, *"real-time compliance posture"*.

## What IS safe to say about automation

- The number and names of supported connectors
- That evidence collection is connector-based and declarative, so adding a provider is
  configuration rather than engineering
- That checks run on a schedule through a background worker
- That a check which collects nothing reports "not assessed" rather than passing — this is
  a real and unusual integrity property worth naming
- That the platform is **building toward** automated evidence collection, with the binding
  work explicitly ahead of it

## What is not built

**Cloud infrastructure connectors** · `PLANNED`
AWS, Azure, Entra, GCP and Kubernetes need SDK and OAuth transports rather than static
tokens. **This is the bulk of real customer infrastructure and none of it is collectable
today.** Do not imply cloud posture coverage.

**Evidence expiry** · `PLANNED`
SCF publishes a reassessment cadence per control — Annual, Semi-Annual, Quarterly. It is
imported and returned by the API, and nothing reads it. Without it, a check that passed 400
days ago on a since-revoked token still reads green. Do not claim evidence freshness.

**Collection health surfacing** · `PLANNED`
A revoked scope or expired secret currently looks like a failing control rather than a
broken collector. Do not claim the platform distinguishes them.

## Other integrations that ARE dependable

These sit outside the compliance-inference problem and are safe to describe:

- **Vulnerability scanner integration** — ingesting scanner output into the vulnerability register
- **ITSM ticket linking** — connecting findings and tasks to an external ticketing system
- **RSS ingestion for regulatory change** — pulling regulator feeds into the change module
- **Identity provider integration** — SSO including Microsoft Entra ID
- **Asset and external attack surface discovery**

## Honest framing that still sells

The defensible position is stronger than the overclaim, and for this buyer it is more
persuasive:

> *"Most compliance automation tells you a connector authenticated and calls it a passing
> control. We are building the layer that makes the difference — every automated check will
> name the specific assessment objective it proves, authored by a compliance reviewer, not
> inferred by a machine. Until that lands we report evidence collected, not compliance
> achieved."*

A CISO who has been burned by a green dashboard that meant nothing will recognise that
distinction immediately. It is a differentiator, not an apology.
