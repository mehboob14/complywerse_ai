# 360° Demo Script — Full Platform Walkthrough

> ~12-15 minutes if you read it. Paraphrase, don't recite. Each section
> has the **NARRATION** (what you say) and the **WHY THIS MATTERS** angle
> (org pain → how we solve it) so you can pivot to whichever resonates
> with the client.

---

## OPENING (60 seconds)

**NARRATION**

> "Let me walk you through what I built end-to-end. I'll keep it at the
> architecture level rather than screen-sharing — the platform is in
> production with a client and the data on screen is theirs.
>
> Think of it as: one platform that pulls together the seven things that
> usually live in seven different tools — Governance, Risk, Compliance,
> Assets, Vulnerabilities, Issues, and Workflows — and ties them together
> with a single linkage model, so when an auditor asks 'show me how you've
> mitigated risk X', three clicks get them from the risk to the asset to
> the control to the evidence. That's the elevator pitch. Let me unpack
> each piece."

---

## 1. FRAMEWORKS LIBRARY — 27 frameworks, pre-seeded

**NARRATION**

> "We start with the frameworks library because everything else hangs off
> it. The platform ships with **27 regulatory frameworks pre-seeded**, with
> their full control hierarchy — Framework → Domain → Objective → Control →
> sometimes Sub-Control. Each control has its statement, implementation
> guidance, testing guidance, and evidence requirements baked in."

### The 27 frameworks (group by region for the client)

**International / Global (10)**
1. **ISO 27001:2022** — Information Security Management Systems
2. **ISO 22301** — Business Continuity Management
3. **ISO 42001** — AI Management Systems (the new one)
4. **NIST CSF 2.0** — US Cybersecurity Framework
5. **NIST 800-53** — Federal control catalogue (high baseline)
6. **PCI DSS v4** — Payment Card Industry Data Security Standard
7. **CIS Controls v8** — Center for Internet Security
8. **COBIT** — IT governance framework
9. **SOC 2** — Trust Services Criteria
10. **HITRUST CSF** — Healthcare-focused integrated framework

**EU / Western Regulations (4)**
11. **GDPR** — EU data protection
12. **NIS2** — EU Network & Information Security Directive
13. **DORA** — Digital Operational Resilience Act (financial sector)
14. **SOX** — Sarbanes-Oxley (US financial reporting)

**US Healthcare (1)**
15. **HIPAA** — Health Insurance Portability & Accountability Act

**Middle East — Saudi Arabia (3)**
16. **SAMA CSF** — Saudi Arabian Monetary Authority Cybersecurity Framework
17. **Aramco CCC** — Saudi Aramco Cybersecurity Compliance Certificate
18. **SABIC CyberTrust** — SABIC's vendor cybersecurity program

**Middle East — UAE (2)**
19. **ADHICS** — Abu Dhabi Healthcare Information & Cyber Security
20. **DOH ADHIE Policy** — Abu Dhabi Department of Health policy

**Middle East — Qatar (1)**
21. **QCB Technology Risks** — Qatar Central Bank technology risk framework

**Asia Pacific (2)**
22. **MAS TRM** — Monetary Authority of Singapore Technology Risk Management
23. **SL CSF** — Sri Lanka Cyber Security Framework

**Pakistan — State Bank of Pakistan (3)**
24. **SBP ETGRMF** — Enterprise Technology Governance & Risk Management Framework
25. **SBP Cloud Adoption Framework**
26. **SBP Internet Banking Security Framework**

**Global financial messaging (1)**
27. **SWIFT CSCF** — SWIFT Customer Security Controls Framework

**WHY THIS MATTERS**

> "Most GRC tools ship empty. You buy a license, then you spend the first
> three months loading framework controls from PDF spreadsheets — that's
> a real consulting expense, usually $20-50K, before you've answered a
> single risk question. We ship with 27 frameworks already structured in
> the database. A regulated bank in Saudi or the UAE can start mapping
> SAMA, NCA equivalents, ADHICS, ISO 27001 the day after install. And
> when a new framework comes out — like ISO 42001 for AI governance, which
> we already shipped — we add it without the customer paying for a
> consultant to re-key control text."

