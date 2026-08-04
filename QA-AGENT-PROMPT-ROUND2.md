# Compliverse — QA Sweep Round 2: Propagation & Risk Posture

Paste everything below the line into the Claude Chrome extension, with the app open and already signed in.

---

You are an experienced QA engineer doing a second acceptance pass on a GRC product called **Compliverse** at `http://complyverse.localhost:3000`. I built it. A first pass already found and fixed several bugs; this round targets a different question.

**The single question this round must answer: when a value changes in one place, does every place that depends on it actually change too — and do they all agree on the new number?**

The scoring layer was heavily modified in the last hour and **nobody has clicked through it since**. Treat every number as guilty until proven consistent.

## Access

The session should already be signed in. **Do not log in and do not type any password.** If you hit a login screen, stop and tell me.

Start at `http://complyverse.localhost:3000/risk-posture`.

## Ground rules

- Local dev database — create, edit and submit freely.
- **Log every change you make** (record, field, old value → new value) so I can reset.
- Do not delete pre-existing records. Removing your own test rows is fine.
- When a number disagrees across two screens, capture **both** screens and the exact figures.
- If a page hangs or errors, capture console + network before moving on.

## Mission 1 — Business impact inputs, end to end

On `/risk-posture/asset/{id}` there is a **"Business impact & scoring inputs"** panel: Customer-facing, Internet-facing, Regulated data, Operational dependency, and C/I/A sliders, with a **Live preview** showing "Current asset risk" vs "After your changes".

For each input, one at a time:

1. Note the **current** score, band, and data-quality figure.
2. Change the input and read the **Live preview** "after" number *before* saving.
3. Save. Read the score again.
4. **Does the saved result equal what the preview promised?** If not, that is a finding — quote both numbers.
5. Reload the page. Is the value still there, and the score still the same?

Then repeat one of the changes **a second and third time** (set it, save, set it back, save, set it again). I specifically want to know whether repeated updates drift — whether the score creeps, or the stored value and the recomputed value diverge. Record the score after every single save.

## Mission 2 — Does it reach the other pages?

This is the core of the round. For each change below, record the value on **every** listed page before and after.

| Change this | Then check it landed on |
|---|---|
| Business impact / op-dependency on an asset | risk-posture asset page · risk-posture dashboard row · **asset detail page** (`/assets/{id}`) Overview + Risk & Controls |
| C/I/A ratings | risk-posture asset page · asset detail Risk & Controls (CIA card) · the asset's **data quality** figure |
| Asset criticality | asset detail · risk-posture · **the priority score of every vulnerability linked to that asset** |
| Internet-facing on/off | asset detail · risk posture · linked vulnerability's **Analysis** score breakdown · its **Exploit Test** verdict |
| Link / unlink a control | asset Overview coverage % · asset Risk & Controls coverage bar · risk-posture ctrl dimension |
| Link / unlink a vulnerability | asset "Open Findings" · asset Vulnerabilities tab badge · risk-posture vuln dimension · the vulnerability register count |
| Close a finding (Verify, or Accept Risk) | vulnerability register open count · asset Open Findings · asset posture score |

For every row, answer plainly: **did it propagate, yes or no** — and if two pages show different numbers for the same concept, lead with that.

## Mission 3 — Verify the specific fixes just made

Each of these was changed in the last hour. Confirm independently:

1. **Band colours.** Pills on `/risk-posture` and the asset page should be colour-coded (green *contained*, amber *watch*, orange *elevated*, red *severe*). They were all grey. Are any still grey?
2. **Dashboard must not write on read.** Load `/risk-posture`, leave it open ~90 seconds (it polls every 30s). Nothing about the data should change on its own. Report any value that shifts while you are not interacting.
3. **Preview must not save.** Open the business-impact panel, change several toggles, watch the Live preview update, then **Cancel / close without saving** and reload. Did anything persist? Nothing should have.
4. **Empty estate.** If any tenant/filter shows zero scored assets, the gauge should read **—**, not a green 0.
5. **Borrowed CIS.** Asset "Windows MSRPC @ 127.0.0.1" previously inherited a CIS score from unrelated assets sharing `127.0.0.1`. It should now show CIS as **not known / not scanned**, and must not display a 1.000 gap.
6. **CIA honesty.** An asset with no explicitly-set C/I/A should now count CIA as *not* known — its data-quality figure should be lower than before. Asset 51 went from 70% to 45%.
7. **PII multiplier** should read **1.4×** in the Regulated-data options (it said 1.3× while the scorer used 1.4×).
8. **"Ignore EPSS + KEV"** should say it affects **ranking only**. Confirm the Effective scores genuinely do not change when it is toggled — if any score changes, the new label is now the lie.
9. **EPSS.** In the vulnerability register/preview, EPSS should show the **probability** (e.g. 0.5%), with percentile clearly labelled as percentile. A single "EPSS 37%" with no percentile wording is the old bug.
10. **Attest & close** with an empty evidence box should now show a message telling you what is required — not silently do nothing.

## Context — do not report these as bugs

- Demo CVEs `CVE-2024-2001`–`2015` are **synthetic** and absent from NVD. No patch data and no CVSS vector for them is correct.
- Exploit counts were just corrected downward (most are now 0–1, previously 208–623). **That is the fix, not a regression** — the old numbers counted CVE catalogues as exploits.
- Applying a remediation fix runs a **simulated executor by design**. Clear labelling is correct; implying a real patch was installed is a bug.
- Seed data has **no control links and no asset relationships**, so coverage starts at 0% and blast radius is empty until you create some.

Known and already logged — no need to re-report: no DB migrations; CIS pass-rate is computed two different ways on the asset page; the IP-group blend is implemented twice; there is no panel for the Risk dimension; `external_feeds.py` is dead code; the "Reopen" button reportedly renders without a visible label (I could not reproduce it from source — if you see it, capture a screenshot and the computed CSS).

## Bug priority

1. **Two screens showing different values for the same thing.**
2. **A change that does not propagate** where the product implies it should.
3. **A claim the system cannot support** — text asserting something was verified, applied or measured when nothing checked it.
4. A write that silently does not persist.
5. An action with no feedback.
6. Dead ends and duplicated UI.
7. Cosmetics.

## Report

1. **Verdict** — one paragraph. Do the numbers hang together well enough to trust?
2. **Propagation matrix** — the Mission 2 table, filled in: change → each page → before → after → propagated y/n.
3. **Disagreements** — every place two screens showed different values for one concept. This is the section I care most about.
4. **Fix verification** — the ten items in Mission 3, each pass/fail with evidence.
5. **Repeat-update behaviour** — did scores stay stable across repeated saves, or drift?
6. **Findings table** — severity, page, steps, expected, actual, reproducible.
7. **Data you created.**
8. **What you could not test, and why.**

Quote exact on-screen text and record IDs. "The score looks wrong" is useless; "Asset 44 showed 39/100 on risk-posture and 52/100 on the asset page at the same time" is actionable. Do not soften anything — I would rather hear it now.
