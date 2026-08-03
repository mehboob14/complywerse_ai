// AUTO-EXTRACTED from public/guide/explore.html's NOTES object — verbatim prose, ported not rewritten.
// Source ids are preserved as comments next to each key for traceability back to the original replica.

export type GuideNote = {
  title: string;
  what: string;      // what it actually is, plain language
  where: string;      // where the value comes from (source or formula)
  why: string;       // why it exists / what decision it drives
  misreading?: string; // the common misreading, if any
};

export const GUIDE_NOTES: Record<string, GuideNote> = {
  // source: a-criticality
  'asset.criticality': {
    title: "Criticality badge",
    what: "Criticality is a single word — Low, Medium, High or Critical — that answers one question: \"if this thing breaks or leaks, how bad is it for the business?\" Think of it as the label a fire marshal puts on a building: it does not describe how likely a fire is, only how much is at stake if one happens. A critical asset is one where an incident is expensive, regulated, or stops the business; a low asset is one a team could survive losing for a week without anyone outside the team noticing.\n\nIt is deliberately a business judgement, not a technical one — a rusty old file server can be Critical if it is the only copy of a contract archive a regulator can demand, while a shiny new microservice can be Low if it is stateless, replaceable, and holds nothing sensitive.",
    where: "On this asset the badge is derived rather than typed in freehand: it is computed from the three CIA ratings below using a simple rule of thumb — the asset's criticality tracks its highest CIA rating, so a single 5 anywhere pulls the whole asset up to Critical even if the other two ratings are lower. It can also be set directly and formally through a Criticality Assessment (see the Criticality Assessments tab), which is the version an auditor actually signs.\n\nBecause it can come from either path, this codebase has a known gap: the formal assessment and the CIA-derived value are not automatically reconciled. If a formal ISCA says \"High\" but the CIA sliders derive \"Critical\", nothing today flags the mismatch — the scoring engine simply uses the derived value.",
    why: "This one word is wired into three different downstream calculations, which is why getting it wrong is expensive. It is worth 10% of every vulnerability's priority score on this asset (a critical asset moves a finding up the queue purely because of where it sits). It is one leg of the CIA dimension inside risk posture (15% of that composite score). And it is one of the six named red-flag triggers that can escalate a finding regardless of its raw CVSS — \"business-critical asset\" is checked as a plain fact, not blended into an average.",
    misreading: "Read it next to the CIA ratings, not instead of them — the badge is a summary of three numbers, and if you only remember the word you lose the reason behind it (is it critical because of confidentiality, or availability, or both?). The common misreading is to treat criticality as a measure of how likely an attack is; it is not — a Critical asset with zero open findings and a hardened configuration is still Critical, because the word describes consequence, not probability.",
  },
  // source: a-riskscore
  'asset.riskScore': {
    title: "Risk Score",
    what: "This is the asset's overall risk temperature, expressed as one number from 0 (nothing to worry about) to 100 (drop everything). It is the same figure, byte for byte, that appears on the Risk & Controls tab and on the dedicated Risk Posture page for this asset — the product is built so an operator never has to wonder whether \"the risk score\" on one screen means something different from \"the risk score\" on another.\n\nA score in the severe range means the model looked at everything it knows about this asset — its open vulnerabilities, how hardened it is, how sensitive it is, how well it is controlled, and what risks are formally logged against it — and concluded this asset deserves attention now, not at the next quarterly review.",
    where: "It is computed by the risk-posture engine as a weighted blend of five dimensions: Vulnerabilities (30% of the weight), CIS benchmark hardening (25%), CIA/business value (15%), control coverage (15%) and linked risk-register entries (15%). Each dimension produces its own 0–100 sub-score, those sub-scores are multiplied by their weights, and the results are summed — but only over the dimensions that actually have evidence behind them (see the \"Where it comes from\" note on Residual Risk, below, for the re-normalisation math). When every dimension has evidence, no re-normalisation is needed and the score shown is simply the weights applied directly.",
    why: "A single asset can have a dozen different numbers scattered across different tools — a vulnerability scanner's severity count, a compliance tool's pass rate, a spreadsheet risk rating — and none of them agree, because none of them are computed the same way. This score exists to be the one number everyone in the organisation, from the engineer patching the box to the executive reading a board deck, can point to and mean the same thing.",
    misreading: "Always read the score together with its data-quality figure (visible on the Risk Posture page as \"100% · 5/5\"). A high score at high data quality, like this one, is a confident, well-evidenced conclusion. A high or low score at low data quality is a much weaker claim — it means most of the five dimensions had no evidence and were excluded, not that the asset was actually measured and came back clean.",
  },
  // source: a-findings
  'asset.openFindings': {
    title: "Open Findings",
    what: "This is a simple count of how many vulnerabilities are currently unresolved on this specific asset. It answers the question \"how much active, unfinished security work does this box represent right now?\" — not a historical count of everything ever found on it.",
    where: "It counts rows in the vulnerability–asset link table where the linked finding's status is NOT one of remediated, verified, closed, resolved or accepted. A finding that has been fixed, formally verified, or formally risk-accepted drops out of this count immediately — whatever findings remain in the count are exactly the ones still requiring a decision.",
    why: "Vulnerability counts are only useful if closing a vulnerability actually makes the number go down. Early designs of systems like this sometimes counted every finding regardless of status, which meant a fully-verified fix still showed up as \"risk\" on the asset that mattered most — the exact opposite of what the number is supposed to tell an operator.",
    misreading: "A small number here is not the same as \"minor\" — a single KEV-listed finding floored to a high priority counts the same as any other open row. This count tells you volume, not severity; always cross-check it against the Vulnerabilities tab rather than treating a low count as automatically low-risk.",
  },
  // source: a-blast
  'asset.blastRadius': {
    title: "Blast Radius",
    what: "Blast radius answers \"if an attacker fully compromises this one box, how many other assets could they reach next?\" It is a lateral-movement estimate, not a measure of how likely compromise is in the first place — it describes the size of the room the attacker would be standing in, not whether they can get in.",
    where: "It is the size of the de-duplicated set formed by two sources: each asset this one has a declared relationship to (visible on the Relationships tab), plus any other assets that share a routable IP address with this one. Loopback addresses (127.0.0.1) are deliberately excluded from the IP-sharing check, because every locally-discovered asset carries a loopback address and including it would silently merge unrelated machines into one group.",
    why: "An attacker who lands on an internet-facing VPN gateway does not stop there — the next question is always \"what can they reach from here?\" Blast radius turns that question into a number an operator can act on: declare fewer unnecessary trust relationships, and the number goes down; discover an undeclared dependency, and it should go up.",
    misreading: "A blast radius of 0 does NOT mean an asset is safely isolated — it means nobody has declared any relationships for it yet. Absence of data and genuine isolation look identical if you only glance at the number. A non-zero figure here is only meaningful and evidenced when it is backed by actual declared relationships or shared IPs, rather than being a default.",
  },
  // source: a-coverage
  'asset.controlCoverage': {
    title: "Control Coverage",
    what: "This is the share of this asset's expected security controls that are actually linked to it in the system. A \"control\" here means a documented safeguard — a policy, a technical setting, a process — like \"multi-factor authentication is enforced\" or \"backups run and are tested.\" Coverage asks: of the controls an asset like this one is expected to have, how many have actually been mapped to it as evidence?",
    where: "The formula is deliberately simple: linked controls ÷ 12. The controls actually linked (visible on the Risk & Controls tab, each named individually) are counted against a fixed target of 12 to produce the percentage shown.",
    why: "The number 12 is not a law of security — it is a house convention, a round target chosen so coverage is comparable across every asset in the estate rather than each asset being graded against a different, invisible bar. What matters is consistency: this same percentage, computed the same way, appears on Overview, on Risk & Controls, and as 15% of the weight inside the composite risk-posture score. An asset reading one figure in one place and some other number in another would undermine trust in the whole system.",
    misreading: "Treat a coverage gap as a to-do list, not a grade. Whatever the percentage reads, it means a specific, nameable set of controls out of the conventional twelve are not yet linked to this asset — the Risk & Controls tab lists exactly which ones are present, so the gap is actionable rather than abstract.",
  },
  // source: a-identity
  'asset.profileCompleteness': {
    title: "Profile completeness",
    what: "This bar is a data-hygiene indicator, not a risk score — it measures how many of the identity and ownership fields on this card (owner, custodian, department, environment, assigned user, location, data classification, business function, owning team, secondary/business owner, escalation contact, and the three CIA ratings) have actually been filled in, versus left blank.",
    where: "It is computed by counting how many of those fields are non-empty and dividing by the total number of fields being checked. Nothing here is inferred or guessed — a field either has a value or it does not, and the percentage is a plain count.",
    why: "An asset record with a real owner, a real department and a real escalation contact is one a human will actually maintain when something goes wrong with it. A mostly-blank record is usually the fingerprint of an asset that was auto-discovered by a scanner and never \"claimed\" by a team — and an unclaimed asset is the one most likely to be forgotten during an incident.",
    misreading: "A high percentage can still be high for the right reasons — some fields may be genuinely not applicable to this asset rather than merely neglected. A lower percentage should prompt you to check the specific empty fields below, not just note the number and move on.",
  },
  // source: a-internet
  'asset.internetExposed': {
    title: "Internet Exposed",
    what: "This flag answers a single, blunt question: can something outside your organisation's network reach this asset directly, without first passing through your perimeter defences? It is the difference between a service sitting on your internal LAN and one with a public IP or a port forwarded through your firewall.",
    where: "It is set on the asset record — either manually by whoever owns the asset, or inferred from its declared network segment (this asset sits in the DMZ, the segment conventionally used for internet-reachable systems) and discovery-scan results that observed it responding on a public-facing address.",
    why: "This single Yes/No is worth 10% of the priority score of every vulnerability found on this asset, and \"internet-facing asset\" is independently one of the six named red-flag triggers that can escalate a finding straight to the top of the queue. The logic is blunt on purpose: a flaw that requires physical access to exploit is a very different problem from the identical flaw sitting on a box anyone on the internet can already reach.",
    misreading: "Do not read \"Internet Exposed: Yes\" in isolation — it multiplies risk, it does not create it by itself. An internet-facing asset with no vulnerabilities is not urgent; the danger is the combination shown on this very asset, where internet exposure meets a weaponised, KEV-listed finding.",
  },
  // source: a-provenance
  'asset.provenance': {
    title: "Provenance footer",
    what: "This single line at the bottom of Overview is a disclosure statement — a plain-English map of which numbers on this page are computed by the system and which are typed in by a human, so nobody mistakes one for the other.",
    where: "Risk score comes from the posture engine's assessments; open-findings count comes from linked vulnerabilities; control coverage comes from mapped controls (÷12); the CIS composite comes from benchmark scan runs; derived criticality comes from the CIA ratings. Everything else on the card — identity, network, hardware and procurement fields — comes from manual entry, a CSV import, or agent/scanner discovery, and is only as accurate as whoever last touched it.",
    why: "In an audit, \"where did this number come from?\" is not a rhetorical question — an assessor genuinely needs to know whether a figure is a system calculation they can trust to be consistent, or a human-entered field they need to separately verify. This footer means that question never has to be asked twice; the answer is printed on the page.",
    misreading: "If a number here looks wrong, use this line to decide where to look first: a wrong computed number means checking the inputs that feed it (open vulnerabilities, controls, scans); a wrong manual field means someone needs to correct the record directly — the fix is different in each case.",
  },
  // source: a-residual
  'asset.residualRisk': {
    title: "Residual Risk",
    what: "\"Residual\" is a deliberate word choice: this is the risk left over after accounting for whatever controls and hardening already exist, not the raw, uncontrolled risk the asset would carry with nothing in place. The five bars underneath break the headline score into its contributing signals so you can see which part of the picture is driving the number, rather than trusting one opaque total.",
    where: "Impact comes from the CIA ratings. Likelihood comes from open vulnerabilities. Control gap comes from controls not yet linked to this asset. Hardening gap comes from CIS benchmark failures. Risk register comes from formally logged risks naming this asset. Each bar is its own 0–100 sub-score; the headline score is these five blended at 30/25/15/15/15% weight, exactly as described on the dedicated Risk Posture page — same formula, same numbers, different screen.",
    why: "A single composite number invites the question \"why is it high?\" — and a single number alone cannot answer that. The five-bar breakdown exists so that \"why is this asset's score what it is\" has a specific answer: which of the five bars is tallest tells you whether it is mostly exploitable vulnerabilities, hardening gaps, weak controls, unrated business value, or open risk-register entries driving the total.",
    misreading: "The footer line — \"N of 5 signals known · data quality\" — is not decoration; read it every time. A score resting on only two of five signals known would rest on far less evidence than one built on all five, and the honest response would be to go collect the missing information before treating the number as reliable, not to treat a thin score the same as a thick one.",
  },
  // source: a-cia
  'asset.cia': {
    title: "CIA Impact Ratings",
    what: "CIA stands for Confidentiality, Integrity and Availability — the three classic dimensions security people use to describe what actually goes wrong if an asset is compromised. Confidentiality is about secrets getting out: could an attacker read data they should not see? Integrity is about correctness being violated: could an attacker change data, undetected, so decisions get made on false information? Availability is about the lights going out: could an attacker (or an outage) take the system down when people need it?\n\nEach is rated 1 to 5. A 1 in any dimension means the worst case is genuinely mild — public information, a cosmetic error, a service nobody would notice being down for a day. A 5 means the worst case is severe in a way that reaches outside the IT department entirely — regulated personal data exposed, a decision made on falsified records, or downtime that stops the business or breaches a contractual SLA. Crucially, CIA describes consequence, not likelihood — a 5 does not mean an attack is probable, it means that if one happened, the damage would be serious.",
    where: "When a human sets these ratings directly, \"manual override\" is shown in the header, and each number should trace back to a specific business reason — what exactly would be exposed, tampered with, or taken down, and why that particular rating reflects the real consequence. When nobody sets these three numbers explicitly, the system falls back to deriving them from the asset's declared criticality instead of leaving them blank.",
    why: "The three ratings combine into a 0–1 dimension score that carries 15% of the weight inside the risk-posture composite, and criticality itself is largely determined by the highest of the three. Beyond the arithmetic, CIA is the vocabulary that lets a security finding be translated into business language: \"Integrity 4\" is a sentence a compliance officer or a board member can reason about, where \"CVSS 8.1\" is not.",
    misreading: "The important distinction to hold onto is \"manual override\" versus \"auto-derived\", shown in this card's header pill. When a value is derived rather than explicitly set, the system marks that dimension \"not known\" and excludes it from the risk-posture calculation rather than silently guessing a number and presenting it as measured fact. Counting an assumption as evidence would make the resulting score look more confident than it actually is — exactly the kind of inflated certainty an auditor is trained to challenge. A lower data-quality percentage is the honest outcome of an unset CIA rating, not a system fault.",
  },
  // source: a-cis
  'asset.cisGap': {
    title: "CIS Benchmark Compliance",
    what: "This card answers \"how well is this specific machine configured against a recognised hardening standard?\" — CIS (the Center for Internet Security) publishes detailed benchmarks, effectively long checklists, of specific configuration settings a well-hardened Ubuntu server (or Windows box, or firewall, etc.) should have: things like disabling unused services, enforcing password complexity, and restricting root access.",
    where: "A scanner runs the applicable benchmark rules against this host and records each one as passed, failed, or never run. The \"hardening gap\" formula is 0.8 × (failed ÷ scanned) + 0.2 × (never-scanned ÷ total), using the counts of passed, failed and never-scanned rules shown on the card: the scanned total is passed plus failed, giving a failed-share; the overall total is scanned plus never-scanned, giving a never-scanned share. The two shares are blended at that 0.8/0.2 weighting into the gap percentage, which is why the hardening score shown reads below a perfect 100 whenever any rules failed or were never run.",
    why: "The formula deliberately punishes two different failure modes at once, on purpose: rules that were checked and failed, and rules that were never checked at all. A host with every attempted rule passing, but a large share of rules simply never run, is not a hardened host — it is an unmeasured one — and a formula that only looked at the pass rate among scanned rules would let that host look artificially clean.",
    misreading: "Read the passed count and the never-scanned count together, not separately. A high pass count sounds reassuring on its own; remembering how many rules have no answer at all is what stops this card from being mistaken for a clean bill of health. This same hardening figure is what feeds both the \"Hardening gap\" bar on Residual Risk above and the CIS dimension on the dedicated Risk Posture page — one scan, one number, three places it appears.",
  },
  // source: a-linkedcontrols
  'asset.linkedControls': {
    title: "Linked Controls table",
    what: "A \"control\" is a specific, documented safeguard — a rule, a technical configuration, or a process — that is supposed to reduce risk on an asset. \"AC-04 — Remote Access Control\" is a control; \"linking\" it to this asset is the system's way of recording \"yes, this specific safeguard applies to, and has been implemented on, this specific asset.\"",
    where: "Each row here is a link between this asset and an entry in the control catalogue, tagged with which compliance framework it maps to (NCA ECC, ISO 27001, CIS Controls) and a coverage status of Full or Partial. A control marked Partial — like IA-02, Multi-Factor Authentication — means the control is recognised as applicable but is not fully implemented or fully evidenced yet.",
    why: "Controls are linked to assets, rather than just existing as a generic organisational policy, because \"we have an MFA policy\" and \"MFA is actually enforced on the internet-facing VPN gateway that everyone in the company depends on\" are very different claims. Linking makes the second, specific claim checkable — an auditor can ask for evidence against this exact row, not a company-wide assertion.",
    misreading: "The count of rows here is the numerator in Control Coverage (linked controls ÷ 12, explained on the Coverage stat above). A Partial status is not a failure by itself — it is a flag that the control needs follow-up work or better evidence, and it is exactly the kind of gap a mapping-recommendation feature would suggest closing.",
  },
  // source: a-coverage-formula
  'asset.coverageFormula': {
    title: "Coverage ÷ 12",
    what: "This explains the denominator behind the coverage percentage you see in multiple places on this asset: coverage is always linked controls divided by 12.",
    where: "Twelve is not derived from any external standard, and it is not the same as \"the number of controls that exist in the catalogue\" (there are many more than 12 possible controls). It is a house convention — a fixed, round target chosen so that every asset in the estate is graded on the same scale, the same way a school might grade every test out of 100 even though different tests have different numbers of questions.",
    why: "Without a shared denominator, coverage percentages would be meaningless across assets — one team might consider 5 controls \"full coverage\" for a simple asset while another expects 20 for a complex one, and two identical-looking percentages from two different assets would not actually mean the same thing. Standardising on 12 everywhere means an operator comparing two assets' coverage percentages really is comparing like with like.",
    misreading: "Do not treat 12 as a regulatory requirement you could cite to an auditor — it is an internal convention. What you can defend to an auditor is the numerator: which specific, named controls are linked, and what their individual coverage status is. The percentage is a navigation aid; the linked-controls list is the evidence.",
  },
  // source: a-linkedrisks
  'asset.linkedRisks': {
    title: "Linked Risks table",
    what: "This table shows entries from the formal risk register (the same register the Risk Management module maintains) that specifically name this asset. A \"risk\" here is a documented statement like \"Perimeter VPN compromise leads to lateral movement into production\" — a described scenario, with an owner and a status, not a technical finding like a CVE.",
    where: "These rows come from risk-to-asset links maintained in the risk register — whatever risks have actually been logged against this specific asset, each with its own status.",
    why: "A risk register entry and a vulnerability are different kinds of record answering different questions. A vulnerability says \"this specific flaw exists and here is its technical detail.\" A risk says \"here is a scenario the organisation has formally decided to track, assess and treat\" — it can exist even without a specific CVE behind it (a single point of failure, a process gap), and it usually persists across many technical findings.",
    misreading: "Linked risks carry 15% of the risk-posture score under \"Risk register.\" A newly onboarded asset with zero linked risks does not necessarily mean zero risk — more often it means nobody has yet performed the formal risk-assessment exercise that would create the entries, another instance of \"no data\" needing to be read as \"not yet assessed,\" not \"safe.\"",
  },
  // source: a-manage-section
  'asset.manageSection': {
    title: "\"Manage\" section",
    what: "Everything above the \"Manage\" divider is read-only: computed scores and summaries. Everything below it is where an operator actually does the work that changes those scores — linking a control, logging a risk.",
    where: "These panels write directly to the same records that Residual Risk, the CIA card and the CIS card read from — there is no separate \"management\" database; you are editing the exact rows the scores above are computed from.",
    why: "Separating \"what the score currently is\" from \"how to change it\" keeps a reviewer from confusing an aspirational plan with a current fact. The scores above are always what is true today; the tools below are how today changes into tomorrow.",
    misreading: "If a number above looks wrong or incomplete, this is where to fix it — not by editing the score directly (there is no such field, deliberately), but by linking the specific control or risk that was missing, and letting the score recompute from the update.",
  },
  // source: a-vulntab
  'asset.vulnTable': {
    title: "Linked Vulnerabilities",
    what: "This is the list of every vulnerability finding currently tied to this specific asset — the same findings counted by the \"Open Findings\" stat on Overview, shown here with full detail instead of just a number.",
    where: "Rows come from the vulnerability–asset link table, joined against the central vulnerability register. A finding appears here because it was matched to this asset — usually because software installed on it (see the Software tab) matches a CVE's affected product list.",
    why: "The whole point of linking vulnerabilities to assets, rather than keeping one global list of CVEs, is that \"this flaw exists somewhere\" and \"this flaw exists on the internet-facing gateway carrying the whole remote workforce\" are utterly different problems requiring utterly different urgency — the link is what lets the second, specific statement be made.",
    misreading: "Read Severity and Priority as two different questions, not two versions of the same one — the next two notes explain each in depth. As a shortcut: Severity tells you how bad the flaw is in the abstract; Priority tells you how urgent it is for you, on this asset, right now.",
  },
  // source: a-vulnseverity
  'asset.vulnSeverity': {
    title: "Severity column",
    what: "Severity is the flaw's technical badness, rated on a fixed scale (Critical / High / Medium / Low) independent of any particular organisation's circumstances. It answers \"how bad could this be, in the worst case, for anyone running the affected software?\"",
    where: "It comes from CVSS (the Common Vulnerability Scoring System), published by NVD (the National Vulnerability Database), a US-government-run public catalogue. A CVSS score of 10 out of 10 is the maximum possible, reserved for flaws that are remotely exploitable, unauthenticated, and lead to full system compromise.",
    why: "Severity exists so that \"how bad is this flaw\" has one universally agreed answer regardless of who is asking — a shared, external, auditable reference point rather than each organisation inventing its own severity scale.",
    misreading: "Severity never changes based on your environment — a given CVSS score stays the same whether the affected software sits on an internet-facing production gateway or an air-gapped test machine nobody has powered on in a year. That is exactly why it is not enough on its own, and why Priority exists as a separate column.",
  },
  // source: a-vulnpriority
  'asset.vulnPriority': {
    title: "Priority column",
    what: "Priority is our engine's answer to a different question than Severity: \"given everything we know about YOUR situation — this asset, this exposure, this exploit activity — how urgently should YOU act on this, right now, compared to everything else in the queue?\" It is a single 0–100 number meant to be sorted on.",
    where: "It blends seven signals: CVSS severity (20% weight), exploit probability from FIRST's EPSS model (20%), exploit maturity — how ready-made attack code is (15%), whether it is on the CISA KEV list of confirmed actively-exploited flaws (15%), attack vector (10%), whether the asset is internet-exposed (10%), and asset criticality (10%). A finding that maxes out or nearly maxes out most of these signals at once ends up with a very high score; one that trips only a signal or two stays low even on the same asset.",
    why: "If every organisation simply worked through vulnerabilities in Severity order, everyone with the same software would work in the same order — which ignores that your VPN gateway being internet-facing and carrying your whole remote workforce is not a fact CVSS knows or cares about. Priority is where that context enters the ranking.",
    misreading: "The common mistake is triaging a queue by Severity because it is the more familiar column. Two Critical (CVSS 9+) findings can have wildly different Priority scores — sort and work this list by Priority, not Severity, and you will handle real-world urgency correctly even when two rows look equally \"Critical\" at a glance.",
  },
  // source: a-vulnkev
  'asset.vulnKev': {
    title: "KEV flag",
    what: "KEV stands for Known Exploited Vulnerabilities — a specific, government-maintained list, not a general estimate. A red KEV pill on a row means one very concrete fact: this exact flaw has been confirmed, by CISA, to have already been used in real attacks in the wild. It is not a prediction of future risk; it is a record of a past fact.",
    where: "CISA (the US Cybersecurity and Infrastructure Security Agency) publishes and maintains the KEV catalogue as a public feed; our engine checks each finding's CVE identifier against it directly.",
    why: "A flaw already being exploited elsewhere is qualitatively different from one that is merely theoretically dangerous — the attackers have already done the hard work of building and testing an exploit. This flag exists so that fact is never buried inside an averaged score; it is called out as its own visible badge.",
    misreading: "A KEV flag independently floors this finding's Priority score at 80, no matter what the other six signals add up to (see the Analysis tab on the vulnerability detail page for the full arithmetic). Treat any row carrying this pill as needing attention today, not \"when it reaches the top of the normal queue.\"",
  },
  // source: a-vulnstatus
  'asset.vulnStatus': {
    title: "Status column",
    what: "Status tracks where a finding sits in its remediation workflow: Open (nothing done yet) → In Progress (someone is actively working it) → Remediated (the fix has been applied) → Verified (someone has since confirmed, with evidence, that the fix actually holds). A finding can also branch to Risk Accepted or False Positive instead of following that line.",
    where: "It is a plain workflow field set by whoever is working the finding — a human decision, not a computed value.",
    why: "The \"Open Findings\" count on Overview, the priority queue on this tab, and every SLA clock in the system all key off this one field. Status is what lets \"we fixed it\" become a checkable claim with a timestamp and an actor attached, rather than a verbal assurance nobody can later verify.",
    misreading: "A row reading Open does not mean no work has happened — a finding can carry an approved remediation plan and a partially-successful retest and still show Open (see the Vulnerability Detail screen) — Status only flips once the fix is fully applied and confirmed, so \"Open\" and \"no progress\" are not the same thing.",
  },
  // source: a-vulncalm
  'asset.vulnCalmExample': {
    title: "A low-priority finding on the same asset",
    what: "A row like this exists on many assets deliberately, as a contrast case: a real Open finding of only Medium severity, sitting on the exact same critical, internet-facing asset as a much more urgent finding, and yet ranking nowhere near the top of the priority queue.",
    where: "Its low priority comes from the same seven-signal formula as any other finding: a low EPSS (almost nobody is attempting to exploit it), no presence on CISA KEV, no known public exploit repositories for it, and an attack vector of Local rather than Network — meaning an attacker needs prior access to the machine before the flaw is even reachable.",
    why: "A row like this is the proof that the priority engine does not simply escalate everything on a Critical, internet-facing asset — asset criticality and internet exposure are only two of the seven inputs, worth 10% each. A flaw that is hard to reach and nobody is exploiting stays low, even on an important asset, which is exactly the restraint that keeps a priority queue usable instead of flooding every finding on an important asset to the top.",
    misreading: "Compare a low-priority row like this to a high-priority row on the same asset side by side: same asset, same criticality, same internet exposure — and yet a wide priority gap, entirely explained by exploit activity and reachability. That gap is the whole argument for scoring priority per-finding rather than per-asset.",
  },
  // source: a-sw-intro
  'asset.swIntro': {
    title: "Detected Software",
    what: "This is the inventory of software products the discovery agent found actually installed and running on this host — not what someone thinks is installed, but what was directly observed.",
    where: "Populated by the same agent (version 3.2.1, visible on Overview) that reports hardware telemetry, each time it checks in.",
    why: "Software inventory is the bridge between \"here is a public vulnerability advisory\" and \"here is whether it applies to us\" — without a record of exactly what is installed, an organisation can only find its own vulnerabilities by actively scanning for them, never by matching against what it already knows it runs.",
    misreading: "Treat this list as a snapshot, current as of the last agent check-in — if new software is installed on the box between check-ins, this table will not reflect it until the next scan.",
  },
  // source: a-sw-cpe
  'asset.swCpe': {
    title: "CPE column",
    what: "A CPE (Common Platform Enumeration) is the standardised, machine-readable name for a specific piece of software, in a fixed format: cpe:2.3:a:apache:log4j:2.14.1 names exactly \"the log4j application, made by Apache, version 2.14.1\" in a way every security tool in the world can parse identically.",
    where: "NVD, the same public database that publishes CVSS scores, describes every vulnerability's affected products using CPE strings. Our agent generates the equivalent CPE for each piece of software it detects on a host.",
    why: "\"We run Log4j 2.14.1\" and \"we are affected by Log4Shell\" are only automatically connectable if something on both sides speaks the same structured language — plain product names are ambiguous (is it \"Log4j\", \"log4j-core\", \"Apache Log4j\"?) in a way CPE strings are built specifically to avoid.",
    misreading: "An estate with no CPE-tagged software inventory can still find vulnerabilities, but only by actively scanning for them one at a time — it can never automatically cross-reference a newly published CVE advisory against everything it already knows it runs. This is exactly the mechanism that auto-links a newly published CVE to an asset the moment the CVE's affected-product CPE and the asset's installed-software CPE match.",
  },
  // source: a-sw-matching
  'asset.swMatching': {
    title: "How auto-matching actually works",
    what: "When a new CVE is published (or enriched) and it lists an affected CPE, the system checks that CPE against every asset's software inventory. A match creates the vulnerability–asset link automatically — no human has to notice the connection and do it by hand.",
    where: "The matching is a direct string/version comparison between the CVE's affected-product CPE range (from NVD) and each asset's detected-software CPEs (from the agent).",
    why: "At the scale of a real estate — hundreds or thousands of assets, tens of thousands of CVEs published every year — manually checking \"does this new CVE affect anything we own\" is not something a human team can keep up with. Automated CPE matching is what makes same-day awareness of a new critical CVE possible at all.",
    misreading: "Matching is only as good as the inventory behind it — software the agent has not yet detected, or detected with an imprecise version string, cannot be matched. A \"clean\" vulnerabilities list on an asset can mean genuinely low risk, or it can mean the inventory underneath it is incomplete; the Software tab is how you check which one you are looking at.",
  },
  // source: a-sw-promote
  'asset.swPromote': {
    title: "Promoting software to its own asset",
    what: "Some detected software is significant enough to deserve its own full asset record — its own owner, its own criticality rating, its own control mappings — rather than living as a line item under its host.",
    where: "This is a manual decision an operator makes from this tab, turning a detected-software row into a new, linked child asset record.",
    why: "A database engine running on a host is often a materially different risk than the host itself — it might hold regulated data the host's own criticality does not reflect, and it may need controls (encryption at rest, access review) that make no sense to attach to the host record.",
    misreading: "The rule of thumb: promote software that would need its own owner, its own risk conversation, or its own compliance scope (a database engine, a payment component); leave commodity software (a PDF reader, a text editor) as a plain inventory line — promoting everything would just recreate an unmanageable asset list one layer down.",
  },
  // source: a-sw-vendor
  'asset.swVendor': {
    title: "Vendor column",
    what: "This records who publishes and maintains each piece of software — the party responsible for shipping a patch when a vulnerability in that product is found.",
    where: "Read directly from the software's own metadata as detected by the agent (package manager records, binary version headers, etc).",
    why: "When a CVE is published, \"is there a vendor patch, and who issues it\" is one of the first operational questions — knowing the vendor up front (Apache Software Foundation for Log4j, OpenBSD for OpenSSH) means the remediation plan can immediately reference the correct advisory and patch channel instead of researching it from scratch.",
    misreading: "Multiple products from the same vendor can behave very differently under a single CVE disclosure — do not assume \"the vendor already patched something\" covers every one of their products installed on this host; check the specific product and version.",
  },
  // source: a-sw-version
  'asset.swVersion': {
    title: "Version column",
    what: "The exact installed version string of each product — the single most important fact for deciding whether a given CVE actually applies, since almost every CVE advisory specifies an affected version range, not just an affected product.",
    where: "Detected directly by the agent from the installed package's own version metadata.",
    why: "Two versions of the same product can sit on opposite sides of a vulnerability boundary — one vulnerable, the next patched release not. Without a precise version on record, the system could only ever say \"you have this product, maybe you're affected\" instead of giving a definitive yes or no.",
    misreading: "After a patch is applied, this field is what should change — a remediation plan's adopted fix targets an upgrade to a specific patched version, and a re-scan updating this version string to that patched version is what would let the finding be verified as actually fixed, rather than merely marked done on trust.",
  },
  // source: a-sw-why
  'asset.swWhy': {
    title: "Why this tab exists at all",
    what: "Software inventory is not decoration — it is the raw material every other vulnerability feature on this asset depends on. Without it, the Vulnerabilities tab, the auto-linking behind it, and the CPE matching described above would have nothing to check CVEs against.",
    where: "",
    why: "A famous internal counter-example makes the point: name-only searching an unrelated public repository catalogue for exploit code returns wildly different numbers than a name-matched search — the same care about \"make sure you are matching the right thing\" applies here. An estate with sloppy or incomplete software records will silently under-report its own vulnerabilities, not because the vulnerabilities are not there, but because nothing was there to match against them.",
    misreading: "If a well-known CVE for software you know you run is NOT showing up as linked on an asset, the first thing to check is this tab — is the software even listed, and is its CPE/version detected precisely enough to match?",
  },
  // source: a-rel-why
  'asset.relWhy': {
    title: "Why relationships are declared at all",
    what: "A \"relationship\" is a human-declared statement that this asset depends on, or is depended on by, another specific asset — \"this gateway authenticates against that identity provider\" is a relationship, not something a scanner can reliably infer just by watching network traffic.",
    where: "Declared here, manually, by whoever understands the architecture — typically the asset owner or a network engineer.",
    why: "Two systems can be network-adjacent without meaningfully depending on each other, and two systems can meaningfully depend on each other while sitting on entirely different networks (a cloud service authenticating against an on-prem identity provider, for instance). Declaring the dependency explicitly is the only way to capture the ones that traffic patterns alone would miss or misread.",
    misreading: "An empty relationships list is not evidence of isolation — see the note below on the empty state. Treat this tab as something that needs active maintenance as the architecture changes, not a one-time setup step.",
  },
  // source: a-rel-types
  'asset.relTypes': {
    title: "Relationship types",
    what: "Each declared relationship carries a specific verb describing the nature of the dependency, not just \"these are connected.\" An asset can \"authenticate against\" its identity provider (an outbound trust relationship for logins), \"sit behind\" its perimeter firewall (an upstream protective relationship), or \"forward logs to\" a SIEM collector (an outbound data relationship) — each verb naming a different kind of dependency.",
    where: "The relationship type is chosen by whoever declares the link, from a fixed vocabulary describing the kind of dependency.",
    why: "Different relationship types imply different consequences if the asset is compromised. \"Authenticates against\" means a compromised VPN gateway could be used to attempt credential attacks against the identity provider — a very different concern from \"forwards logs to,\" where compromise might mean an attacker could suppress or falsify the evidence trail instead.",
    misreading: "When assessing what an attacker could actually do after compromising this asset, read the relationship type, not just the fact that a relationship exists — \"sits behind\" a firewall describes protection flowing toward this asset, the opposite direction of risk from \"authenticates against,\" which describes trust flowing outward from it.",
  },
  // source: a-rel-blast
  'asset.relFeedsBlastRadius': {
    title: "How this feeds Blast Radius",
    what: "Every relationship declared on this tab is counted directly into the Blast Radius statistic shown on the Overview tab — the two numbers are not independently maintained, they are the same underlying data viewed two ways.",
    where: "Blast Radius = the de-duplicated union of every asset with a declared relationship to this one, plus assets sharing a routable IP address (loopback excluded).",
    why: "Keeping these as one dataset rather than two prevents the classic problem of two screens quietly drifting out of sync — declare a relationship here, and Blast Radius on Overview updates automatically, because it is reading the same rows.",
    misreading: "If you expect Blast Radius to be higher than it currently reads, the fix is here: declare the missing relationship, rather than looking for a separate setting on the Overview tab, because there is not one.",
  },
  // source: a-rel-loopback
  'asset.relLoopbackExcluded': {
    title: "Why loopback addresses are excluded",
    what: "The system also groups assets that happen to share a routable IP address as being co-located (useful for catching, say, several applications all running on the same physical host). But it deliberately ignores one specific address family when doing this: loopback addresses like 127.0.0.1.",
    where: "This exclusion is hard-coded into the co-location grouping logic, not a configurable setting.",
    why: "Every single locally-discovered asset reports a loopback address — it is a universal, meaningless-for-grouping-purposes address every machine has. If loopback addresses were allowed into the co-location check, every asset in the entire estate would appear to be co-located with every other asset, silently merging thousands of genuinely unrelated machines into one meaningless blast-radius group.",
    misreading: "This is a good example of a small, deliberate design decision protecting the integrity of a bigger number — Blast Radius would be a useless, universally-huge figure without this specific exclusion.",
  },
  // source: a-rel-lateral
  'asset.relFeedsLateralMovement': {
    title: "Feeding the exploit assessment",
    what: "Declared relationships do not only feed Blast Radius — they also directly inform the \"Lateral movement\" stage of the MITRE kill-chain assessment shown on a linked finding's Exploit Test tab (see the Vulnerability Detail screen).",
    where: "The kill-chain assessment checks this asset's declared relationships when deciding whether the \"lateral movement\" stage should read Reached, Possible or Blocked.",
    why: "Whether an attacker who compromises this box could then reach the identity provider or the SIEM collector is not a generic security question — it is a direct consequence of the specific relationships declared right here, which is why the two features share the same underlying data.",
    misreading: "If the exploit assessment on a related finding seems too optimistic or too pessimistic about lateral movement, check whether this asset's relationships are accurately and completely declared — a missing relationship here under-states what an attacker could actually reach.",
  },
  // source: a-rel-empty
  'asset.relEmptyState': {
    title: "Reading an empty relationships list correctly",
    what: "If this table were empty, the honest reading would be \"nobody has declared any dependencies for this asset yet\" — not \"this asset has no dependencies.\"",
    where: "",
    why: "Absence of a declared relationship and genuine architectural isolation produce an identical, empty-looking screen. The system has no way to distinguish \"we checked and there really are none\" from \"nobody has done this yet\" unless the process of declaring relationships is actually completed.",
    misreading: "A populated Relationships tab reads that way specifically because someone did that work — treat it as evidence of diligence, and an empty one on any other asset as an open task, not a clean result.",
  },
  // source: a-life-states
  'asset.lifecycleStates': {
    title: "The lifecycle state machine",
    what: "Every asset moves through a fixed sequence of states over its life: onboarding (just discovered or entered, not yet fully verified), active (in normal production use), decommissioning (being taken out of service), and retired (fully removed from active duty).",
    where: "The current state is a field on the asset record, changed only through an explicit \"Lifecycle\" transition action (see the button in the header), not by editing a free-text field.",
    why: "Modelling this as a fixed set of states with controlled transitions, rather than a free-text status field, means the system can attach real validation and side-effects to each change — most importantly, automatically closing out vulnerabilities linked to an asset once it is confirmed retired, since a decommissioned asset can no longer be meaningfully patched or exploited.",
    misreading: "This asset is Active, which is why every risk, vulnerability and control calculation on it is being taken seriously — a Retired asset with the exact same open findings would have those findings auto-closed, because they are no longer operationally relevant.",
  },
  // source: a-life-eol
  'asset.lifecycleEol': {
    title: "End-of-life and remediation options",
    what: "End-of-life (EOL), shown on this card as a specific date, is the date the vendor stops shipping updates or security patches for this asset's hardware or platform.",
    where: "Set from vendor lifecycle data, or calculated as a conventional 4-year refresh cycle from the purchase date when a vendor EOL date is not directly known.",
    why: "Once an asset passes its EOL date, \"apply the vendor patch\" stops being an available option for any new vulnerability found on it — there simply is no patch being issued anymore. Every finding on a past-EOL asset must instead be handled through a compensating control (segmentation, monitoring, a WAF rule) or through a hardware/platform replacement decision.",
    misreading: "An asset that is not past its EOL date yet can legitimately have a remediation plan that relies on a vendor-style patch upgrade. Re-check this date periodically — the same finding on the same asset would need a fundamentally different remediation strategy once that date passes.",
  },
  // source: a-life-decommission
  'asset.lifecycleDecommission': {
    title: "Decommissioning auto-closes vulnerabilities",
    what: "Transitioning an asset to decommissioning or retired does not just change a label — it triggers an automatic review of every vulnerability linked to that asset, closing out findings that are no longer operationally meaningful.",
    where: "This behaviour is built into the lifecycle-transition action itself, not a separate manual cleanup step.",
    why: "Without this, a retired asset would sit forever in vulnerability reports and dashboards as if it still represented live risk, permanently inflating \"open findings\" counts across the organisation with problems that, practically speaking, no longer exist because the hardware is gone.",
    misreading: "This is exactly why the Lifecycle transition is treated as a deliberate, validated action (with its own confirmation dialog) rather than a casual field edit — it has real, automatic consequences elsewhere in the system.",
  },
  // source: a-life-transition
  'asset.lifecycleTransition': {
    title: "Why transitions are gated, not free-text",
    what: "Moving an asset from one lifecycle state to another goes through a dedicated action with its own validation, rather than simply editing a \"status\" dropdown.",
    where: "The transition endpoint checks that the requested move is a valid one (you cannot jump straight from onboarding to retired without passing through active and decommissioning) and can require a reason or a replacement-asset reference.",
    why: "A free-text status field can be set to anything by anyone, silently, with no record of why. A gated transition means every lifecycle change carries context — who did it, when, and often why — which matters enormously when an auditor asks \"when and why was this critical asset decommissioned?\"",
    misreading: "If you need to retire an asset, always use the Lifecycle action from the header rather than looking for a way to edit the state directly — the validation and the vulnerability auto-close only happen through that path.",
  },
  // source: a-life-replacement
  'asset.lifecycleReplacement': {
    title: "Replacement asset reference",
    what: "When decommissioning an asset, the transition can record which new asset is replacing it — an explicit link from the old record to the new one.",
    where: "Set as part of the lifecycle-transition action, stored as a direct reference on the retiring asset's record.",
    why: "Without this link, institutional knowledge of \"what replaced what\" lives only in people's memory, and it evaporates the moment the person who did the migration leaves. A recorded replacement link means anyone reading the old asset's history later can trace exactly where its responsibilities moved.",
    misreading: "This asset has no replacement recorded, because it has not been decommissioned — this field only becomes populated at the point of an actual, deliberate retirement decision.",
  },
  // source: a-life-why
  'asset.lifecycleWhy': {
    title: "Who opens this tab, and why",
    what: "This tab is where an infrastructure or asset-management team member goes to answer \"is this asset still supported, and what happens when it stops being supported?\" — a planning question, distinct from the day-to-day security questions the other tabs answer.",
    where: "",
    why: "Patch cadence, remediation strategy, and even whether to accept a risk long-term all depend on how much runway an asset has left. A vulnerability found today on an asset with three years of support left is a very different conversation from the same vulnerability on an asset six months from EOL.",
    misreading: "Check this tab whenever a remediation plan is being drafted for a finding on an unfamiliar asset — the lifecycle state and EOL date directly constrain which remediation options (vendor patch vs. compensating control vs. replacement) are realistically on the table.",
  },
  // source: a-att-why
  'asset.evidenceWhy': {
    title: "Assertion versus artefact",
    what: "Attachments are the evidence documents backing up claims made elsewhere on this asset — an architecture diagram, a signed change approval, a scan report, a test result.",
    where: "Uploaded and linked manually by whoever performed the relevant work — an engineer, an auditor, a compliance analyst.",
    why: "In an audit, \"we enforce MFA on this gateway\" is an assertion; a signed change-approval document showing when and how MFA enforcement was rolled out is an artefact. An assessor is trained specifically to distinguish the two, and a claim with no artefact behind it is treated, correctly, as unverified.",
    misreading: "When defending any control or remediation claim to an auditor, always be ready to point to the specific attachment that backs it — a claim with a document reference is categorically stronger than the identical claim made verbally.",
  },
  // source: a-att-types
  'asset.evidenceTypes': {
    title: "What kinds of documents live here",
    what: "The four attachments on this asset span the categories this tab is built for: a network architecture diagram (how the asset fits into the broader environment), a signed change approval (authorisation for a specific configuration change), a CIS benchmark scan report (raw evidence behind the Compliance tab's numbers), and DR failover test evidence (proof a disaster-recovery plan was actually tested, not just written).",
    where: "",
    why: "Each type answers a different question an assessor might ask: what does this look like architecturally, who approved this change, what did the scan actually find, and does the recovery plan actually work when tried. A single \"attachments\" bucket covering all of them keeps every relevant document discoverable from the one asset it concerns.",
    misreading: "The CIS scan report attachment here is a good example of the assertion/artefact link in practice — the Compliance tab shows the computed passed/failed/never-scanned numbers; this attachment is the underlying raw report those numbers were computed from.",
  },
  // source: a-att-audit
  'asset.evidenceAuditorUsage': {
    title: "How an auditor actually uses this tab",
    what: "An assessor reviewing this asset will typically start from a claim elsewhere (a control marked \"Full\" coverage, a remediation marked \"Applied\") and come here looking for the document that proves it.",
    where: "",
    why: "This is the practical reason \"assertion vs. artefact\" matters so much in security and compliance work — regulatory frameworks like NCA ECC or ISO 27001 are ultimately assessed by sampling claims and checking for supporting evidence, not by trusting a dashboard at face value.",
    misreading: "A well-maintained Attachments tab, where every significant claim elsewhere on the asset has a corresponding document here, is what turns an audit from a stressful scramble into a straightforward walkthrough.",
  },
  // source: a-att-link
  'asset.evidenceModuleLink': {
    title: "Relationship to the Evidence module",
    what: "Attachments linked here are the same underlying evidence records the organisation-wide Evidence Management module tracks — this tab is simply the asset-scoped view of \"which evidence concerns this specific asset.\"",
    where: "",
    why: "Storing evidence once and linking it from every relevant place (an asset, a control, a framework requirement) avoids the alternative — duplicate copies of the same document scattered across the system, which inevitably drift out of sync as one copy gets updated and the others do not.",
    misreading: "If you are looking for evidence related to this asset but a document does not appear here, check whether it was uploaded through the Evidence module without being explicitly linked back to this specific asset record.",
  },
  // source: a-att-scan
  'asset.evidenceCisScan': {
    title: "The CIS scan attachment specifically",
    what: "This one attachment — a CIS benchmark scan report, timestamped to the scan run — is the raw machine output behind the passed / failed / never-scanned figures shown on the Compliance tab and used throughout the Hardening-gap calculation.",
    where: "Generated directly by the scanning tool at the time of the scan run, and attached here for reference and audit.",
    why: "The Compliance tab shows computed summary numbers; this raw file is what an assessor would ask to see if they wanted to verify those numbers themselves, rule by rule, rather than trusting the displayed summary.",
    misreading: "Whenever a new scan runs, this attachment should be refreshed alongside it — a stale scan attachment sitting next to fresh Compliance-tab figures is exactly the kind of mismatch an auditor is trained to notice and flag.",
  },
  // source: a-att-missing
  'asset.evidenceMissing': {
    title: "What it means when evidence is missing",
    what: "An asset with claims elsewhere (controls marked Full, remediations marked Verified) but nothing here to back them up is not automatically wrong — but it is unverifiable, which in an audit context is treated much like being wrong.",
    where: "",
    why: "Auditors work from what can be shown, not what is asserted. A gap between claims and evidence is one of the most common audit findings in any GRC programme, and it is entirely preventable by simply keeping this tab current as work happens, rather than retroactively.",
    misreading: "Make attaching evidence part of finishing the work, not a separate task for later — a remediation is not really \"Verified\" until the evidence text and any supporting document both exist, together.",
  },
  // source: a-notes-vs-history
  'asset.notesVsHistory': {
    title: "Notes versus History",
    what: "Notes and History look similar (both are timestamped, both show who wrote what) but they capture fundamentally different things. History is what the system itself directly observed — a field changed, a scan ran, a link was created. Notes are what a human chose, of their own judgement, to write down.",
    where: "Notes are free-text entries an operator adds manually at any time; History entries are generated automatically by the system whenever a tracked action occurs.",
    why: "Merging the two would lose an important distinction: fact versus reasoning. \"CIS scan completed — N passed / N failed\" (History) is an observation nobody can dispute; \"flagged for MFA hardening review after the Q2 pen test noted weak session timeout defaults\" (Notes) is a human's judgement call, which might later turn out to be wrong, superseded, or subjective in a way a system-generated fact never is.",
    misreading: "When reconstructing \"what happened and why\", read both tabs together — History gives you the indisputable timeline, Notes gives you the human reasoning that a bare timeline can never capture on its own.",
  },
  // source: a-notes-why
  'asset.notesWhy': {
    title: "Why free-text notes exist at all",
    what: "Not every important piece of context fits into a structured field. \"This box is scheduled for an MFA hardening review because of something a pen test found\" does not belong in a status dropdown — it needs a sentence, written by a person, in their own words.",
    where: "",
    why: "A rigid system that only allows structured fields eventually forces people to either omit important context or stuff it awkwardly into a field that was not designed for it (a status value that becomes a paragraph). A dedicated free-text Notes tab avoids that pressure entirely.",
    misreading: "Use Notes for judgement calls, escalation reasoning, and context that will matter to whoever looks at this asset next — not for facts the system already records automatically elsewhere (those belong in, or already appear in, History).",
  },
  // source: a-notes-example1
  'asset.notesExample1': {
    title: "Reading the first note",
    what: "Liang Wei's note flags a hardening review triggered by a Q2 penetration test finding about weak VPN session timeout defaults.",
    where: "Written directly by the asset owner as a manual entry, dated Jun 3, 2026.",
    why: "A pen-test observation about a configuration weakness is exactly the kind of thing that would otherwise live only in a separate pen-test report, disconnected from the asset it concerns — recording it here keeps it visible to anyone working on this asset going forward, without needing to cross-reference a different document.",
    misreading: "This note does not have a structured \"status\" — it is a standing flag for future work, which is precisely the kind of open-ended context Notes exists to carry.",
  },
  // source: a-notes-example2
  'asset.notesExample2': {
    title: "Reading the second note",
    what: "Amara Okafor's note explains, in her own words, why the finding was escalated ahead of the normal patch cycle — because the asset is internet-facing and serves the whole remote workforce.",
    where: "Written manually, dated Jul 8, 2026 — the same day History records the finding being linked to this asset.",
    why: "The escalation itself is a workflow action recorded in History (a status or priority change); the reasoning behind choosing to escalate is a human judgement that only a note can capture. Without this note, a later reviewer would see \"escalated\" in History but have no record of why a person made that call.",
    misreading: "Notice how this note complements, rather than duplicates, the History entry from the same day — together they answer both \"what happened\" and \"why someone decided it should happen.\"",
  },
  // source: a-notes-audit
  'asset.notesAudit': {
    title: "Notes in an audit context",
    what: "A well-written note trail is often what convinces an assessor that decisions on this asset were made thoughtfully, rather than reactively.",
    where: "",
    why: "An auditor reviewing why a Critical finding was handled a particular way will often specifically look for the human reasoning behind it — a note explaining \"escalated because internet-facing and business-critical\" is exactly the kind of documented judgement that satisfies that question.",
    misreading: "Write notes as if a stranger, unfamiliar with the situation, will read them in six months during an audit — because that is a realistic scenario for exactly this kind of record.",
  },
  // source: a-notes-who
  'asset.notesWho': {
    title: "Who can write notes, and why that matters",
    what: "Notes are attributed to the specific person who wrote them, with a timestamp, the same as every other record in the system.",
    where: "Any user with edit access to the asset can add a note; the attribution is not editable after the fact.",
    why: "Attribution matters because a note is a judgement call, not a neutral fact — knowing who made a particular call, and when, is often as important as the call itself when reconstructing a decision later.",
    misreading: "Do not write notes anonymously or on someone else's behalf if the tooling allows it — the value of a note is partly the accountability that comes with a named author.",
  },
  // source: a-hist-why
  'asset.historyWhy': {
    title: "What History actually captures",
    what: "History is a strict, automatically generated log of tracked changes to this asset — a vulnerability link being created, a scan completing, a criticality value being confirmed, the asset being discovered in the first place.",
    where: "Every row is written by the system itself at the moment the underlying action occurs — no entry here was typed in by a human describing what they did; each is the system's own record of what it did.",
    why: "A record generated at the moment of the action, by the system performing it, cannot later be quietly rewritten to tell a more convenient story — which is exactly the property that makes History useful as an audit trail, as opposed to a narrative someone reconstructs from memory after the fact.",
    misreading: "If you need to know precisely when something changed on this asset and cannot fully trust memory or a verbal account, History is the authoritative source — not Notes, which reflects opinion, and not a conversation, which reflects recollection.",
  },
  // source: a-hist-actor
  'asset.historyActor': {
    title: "Why every row names an actor",
    what: "Every History entry records not just what happened, but who or what caused it — a named person, or \"system\" / a named automated process like the compliance-scanner.",
    where: "Captured automatically at the moment the change is made — whichever authenticated session or automated job performed the action.",
    why: "An auditor rarely disputes that something happened; they ask who decided it, when, and on what basis. A change log with no actor attached cannot answer the first and most basic of those three questions, no matter how detailed the description of the change itself is.",
    misreading: "When two entries look similar but one is attributed to a person and another to \"system\", read them differently — a human-triggered change usually implies a judgement call worth understanding; a system-triggered one usually reflects a routine, scheduled process (like the compliance scanner's regular run).",
  },
  // source: a-hist-immutable
  'asset.historyImmutable': {
    title: "Why History entries cannot be edited",
    what: "Once written, a History row is permanent — there is no edit button, no delete option, only new rows added over time.",
    where: "",
    why: "An audit trail that can be silently edited after the fact is not an audit trail — it is just a note that happens to have a timestamp. Immutability is what lets History be relied upon as evidence rather than merely as a convenience.",
    misreading: "If a History entry appears to be wrong (say, an incorrect actor was recorded due to a system bug), the correct response is a new, corrective entry explaining the discrepancy — never an edit to the original row, even if that were technically possible.",
  },
  // source: a-hist-example1
  'asset.historyExample1': {
    title: "Reading a vulnerability link event",
    what: "A row like \"Vulnerability CVE-xxxx-xxxxx linked (auto, CPE match)\" records the exact moment the system, not a person, connected that CVE to this asset — because an installed software CPE matched the CVE's published affected-product list.",
    where: "Actor: system — this was an automated match, not a manual link.",
    why: "This single row is the direct evidence behind the CPE-matching mechanism described on the Software tab — it is not an abstract claim that auto-matching exists, it is the specific record of it happening, on this asset, on this date.",
    misreading: "Compare the \"(auto, CPE match)\" provenance here to a manually linked finding, which would instead show a named human actor — the distinction tells you whether a link was discovered by the system or asserted by a person, which matters if you ever need to double-check its accuracy.",
  },
  // source: a-hist-example2
  'asset.historyExample2': {
    title: "Reading the CIS scan completion event",
    what: "\"CIS benchmark scan completed — N passed / N failed\" is the system's own record of the exact scan run that produced the numbers shown on the Compliance tab and used in the Hardening-gap calculation.",
    where: "Actor: compliance-scanner — an automated, scheduled process, not a person-triggered action.",
    why: "This entry is what lets someone answer \"when was this asset last actually scanned, and did the scan complete successfully\" without having to separately dig through scan-tool logs outside this system.",
    misreading: "If the Compliance tab's numbers ever look stale, this is the row to check first — the timestamp here tells you exactly how current those figures actually are.",
  },
  // source: a-hist-audit
  'asset.historyAudit': {
    title: "How an auditor reads this tab",
    what: "History is frequently the very first tab an experienced assessor opens on any asset, before looking at current-state summaries elsewhere.",
    where: "",
    why: "A timeline of tracked, system-generated changes is the fastest way to sanity-check a story — if a control is claimed to have been in place since March but History shows it was only linked in July, that discrepancy needs to be resolved before anything else on the asset can be trusted at face value.",
    misreading: "When preparing for a review of this asset, read straight down History first — it will often surface exactly the questions an assessor is going to ask before they ask them.",
  },
  // source: a-comp-formula
  'asset.compFormula': {
    title: "The CIS gap formula, worked through",
    what: "This tab shows the full arithmetic behind the single \"hardening gap\" figure used elsewhere on this asset (on the Residual Risk bar, and as 25% of the Risk Posture composite score).",
    where: "The formula is: CIS gap = 0.8 × (failed ÷ scanned) + 0.2 × (never-scanned ÷ total). Plugging in the passed, failed and never-scanned counts shown on the card: scanned is passed plus failed, which gives the failed-share; total is scanned plus never-scanned, which gives the never-scanned-share. The gap is 0.8 times the failed-share plus 0.2 times the never-scanned-share, and the hardening score shown on Risk & Controls is what remains once that gap is subtracted from a perfect 100.",
    why: "The 0.8/0.2 split is a deliberate weighting decision: failing a rule you actually checked is worse than never having checked it (0.8 weight versus 0.2), because a failed, known rule is a confirmed gap while a never-scanned rule is merely an unknown one — but the formula still charges you something for the unknown, rather than ignoring it, because an unmeasured host is not automatically a safe one.",
    misreading: "Never quote just the pass rate (passed ÷ scanned) as \"how hardened is this asset\" — that number silently ignores the never-scanned rules entirely. The gap formula above is the number that actually accounts for everything, and it is the one wired into every other score on this asset.",
  },
  // source: a-comp-passed
  'asset.compPassed': {
    title: "\"Passed\" — what it actually confirms",
    what: "A passed rule means the scanner directly checked a specific configuration setting against the CIS benchmark's required value and found it compliant — for example, confirming that password complexity requirements meet the minimum the benchmark specifies.",
    where: "Recorded automatically by the scanning tool during a scan run, one rule at a time.",
    why: "This is positive, checked evidence — the strongest of the three possible outcomes, because it reflects an actual verification rather than an assumption.",
    misreading: "A high passed count is a real, meaningful accomplishment — but it should always be read alongside the failed and never-scanned counts, not in isolation, since a high pass count does not by itself tell you how complete the overall scan was.",
  },
  // source: a-comp-failed
  'asset.compFailed': {
    title: "\"Failed\" — a confirmed gap, not a guess",
    what: "A failed rule means the scanner directly checked a specific setting and found it does NOT meet the benchmark's requirement — a confirmed configuration weakness, not a suspicion.",
    where: "Recorded automatically during the same scan run as passed and never-scanned results.",
    why: "Because failures are directly observed rather than inferred, each one is immediately actionable — a specific setting, on a specific host, that needs a specific configuration change, which is exactly the kind of concrete work item a hardening programme needs to track.",
    misreading: "The failed count out of the scanned total is what drives the \"scanned gap\" in the formula above — closing those specific items would, on its own, meaningfully improve this asset's hardening score even before touching the never-scanned rules.",
  },
  // source: a-comp-neverscanned
  'asset.compNeverScanned': {
    title: "\"Never scanned\" — why this counts against you",
    what: "The rules counted here on this host were never checked at all — not passed, not failed, simply never run, whether due to scan configuration, connectivity issues, or the rule not being applicable at the time of the last run.",
    where: "Determined by comparing the full applicable rule set for this benchmark against which rules actually produced a result in the last scan.",
    why: "It would be tempting to treat \"never scanned\" as neutral — neither good nor bad. The formula deliberately refuses that framing: an unmeasured host is not a hardened one, and a scan that silently skips a chunk of its rule set can hide real gaps just as effectively as a scan that ran and failed them. Charging a (smaller, 0.2-weighted) penalty for this keeps the score honest about what was actually verified.",
    misreading: "If this number is high on any asset, the right response is to investigate why those specific rules are not running — not to assume the host is fine simply because nothing failed.",
  },
  // source: a-comp-benchmark
  'asset.compBenchmark': {
    title: "What \"matched benchmark\" means",
    what: "\"CIS Ubuntu Linux 22.04 LTS v2.0.0 (Level 1 — Server)\" identifies exactly which published CIS benchmark document this asset is being measured against — CIS publishes different benchmarks for different operating systems and different hardening levels.",
    where: "The system matches this asset's detected OS family and version (Ubuntu 22.04 LTS, visible on Overview) against the library of available CIS benchmarks to select the correct one automatically.",
    why: "Scanning a host against the wrong benchmark — say, a Windows Server benchmark against a Linux box — would produce meaningless results. Naming the exact matched benchmark on screen lets anyone verify the comparison is even the right one to be making.",
    misreading: "\"Level 1 — Server\" specifically means the baseline hardening profile intended for general-purpose servers, as opposed to CIS's stricter \"Level 2\" profile intended for higher-security environments — worth checking whether Level 1 is actually the appropriate bar for an asset this critical.",
  },
  // source: a-comp-colocated
  'asset.compColocated': {
    title: "Co-located blending",
    what: "When multiple assets share a physical host (an application server and the database engine running on the same box, for instance), their CIS scores are not scored in complete isolation — they blend.",
    where: "The blend is 60% the host's own score plus 40% a criticality-weighted average of the applications running on it.",
    why: "A perfectly hardened operating system running a completely unpatched, misconfigured database is not, in any meaningful sense, a hardened environment — a host-only score would miss that entirely. Blending in the applications' own scores captures the fact that real-world risk lives at the whole-stack level, not just the OS layer.",
    misreading: "A blended score is explicitly labelled as such wherever it appears, specifically so nobody mistakes a borrowed, blended figure for a score earned entirely by the asset's own configuration.",
  },
  // source: a-comp-feeds
  'asset.compFeedsHardeningGap': {
    title: "Where this number goes next",
    what: "The hardening figure computed on this tab is not a dead end — it feeds directly into the \"Hardening gap\" bar on the Risk & Controls tab and into 25% of the weight of the composite Risk Posture score for this asset.",
    where: "",
    why: "One scan, one calculation, reused everywhere it is relevant — this is the same design principle behind the risk score and control coverage figures: compute a number once, from one source, and let every screen that needs it read the same value rather than recalculating it differently in different places.",
    misreading: "If you improve this asset's hardening (closing failed rules, running the never-scanned ones), expect that improvement to show up automatically on Risk & Controls and on the Risk Posture page the next time those pages are viewed — no separate update is needed.",
  },
  // source: a-comp-scanfreq
  'asset.compScanFrequency': {
    title: "Continuous monitoring, not a one-off audit",
    what: "This tab is described as \"continuously monitored\" because CIS scanning is intended to run on a recurring schedule, not as a single point-in-time compliance exercise.",
    where: "Scan cadence is configured at the scanning-tool level; History (see that tab) records each completed run with its timestamp.",
    why: "A hardening posture measured once and never re-checked goes stale the moment any configuration drifts — a recurring scan schedule is what lets the hardening score stay a live, trustworthy reflection of the asset's actual current state rather than a snapshot of how it looked months ago.",
    misreading: "Always check the timestamp of the most recent scan (visible in History) before treating this tab's numbers as current — a hardening score from six months ago says very little about a host's configuration today.",
  },
  // source: a-traj-why
  'asset.trajWhy': {
    title: "Why this view exists",
    what: "Trajectory exists to answer a question none of the other, more technical tabs are built to answer directly: \"in plain language, what is the actual story connecting this asset to the risk register?\"",
    where: "It is built by walking the same underlying links used elsewhere — this asset's linked vulnerabilities, and those vulnerabilities' or this asset's linked risk-register entries — and rendering them as one readable chain.",
    why: "\"This server has a flaw, that flaw threatens customer data, and that is a named risk on the register\" is a sentence a board member or a non-technical executive can follow. A table of raw CVE identifiers is not. Trajectory exists specifically to make that translation without requiring a technical audience.",
    misreading: "Use this tab when preparing a briefing for a non-technical audience — it is built for exactly that purpose, not as a working tool for day-to-day vulnerability management (that is what the Vulnerabilities and Risk & Controls tabs are for).",
  },
  // source: a-traj-node1
  'asset.trajAssetNode': {
    title: "The asset node",
    what: "The first node in the chain is simply this asset itself, anchoring the whole narrative to a specific, real piece of infrastructure rather than an abstract technical concept.",
    where: "",
    why: "Starting from a concrete, named thing that non-technical stakeholders can picture (a physical or virtual server, with an owner, a location, a purpose) is what makes the rest of the chain land — \"the VPN gateway everyone uses to work remotely\" is instantly meaningful in a way \"asset #4471\" is not.",
  },
  // source: a-traj-node2
  'asset.trajVulnNode': {
    title: "The vulnerability node",
    what: "The second node names the specific flaw — the CVE identifier of the linked finding — as the technical fact connecting the asset to the risk it creates.",
    where: "Pulled directly from this asset's linked vulnerabilities (the same data shown in full detail on the Vulnerabilities tab).",
    why: "This is the node a security engineer cares most about, and it is preserved in the chain — Trajectory does not hide the technical detail, it adds a plain-language narrative around it.",
    misreading: "Clicking this node (in the full product) would trace deeper into that specific finding's own sub-chain — this replica shows the top-level chain only.",
  },
  // source: a-traj-node3
  'asset.trajRiskNode': {
    title: "The risk node",
    what: "The final node connects the technical vulnerability to a formal, named entry in the risk register, describing the business-level scenario that this specific flaw makes concrete.",
    where: "Pulled from the same linked-risks data shown on the Risk & Controls tab.",
    why: "This is the node a board or an executive actually cares about — not a raw CVE identifier but \"if this goes wrong, here is what actually happens to the business.\" The risk node is the sentence that makes the whole chain worth showing to a non-technical audience.",
    misreading: "If a critical vulnerability has no risk-register entry connected to it, this chain will visibly dead-end at the vulnerability node — a useful, honest signal that the formal risk-assessment step has not yet been done for that specific finding.",
  },
  // source: a-traj-audience
  'asset.trajAudience': {
    title: "Who this tab is built for",
    what: "Trajectory is aimed at translating technical fact into business narrative for an audience that does not read CVE identifiers fluently — a board member, an executive, a non-technical auditor.",
    where: "",
    why: "Every other tab on this page is built for someone doing hands-on security or compliance work. This is the one tab built specifically for someone who needs the five-second version of \"why should I care about this asset right now.\"",
    misreading: "Do not use this as your working view for triage or remediation — it deliberately omits the depth (priority scores, exploit evidence, control mappings) that those tasks actually require.",
  },
  // source: a-traj-limits
  'asset.trajLimits': {
    title: "What this view intentionally does not do",
    what: "Trajectory simplifies a genuinely many-to-many relationship — one asset can carry many vulnerabilities, and one vulnerability can affect many assets — down into one clean, readable chain for storytelling purposes.",
    where: "",
    why: "That simplification is a deliberate trade: readability for a non-technical audience, at the cost of hiding the full complexity a security team actually has to manage. It is why \"how bad is this CVE\" and \"how bad is this for us, on this specific asset\" remain genuinely separate questions elsewhere in the product, even though this view flattens them into one narrative line.",
    misreading: "Treat any single trajectory chain as one illustrative path through a larger, messier reality — not as a complete map of every risk this asset carries.",
  },
  // source: a-crit-isca
  'asset.critIsca': {
    title: "ISCA",
    what: "ISCA rates the system as a whole — the asset itself, as a piece of infrastructure or an application — asking \"how critical is this system to the organisation's operations?\"",
    where: "A formal, documented exercise conducted by a named assessor (here, the Head of Infrastructure), producing a dated, approved result — Critical, in this case.",
    why: "This is a different kind of evidence than the CIA sliders on Risk & Controls: it is a considered, defensible, dated judgement rather than a quick technical rating an engineer sets in ten seconds. A regulator or auditor specifically wants to see this kind of formal record for an asset this significant.",
    misreading: "Compare this ISCA result (Critical) against the CIA-derived criticality badge shown in the header (also Critical, in this case) — they happen to agree here, but the system does not automatically reconcile them if they ever disagreed (see the note below).",
  },
  // source: a-crit-iaca
  'asset.critIaca': {
    title: "IACA",
    what: "IACA rates the data the system holds, rather than the system itself — asking \"how sensitive or critical is the information that flows through or is stored on this asset?\"",
    where: "A parallel formal exercise, conducted here by the Data Protection Officer, producing its own dated, approved result — High.",
    why: "A system and the data it carries do not always share the same criticality — a relatively simple, replaceable system can carry extremely sensitive data (a legacy file share holding regulated records), or a sophisticated system can carry relatively low-value data. Rating both separately captures that distinction instead of collapsing it into one number.",
    misreading: "ISCA and IACA can legitimately land on different results for the same asset (Critical system, High data, say) — that difference is meaningful information, not an inconsistency to be resolved away.",
  },
  // source: a-crit-vs-derived
  'asset.critVsDerived': {
    title: "Formal assessment versus CIA-derived criticality",
    what: "This asset has three separate sources that could, in principle, describe its criticality: the CIA sliders (Risk & Controls tab), the derived criticality badge (Overview header), and these two formal assessments.",
    where: "",
    why: "This is a known, named gap in the system: the formal assessment result and the criticality derived from CIA ratings are not automatically reconciled with each other. The scoring engine always uses the CIA-derived value for its calculations, regardless of what a formal ISCA or IACA concluded — and nothing today automatically flags it if the two disagree.",
    misreading: "If you are relying on this tab for an audit, do not assume the formal result shown here is what actually drove the risk score elsewhere on the asset — it is not, currently. Treat a mismatch between the two as something a human needs to notice and reconcile manually, not something the system will catch for you.",
  },
  // source: a-crit-approver
  'asset.critApprover': {
    title: "Why an approver and a date matter",
    what: "Both assessment rows carry a named approver and a specific date — this is not incidental metadata, it is the core of what makes a formal assessment different from an informal one.",
    where: "",
    why: "A rating with a named, accountable approver and a date is a claim someone stood behind at a specific point in time — exactly the kind of documented, defensible judgement a regulator wants to see, as opposed to an undated rating nobody can be asked to justify.",
    misreading: "A stale approval date (an assessment from years ago, on an asset whose role has since changed) is worth flagging for re-assessment — the date here is what lets you notice that staleness in the first place.",
  },
  // source: a-crit-audience
  'asset.critAudience': {
    title: "Who each kind of rating serves",
    what: "The quick CIA sliders and these formal assessments are not competing for the same audience — they serve different people asking different questions.",
    where: "",
    why: "An engineer working day-to-day needs a fast, good-enough judgement they can record in ten seconds (the CIA sliders). A regulator or auditor wants a documented, dated, approved assessment with a named accountable person behind it (ISCA/IACA). Both are legitimate; neither is a substandard version of the other.",
    misreading: "Do not treat the CIA sliders as a lightweight substitute for a formal assessment when one is actually required — for an asset this critical, both should exist, and both do, here.",
  },
  // source: a-crit-why
  'asset.critWhy': {
    title: "Why both kinds of rating exist at all",
    what: "This tab exists because a single number cannot simultaneously be fast enough for daily engineering use and rigorous enough for regulatory defence — so the system deliberately keeps both.",
    where: "",
    why: "Trying to force one process to satisfy both needs would compromise both: making the CIA sliders as rigorous as a formal assessment would make them too slow for daily use; making a formal assessment as quick as a slider would make it too shallow to defend to a regulator.",
    misreading: "When in doubt about which rating to cite for a particular purpose: use the CIA-derived criticality for day-to-day risk scoring and remediation prioritisation; use the ISCA/IACA result when a specific person needs to formally stand behind a criticality claim, such as in a regulatory submission.",
  },
  // source: p-score
  'posture.score': {
    title: "Score",
    what: "This is the same headline risk number shown on the asset's Overview and Risk & Controls tabs, presented here on its own dedicated page with its full supporting detail. The band label underneath — Severe — translates the raw number into one of four fixed categories: contained, watch, elevated, severe.",
    where: "Bands are fixed cut points: contained 0–25, watch 25–50, elevated 50–75, severe 75–100 — a score above 75 puts an asset in the severe band.",
    why: "These four band words are chosen deliberately to be different from the four asset-criticality words (low/medium/high/critical) used elsewhere. If risk bands reused the criticality vocabulary, a sentence like \"this high-criticality asset has high risk\" would become genuinely ambiguous — is \"high\" describing the asset's importance, or its current danger level? Using a distinct vocabulary for each concept removes that ambiguity entirely.",
    misreading: "Never read the score without also checking data quality (see the note on that figure, right next to it) — a Severe band at low data quality is a much weaker, less trustworthy claim than a Severe band at full data quality, even though both display the identical word \"Severe.\"",
  },
  // source: p-breakdown
  'posture.dimensions': {
    title: "Score breakdown",
    what: "This bar takes the same five dimensions described throughout this asset's scoring (CIS gap, Vulnerabilities, CIA value, Control gap, Linked risks) and shows each one's actual contribution to the final score, side by side, as a single visual proportion.",
    where: "Nominal weights are Vulnerabilities 30%, CIS 25%, CIA 15%, Control coverage 15%, Linked risks 15%. When every dimension has evidence, the bar simply shows those weights applied to each dimension's own 0–100 sub-score, and the five point-contributions sum to the headline score shown at the top of the page (small roundings aside). A dimension driven by a weaponised, KEV-listed finding, for instance, can push the Vulnerabilities segment close to its full weight on its own.",
    why: "A single number invites \"why is it what it is?\" — this bar is the direct, visual answer, letting you see at a glance which dimensions are doing most of the work and which are comparatively the least concerning of the five.",
    misreading: "When a dimension has NO evidence at all (unlike this fully-evidenced asset), its segment of the bar is shown muted/greyed and the remaining weights are re-normalised among the dimensions that do have evidence, so the bar still totals 100% — always check for that muted styling before assuming every percentage shown is a real, evidenced contribution.",
  },
  // source: p-dataquality
  'posture.dataQuality': {
    title: "Data quality",
    what: "Data quality is a completely separate concept from the risk score itself — it measures how much of the scoring weight is actually backed by real evidence, versus how much had to be excluded for lack of any.",
    where: "Computed as the sum of the weights of dimensions that have evidence, divided by the full possible weight (100%). An asset with all five dimensions evidenced (CIS scan run, vulnerabilities linked, CIA ratings set, controls linked, risks logged) reads a full 100%, shown as \"5/5\"; fewer evidenced dimensions bring that fraction down.",
    why: "A score and a confidence-in-that-score are not the same thing, and conflating them is a common and dangerous mistake. A brand-new asset with almost nothing recorded about it might show a reassuringly low score and a calm green band — purely because only one or two dimensions had any evidence to score at all. That is \"we do not know,\" not \"it is fine,\" and data quality is the figure that makes the difference visible.",
    misreading: "Always read score and data quality as a pair. A score at full, 5-of-5 data quality is about as strong and well-evidenced a claim as this system can make — treat a low-quality score on any other asset with proportionally more scepticism, not equal confidence.",
  },
  // source: p-cis
  'posture.cisDimension': {
    title: "CIS Benchmark dimension card",
    what: "This card is the Vulnerabilities-dimension-adjacent summary of the same CIS scan data shown in full on the asset's Compliance tab: the passed, failed and never-scanned counts, feeding 25% of the composite score.",
    where: "Same scan data, same formula (0.8 × scanned-gap + 0.2 × coverage-penalty) described in depth on the Compliance tab — this card is a summary view, not an independent calculation.",
    why: "Surfacing this dimension's own numbers on the posture page, not just its final contribution to the composite, lets an operator quickly see which specific dimension is driving an asset's score without having to open a separate tab.",
    misreading: "The \"View CIS details →\" link exists precisely so this summary is never the end of the investigation — click through to the Compliance tab whenever the summary number here prompts a \"why\" question.",
  },
  // source: p-vulns
  'posture.vulnDimension': {
    title: "Vulnerabilities dimension card",
    what: "This card summarises the active-finding count and severity mix behind the single heaviest-weighted dimension in the whole composite score (30%).",
    where: "Counts and weights the open findings on this asset by their own priority scores, not merely their raw CVSS — meaning a single weaponised, KEV-listed finding can dominate this dimension almost entirely on its own.",
    why: "Vulnerabilities are weighted heaviest of the five dimensions deliberately — an actively exploitable flaw on a live asset is generally the most immediate, concrete form of risk the system tracks, more so than a compliance gap or an unmapped control, which are both slower-moving, more preventive concerns.",
    misreading: "This is the dimension to check first whenever a Severe-band asset surprises you — it is disproportionately likely to be one or two specific, serious findings driving the whole score.",
  },
  // source: p-cia
  'posture.ciaDimension': {
    title: "CIA Criticality dimension card",
    what: "The same Confidentiality/Integrity/Availability ratings explained in depth on the Risk & Controls tab, shown here specifically as their contribution to the composite score (15% weight).",
    where: "Set by a human on this asset, or derived from declared criticality when unset elsewhere.",
    why: "Including CIA as its own dimension, rather than folding it silently into criticality alone, keeps the three underlying judgements (what if confidentiality breaks, what if integrity breaks, what if availability breaks) visible and separately auditable inside the composite score, rather than compressed into one word.",
    misreading: "If this card ever shows a warning about missing CIA ratings on some other asset, remember what that means for data quality: the dimension gets excluded and re-normalised away, rather than silently scored as if the asset were low-value — read the earlier note on Data Quality for the full mechanism.",
  },
  // source: p-coverage
  'posture.coverageDimension': {
    title: "Control Coverage dimension card",
    what: "The same linked-controls-÷-12 figure explained on the Risk & Controls tab, shown here as its contribution to the composite score (15% weight).",
    where: "Linked controls ÷ 12, identical formula and identical \"12\" convention used everywhere else this figure appears.",
    why: "Of the five dimensions, this is the one most directly and immediately actionable by a human — linking a specific missing control is a concrete task an operator can complete this week, unlike, say, waiting for a vulnerability to be patched by a vendor.",
    misreading: "The \"Link controls →\" link exists because this dimension, more than any other, rewards direct action — closing this gap is usually the fastest lever available to actually move a Severe-band asset toward a better score.",
  },
  // source: p-biz
  'posture.businessImpact': {
    title: "Business impact & scoring inputs",
    what: "This panel is where purely business-context judgements — facts no scanner or agent could ever detect on its own — are declared by a human and folded into an otherwise technical scoring system. Four multipliers live here: customer-facing (1.2×), internet-facing (1.3×), regulated data (1.4×), and operational dependency, which ranges from 0.8× (low) up to 1.5× (critical) depending on a declared level.",
    where: "Every one of these is set manually — there is no scan, agent or automated check that can determine \"this asset holds regulated data\" or \"this asset is customer-facing.\" A human with business context has to declare it. Nothing here is measured; everything here is asserted, which is precisely the point.",
    why: "A purely technical scoring system has no way to know that this VPN gateway is both internet-facing and carries session data for the entire remote workforce — facts that make an identical CVE meaningfully more dangerous here than on some other, less exposed asset. These multipliers are the deliberate seam where business judgement enters an otherwise mechanical calculation, which is exactly why the same CVE can, correctly, rank very differently across two different assets in the same estate.",
    misreading: "Because these values are declared rather than measured, they carry the same honesty obligation as the CIA ratings: an unset or wrong multiplier does not just under-count risk quietly, it actively misrepresents it as more precise than it really is. Revisit this panel whenever an asset's business role changes (say, it starts handling a new class of regulated data) — the multiplier will not update itself.",
  },
  // source: p-bands
  'posture.bands': {
    title: "The four risk bands, in full",
    what: "Contained (0–25) describes a genuinely healthy posture — nothing urgent, evidenced across the dimensions that were checked. Watch (25–50) means keep an eye on it, nothing demanding immediate action yet. Elevated (50–75) means this asset should be scheduled for remediation soon, not left for a future review cycle. Severe (75–100) means immediate action — whichever band this asset's score falls into, the label describes active risk at that level right now.",
    where: "",
    why: "Four bands, rather than a raw 0–100 number alone, exist because most people reason and prioritise in categories, not continuous numbers — a band label prompts a different, faster reaction than a bare number, even though they describe the same underlying fact.",
    misreading: "Use the band to decide urgency at a glance, and the underlying score plus its dimension breakdown to decide exactly what to do about it — the band alone will never tell you which of the five dimensions is actually driving the classification.",
  },
  // source: v-status
  'vuln.status': {
    title: "Status & primary action",
    what: "This is the finding's current position in its remediation workflow — Open here — paired with the single next action the system expects someone to take from this state (Start Remediation, in this case; the button's label itself changes as status changes).",
    where: "A workflow field, changed only through explicit actions (Start Remediation, Mark Remediated, Verify Fix, Reopen), not a free-text field anyone can set to anything.",
    why: "Every finding, no matter how it is scored or flagged, ultimately resolves into exactly one of three outcomes: Remediate (the flaw is genuinely gone), Mitigate (still present, but guarded — segmentation, a WAF rule, monitoring), or Accept (still present, and the organisation has formally decided to live with it, on the record, with a date). This status bar, and the buttons beside it, is how that eventual decision actually gets recorded.",
    misreading: "A finding sitting in Open for a long time is not automatically a problem if active mitigation work is genuinely happening underneath it (see the Remediation tab) — always check the fuller detail before assuming a stale-looking status means neglect.",
  },
  // source: v-flags
  'vuln.redFlags': {
    title: "Threat flags",
    what: "These pills are deliberately not the priority score — they are individual, binary red flags, six in total across the whole system: on CISA KEV, any public exploit existing at all, EPSS at or above 10%, past its due date, sitting on an internet-facing asset, or sitting on a business-critical asset.",
    where: "Each flag is checked as a raw, independent fact — CISA's KEV list, GitHub exploit-repository counts, FIRST's EPSS feed, the finding's own due date, and this asset's own exposure/criticality fields — never derived from, or hidden inside, the single blended priority number.",
    why: "This mirrors emergency-room triage: everyone gets an overall severity assessment, but certain specific signs (chest pain, uncontrolled bleeding) get a patient seen immediately regardless of their triage score. A finding can have a comparatively modest priority number and still deserve to jump the queue because one of these six independent facts is true of it.",
    misreading: "An empty flag list on some other finding is a real, legitimate answer, not a system failure — it means none of the six specific red flags apply, and that finding can reasonably wait for the normal patch cycle. Do not read \"no flags\" as \"the system missed something.\"",
  },
  // source: v-triage
  'vuln.triage': {
    title: "Triage facts",
    what: "These three numbers are commonly confused with each other, and this card exists specifically to keep them visually distinct. CVSS is the flaw's technical severity from NVD — how bad it could be, in the abstract. EPSS is FIRST's estimated probability that this specific CVE will be exploited somewhere in the next 30 days — and the percentage shown genuinely means a probability, not a percentile ranking (a separate, different EPSS figure that this card does not show). Risk score is our own engine's blended priority for this finding on this specific asset.",
    where: "CVSS: NVD. EPSS: FIRST.org's published exploit-prediction model, updated regularly as real-world exploitation data changes. Risk score: computed by this engine from CVSS, EPSS, KEV status, exploit maturity, attack vector, asset exposure and asset criticality together.",
    why: "Conflating EPSS's probability with its percentile is one of the single most common and consequential misreadings of vulnerability data — mistaking a percentile for a probability can overstate perceived risk by roughly seventy-fold in the wrong direction, or understate it just as badly depending on which way the confusion runs. Keeping the three numbers visually separate, each clearly labelled with its source, is a direct defence against that mistake.",
    misreading: "If you only remember one thing from this card: EPSS answers \"how likely is exploitation,\" CVSS answers \"how bad would it be,\" and Risk score answers \"how urgent is this for me, specifically, right now\" — three different questions, three different numbers, on purpose.",
  },
  // source: v-due
  'vuln.dueDate': {
    title: "Timeline",
    what: "The due date is the SLA deadline this specific finding was assigned, based on its severity/priority under organisational policy; the \"14d overdue\" chip is the direct, visible consequence of that date having already passed.",
    where: "Calculated by applying the organisation's SLA policy (typically, a maximum allowed remediation window per severity tier) against the date the finding was created or last enriched.",
    why: "An SLA breach is independently one of the six named red-flag triggers described above — a finding sitting past its own deadline escalates on that fact alone, regardless of what its underlying priority score happens to be, because a missed commitment is itself worth acting on immediately.",
    misreading: "This finding being 14 days overdue, while already carrying an approved remediation plan and a partial retest, is not a contradiction — the deadline pressure and the visible progress can, and here do, coexist; the overdue chip is a fact about the clock, not a judgement about whether work is happening.",
  },
  // source: v-identity
  'vuln.identityCard': {
    title: "Identity card",
    what: "CWE-917 is a standardised weakness-type classification (distinct from a CVE, which identifies one specific vulnerability instance) — CWE-917 describes \"Improper Neutralization of Special Elements used in an Expression Language Statement,\" the general category of coding mistake Log4Shell is an example of. The affected component, log4j-core@2.14.1, names the exact library and version actually vulnerable.",
    where: "CWE classification comes from NVD alongside the CVSS score; the affected component is matched against this asset's own software inventory via the CPE mechanism described on the Software tab.",
    why: "A CWE groups a whole family of related vulnerabilities under one weakness type, which is genuinely useful for pattern-spotting (\"we keep having expression-language-injection issues across our stack\") in a way a single CVE number cannot capture on its own.",
    misreading: "Use the CWE when looking for training or coding-standard gaps across the organisation, not just this one finding — \"Auto-map from CWE\" style features (elsewhere in the product) use exactly this classification to suggest which compensating controls are broadly relevant to this whole class of weakness.",
  },
  // source: v-assignment
  'vuln.assignment': {
    title: "Assignment card",
    what: "This records the specific individual currently responsible for working this finding — distinct from the department-level assignment shown on the Remediation tab.",
    where: "Set manually by whoever triages the finding, from the pool of users with access to this asset or module.",
    why: "An individual assignee and a department assignment satisfy different needs: one routes accountability to a named person who can be asked directly \"what is the status of this,\" the other routes the work to a queue a team manages collectively. Having both means a finding is never simultaneously \"someone's job\" and \"nobody in particular's job.\"",
    misreading: "Either the individual assignment or the department assignment is sufficient to satisfy the approval gate on a remediation plan — they are not required together, but recording both, as here, gives the clearest possible accountability trail.",
  },
  // source: v-affectedasset
  'vuln.affectedAssetCard': {
    title: "Affected asset card",
    what: "This card is the rail's pointer back to the specific asset this finding actually lives on, along with its criticality, so the finding's context is never more than a glance away no matter which tab you are reading.",
    where: "Pulled directly from the vulnerability–asset link, the same link responsible for this finding appearing on the asset's own Vulnerabilities tab.",
    why: "A vulnerability detail page that only showed the technical flaw, with no easy path back to which real, specific piece of infrastructure it threatens, would make it easy to lose sight of exactly why a given finding matters as much as it does.",
    misreading: "\"View asset details →\" is the fastest way to cross-check this finding's scoring against the asset's own declared criticality, exposure and business-impact multipliers, rather than taking the finding's priority number on faith.",
  },
  // source: v-score
  'vuln.priority': {
    title: "Risk analysis score",
    what: "This is the same Priority number shown in the rail and on the asset's Vulnerabilities tab, presented here with its full supporting detail — severity, exploit probability, known-exploited status and asset criticality, blended into one ranking figure specific to this finding on this specific asset.",
    where: "Computed by the scoring engine from CVSS (NVD), EPSS (FIRST), CISA KEV status, GitHub public-exploit-repository counts, and this asset's own criticality and exposure fields — the full seven-signal breakdown appears immediately below this card.",
    why: "Two findings can carry an identical CVSS score and still represent very different real-world risk, depending on whether a working exploit actually exists, whether the flaw is reachable over the network, and whether the host it sits on faces the internet. This score is what lets those two findings be ranked honestly against each other, rather than tied at the same CVSS-only value.",
    misreading: "A very high score — whether it comes from a KEV floor, from the other six signals independently, or both at once — should be read as \"nearly every input signal available points the same direction\" — it is not one bad signal dragging an otherwise calm finding upward, as the full breakdown below demonstrates.",
  },
  // Before / After panels on Analysis — the explanation lives here in Guide
  // mode, not as paragraphs under the cards.
  'vuln.scoreBefore': {
    title: "Before · CVSS alone — the full math",
    what: "The finding scored from nothing but the CVSS vector's own parameters — attack vector, attack complexity, privileges required, user interaction, scope and the three impact ratings — scaled to a 0–100 number. Nothing else counts in this panel: no EPSS, no exploit intelligence, no KEV status, no asset context. When no CVSS score is stored there is nothing to score, so the panel shows a dash — it never invents a number from the severity label. The ×0.85-style figure beside each row is that parameter's official CVSS v3.1 multiplier (Scope shows \"rule\" because it switches the formula rather than multiplying).",
    where: "The weights and formulas are the CVSS v3.1 specification's (first.org), not ours. Exploitability = 8.22 × AV × AC × PR × UI, using the row multipliers (e.g. Network 0.85 · Low complexity 0.77 · Low privileges 0.62 · No interaction 0.85 → 2.8). Impact starts from ISS = 1 − (1−C)(1−I)(1−A) with High = 0.56, Low = 0.22, None = 0; with Scope unchanged, Impact = 6.42 × ISS (three Highs → ISS 0.91 → 5.9); with Scope changed a steeper curve applies and the sum is stretched by 1.08. Base = the two sub-scores added, rounded UP to one decimal and capped at 10 (2.8 + 5.9 → 8.8). The panel score is simply that CVSS base × 10 (8.8 → 88). The score and vector themselves come from the scanner or the NVD record — both listed in Data by source below; the indigo badge matches the NVD card on purpose.",
    why: "This is the industry's default way of ranking a flaw: the worst-case reading, which assumes the flaw is reachable and fully exploitable everywhere — e.g. \"reachable over the network, low complexity, no user interaction, full loss of confidentiality, integrity and availability\" is exactly what a vector of Network/Low/None/High-High-High is saying. It is the number most scanners and reports lead with, which is exactly why it needs a counterpart panel weighing what actually applies on this specific host.",
    misreading: "A 98 here does not mean this host is 98-urgent — it means the flaw in the abstract is near-maximal. Read it side by side with After: the gap between the two numbers is what context (exposure, exploit evidence, asset criticality) actually changed. And note the roundup: CVSS rounds the base UP, so the recomputed math can land a decimal below a scanner-stored value — the stored value is the one that counts.",
  },
  'vuln.scoreAfter': {
    title: "After · on this host — the formula and the difference",
    what: "The same flaw re-scored by the seven contextual signals, each row showing its actual evidence and its exact points. The formula, out of 100: CVSS severity = (CVSS ÷ 10) × 20 · Exploit probability = EPSS × 20 · Exploit maturity = up to 15 (weaponized or actively exploited 15, proof of concept 6, none known 1.5, unrated 4.5) · Known exploited = 15 if on CISA KEV, else 0 · Attack vector = up to 10 (Network 10, Adjacent 6, Local 3, Physical 1, unknown 5) · Internet exposure = 10 if the asset is internet-facing, else 0 · Asset criticality = the asset's 0–10 criticality score. Any CVE on CISA KEV is floored at 80 regardless of the sum. The small arrow chip is the difference between the two panels — After minus Before.",
    where: "Computed on this platform from the enrichment fields plus the linked asset's exposure and criticality — the slate badge matches the \"Contextual · this platform\" card in Data by source. The same seven contributions are drawn as bars in the Score breakdown further down the page.",
    why: "The difference between Before and After is the entire point of enrichment. A downward arrow means the flaw is severe on paper but less urgent here — typically not internet-exposed, no public exploit, low EPSS. An upward arrow means context is worse than the paper severity — actively exploited in the wild, an exposed or critical asset, or the KEV floor lifting the score. CVSS is deliberately only 20 of the 100: it measures how bad the flaw is, not how likely it is to be used against this host.",
    misreading: "A large drop (say ↓46) is not the score being broken or the flaw being dismissed — the flaw is exactly as severe as CVSS says in the abstract. It is a statement about this host: the conditions the worst case assumes are not present here. Fix the exposure (or link the right asset) and the After number moves back up.",
  },
  // source: v-breakdown
  'vuln.breakdown': {
    title: "7-signal score breakdown",
    what: "This is the complete, line-by-line accounting of exactly how the priority score was built — every one of the seven weighted signals, its raw evidence, and its exact point contribution, summing to the total shown above.",
    where: "CVSS severity (up to 20 points, scaled from the CVSS score out of 10). Exploit probability (up to 20 points, scaled from the EPSS percentage). Exploit maturity (up to 15 points, based on the count of known public exploit repositories for the CVE — enough of them places a flaw firmly in the \"weaponised\" tier). Known exploited (up to 15 points — full marks if confirmed on CISA KEV). Attack vector (up to 10 points — Network, the maximum-risk vector, scores highest, meaning no physical or local access is required). Internet exposure (up to 10 points — full marks if this asset is internet-facing). Asset criticality (up to 10 points, scaled from the asset's criticality rating). The seven contributions sum to the total.",
    why: "CVSS severity is deliberately only 20% of the total weight — 60% of the formula's weight sits on exploitability and context (EPSS, maturity, KEV, vector, exposure) rather than on raw technical severity, because severity alone describes the flaw in the abstract while these other signals describe your actual, specific exposure to it. The exploit-repository count behind \"Exploit maturity\" is itself measured carefully: repositories are matched by CVE name, not searched by full text — a full-text search across a large sample of unrelated CVE catalogues and link-lists returned hundreds of false matches for a nonexistent test CVE, while a name-matched search correctly returned zero for that same nonexistent CVE and a large, accurate count for a real, well-known CVE.",
    misreading: "When a score seems surprising, this breakdown is where to look — read down the list for the specific signal responsible, rather than treating the total as an opaque verdict. A high score where every single signal independently supports it is the specific pattern that makes the total a defensible number rather than an artefact of one dominant input.",
  },
  // source: v-kev-floor
  'vuln.kevFloor': {
    title: "The KEV floor at 80",
    what: "Separately from the seven-signal arithmetic above, any CVE confirmed on CISA's Known Exploited Vulnerabilities list has its final priority score floored at a minimum of 80, no matter what the underlying signals sum to.",
    where: "CISA KEV — a specific, authoritative, binary government feed of vulnerabilities confirmed to have been exploited in real attacks, checked directly against this finding's CVE identifier.",
    why: "A flaw that is actively being used in real attacks right now must never sit in a merely \"medium priority\" queue simply because one input signal — say, an unusually low asset criticality, or an unknown attack vector — happened to pull the raw weighted sum down. The floor is a deliberate override of the formula's own arithmetic, not a bug or an inconsistency in it: it encodes a hard business rule (\"known exploitation in the wild always means at least this urgent\") on top of a more nuanced underlying calculation.",
    misreading: "Sometimes the floor is not actually doing any work — the seven signals alone can already sum to a total well above the 80 floor — but the floor exists precisely for the cases where they would not, which is why it is worth understanding even when it is not the deciding factor.",
  },
  // Source cards on Analysis — explanations live in Guide mode, not under the cards.
  'vuln.source.epss': {
    title: "EPSS · FIRST.org",
    what: "EPSS (Exploit Prediction Scoring System) estimates how likely this CVE is to be exploited in the wild in the next 30 days, as a probability and a percentile among all scored CVEs.",
    where: "Published live by FIRST.org and enriched onto the finding when you run Enrich (or the daily refresh).",
    why: "CVSS says how bad a flaw could be; EPSS says how likely attackers are to use it soon. A high CVSS with a tiny EPSS is often less urgent than a medium CVSS with a climbing EPSS.",
    misreading: "\"Probability 0.4%\" is not \"0.4 out of 10\" — it is a percentage chance. Percentile tells you how it ranks versus other CVEs (35th ≈ below average urgency on this axis).",
  },
  'vuln.source.kev': {
    title: "CISA KEV",
    what: "CISA's Known Exploited Vulnerabilities catalog lists CVEs confirmed to have been exploited in real attacks. \"No\" means this CVE is not on that list.",
    where: "Checked against the CISA KEV feed during enrichment; when listed, a link opens the public catalog.",
    why: "KEV is the strongest binary exploitation signal we use — stronger than a GitHub PoC count — and it can floor the contextual priority at 80.",
    misreading: "\"No\" is a real answer, not missing data. There is nothing to open when the CVE is not in the catalog.",
  },
  'vuln.source.exploitIntel': {
    title: "Exploit intel · Exploit-DB + GitHub",
    what: "Two independent public sources: Exploit-DB entry count and GitHub PoC repository count. \"Maturity\" is our verdict derived from them (and KEV): none known → proof of concept → weaponized → actively exploited.",
    where: "Exploit-DB comes from our offline mirror (point-in-time); GitHub PoCs from a live search API, cached. A source only links when it has at least one entry.",
    why: "Public exploit code is the practical \"can someone run this tomorrow?\" signal, separate from CISA confirming exploitation in the wild.",
    misreading: "Zero here means no indexed public PoC / Exploit-DB hit — not that exploitation is impossible. Advisory write-ups can still describe the flaw without counting as this signal.",
  },
  'vuln.source.contextual': {
    title: "Contextual · this platform",
    what: "Composite is the 7-signal score (CVSS · EPSS · exploit maturity · KEV · attack vector · exposure · asset criticality). Raw is CVSS/severity alone. Context change is how far enrichment moved the number.",
    where: "Computed on this platform from enrichment fields plus the linked asset's exposure and criticality — the full per-signal math is in the Score breakdown above.",
    why: "Raw CVSS treats every host the same; composite answers \"how urgent is this finding on this asset, given real exploit and exposure signals.\"",
    misreading: "A large downward arrow (context change) usually means the flaw looks severe on paper but is less urgent here (e.g. not exposed, no public exploit, low EPSS) — not that the score is broken.",
  },
  // source: v-description
  'vuln.description': {
    title: "Description card",
    what: "This is the plain-language technical explanation of the flaw itself: Log4j2 versions 2.0-beta9 through 2.14.1 fail to protect against attacker-controlled JNDI lookups, meaning an attacker who can influence a log message can cause the application to execute arbitrary code loaded from an external LDAP server.",
    where: "Sourced from the CVE's public advisory text (NVD), combined with the specific affected component detected on this asset (log4j-core@2.14.1, matched via CPE as described on the Software tab).",
    why: "CVSS and priority scores tell you how bad and how urgent a flaw is; they do not, by themselves, tell you what the flaw actually is or how it works. An engineer implementing a fix needs the technical narrative, not just the number.",
    misreading: "Read this alongside the CWE (Identity card, in the rail) for the general weakness category, and the affected-component field for the exact version that needs to change — together they tell you what is wrong and precisely what needs to be upgraded to fix it.",
  },
  // source: v-cwe
  'vuln.cwe': {
    title: "CWE-917 in detail",
    what: "CWE-917, \"Improper Neutralization of Special Elements used in an Expression Language Statement,\" is the general weakness category — Log4Shell is one specific, famous instance of this broader class of coding mistake, where user-controllable input is evaluated as if it were trusted code or expression syntax.",
    where: "Published and maintained by MITRE as part of the CWE (Common Weakness Enumeration) taxonomy; NVD tags each CVE with the CWE category it belongs to.",
    why: "Classifying by weakness type, not just by individual CVE, is what lets a security team spot patterns across their whole codebase or estate — \"we have had three separate CVE-917-class findings this year\" is a much more actionable observation than three unrelated-looking CVE numbers.",
    misreading: "If your organisation writes its own software, a recurring CWE across multiple findings is a strong signal to invest in developer training or a coding-standard change targeting that specific weakness class, rather than only patching each instance as it appears.",
  },
  // source: v-affectedassets
  'vuln.affectedAssetsTable': {
    title: "Affected Assets table",
    what: "This table lists every asset in the estate this specific finding has actually been linked to — a widely-deployed library vulnerability could in principle affect many assets across an organisation, even though this table may show just one.",
    where: "Populated via the vulnerability–asset link table, the same links visible from the asset side on its own Vulnerabilities tab.",
    why: "A single CVE and a single asset are not a one-to-one relationship — one vulnerable library can be installed on dozens of assets, and one asset can carry dozens of vulnerabilities. This table is where that many-to-many relationship becomes concrete and countable for this one specific finding.",
    misreading: "The provenance pill (\"Auto — CPE match\") tells you this specific link was discovered automatically rather than added by hand — worth remembering if you are ever auditing how confident you can be in the completeness of this list across a larger estate.",
  },
  // source: v-remedplan
  'vuln.remediationPlan': {
    title: "Remediation Plan",
    what: "This is the specific, adopted fix for this finding: upgrade the affected component to its patched version across every affected instance on this asset, with an interim mitigation while the full upgrade is scheduled.",
    where: "A draft plan like this is generated from the CVE itself, the asset type, its OS family and its exposure profile; a human then reviews and adopts it, and separately approves it — adopting and approving are two distinct, deliberate actions, not one click.",
    why: "A draft plan shown before it is saved carries no weight — it is a suggestion. The moment of intent is adopting it; the moment of accountability is approving it, because an approved plan carries a formal trail (see the stage-gates below) that a merely-drafted one does not.",
    misreading: "The pill sequence (recommended → approved → applied → verified) beneath the plan text tells you exactly where in its lifecycle this specific plan currently sits — \"Approved\" here means a named owner has signed off, but the fix has not yet actually been executed (that is the \"Applied\" stage) or independently confirmed (that is \"Verified\").",
  },
  // source: v-remed-stages
  'vuln.lifecycle': {
    title: "The four-stage remediation lifecycle",
    what: "Every remediation plan moves through four fixed stages: Recommended (a plan exists, drafted with its rationale), Approved (a named person has authorised it), Applied (the steps have been executed and logged), Verified (someone has attested, with evidence, that the fix actually holds).",
    where: "Each stage transition is a distinct, recorded action — never a silent status edit.",
    why: "Two specific gates exist on purpose. Approval requires a named owner: an approval attached to nobody is an instruction addressed to no one, and a plan can otherwise sit \"approved\" indefinitely with no one accountable for the deadline it implies. Verification requires evidence text: a confirmation with nothing behind it looks exactly like proof in an audit export, which is precisely the failure mode the evidence requirement exists to prevent.",
    misreading: "Two claims this system deliberately does NOT make, and you should not read into it either: \"Applied\" does not mean anything actually touched a live host — it runs through a simulated executor that records the intended steps without ever executing them for real, because a real executor capable of changing production systems is a separate, much more consequential decision that must never happen by accident. \"Verified\" does not mean anything was automatically re-scanned — it means a named person, on a named date, attested the fix is in place and stated what evidence they are relying on.",
  },
  // source: v-remed-department
  'vuln.remediationDepartment': {
    title: "Department assignment",
    what: "Network Operations is assigned here with its own SLA override (7 days) — distinct from, and in addition to, the individual assignee (Amara Okafor) shown in the rail.",
    where: "Set manually as part of triaging the finding, alongside or instead of an individual assignment.",
    why: "An individual assignee and a department assignment satisfy two different needs at once: one gives a named person to ask \"what is happening with this,\" the other routes the work into a team's queue with its own escalation path, so the work does not stall if that one named person is unavailable.",
    misreading: "Either satisfies the approval gate on its own, but having both, as here, gives the strongest accountability — a specific person to ask, and a team that owns the outcome if that person is out.",
  },
  // source: v-remed-mitigations
  'vuln.mitigationsTable': {
    title: "Mitigations table",
    what: "Mitigations are tracked tasks that reduce exposure without actually removing the underlying flaw — here, disabling JNDI lookups (already complete) and a WAF rule blocking JNDI-style payloads at the perimeter (in progress).",
    where: "Each mitigation is its own tracked record with an owner, a priority, a status and a target date — a real work item, not a free-text comment.",
    why: "Between \"not fixed yet\" and \"fully remediated,\" there is meaningful, real work that reduces actual risk without yet closing the underlying vulnerability — mitigations exist to make that intermediate work visible and trackable, rather than invisible until the final patch lands.",
    misreading: "The interim mitigation already complete here (disabling JNDI lookups) is a large part of why the retest on the Exploit Test tab reads \"Partial\" rather than \"Fail\" — mitigations directly change real-world outcomes even before the plan reaches \"Applied.\"",
  },
  // source: v-remed-exception
  'vuln.exceptionWorkflow': {
    title: "Exception workflow",
    what: "An exception is the formal version of \"we are deliberately choosing not to fix this yet\" — distinct from simply not having gotten to it — and it carries its own state machine: none → requested → approved → expired, with a mandatory review date.",
    where: "This finding currently shows \"none\" — no exception has been requested, because the adopted remediation plan is actively being executed instead.",
    why: "An acceptance or exception with no review date is, in effect, accepted forever — and nobody ever consciously decides that outcome; it is simply what happens when a date field is left blank. Six months later, an undated acceptance is invisible and unreviewed, while the underlying risk is still being carried with no current sign-off. Naming and requiring the review date is what turns an oversight into an actual, revisitable decision.",
    misreading: "If this finding is ever formally deferred instead of fixed, expect a review date to be mandatory at that point — treat any exception without one, anywhere in the system, as a process gap worth flagging.",
  },
  // source: v-remed-threeanswers
  'vuln.remediationThreeAnswers': {
    title: "Only three real answers exist",
    what: "Every vulnerability, eventually, resolves into exactly one of three outcomes: Remediate (the flaw is gone — you fixed it), Mitigate (still present, but guarded — a compensating control reduces the practical risk), or Accept (still present, and the organisation has formally decided to live with it, on the record, with a date).",
    where: "",
    why: "This is precisely why this tab is structured into exactly three groups — the fix, who owns it, and what happens if we are not fixing it yet — because those three groups map directly onto the three possible eventual answers.",
    misreading: "When triaging any finding, ask which of these three outcomes it is actually heading toward — a finding with no remediation plan, no mitigation, and no exception is not in any of the three states, which is itself useful information: it means the decision genuinely has not been made yet.",
  },
  // source: v-remed-patchavail
  'vuln.patchAvailability': {
    title: "Patch availability",
    what: "This finding shows a vendor patch as available (Yes) — Apache has published log4j-core 2.17.1, which is not affected by this vulnerability.",
    where: "Checked against the vendor's own security advisories (Apache Software Foundation, in this case) as part of enrichment.",
    why: "Whether a vendor patch exists at all fundamentally shapes what \"remediation\" even means for a given finding — a patchable flaw usually resolves through an upgrade; an unpatched flaw in unsupported software forces a compensating-control or replacement conversation instead (see the Lifecycle tab's note on end-of-life for the asset-level version of this same idea).",
    misreading: "Always check this field before drafting a remediation plan — recommending \"apply the vendor patch\" for a flaw where none exists would be actively unhelpful, and this field is what prevents that specific mistake.",
  },
  // source: v-killchain
  'vuln.killChain': {
    title: "Attack chain — the MITRE ATT&CK kill chain",
    what: "This is the full MITRE ATT&CK kill chain — all 15 tactics an attack can move through, in order, from Reconnaissance on the left to Impact on the right. Each stage is either lit with a specific technique (for example T1190 \"Exploit Public-Facing Application\") or left greyed. A lit technique carries one of three states: Likely, Possible, or Blocked.",
    where: "The techniques come from the MITRE ATT&CK catalogue bundled with the platform (v19.1 — 367 techniques, 15 tactics, held locally as a data file, not fetched live). WHICH techniques attach to this finding is decided by translating the CVE → its weakness type (CWE) → an attacker technique, using three sources in order: the standards crosswalk (CWE→CAPEC→ATT&CK), a curated list, and — the backbone — rules that read the CVSS attack vector (e.g. AV:N → T1190 / T1210 / T1595). Each technique's state is then set by the reachability check against stored facts (internet exposure, public exploit, KEV). Nothing is executed against any host.",
    why: "A kill-chain view turns a bare CVSS number into an attacker's actual journey — \"here is how far someone could get, and exactly where they'd be stopped.\" Showing all 15 tactics, not just the lit ones, is deliberate: the greyed stages are the honest statement that the data can't justify a technique there.",
    misreading: "Greyed does NOT mean \"safe\" and it does NOT mean \"missing data\" — it means no technique this finding's weakness + vector can defensibly justify maps to that stage. Likewise, most findings only light Reconnaissance / Initial-Access / Execution because those are the only stages the CVE+CVSS backbone can prove; that is coverage honesty, not an under-count.",
  },
  // source: v-exploit-nothing-executed
  'vuln.exploitNothingExecuted': {
    title: "Why nothing here is executed",
    what: "Every marking on this tab — reached, possible, or blocked — is a derivation from stored evidence the system already holds, never the result of an actual attack, scan, or exploit attempt run against a real system.",
    where: "",
    why: "Running real exploit code against production infrastructure, even for testing purposes, carries obvious operational risk — this tab is deliberately designed to give useful, evidence-based insight into an attack path without ever needing to take that risk.",
    misreading: "Because nothing here is executed, treat every verdict on this tab as a well-reasoned hypothesis, not as proof — proof only exists once a human actually records a real test, which is exactly what the \"Prove it\" section (the retest log) below is for.",
  },
  // source: v-exploit-evidence-table
  'vuln.exploitEvidenceTable': {
    title: "Evidence — the six facts behind the verdict",
    what: "Six chips, each green (helps your defence) or red (helps the attacker): Internet-facing, Attack vector, Public exploit, CISA KEV, EPSS, and Patch. Together they are the raw facts the verdict is built from — every one is a stored value, not an opinion or a guess.",
    where: "Each chip is drawn from a different named source: Internet-facing from this asset's own record; Attack vector parsed from the CVE's CVSS vector (NVD); Public exploit from the GitHub + Exploit-DB check; CISA KEV from CISA's actively-exploited catalogue; EPSS from FIRST.org; Patch from the vendor-advisory sync. Each chip below carries its own guide marker explaining its exact source and how it is fetched.",
    why: "A verdict with no visible facts is just an assertion. This row is the \"show your work\" — every chip traces to the one fact that justified it, so you can audit the reasoning instead of trusting it.",
    misreading: "Red isn't automatically bad news and green isn't automatically safe — read them together. \"Network attack vector\" (red) only matters if the asset is also reachable; here \"Not exposed\" (green) is what severs the chain. It is the combination that decides the verdict, not any single chip.",
  },
  // source: v-exploit-retest
  'vuln.exploitRetest': {
    title: "Exploit test & retest — \"Prove it\"",
    what: "Everything above this point on the tab is derivation from existing evidence; this panel is the one part of the whole Exploit Test tab that is actual proof — a human-recorded record of what was genuinely tested and what actually happened.",
    where: "Recorded manually by whoever performs the test, with a result (Pass / Fail / Partial), an evidence reference, and free-text notes on exactly what was tested.",
    why: "Until a real retest exists, remediation on a finding is claimed but not demonstrated — this is the one place on the entire vulnerability record where a claim (\"we fixed it\") is actually converted into evidence (\"we checked, and here is what we found\").",
    misreading: "This finding currently shows \"Partial\" — the interim JNDI-lookup mitigation is confirmed working (no outbound LDAP traffic triggered, per a DNS canary log), but the vulnerable library file itself is still present pending the full 2.17.1 upgrade. Read \"Partial\" as real, verified progress, not as a euphemism for \"we assume it is mostly fine.\"",
  },
  // source: v-exploit-blockers-caveat
  'vuln.exploitBlockersCaveat': {
    title: "The caveat on \"Blocked\" stages",
    what: "The Impact stage here is marked Blocked, based on a network-segmentation rule that prevents direct database-tier access from the DMZ where this asset sits.",
    where: "",
    why: "This blocker is a heuristic derived from known configuration, not a formally linked, auditable control record from your ISO or NIST control catalogue — an important distinction if this specific claim ever needs to be defended to an external assessor.",
    misreading: "If you need this \"Blocked\" status to stand up as actual control evidence in an audit, the segmentation rule behind it needs to be separately linked as a formal control on the asset (see the Risk & Controls tab) — this kill-chain marking alone is not yet that link.",
  },
  // source: v-exploit-stage-early
  'vuln.exploitStageEarly': {
    title: "Reconnaissance, Initial access, Execution",
    what: "The first three kill-chain stages are marked Reached, meaning the evidence indicates an attacker could realistically complete each of them against this finding, on this asset, without being stopped.",
    where: "Reconnaissance is Reached when the asset is internet-facing with a scannable, identifiable service banner. Initial access is Reached when the CVE is unauthenticated and remotely triggerable. Execution is Reached when public exploit repositories demonstrate working attack code already exists.",
    why: "Marking these early stages honestly as Reached, rather than softening the assessment, is what makes the later \"Blocked\" marking (at Impact) meaningful — if every stage were marked cautiously as merely \"Possible,\" a genuine blocker further down the chain would not stand out as clearly as it does here.",
    misreading: "Three consecutive Reached stages at the start of a kill chain is a strong signal that any interim mitigation already applied is doing real, necessary work — this is not a hypothetical attack path, it is one the evidence says is realistically open.",
  },
  // source: v-exploit-stage-mid
  'vuln.exploitStageMid': {
    title: "Privilege escalation, Lateral movement",
    what: "These two middle stages are marked Possible rather than Reached or Blocked — the evidence does not confirm they would definitely succeed, but it does not rule them out either.",
    where: "Privilege escalation is Possible because the service's run-as user privilege level is not fully confirmed (Medium confidence, per the evidence table). Lateral movement is Possible directly because of this asset's three declared relationships (to the identity provider, the firewall, and the SIEM collector) — see the Relationships tab.",
    why: "\"Possible\" is an honest middle category, distinct from both the confidence of \"Reached\" and the reassurance of \"Blocked\" — collapsing genuine uncertainty into one of those two more definitive labels would misrepresent how much is actually known.",
    misreading: "A \"Possible\" marking is exactly where more evidence-gathering (confirming the service's actual run-as privileges, for instance) would most improve the overall confidence of this whole kill-chain assessment — it is the weakest link in an otherwise fairly well-evidenced chain.",
  },
  // ── Exploit Test tab — added guide (parent sections + child boxes) ──────────
  'vuln.exploitVerdict': {
    title: "The verdict — Unlikely / Possibly / Likely, plus signals % and data %",
    what: "The headline answers \"could an attacker actually use this here?\" — Unlikely, Possibly, or Likely exploitable, judged per asset. Beside it sit two small percentages people often confuse: \"signals\" and \"data.\"",
    where: "The verdict looks only at the ENTRY techniques (Initial-Access and Execution): if every way in is Blocked → Unlikely; one Possible → Possibly; one Likely → Likely; no network entry at all → Unlikely (\"an attacker would already need local access\"). \"Signals %\" = how many of 4 danger flags are on (internet-exposed, public exploit, in KEV, EPSS ≥ 10%). \"Data %\" = how many of the 10 facts the engine needs are actually known. Both are computed by the engine from stored evidence.",
    why: "Severity says how bad the flaw is; this verdict says whether it can be reached on THIS box — a High-severity flaw on an internal machine can honestly be \"Unlikely.\" The two percentages let you tell a confident answer from a guess.",
    misreading: "\"0% signals, 100% data\" is the reassuring case, not a broken one: full picture, and none of the four dangerous things is true. Low DATA % is the real warning sign — it means facts are missing, so treat the verdict as provisional.",
  },
  'vuln.exploitWalkthrough': {
    title: "Attacker walkthrough (AI · grounded)",
    what: "A plain-English story of how an attacker would move through this specific chain, step by step — written by an AI model as a readable narration layer on top of the computed assessment.",
    where: "Generated by a language model (gpt-4o-mini) from the already-computed chain and evidence — the model is handed the engine's result and asked only to describe it. It is a separate API call from the chain, so the chain paints instantly and the story streams in a second later. It decides nothing.",
    why: "A grid of tactic codes is precise but hard to feel; the walkthrough turns it into \"first they scan, then they're stopped at the door because it isn't internet-facing\" — the same facts in the language a non-specialist reads.",
    misreading: "The AI never overrides the engine. If its story would contradict the verdict, an automatic check catches it and the narration is withheld with a banner — so a missing walkthrough means \"we refused to show an inconsistent story,\" not \"the assessment failed.\" The chain below is always the source of truth.",
  },
  'vuln.exploitTechnique': {
    title: "A technique card (click any lit stage)",
    what: "Clicking a lit stage opens its detail, deliberately split into three voices at three scopes: \"On this asset\" (the per-asset verdict and its reason — the conclusion), \"Why it's in this chain\" (the mapping rationale — a claim about the flaw, not this asset, with a coloured source badge), and \"What this technique is · MITRE's general description\" (the generic encyclopedia text). \"What stops it\" lists the matching ATT&CK mitigations.",
    where: "\"On this asset\" comes from the reachability check (the specific fact that made it Likely / Possible / Blocked on this host). \"Why it's in this chain\" is the provenance layer — Standards (CAPEC), CVSS heuristic, Curated, or Assumed — telling you which source tied this technique to the flaw. The description at the bottom is MITRE's own catalogue text, unchanged.",
    why: "The three voices answer different questions at different scopes — this asset, this flaw, the technique in general. Kept separate and labelled, a card can say \"blocked here\" and still explain why the technique is in the chain and what MITRE says about it, without reading as a contradiction.",
    misreading: "On a Blocked card the lower sections are NOT walking back the verdict: \"Why it's in this chain\" is about the flaw and is phrased as would-apply-if, and the MITRE text is generic background — neither claims the technique works on this asset. The source badge still matters too: \"CVSS heuristic\" is a reasoned rule, not a confirmed standards mapping — treat \"Curated\" / \"Standards\" as stronger evidence than \"CVSS\" / \"Assumed.\"",
  },
  'vuln.exploitBlastRadius': {
    title: "Blast radius",
    what: "A different question from \"can they get in\": if this one asset were fully compromised, which other assets sit next to it that an attacker could try to reach next.",
    where: "Built from two sources unioned together: this asset's declared relationships (the Relationships tab) plus other assets sharing its network — loopback (127.0.0.1) excluded so unrelated machines aren't merged. It is an asset-graph lookup, not part of the reachability verdict.",
    why: "Getting in is only half the risk; the other half is how far it spreads. Blast radius turns that into a concrete list — declare fewer unnecessary trust links and it shrinks; discover a hidden dependency and it grows.",
    misreading: "An empty blast radius means \"no neighbours have been mapped,\" NOT \"this asset is safely isolated.\" Absence of data and true isolation look identical here — only declared relationships make a non-empty number trustworthy.",
  },
  'vuln.exploitThreatIntel': {
    title: "Threat intelligence (technique-level)",
    what: "For each technique in this chain, the real-world threat groups and malware / tools that MITRE records as using that technique — for example \"T1190 is used by APT28, APT29, Sandworm…\"",
    where: "Looked up from the MITRE ATT&CK Groups & Software dataset bundled with the platform (held locally — 170 groups plus malware / tools), matched to the techniques in this finding's chain and capped at 12 names per technique for readability.",
    why: "It answers \"do real attackers actually bother with this kind of move?\" — useful context for how seriously to take a technique that is only \"Possible\" on paper.",
    misreading: "The single most-misread panel: it is a TECHNIQUE-level association, NOT \"these actors attacked this CVE.\" MITRE has no CVE-to-actor link, so \"APT28 uses T1190\" never means \"APT28 exploited this vulnerability.\" The panel says so itself — read it as context, not attribution.",
  },
  'vuln.ev.internetFacing': {
    title: "Evidence · Internet-facing",
    what: "Whether this asset can be reached directly from the public internet — the single biggest factor in whether a network flaw can actually be attacked here.",
    where: "Read from THIS asset's own record (the internet-facing field on the asset), not from the CVE. Today that field is set by an operator or an import — it is not yet auto-detected by a live scanner, which is why the tab notes reachability is derived from the asset's stored state.",
    why: "It's what flips a network-exploitable flaw from \"Likely\" to \"Blocked.\" On this finding, \"Not exposed\" is exactly why the entry technique is Blocked and the verdict is Unlikely.",
    misreading: "Because it's an operator-set field, a wrong value here quietly skews the verdict — if an asset really is exposed but the field says no, fix it on the asset and the whole assessment recomputes.",
  },
  'vuln.ev.attackVector': {
    title: "Evidence · Attack vector",
    what: "How close an attacker must be to exploit the flaw — Network (from anywhere), Adjacent (same LAN), Local (already on the box), or Physical. Shown red when it's Network / Adjacent.",
    where: "Parsed from the CVE's CVSS vector string (the AV: field), which comes from NVD. It is a property of the vulnerability itself, not of your asset.",
    why: "It's one half of reachability: a Network-vector flaw CAN be hit remotely — but only if the asset is also exposed (see Internet-facing). The engine's CVSS rules also use it to pick the entry technique (AV:N → T1190).",
    misreading: "\"Network\" (red) alone is not danger — it's danger only when paired with exposure. Here the Network vector is red but the asset isn't exposed, so it stays contained.",
  },
  'vuln.ev.publicExploit': {
    title: "Evidence · Public exploit",
    what: "Whether ready-made attack code for this CVE exists in public — and whether any of it is confirmed working (\"Verified\").",
    where: "Two separate sources combined: a LIVE search of GitHub for repositories named after the CVE (a breadth count), plus the bundled Exploit-DB dataset where some entries carry a \"verified\" flag (a quality signal). The chip shows the combined provenance, e.g. \"github; exploit-db (verified).\"",
    why: "Public exploit code sharply raises real-world risk — it's one of the four danger signals and a red-flag trigger on the Remediation tab. \"None found\" (green), as here, is part of why this finding scores low.",
    misreading: "Don't confuse this with the ATT&CK mapping. GitHub / Exploit-DB answer \"is there attack CODE?\" — they do NOT decide which techniques appear in the chain (that is ATT&CK + the CVSS rules). Two different databases, two different jobs.",
  },
  'vuln.ev.kev': {
    title: "Evidence · CISA KEV",
    what: "Whether this CVE is on CISA's Known Exploited Vulnerabilities catalogue — the US government's authoritative list of flaws being actively exploited in the wild right now.",
    where: "Checked against CISA's published KEV catalogue (pulled from CISA and cached). It's a yes / no on the CVE.",
    why: "KEV is the strongest single urgency signal there is. On the Analysis tab it acts as a floor — a KEV finding can't score below 80 / 100 — because a bug attackers are already using is never \"medium.\" Here it's \"Not listed\" (green).",
    misreading: "KEV is about the CVE globally, not your asset. \"Listed\" means \"attacked somewhere in the world,\" which raises priority everywhere — but whether it can be reached on THIS asset is still decided by exposure and vector.",
  },
  'vuln.ev.epss': {
    title: "Evidence · EPSS",
    what: "A percentage: the modelled probability this CVE will be exploited in the wild within the next 30 days. It answers \"how likely is this to actually be attacked soon?\"",
    where: "From FIRST.org's EPSS service (Exploit Prediction Scoring System), pulled via its public API and refreshed daily. It's a forward-looking model, not a fact about your asset.",
    why: "It separates the thousands of theoretical flaws from the few likely to be hit. It's 20% of the Analysis risk score and one of the four danger signals (it flips on at ≥ 10%). Here it's near zero, part of why the verdict is Unlikely.",
    misreading: "EPSS is a probability, not proof — a low EPSS doesn't mean \"impossible,\" and a high EPSS doesn't mean \"already exploited\" (that's what KEV is for). Read it as a forecast.",
  },
  'vuln.ev.patch': {
    title: "Evidence · Patch",
    what: "Whether a vendor fix (or official guidance) exists for this CVE — and, on the Remediation tab, what it is.",
    where: "From the patch-intel sync: vendor PSIRT advisories, Microsoft MSRC for Microsoft products, and CISA's KEV required-action guidance. Stored as patch references / remediation guidance on the finding.",
    why: "It's the difference between \"we can fix this properly\" and \"we can only apply a compensating control.\" Here \"None\" means no vendor patch is recorded yet, which is why the advice is to mitigate until one ships.",
    misreading: "\"None found\" doesn't always mean no fix exists in the world — it means none is recorded here yet. Running the Remediation tab's patch Sync can pull it in if the vendor has since published one.",
  },
  // source: v-hist-why
  'vuln.historyWhy': {
    title: "What this History tracks",
    what: "This is the finding's own complete, system-generated timeline — every status change, every score computation, every mitigation added, every plan approved — each with its actor and exact timestamp.",
    where: "Generated automatically by the system at the moment each tracked action occurs on this finding, the same principle as the asset-level History tab.",
    why: "An assessor rarely disputes that a finding was eventually fixed; they ask who decided each step, when, and on what basis. A workflow that changes state without recording those three things cannot answer that question convincingly, no matter how good the final outcome looks.",
    misreading: "Treat this tab as the tab an auditor opens first on any finding — it is usually the fastest way to sanity-check whether the story told elsewhere on this page (a calm \"Approved\" plan, a \"Partial\" retest) actually matches a coherent, traceable sequence of real decisions.",
  },
  // source: v-hist-actor
  'vuln.historyActor': {
    title: "Actor and timestamp on every row",
    what: "Every entry names who or what performed the action — a specific named person, or \"system\"/\"scoring-engine\" for automated steps — alongside the exact date it happened.",
    where: "",
    why: "A change with no named actor is unfalsifiable — nobody can be asked \"why did you do this\" about an action nobody is recorded as having taken. Naming the actor on every row is what keeps this finding's history genuinely accountable rather than merely descriptive.",
    misreading: "Distinguish system-generated rows (like the automatic priority computation) from human-generated ones (like a manual plan approval) — the former reflects the engine doing its job on schedule; the latter reflects a specific person's judgement call at a specific moment, and the two deserve different scrutiny.",
  },
  // source: v-hist-immutable
  'vuln.historyImmutable': {
    title: "Why History entries cannot be edited",
    what: "Once written, a History row on a finding is permanent — there is no edit button, no delete option, only new rows added over time as the finding moves through triage, mitigation and remediation.",
    where: "",
    why: "An audit trail that can be silently edited after the fact is not an audit trail — it is just a note that happens to have a timestamp. Immutability is what lets this finding's History be relied upon as evidence of exactly how it was handled, rather than merely as a convenience log someone could tidy up after the fact.",
    misreading: "If a History entry on a finding appears to be wrong (say, an incorrect actor was recorded due to a system bug), the correct response is a new, corrective entry explaining the discrepancy — never an edit to the original row, even if that were technically possible.",
  },
  // source: v-hist-example-link
  'vuln.historyExampleLink': {
    title: "Reading the linking and scoring events",
    what: "\"Status changed: New → Open (linked to this asset via CPE match)\" and \"Priority computed — floored by CISA KEV\" together record the exact moment this finding entered the active queue and exactly how its initial priority was determined.",
    where: "Both are system-generated, occurring automatically the moment the CPE match and the enrichment/scoring run completed.",
    why: "These two rows are the direct, dated evidence behind two claims made elsewhere on this page (the auto-linking mechanism described in the Software tab notes, and the KEV-floor mechanism described in the Analysis tab) — not abstract descriptions of how the system works, but the actual record of it happening, on this finding, on this date.",
    misreading: "Note that both events happened on the same day (Jul 8, 2026) — the system links and scores a newly matched finding immediately, not on some later delayed schedule, which is part of why same-day awareness of a new critical CVE is achievable at all.",
  },
  // source: v-hist-example-approve
  'vuln.historyExampleApprove': {
    title: "Reading the approval event",
    what: "\"Remediation plan approved (owner: Amara Okafor)\" on Jul 11, 2026 is the specific, dated record of the plan moving from drafted to formally accountable — the exact moment described abstractly in the Remediation tab's stage-gate notes.",
    where: "A human-triggered action, recorded the moment Liang Wei (the approver) completed the approval step.",
    why: "This single row is what would satisfy an auditor asking \"who authorised fixing this, and when\" — a plain, dated, named answer, rather than a verbal assurance that approval \"basically happened at some point.\"",
    misreading: "Notice the gap between this row (Jul 11) and the mitigation-added row three days earlier (Jul 9) — real, useful mitigation work started before formal plan approval completed, which is a realistic and reasonable sequence: urgent interim action does not have to wait for the full approval process to finish.",
  },
  // source: v-hist-auditor
  'vuln.historyAuditor': {
    title: "How an auditor reads this tab",
    what: "An assessor reviewing this specific finding will typically read straight down this list first, checking that the sequence of events (linked, scored, escalated, mitigated, approved, retested) is coherent and that every step names a real, accountable actor.",
    where: "",
    why: "A finding whose History reads as a clean, explicable sequence is far easier to defend in an audit than one where the current state (Approved plan, Partial retest) has to be taken purely on trust, with no visible trail of how it got there.",
    misreading: "If you are ever asked to defend how a specific finding was handled, lead with this tab rather than with the current-state summary elsewhere on the page — the timeline is what actually answers \"how do we know this was handled properly,\" not just \"what is true right now.\"",
  },
  // source: v-hist-example-mitigation
  'vuln.historyExampleMitigation': {
    title: "Reading the mitigation and assignment events",
    what: "\"Mitigation added: disable JNDI lookups (interim)\" on Jul 9, and \"Department assigned: Network Operations, SLA 7 days\" on Jul 10, record the two concrete actions taken in the two days between the finding first appearing and its remediation plan being formally approved.",
    where: "Both are human-triggered actions — Amara Okafor added the mitigation, Liang Wei made the department assignment — captured the moment each was completed.",
    why: "These two rows are the direct evidence that real, protective work was already underway before the more formal approval step happened on Jul 11 — a sequence worth being able to point to if anyone later asks \"what were we doing about this before it was officially approved?\"",
    misreading: "Read these two rows together with the approval row that follows them — the order (mitigate first, formally approve the fuller plan second) shows urgent interim action did not wait on the full approval process, which is a reasonable and defensible sequence, not a process violation.",
  },
  // source: v-notes-why
  'vuln.notesWhy': {
    title: "Why this tab exists, separately from History",
    what: "Notes on a finding capture the human reasoning behind a decision — judgement, context, and rationale — in a way the strictly factual, system-generated History tab is not designed to hold.",
    where: "Free-text entries, written manually by whoever is working the finding, at any point in its lifecycle.",
    why: "A decision like \"escalated straight to Network Ops the moment enrichment flagged KEV plus internet-facing\" is a human judgement call responding to several facts at once — it deserves to be recorded in the analyst's own words, not compressed into a structured field that was never designed to hold that kind of reasoning.",
    misreading: "Use Notes for the \"why we decided this\" that a bare status change can never fully capture — reserve structured fields and History for the \"what happened\" side of the record.",
  },
  // source: v-notes-vs-history
  'vuln.notesVsHistory': {
    title: "Notes versus History, on a finding specifically",
    what: "The same fact/reasoning distinction that applies on the asset-level Notes and History tabs applies here: History is what the system directly observed about this finding; Notes is what a person chose to write about it.",
    where: "",
    why: "Merging the two would mean losing the ability to tell \"the system computed this\" apart from \"a person judged this\" — a distinction that matters enormously the moment anyone has to defend a specific decision made about this finding.",
    misreading: "When reconstructing why this finding was handled the way it was, read History for the indisputable sequence of events and Notes for the human reasoning layered on top of it — together, not as substitutes for one another.",
  },
  // source: v-notes-example
  'vuln.notesExample': {
    title: "Reading the note on this finding",
    what: "Liang Wei's note explains that this finding was escalated straight to Network Ops the moment enrichment flagged CISA KEV plus internet-facing exposure together, and that the full upgrade is blocked until a maintenance window on Jul 26, with the interim mitigation holding in the meantime.",
    where: "Written manually, dated Jul 8, 2026 — the same day History shows the finding being linked and its priority first computed.",
    why: "This note captures precisely the reasoning a bare status field cannot: not just that the finding was escalated, but which two specific facts (KEV plus internet-facing) triggered the escalation decision, and what practical constraint (the maintenance window) explains why the fix is not instant.",
    misreading: "Compare the date on this note (Jul 8) against the plan-approval date in History (Jul 11) — the note explains the reasoning that preceded, and led to, the more formal approval action recorded a few days later.",
  },
  // source: v-notes-who
  'vuln.notesWho': {
    title: "Who writes notes on a finding",
    what: "Any user with access to work this finding can add a note; each is attributed to its author with a timestamp, the same as asset-level notes.",
    where: "",
    why: "Attribution matters here for the same reason it matters on assets: a note is a judgement call by a specific person, and knowing who made that call is often as important as the call itself when the decision is later reviewed.",
    misreading: "Write notes assuming a future reader — an auditor, a new team member, your own future self — will need the reasoning spelled out without any of the context you currently have in your head.",
  },
  // source: v-notes-audit
  'vuln.notesAudit': {
    title: "Notes in an audit context, on a finding",
    what: "A clear note trail on a Critical, KEV-listed finding like this one is often exactly what convinces an assessor that the organisation handled it deliberately and promptly, rather than merely getting lucky.",
    where: "",
    why: "Regulatory frameworks generally care less about whether an organisation has zero vulnerabilities (an unrealistic bar) and much more about whether it demonstrably reacts appropriately and quickly to serious ones — a documented note explaining a same-day escalation decision is strong evidence of exactly that.",
    misreading: "When a finding is this severe, treat writing a clear note explaining the response as part of finishing the triage step, not an optional afterthought — it is often the single piece of evidence that most directly answers an auditor's \"did you actually take this seriously\" question.",
  },
  // source: v-notes-freeform
  'vuln.notesFreeform': {
    title: "Why notes are free-form text, not a structured field",
    what: "Notes deliberately impose no structure beyond an author and a timestamp — no dropdowns, no required categories, just a sentence or paragraph in the author's own words.",
    where: "",
    why: "The reasoning behind a specific triage decision rarely fits neatly into a small set of predefined categories — forcing it to would either lose nuance or push people to pick the closest-enough category rather than actually explaining their thinking.",
    misreading: "Do not treat the lack of structure as license to write vaguely — a good note is still specific: what happened, why it mattered, and what decision it led to, exactly as the example on this finding does.",
  },
};