---

## 2. GOVERNANCE — Documents, Committees, Exceptions (AI-powered)

**NARRATION**

> "The Governance module handles everything you'd expect a CISO's office
> to manage on paper. Three sub-modules.

### 2a. Document Management

> "Full document lifecycle — policies, procedures, standards, guidelines.
> You upload a draft, route it through a configurable approval chain —
> author writes → reviewer comments → committee approves → final published
> with version history. Every published version is immutable; every
> revision is tracked diff-style. There's an AI layer here: when you
> upload a policy, the platform parses it, classifies it (is it a policy
> versus a procedure?), suggests the right policy code, extracts key
> sections — purpose, scope, responsibilities — and pre-fills the
> metadata. Saves the policy author 20-30 minutes per document.

### 2b. Committees

> "Committees are where governance actually happens — Risk Committee,
> Audit Committee, IT Steering Committee, etc. The platform manages
> committee structure (who's on it, who chairs it, what the charter says),
> meeting agendas, minutes, action items, attendance records.
> AI here parses uploaded meeting transcripts and pre-fills the minutes
> template — committee secretaries used to spend 2 hours per meeting on
> minute-taking; we cut that to ~20 minutes of review.

### 2c. Exceptions Management

> "Exceptions are formal acceptance of risk — 'we're not patching this
> system because the business case justifies it for the next 90 days'.
> The platform handles the request, the multi-tier approval (manager →
> CISO → board if material), the expiry tracking, automatic re-review
> reminders, and the audit trail. Exception requests link directly to
> the underlying risk and the affected assets — so when an exception
> expires, the platform flags every dependent risk that goes back to
> 'unmitigated' status. That last point is the one that organizations
> always get wrong manually."

**WHY THIS MATTERS**

> "Without this module, document control lives in SharePoint, committee
> minutes live in Word docs nobody reads, and exception tracking lives
> in a spreadsheet that gets out of date the day after audit. When the
> regulator asks 'show me the policy that governs your cloud usage and
> the committee that approved it', the answer should be three clicks,
> not three emails."

---

## 3. ENTERPRISE RISK MANAGEMENT (ERM)

**NARRATION**

> "ERM is the centerpiece. Five sub-modules.

### 3a. Risk Register
> "Full CRUD on enterprise risks. Inherent versus residual scoring on a
> 5-by-5 matrix — likelihood and impact. Treatment strategies: Accept,
> Reduce, Transfer, Avoid. Each risk has an owner, a treatment plan,
> a target residual score, and a review cadence. Heatmaps, category
> breakdowns, top-10 risk lists.

### 3b. Compliance Framework Assessments — THIS IS THE BIG ONE

> "This is where the framework library becomes operational. You launch
> an assessment against, say, ISO 27001. The platform creates a workbook
> of every applicable control — 93 for ISO 27001 — and the assessor goes
> through control by control:
>
> - **Implementation status** — Not implemented / Partial / Implemented / Tested
> - **Effectiveness rating** — 1-5
> - **Evidence attached** — drag and drop, or pick from the evidence library
> - **Internal control mapping** — which of YOUR controls implement this
> - **Owner + reviewer + sign-off**
>
> When the assessment completes, the platform calculates your readiness
> percentage per framework, surfaces the unmapped controls, the controls
> with insufficient evidence, the controls failing testing. Auditors love
> this view because it's the same data they'd ask for in a workbook —
> except it's live and traceable.

### 3c. Key Risk Indicators (KRIs)
> "Quantitative metrics tied to risks — 'number of critical vulnerabilities
> open > 30 days', 'percentage of admin accounts without MFA'. Green /
> amber / red thresholds. Time-series tracking. When a KRI flips red,
> it triggers the workflow engine — could open a ticket, notify the risk
> owner, or escalate to the committee.

### 3d. Incident Management
> "Incident log with severity classification, impact assessment, root cause,
> lessons learned, post-incident review workflow. Incidents link back to
> risks (did this incident materialize an existing risk?) and to controls
> (which control failed?).

### 3e. COSO ERM Wheel
> "Executive-level visualization showing your risk posture across the COSO
> ERM categories — Strategy, Operations, Reporting, Compliance. Board
> directors recognize this format from the standard."

**LINKAGE in ERM — explain this one slowly:**

> "Here's the part most platforms get wrong. A risk in our system isn't
> a standalone row. A risk links to:
>
> - The assets it threatens
> - The vulnerabilities that materialize it
> - The internal controls that mitigate it
> - The framework controls those internal controls map to
> - The evidence proving those controls work
> - The incidents where the risk has materialized historically
>
> So when the CISO opens 'Ransomware on critical infrastructure', the
> risk page shows: the 47 critical-criticality servers it threatens,
> the 12 open vulnerabilities currently feeding it, the 6 internal
> controls mitigating it, the 18 framework controls those map to
> across ISO 27001 / NIST CSF / PCI, the evidence library showing the
> last backup test report, and the 2 historical incidents. All on one
> screen. THAT is what makes this platform sticky."

**WHY THIS MATTERS**

> "Organizations struggle with two ERM things. First, they treat risk
> assessment as an annual spreadsheet exercise — by the time it's done,
> half of it is stale. Second, their risk register doesn't connect to
> anything operational — when a new critical vulnerability appears,
> nobody updates the residual score on the related risk. Our platform
> makes the risk register a live document because it's wired to the
> rest of the system."

---

## 4. ASSETS — Inventory + Criticality

**NARRATION**

> "Assets are the foundation that everything else attaches to. The IT
> Asset Inventory tracks every asset — physical servers, virtual machines,
> cloud workloads, databases, network devices, applications. For each
> asset:
>
> - **Identity** — hostname, IP, asset type, OS family / version
> - **Ownership** — primary owner, business owner, custodian, owning team
> - **Lifecycle state** — planned / active / maintenance / decommissioned / retired (with a state machine that prevents invalid transitions)
> - **Criticality assessments** — formal Information System and Infrastructure criticality scoring, similar to NIST SP 800-60 or the SAMA criticality model. CIA scores, derived numeric criticality, with audit-traceable overrides
> - **Compliance scope tags** — PCI-DSS, HIPAA, GDPR — drives which scans apply
> - **Network exposure** — internet-facing, network segment, DMZ vs internal
> - **Discovery source** — was this asset manually added, scanned, or imported from a connector

> "Assets connect to:
> - Risks (the risks they threaten)
> - Vulnerabilities (open vulns on them)
> - Framework Controls (which controls apply — we auto-recommend via regex matcher)
> - Internal Controls (which org controls cover them)
> - Evidence (linked attestations, scan reports, configuration snapshots)
> - Scan results (CIS benchmark pass/fail counts per asset)

> "And here's the killer feature — **Mapping Recommendations**. For every
> asset, the platform runs a regex-based scorer across all 27 frameworks
> and surfaces which controls are most likely to apply, broken down by
> confidence. Auditor says 'why have you mapped this server to NIST
> AC-2?' — answer: 'because the platform's matcher fired on three signals,
> here they are, here's the rationale'."

**WHY THIS MATTERS**

> "Every regulated org has 'our asset list' in a spreadsheet that's six
> months out of date, plus three scanners that each see a different
> subset, plus a CMDB that nobody trusts. Our platform consolidates,
> deduplicates, and continuously updates the picture — and it auto-suggests
> which compliance controls each asset should be governed by. That last
> piece alone replaces weeks of consultant time during ISO 27001 prep."

---

## 5. VULNERABILITY MANAGEMENT

**NARRATION**

> "Vulnerability register with everything a security operations team
> needs. Per vulnerability:
>
> - **Identity** — CVE ID, title, description, severity (CVSS), affected assets
> - **Threat intelligence enrichment** — KEV flag (is it on CISA's Known
>   Exploited Vulnerabilities list?), EPSS score (probability of
>   exploitation in the next 30 days), composite priority that combines
>   CVSS + KEV + EPSS + asset criticality
> - **SLA tracking** — remediation deadlines per severity, overdue
>   highlighting, MTTR (mean time to remediate) per team
> - **Exception workflow** — 'we can't patch this in 30 days, here's the
>   compensating control, approved by CISO until X date'
> - **NCA Saudi template** — first-class support for the Saudi National
>   Cybersecurity Authority vulnerability template
> - **Patch correlation** — which patches close which vulns
> - **Department / owner assignment** — vulns route to the right team automatically
> - **Aging buckets** — 0-30d / 31-60d / 61-90d / 90+d
>
> "Linkage: vulnerabilities link to the assets they're on (one vuln can
> hit 200 assets), to the risks they feed, and to the framework controls
> they violate. So when 'Log4Shell' lands, the CISO sees 200 affected
> assets, the 7 risks materially raised by it, and the ISO 27001 controls
> that just dropped to 'failing' because of it."

