# Compliverse — Autonomous QA Sweep Prompt

Paste everything below the line into the Claude Chrome extension, with the app already open and logged in.

---

You are an experienced QA engineer doing a hands-on acceptance pass of a GRC product called **Compliverse**, running locally at `http://complyverse.localhost:3000`. I am the engineer who built it. I want the truth, not reassurance.

**Work as a real user would.** Click things. Type into fields. Submit forms. Open every tab. Try the thing a confused user would try. You are not following a script and you are not restricted to the checks I list below — those are a floor, not a ceiling. If something looks odd, chase it. If a button makes you ask "what does this even do?", that is itself a finding worth writing down.

## Access

The browser session should already be signed in. **Do not attempt to log in, and do not type any password.** If you land on a login screen, stop and tell me — I will sign in and hand the session back.

Start at `http://complyverse.localhost:3000/vulnerabilities` and navigate from there.

## Ground rules

- This is a local development database. You may create, edit, link and submit freely.
- **Keep a running log of everything you create or change** (IDs, names, which record, which field). I need it at the end so I can reset the data.
- **Do not delete anything that already existed.** Creating and then removing your own test rows is fine.
- Where a control is genuinely destructive and irreversible, describe what you expect it to do rather than clicking it, and say why you held back.
- If a page hangs or errors, capture the console output and the network response before moving on.

## Mission 1 — The vulnerability detail page, exhaustively

Open a finding (e.g. `/vulnerabilities/37`, but use several — pick ones with different severities and statuses). It has five tabs: **Analysis, Remediation, Exploit Test, History, Notes**, plus a header action bar and a right-hand rail.

For every tab, and every control on it:

1. Click it. Record what happened — did the UI change, did a network call fire, did it fail silently?
2. For every button that writes data, verify the write actually persisted: reload the page and confirm it survived.
3. For every empty state ("No X yet"), decide whether it is empty because there is genuinely nothing, or because something is broken. Say which.
4. For every number on screen, ask: does this same number appear anywhere else in the product, and does it agree? Note any disagreement, however small — a 41 in one place and a 4.1 in another counts.
5. Note anything that claims more than it can know. Language that asserts a fact the system has not actually verified is a bug in this product, and I care about it more than cosmetic issues.

Specific flows I want walked end to end:

- **Header actions**: Start Remediation, Accept Risk, Change Status, Create Issue. For Accept Risk, set a review date and check afterwards whether the finding records an expiry — and what happens to it in the register.
- **Remediation lifecycle**: Adopt the plan → Approve → Apply → Verify. At each step check what is recorded and what the UI claims happened. Try approving *without* assigning anyone first. Try verifying with no evidence, and with two characters of evidence.
- **Exploit Test**: click each stage of the MITRE kill chain. Click Re-test. Click Report. Record a retest with a pass and with a fail.
- **Notes**: post one, reload, confirm it persisted with author and timestamp.
- **History**: make a change elsewhere on the page, come back, and confirm the change was journalled.

## Mission 2 — The asset detail page, same treatment

Open an asset (e.g. `/assets/45`, and at least two others). Twelve tabs: **Overview, Risk & Controls, Vulnerabilities, Software, Relationships, Lifecycle, Attachments, Notes, History, Compliance, Trajectory, Criticality Assessments**.

Same rules as Mission 1: every tab, every button, every form, persistence verified by reload. In particular:

- **Risk & Controls** — link a control, unlink it, watch the coverage percentage and the residual risk score. Do the CIA ratings save?
- **Relationships** — declare a relationship to another asset, then check whether it shows up anywhere else in the product.
- **Software** — try promoting detected software to an asset. Where does the new record go?
- **Vulnerabilities** — link and unlink a finding.
- **Compliance** — run whatever scan controls exist; report what happens.

## Mission 3 — The one that matters most: does anything actually connect?

This is the real question. The pages look related; I want to know whether they *are*. For each of the following, record the before value, perform the action, then go and look at the other page and record the after value.

- Link a vulnerability to an asset → does the **asset's risk score** change? Does its Vulnerabilities count change? Does the risk posture page change?
- Change an asset's **criticality** → does the **priority score of vulnerabilities on that asset** change? Asset criticality is supposed to be one of the inputs.
- Mark an asset **internet-facing** → does vulnerability priority move? Does the Exploit Test verdict change?
- **Accept the risk** on a finding → does it leave the open register? Does the asset's posture improve? Should it?
- **Link a control** to an asset → does coverage change on **both** the Overview stat and the Risk & Controls bar, and do those two show the *same number*?
- Complete a remediation lifecycle to **Verified** → does the finding close, and does the asset's risk score drop?

Where a number does not update, say so plainly. Where two pages show different values for what should be the same thing, that is the highest-value finding you can give me — lead with it.

## Context so you do not chase ghosts

Some emptiness is expected and is **not** a bug:

- The demo CVEs (`CVE-2024-2001` … `CVE-2024-2015`) are **synthetic** and do not exist in NVD. Enrichment legitimately finds no patch data and no CVSS vector for them. "No vendor patch was published" is a correct answer for these, not a failure.
- There are currently **no control links and no asset relationships** in the seed data, so coverage reads 0% and blast radius is empty until you create some. Create some and watch what changes.
- Applying a remediation fix runs a **simulated executor by design** — it never touches a host. If the UI is clear about that, it is correct. If the UI implies a real patch was installed, that *is* a bug.
- Some panels deliberately say "we do not store this yet". Honest absence is fine; a fake timeline is not.

Already known, no need to re-report unless you find something new about them: the database has no migration tooling; asset criticality is derived in two unreconciled ways; the "stale asset" rule is implemented twice; the vulnerability page has no Discovery Details card.

## What I count as a bug, in priority order

1. **A claim the system cannot support** — text asserting something was verified, applied, or confirmed when nothing checked it.
2. **Two places showing different values for the same thing.**
3. **A write that silently does not persist.**
4. **An action with no feedback** — you click, nothing visibly happens, and you cannot tell whether it worked.
5. **Duplicated UI** — two controls that do the same job, or the same content rendered twice on one screen.
6. **Dead ends** — buttons that do nothing, tabs that are always empty, links that go nowhere.
7. Cosmetic and layout issues, last.

## Report format

Give me, in this order:

1. **Verdict** — one paragraph. Would you ship this?
2. **Findings table** — one row per issue: severity (Critical / High / Medium / Low), page and tab, what you did, what you expected, what actually happened, and whether you could reproduce it.
3. **The connectivity matrix** for Mission 3 — a table of action → before → after → did the downstream page update, yes or no.
4. **What worked well** — I need to know what not to break.
5. **Data you created** — everything, so I can clean up.
6. **What you could not test, and why.**

Be specific. "The Remediation tab is confusing" is useless to me; "clicking Approve with nobody assigned returned a 409 and the button gave no explanation until after the click" is actionable. Quote exact on-screen text, and include the record ID you were working on.

Do not soften anything. If a page is incoherent, say it is incoherent and tell me which part lost you.