**WHY THIS MATTERS**

> "Vulnerability management teams drown in scanner output — Nessus says
> 50,000 findings, the SecOps team has 5 people, they prioritize the
> wrong things. Our platform's composite priority — CVSS combined with
> KEV combined with EPSS combined with the asset's criticality — surfaces
> the 30 vulnerabilities you should fix THIS WEEK, not the 50,000 sorted
> by CVSS alone."

---

## 6. ISSUES MANAGEMENT

**NARRATION**

> "Issues is the operational backbone — anything raised by an audit, a
> risk assessment, a vulnerability scan, an incident review, or a manual
> report. Six sub-views:
>
> - **Enterprise Issue Log** — central register, severity classified
> - **CAPA Actions** — Corrective And Preventive Actions tracked to closure
> - **Contract Compliance** — third-party contractual obligations
> - **Closure Tracker** — what's been closed, when, by whom, with evidence
> - **Severity Matrix** — heat map of open issues by severity × age
> - **Classification Matrix** — taxonomy view
>
> "Every issue links back to its source — the audit finding, the
> control failure, the incident — so closure is traceable to root
> cause. CAPA in particular drives a structured 'what we changed' /
> 'what we'll do differently' workflow that ISO auditors specifically
> ask for."

**WHY THIS MATTERS**

> "Organizations track issues in Jira tickets, email threads, Excel
> sheets, and meeting minutes. When the auditor asks 'how did you fix
> the issue from last year's report', the answer takes a week of email
> archaeology. Here, it's: open the issue, see the CAPA, see the linked
> evidence, see the closure approval. Done."

---

## 7. WORKFLOW ENGINE — Configurable per organization

**NARRATION**

> "Every workflow in the platform — document approvals, risk treatment
> sign-offs, exception requests, vulnerability acceptance, evidence
> reviews, criticality assessment approvals — runs on one configurable
> workflow engine.
>
> "What 'configurable' means:
> - **Steps**: you define the chain — Assessor → Business Owner → CISO →
>   Board, or shorter / longer
> - **Routing rules**: 'if the risk is materiality > $1M, escalate to the
>   Board; else stop at CISO'
> - **Timeouts**: 'if reviewer hasn't acted in 5 business days, escalate'
> - **Parallel branches**: 'send to legal AND compliance simultaneously,
>   require both approvals'
> - **Triggers**: workflows fire automatically — 'when a critical vuln
>   stays open > 14 days, open a CAPA'
> - **Notifications**: email, in-app, optionally Microsoft Teams / Slack
> - **Audit log**: every transition recorded with user + timestamp + diff
>
> "Each customer organization configures this for their own governance
> structure. A small startup might have a single-approver workflow; a
> bank might have a five-step chain with board escalation. Same engine,
> different config. Nothing hardcoded."

**WHY THIS MATTERS**

> "Most GRC platforms ship one approval workflow — author → reviewer →
> approved. That works for a small company; it falls apart at a bank
> where 'approved by' depends on the materiality threshold, the
> department, and the time of year. Custom workflows used to mean custom
> code. Ours doesn't."

---

## 8. EVIDENCE LIBRARY

**NARRATION**

> "Central evidence repository. Upload files — PDFs, Word, Excel, images,
> CSV scan exports. Each evidence item links to one or many framework
> controls and / or internal controls. Status flags: Draft, Approved,
> Expired. Expiry tracking with automatic reminders 30 / 14 / 7 days
> ahead. OCR on PDFs and images so the text becomes searchable.
> Per-tenant encryption at rest using Fernet with rotated keys.
>
> "The AI layer here is the **Evidence Quick-Assess** — when you upload
> a document and link it to a control, the AI reads the document, reads
> the control's requirements, and gives the reviewer a quick verdict:
> 'this document addresses 4 of the 6 sub-requirements; the remaining 2
> are not covered'. Cuts evidence-review time by 60-70%."

**WHY THIS MATTERS**

> "Evidence in the typical org lives in SharePoint folders with names
> like 'audit_evidence_2024_final_v3_REAL.zip'. Auditor asks for the
> backup-test report from Q2, somebody spends 90 minutes hunting. Here,
> evidence is indexed, linked to the controls it supports, OCR-searchable,
> and version-controlled."

---

## 9. ADMINISTRATION — Users, Roles, AD / Google Workspace Integration

**NARRATION**

> "Administration is where it's set up.
>
> ### Users
> - CRUD on platform users
> - Per-tenant scope (a user belongs to one or more tenant organizations)
> - Activity log per user
> - MFA support
>
> ### Roles
> - Out-of-the-box: Administrator / Risk Manager / Compliance Manager /
>   Auditor / Read-only
> - Custom roles with granular permissions — 140+ individual permissions
>   across the modules (e.g. 'can edit risks', 'can approve evidence',
>   'can view audit logs', 'can manage scanners')
> - Permission gates enforced both in the UI (hide buttons) and the
>   backend (deny requests)
>
> ### Active Directory + Google Workspace integration
> - **Azure AD / Entra ID integration** — pull users and groups directly;
>   role auto-assignment from AD groups; SAML SSO; no separate password
>   management
> - **Google Workspace integration** — same flow via OAuth + Directory API
> - **On-prem LDAP** — bind-and-search for legacy environments
>
> ### Identity Providers
> - SAML 2.0
> - OIDC
> - SCIM provisioning for auto-deprovisioning when someone leaves the org

> ### Password Policy
> - Configurable per tenant
> - Complexity rules, expiry, history, lockout thresholds, idle timeout

> ### Audit Logs
> - Every action recorded with user + timestamp + before/after diff
> - Filterable, exportable to CSV / JSON
> - Tamper-evident (hash-chained — every entry references the previous one's hash)

**WHY THIS MATTERS**

> "Onboarding 200 users one-by-one is a non-starter — every customer org
> has Active Directory or Google Workspace as the source of truth. Our
> platform reads from there. When a new employee joins, they're already
> in. When someone leaves, SCIM provisioning auto-deactivates them. The
> CISO doesn't have to manage two user directories."

---

## 10. INTEGRATIONS — Scanners, Cloud, External Systems

**NARRATION**

> "Three integration categories.

### 10a. Vulnerability scanners
> "We integrate with the scanners your customers already use — we don't
> ask them to throw away their existing investment:
>
> - **Tenable Nessus / Tenable.io** — pull scan results, normalize into
>   the vuln register, deduplicate, enrich with KEV / EPSS
> - **Rapid7 InsightVM / Nexpose** — same flow
> - **Wazuh** — SIEM + XDR + agent-based vulnerability data
> - **Qualys** — VMDR results
> - **Microsoft Defender for Endpoint** — vulnerability assessment data
> - **OpenVAS / Greenbone** — open-source option for tighter-budget orgs

### 10b. Cloud connectors
> - **AWS Inspector** — EC2 + ECR vulnerability findings, plus Inspector for Lambda
> - **AWS Security Hub** — aggregated findings
> - **Azure Defender** (Microsoft Defender for Cloud) — Azure resources
> - **GCP Security Command Center** — GCP findings
> - **Kubernetes** — kube-bench, kube-hunter, Trivy results

### 10c. Asset discovery
> - **Connect Wizard** — agentless WinRM (Windows) / SSH (Linux) / SNMP
>   (network devices) / database probes (Oracle, MSSQL, Postgres, MySQL)
> - **Endpoint agent** — small Python binary, installs on Windows / Linux,
>   runs CIS benchmark scans, reports back continuously
> - **Active Directory / LDAP bulk discovery** — bind once, enumerate every
>   domain-joined computer, auto-onboard with shared credentials

### 10d. External operational systems
> - **ServiceNow** — bidirectional ticket sync; raise CAPAs / issues
>   that flow into the customer's existing ITSM
> - **Splunk** — push GRC events into the customer's SIEM
> - **Microsoft Teams / Slack** — workflow notifications and approval requests
> - **Email (SMTP / SendGrid / SES)** — notifications, scheduled digests
> - **Fireflies** — meeting transcript ingestion for committee minutes

**WHY THIS MATTERS**

> "Every CISO buying a GRC tool is afraid of one thing — that they'll
> have to throw away the $200K they've already spent on Nessus / Rapid7
> / Tenable and re-do their scanning. We integrate with what they have.
> The GRC tool becomes the consolidation layer, not yet another silo.
> That positioning is the entire sale."

---

## 11. AI LAYER — Where it actually pays for itself

**NARRATION**

> "We use AI in five places. We deliberately don't use it everywhere
> because LLM tokens add up and deterministic code is faster, cheaper,
> and audit-friendly.

### 11a. ComplyChat — natural-language Q&A
> "An assistant you can ask anything across the platform.
>
> - 'Show me all critical vulnerabilities on PCI-scope assets that have
>   been open more than 30 days.'
> - 'Which ISO 27001 controls have no evidence attached?'
> - 'List all risks owned by the Payments team with residual score > 10.'
>
> "The LLM translates the natural-language question into a structured
> query, executes it read-only, and presents the result. Saves the
> compliance team from learning SQL or filtering through 12 UI dropdowns.

### 11b. Document AI (Governance)
> "Policy uploads get auto-classified and metadata-extracted. Meeting
> transcripts become draft minutes. Document version diffs get
> AI-summarized — 'what actually changed in version 4'.

### 11c. Evidence Quick-Assess
> "Mentioned above — AI reads evidence + control requirements, verdict.

### 11d. Asset Auto-Classification
> "On connect, probe output → OS family / version / edition. Deterministic
> lookup tables, not LLM, but reads like AI to the user.

### 11e. Mapping Recommendations (the one we built last week)
> "Pure regex matcher with weighted signals — Operating System, asset
> type, network exposure, data sensitivity, business function, vendor,
> criticality, universal applicability. Scores every framework control
> against each asset, surfaces by confidence band. No LLM, no token cost,
> deterministic, fast. Operator one-clicks to accept recommendations and
> link them. Replaces weeks of manual mapping work during framework
> assessments."

**WHY THIS MATTERS**

> "Customers want AI but they're nervous — about hallucination, about
> token cost, about regulatory acceptance. Our position: use the LLM
> where the value pays for the token (Q&A, document understanding),
> and use deterministic regex / matchers everywhere the LLM would just
> add cost without adding accuracy. That story sells to a CISO who's
> been burned by 'AI-powered' tools."

---

## 12. THE PLATFORM-LINKAGE STORY (DON'T SKIP THIS)

**NARRATION** — spend 2-3 minutes here

> "I want to bring this back to one point, because it's the differentiator.
>
> "Every module I just walked you through — Governance, Risk, Compliance,
> Assets, Vulnerabilities, Issues, Evidence — they're not silos. They're
> nodes in a graph. The platform's value isn't 'we have a vuln register'
> or 'we have a risk register' — every competitor has those. The value
> is the LINKS.
>
> "Let me give you a real auditor scenario. An ISO 27001 auditor asks:
> 'Show me how you've addressed control A.8.8 — Management of Technical
> Vulnerabilities.'
>
> "In a typical GRC tool, the compliance manager opens the framework
> module, finds the control, sees 'we have a process for this'. Auditor
> says 'show me'. Compliance manager opens the policy library, finds
> the patch management policy. Auditor says 'show me an example'.
> Compliance manager opens the vuln scanner separately, exports a CSV,
> sends it later. Auditor writes a finding because traceability isn't
> demonstrated end-to-end.
>
> "On our platform, the compliance manager opens A.8.8. They see:
> - The internal control mapped to it (Patch Management Procedure v3)
> - The evidence attached (the policy PDF, the last scan report)
> - The 47 assets in scope
> - The 12 currently-open critical vulns on those assets
> - The SLA performance: 89% on time
> - The 2 exceptions approved by the CISO for legacy systems
> - The historical incidents linked to vulnerability exploitation (zero in the last 12 months)
>
> "Auditor sees the full picture in 30 seconds. Writes a clean finding.
> THAT is what 'integrated GRC' actually means."

---

## CLOSING (60 seconds)

**NARRATION**

> "So that's the platform. Production-deployed, used daily by my client's
> compliance team. The breadth is 27 frameworks, 8 integrated modules,
> 140+ permission gates, 8 scanner integrations, AD / Google Workspace
> SSO, configurable workflows, and AI where it pays.
>
> "For YOUR engagement — based on the post and what you've told me — I'd
> propose we scope a focused v1 that covers maybe 5 of those 8 modules,
> ships in 4 weeks, runs in production with one organization, and gives
> us the proof point to scope v2. The other modules layer on after.
>
> "I'll send you a written proposal by end of day. Couple of things from
> my side before we wrap — and then I'm happy to take any questions.
>
> "Question one: of everything I walked through, which two or three pieces
> are most important for your use case?
>
> "Question two: do you have a target go-live date, or is the 4-week
> framing flexible?
>
> "Question three: who's the decision-maker on your side I'll be working
> with once we kick off?"

**Then shut up. Listen. Take notes.**

---

## QUICK REFERENCE — talking points by stakeholder type

If the client is a **CISO / Compliance Officer**, emphasize:
- The 27 pre-seeded frameworks
- The linkage story (auditor scenario)
- The exception management workflow
- ComplyChat for ad-hoc reporting

If the client is a **CTO / IT Director**, emphasize:
- Database-per-tenant isolation
- AD / Google Workspace SSO + SCIM
- Scanner integrations (Nessus / Rapid7 / Wazuh)
- The agent + agentless dual-mode
- The configurable workflow engine

If the client is a **CEO / business sponsor**, emphasize:
- Cost saving versus paying consultants to load frameworks
- Auditor-friendly traceability reduces audit cycle time
- Mapping recommendations replace weeks of manual mapping
- One platform replaces 5-7 disconnected tools

If the client is a **product manager building a GRC SaaS**, emphasize:
- Multi-tenancy as foundation
- The link table model that makes cross-module navigation work
- 140+ permission gates for granular role design
- White-label / tenant-branded deployment
