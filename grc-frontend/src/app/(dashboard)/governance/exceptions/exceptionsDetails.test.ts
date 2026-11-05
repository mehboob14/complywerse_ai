// node --test "src/app/(dashboard)/governance/exceptions/exceptionsDetails.test.ts"
// What the exception details promise and a screenshot cannot hold for long (source-text tests, like exceptionsPage.test.ts), D62: the drawer keeps its props and is made of
// panels that read and write what they need; every write is reported by useReportedMutation and goes to its own endpoint; AI runs only when its button is pressed and
// saves nothing until Add; the server's sentences are shown as they are (and not made up here); Approve waits for the person's own assessment but Reject and Ask for changes
// do not; Mark implemented asks the server's question before it forces anything; no id or model name is ever drawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const dir = new URL('./', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, dir), 'utf8');
const PANELS = ['_RisksPanel.tsx', '_ControlsPanel.tsx', '_AssetsPanel.tsx', '_ImplementationPanel.tsx', '_assistReview.tsx'];
const MINE = ['_ExceptionDetails.tsx', '_ApprovalPanel.tsx', '_Decision.tsx', ...PANELS];
const src = Object.fromEntries([...MINE, '_approval.ts', '_riskText.ts'].map((f) => [f, read(f)])) as Record<string, string>;
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');                    // the files' own comments say what the screens must not (the server's sentences, for one)
const all = MINE.map((f) => code(src[f])).join('\n');
const panels = PANELS.map((f) => code(src[f])).join('\n');

test('the drawer keeps the props the page passes and is made of the panels, in the order a person reads them', () => {
  const d = src['_ExceptionDetails.tsx'];
  assert.match(d, /export function ExceptionDetailsDrawer\(\{ exception: e, onClose, onDecide, onWithdraw, withdrawing \}: \{/);
  assert.match(d, /exception: ExceptionItem;\s*onClose: \(\) => void;[\s\S]*?onDecide: \(kind: Exclude<DecisionKind, 'revoke'>\) => void;\s*onWithdraw: \(\) => void;\s*withdrawing: boolean;/);
  const at = (needle: string) => { const i = d.indexOf(needle); assert.ok(i > 0, needle); return i; };
  const places = ['<AssetsPanel exception={e} />', '<RisksPanel', '<ApprovalPanel exception={e}', '{!e.implementation?.my_turn && implementation}', '<MessageSquare aria-hidden'].map(at);
  assert.deepEqual([...places].sort((a, b) => a - b), places, 'assets, then the potential risks, then the approval, then the implementation, then the comments');
  assert.match(d, /<ImplementationPanel exception=\{e\}>\s*<ControlsPanel exception=\{e\} \/>\s*<\/ImplementationPanel>/);
  assert.match(d, /\{e\.implementation\?\.my_turn && implementation\}/);              // the people asked to implement it find it first
  assert.match(d, /\{e\.approval && \(\s*<ApprovalPanel exception=\{e\} approval=\{e\.approval\}/);
});

test('the header says the status and, once approved under a rule with an implementer, where the implementation stands; the business impact sits next to the justification', () => {
  const d = src['_ExceptionDetails.tsx'];
  assert.match(d, /const stateOfImplementation = impl && e\.status === 'approved' \? impl : null;/);
  assert.match(d, /<span role="group" aria-label=\{statusLine\(e\.status, stateOfImplementation\)\}/);                    // read out as "Approved · Waiting for compensating controls"
  assert.match(d, /\{stateOfImplementation && <StatusPill tone=\{implementationTone\(stateOfImplementation\.state\)\} label=\{implementationWord\(stateOfImplementation\.state\)\} \/>\}/);
  assert.match(d, /<Heading>Justification<\/Heading><RichText value=\{e\.justification\} \/>/);
  assert.match(d, /<Heading>Business impact<\/Heading><RichText value=\{e\.business_impact\} \/>/);
  assert.match(d, /<Fact label="Document">/);
  assert.doesNotMatch(d, /<Fact label="Policy">/);                                      // an exception can be about a standard, a procedure, a guideline
  assert.match(d, /\{e\.document_type && <span className=\{KIND\}>\{statusLabel\(e\.document_type\)\}<\/span>\}/);       // what kind it is: a chip, as on the page
  assert.match(d, /<Fact label="Unit">/);                                               // the page's words: Unit (not Department), Document (not Policy), "From the document"
  assert.doesNotMatch(d, /<Fact label="Department">|From the policy/);
  assert.match(d, /<Muted> · From the document<\/Muted>/);
});

test('the requester\'s own two long texts are read-only notes, shown only when there is something in them, with an (i) saying who wrote them and when', () => {
  const d = src['_ExceptionDetails.tsx'];
  assert.match(d, /const hasNotes = Boolean\(cleanText\(e\.risk_assessment\) \|\| cleanText\(e\.compensating_controls\)\);/);
  assert.match(d, /\{hasNotes && \(/);
  assert.match(d, /\{"Requester's notes"\}/);
  assert.match(d, /Written by the requester before the people asked recorded their own potential risks and compensating controls\./);
  assert.doesNotMatch(d, /<(textarea|input)\b|<Textarea|<TextInput[^>]*risk_assessment/);                       // nothing here edits them
});

test('no file of the details uses a class the platform CSS rewrites, a hex colour, a bare form control or a native dialog (kit rules)', () => {
  for (const f of MINE) {
    assert.deepEqual(findViolations(src[f]), [], f);
    assert.doesNotMatch(src[f], /#[0-9a-fA-F]{6}\b/, `${f}: colours are the --ds tokens and the status tones`);
    assert.doesNotMatch(src[f], /<(select|textarea|input)\b/, `${f}: the kit's Select, Textarea, TextInput and Checkbox`);
    assert.doesNotMatch(src[f], /window\.(confirm|alert|prompt)\(|(?<![.\w])(alert|prompt)\(/, f);
  }
  for (const f of ['_RisksPanel.tsx', '_ControlsPanel.tsx', '_AssetsPanel.tsx', '_ImplementationPanel.tsx', '_assistReview.tsx', '_ApprovalPanel.tsx']) {
    assert.equal((src[f].match(/<button\b/g) ?? []).length, 0, `${f}: Button, IconButton or Menu`);
  }
  assert.match(panels, /useConfirm\(\)/);
});

test('the new panels name every long text: a bare <p>, <h2> or <h3> carries a size of the type scale (the platform CSS gives a bare one 11.5px)', () => {
  for (const f of PANELS) {
    for (const tag of src[f].match(/<(?:p|h2|h3)\b[^>]*>/g) ?? []) assert.match(tag, /text-ds-(?:title|section|body|label)/, `${f}: ${tag}`);
  }
});

test('all the writes are reported by useReportedMutation, each to its own endpoint, and each refreshes what a change refreshes', () => {
  assert.doesNotMatch(all, /\buseMutation\(/);
  const expected: Record<string, string[]> = {
    '_RisksPanel.tsx': ['addRisk', 'updateRisk', 'deleteRisk', 'linkRisk'],
    '_assistReview.tsx': ['addRisk'],
    '_ControlsPanel.tsx': ['addControl', 'updateControl', 'deleteControl'],
    '_ImplementationPanel.tsx': ['completeImplementation'],
    '_AssetsPanel.tsx': ['addAssets', 'removeAsset'],
  };
  for (const [f, calls] of Object.entries(expected)) {
    for (const call of calls) assert.match(src[f], new RegExp(`policyExceptionApi\\.${call}\\(`), `${f}: ${call}`);
  }
  assert.equal((panels.match(/useReportedMutation\(\{/g) ?? []).length, 11);          // risks: link, record, change, remove | AI risk | controls: save, remove, AI control | mark implemented | assets: add, remove
  assert.equal((panels.match(/failure: /g) ?? []).length, 11);
  assert.equal((panels.match(/invalidate: /g) ?? []).length, 11);
  assert.doesNotMatch(panels, /invalidate: \[risksKey|invalidate: \[controlsKey/);   // LIST_KEYS starts with 'policy-exceptions': the open exception, its Approve button and every list follow
  assert.equal((panels.match(/invalidate: LIST_KEYS/g) ?? []).length, 10);
  assert.match(src['_ImplementationPanel.tsx'], /invalidate: \[\.\.\.LIST_KEYS, \['exception-comments'\]\]/);            // marking it implemented writes a line into the comments
  assert.doesNotMatch(panels, /\btoast\(/);
  const types = read('_types.ts');
  assert.match(types, /LIST_KEYS: ReadonlyArray<readonly unknown\[\]> = \[\['policy-exceptions'\]/);
  assert.match(types, /risksKey = \(id: number\) => \['policy-exceptions', 'risks', id\]/);
  assert.match(types, /controlsKey = \(id: number\) => \['policy-exceptions', 'controls', id\]/);
});

test('the panels read with the contract\'s keys; a failed read says so with Retry and is never replaced by anything else', () => {
  assert.match(src['_RisksPanel.tsx'], /queryKey: risksKey\(e\.id\),\s*queryFn: async \(\) => \(await policyExceptionApi\.getRisks\(e\.id\)\)\.data as RisksAnswer/);
  assert.match(src['_ControlsPanel.tsx'], /queryKey: controlsKey\(e\.id\),\s*queryFn: async \(\) => \(await policyExceptionApi\.getControls\(e\.id\)\)\.data as ControlsAnswer/);
  assert.match(src['_ControlsPanel.tsx'], /queryKey: risksKey\(e\.id\)/);               // the same request as the Potential risks panel: titles for the controls
  assert.match(src['_RisksPanel.tsx'], /Couldn't load the potential risks/);
  assert.match(src['_ControlsPanel.tsx'], /Couldn't load the compensating controls/);
  assert.match(src['_AssetsPanel.tsx'], /Couldn't load the assets/);
  assert.match(panels, /retry: \(n, err\) => n < 2 && canRetry\(err\)/);                // a refusal (403) is not tried again
  assert.match(panels, /SkeletonLines/);
  assert.match(src['_AssetsPanel.tsx'], /enabled: adding,/);                            // the organisation's assets are read only once "Add assets" is pressed
  assert.match(src['_AssetsPanel.tsx'], /queryKey: \['assets-for-exception-link'\]/);   // the form's own entry
  assert.match(src['_RisksPanel.tsx'], /enabled: turn !== null && hasPermission\('erm:risks:view'\),/);         // the scales are read only for the person who records, and who may read them
});

test('AI runs only when its button is pressed and saves nothing until Add: no effect or query starts it, and a suggestion is added as AI-suggested', () => {
  const a = src['_assistReview.tsx'];
  assert.doesNotMatch(a, /useEffect|useQuery|useLayoutEffect/);
  assert.match(a, /policyExceptionApi\.aiRisks\(exceptionId\)/);
  assert.match(a, /<Button leftIcon=\{<Sparkles aria-hidden \/>\} loading=\{run\.status === 'loading'\} onClick=\{\(\) => \{ setAdded\(\[\]\); void ask\(\); \}\}>Suggest risks<\/Button>/);
  assert.match(a, /likelihood: suggestion\.likelihood, impact: suggestion\.impact, source: 'ai'/);
  const c = src['_ControlsPanel.tsx'];
  assert.match(c, /useAiRun<AiControlsAnswer>\(\(\) => policyExceptionApi\.aiControls\(e\.id\)\)/);
  assert.match(c, /risk_ids: suggestion\.risk_ids, asset_ids: suggestion\.asset_ids, source: 'ai'/);
  assert.match(c, /void ai\.ask\(\); \}\}>Suggest controls<\/Button>/);
  assert.equal((panels.match(/policyExceptionApi\.ai(?:Risks|Controls)\(/g) ?? []).length, 2);               // and only inside useAiRun, which only `ask` starts
  assert.equal((panels.match(/useAiRun<\w+>\(\(\) => policyExceptionApi\.ai(?:Risks|Controls)\(/g) ?? []).length, 2);
  assert.match(a, /ErrorState compact title="Couldn't get suggestions" message=\{errorMessage\(run\.error\)\}/);       // the server's sentence (503: not configured), never a made-up draft
  assert.doesNotMatch(panels, /AI is not available|could not be used|could not answer/);      // those sentences are the server's
});

test('the person asked is told what they may do by the server: my_turn for the form, can_edit for a risk, can_complete and my_turn for the implementer; never a guess from a role', () => {
  for (const f of MINE.filter((name) => name !== '_RisksPanel.tsx')) assert.doesNotMatch(code(src[f]), /hasPermission|usePermissions/, f);
  // the one place a right is read: the Risk Management module's own lists (the register for the link, the scales for the level names), which the server gives to its readers only
  assert.deepEqual(code(src['_RisksPanel.tsx']).match(/hasPermission\('[^']+'\)/g), ["hasPermission('risks:risk_register:view')", "hasPermission('erm:risks:view')"]);
  assert.match(src['_RisksPanel.tsx'], /\{canLink && <IconButton label=\{`\$\{r\.register_risk_id !== null \? 'Change register link' : 'Link to risk register'\}: \$\{what\}`\}/);
  assert.match(src['_RisksPanel.tsx'], /\{turn && <Assessment /);
  assert.match(src['_RisksPanel.tsx'], /\{r\.can_edit && \(/);
  assert.match(src['_ControlsPanel.tsx'], /const canEdit = Boolean\(impl\?\.my_turn\);/);
  assert.match(src['_ControlsPanel.tsx'], /\{c\.can_edit && \(/);
  assert.match(src['_ImplementationPanel.tsx'], /\{impl\.can_complete && \(/);
  assert.match(src['_AssetsPanel.tsx'], /\{e\.can_add_assets && !adding && /);
  assert.match(src['_AssetsPanel.tsx'], /\{a\.can_remove && \(/);
  assert.match(src['_RisksPanel.tsx'], /\{!mine\.recorded && \(\s*<Button[\s\S]*?>None identified<\/Button>/);          // once something is recorded, "none identified" would be refused (409)
});

test('Approve waits for the person\'s own assessment; Ask for changes and Reject do not; the same in the decision dialog; the hint says why', () => {
  const p = src['_ApprovalPanel.tsx'];
  assert.match(p, /const gated = options\.includes\('approve'\) && approveBlocked\(a\.my_step\);/);
  assert.match(p, /<Button variant="primary" leftIcon=\{<Check aria-hidden \/>\} disabled=\{gated\} aria-describedby=\{gated \? gateId : undefined\} onClick=\{\(\) => onDecide\('approve'\)\}>Approve<\/Button>/);
  assert.doesNotMatch(p, /onDecide\('changes'\)\}[^]*?disabled=\{gated\}|disabled=\{gated\}[^>]*onDecide\('(?:changes|reject)'\)/);
  assert.match(p, /\{gated && <p id=\{gateId\} className="w-full text-ds-label text-ds-fg-muted">\{APPROVE_HINT\}<\/p>\}/);
  const d = src['_Decision.tsx'];
  assert.match(d, /const blocked = kind === 'approve' && approveBlockedFor\(exception\);/);
  assert.match(d, /const missing = \(d\.required && !text\.trim\(\)\) \|\| blocked;/);
  assert.match(d, /\{blocked && <p className="mt-\[8px\] text-ds-label text-ds-fg-muted">\{APPROVE_HINT\}<\/p>\}/);
  assert.match(src['_approval.ts'], /APPROVE_HINT = 'Record a potential risk, or none identified, to approve\.'/);
  assert.doesNotMatch(src['_approval.ts'], /Record at least one potential risk/);       // the server's own sentence is the server's
});

test('Mark implemented asks the server first: its 400 is shown as it is, its 409 question is asked in a box of its own, and confirm_uncovered is sent only on a yes', () => {
  const m = code(src['_ImplementationPanel.tsx']);
  assert.match(m, /policyExceptionApi\.completeImplementation\(exception\.id, \{ note: v\.note \|\| undefined, \.\.\.\(v\.anyway \? \{ confirm_uncovered: true \} : \{\}\) \}\)/);
  assert.equal((m.match(/confirm_uncovered/g) ?? []).length, 1);
  assert.match(m, /const question = uncoveredQuestion\(error\);\s*if \(question === null\) \{ setProblem\(errorMessage\(error\)\); return; \}/);
  assert.match(m, /void askAnyway\(question, v\.note\);/);
  assert.match(m, /if \(await confirm\(\{ title: 'Some risks are not covered', message: question, confirmLabel: 'Mark implemented anyway' \}\)\) complete\.mutate\(\{ note, anyway: true \}\);/);
  assert.doesNotMatch(m, /(?<!await )(?<![.\w])confirm\(/);                              // the kit's question is always awaited (the page test reads any other confirm( as a native one)
  assert.match(m, /toast: 'success',/);                                                   // a refusal is said in the dialog or asked, not also toasted
  assert.match(m, /\{problem && <Notice tone="danger">\{problem\}<\/Notice>\}/);
  assert.doesNotMatch(all, /Record at least one compensating control|Say what could go wrong\.|Say what the control is\.|no compensating control:/);       // the server's sentences are the server's
  assert.match(src['_riskText.ts'], /implemented anyway\\\?\$/);
});

test('a control\'s evidence: a link opens in a new tab (and only a web address is a link), a library item is shown by name; the covers are titles and names', () => {
  const c = src['_ControlsPanel.tsx'];
  assert.match(c, /target="_blank" rel="noopener noreferrer"/);
  assert.match(c, /ev\.kind === 'link' && !\/\^https\?:\\\/\\\/\/i\.test\(ev\.url\)\) return <span>\{ev\.label\}<\/span>;/);
  assert.match(c, /`\/evidence\/\$\{ev\.evidence_id\}`/);
  assert.match(c, /coverNames\(c, risks, assets\)/);
  assert.match(c, /<Notice tone=\{implementationOpen\(impl\) \? 'warning' : 'info'\} title="Not covered yet">/);
  assert.match(c, /assetsApi\.getTenantUsers\(\)/);                                          // the owner picker: the call the assets pages use
  assert.match(c, /evidenceApi\.getAll\(\)/);                                                // the Evidence library
});

test('nothing here draws a number a person cannot use, and nothing says a model or a vendor (UX rule U1, and "AI" only)', () => {
  assert.doesNotMatch(all, /#\{|User #|Policy #|Risk #|Asset #|Control #/);
  assert.doesNotMatch(all, />\s*\{[^}<>]*\b(?:\w+_id|\w+\.id|asset_id|evidence_id)\b[^}<>]*\}\s*</, 'an id is never the visible text of an element');
  assert.doesNotMatch(all, /\b(?:openai|gpt[-\w.]*|claude|anthropic|chatgpt)\b/i);
  assert.doesNotMatch(all, /\b(?:hash|fingerprint|checksum|sha-?256|uuid|stack ?trace)\b/i);
  assert.match(panels, /Suggest risks/);
  assert.match(panels, /Suggest controls/);
});

test('dates go through the helpers that keep a day a day, and the text diet holds: no sentence under a title, explanations are (i) notes', () => {
  assert.doesNotMatch(all, /toLocale(Date|Time)?String|new Date\(|toISOString|Intl\.DateTimeFormat/);
  assert.match(src['_riskText.ts'], /formatDate\(c\.due_date, \{ calendar: true \}\)/);
  assert.match(src['_approval.ts'], /formatDate\(impl\.due_at\)/);
  for (const f of ['_ExceptionDetails.tsx', '_RisksPanel.tsx', '_ControlsPanel.tsx', '_ImplementationPanel.tsx', '_assistReview.tsx']) assert.match(src[f], /<InfoTip /, f);
});

test('typed input is not lost by accident: the drawer asks before it is closed over a risk or a comment that was typed, and the dialogs ask over theirs', () => {
  const d = src['_ExceptionDetails.tsx'];
  assert.match(d, /dirty=\{riskTyped \|\| newComment\.trim\(\) !== ''\}/);
  assert.match(d, /onDirty=\{setRiskTyped\}/);
  assert.match(src['_RisksPanel.tsx'], /const changeDraft = \(next: RiskDraft\) => \{ setDraft\(next\); onDirty\?\.\(riskDraftTouched\(next\)\); \};/);
  assert.match(src['_ControlsPanel.tsx'], /dirty=\{controlFormTouched\(f, initial\)\}/);
  assert.match(src['_ImplementationPanel.tsx'], /dirty=\{note\.trim\(\) !== ''\}/);
});

test('the potential risks: the register link is a button that opens the register in a new tab, a risk is changed or taken back only by its author while the step is open, and the choice of register entry is read when asked', () => {
  const r = src['_RisksPanel.tsx'];
  assert.match(r, /href=\{`\/erm\/risks\/\$\{r\.register_risk_id\}`\} target="_blank" rel="noopener noreferrer" variant="link"/);
  assert.match(r, /queryKey: \['risk-register-for-exception-link'\]/);
  assert.match(r, /risksApi\.getAll\(\)/);
  assert.match(r, /\{linking && <LinkDialog key=\{linking\.id\}/);                      // the register is read only once the dialog is open
  assert.match(r, /confirm\(\{ title: 'Remove this risk\?'/);
  assert.match(r, /const \{ current, earlier \} = groupRisks\(risks, currentRound\(risks, e\.approval\?\.round\)\);/);       // an implementer is not shown the approval: the round comes from the rows then
  assert.match(src['_ControlsPanel.tsx'], /coverableRisks\(risks, currentRound\(risks, e\.approval\?\.round\)\)/);
  assert.match(r, /aria-expanded=\{earlierOpen\}/);                                     // earlier rounds are folded away
  assert.match(r, /hidden=\{!earlierOpen\}/);
});

test('the assets: the list is the exception\'s own (asset_links), everyone reads it, and the person the server lets adds and removes', () => {
  const a = src['_AssetsPanel.tsx'];
  assert.match(a, /const links = e\.asset_links \?\? \[\];/);
  assert.match(a, /addedLine\(a\)/);
  assert.match(a, /policyExceptionApi\.addAssets\(e\.id, ids\)/);
  assert.match(a, /policyExceptionApi\.removeAsset\(e\.id, a\.asset_id\)/);
  assert.match(a, /filter\(\(a\) => !onList\.has\(a\.id\)\)/);                            // what is already on the list is not offered again
});

test('a screen reader can tell the buttons apart: a row\'s buttons and each suggestion\'s Add name the row, and a group of risks is not a second landmark', () => {
  const r = src['_RisksPanel.tsx'];
  assert.match(r, /<IconButton label=\{`Edit risk: \$\{what\}`\}/);
  assert.match(r, /<IconButton label=\{`Remove risk: \$\{what\}`\}/);
  assert.match(r, /<div key=\{g\.key\} role="group" aria-label=\{`Recorded at \$\{g\.title\}`\}/);
  assert.doesNotMatch(r, /<section key=/);                                                          // two regions called "Approval" (a step's risks, the approval card) are one too many
  assert.match(src['_ControlsPanel.tsx'], /<IconButton label=\{`Edit control: \$\{truncate\(c\.title, 50\)\.text\}`\}/);
  assert.match(src['_ControlsPanel.tsx'], /<IconButton label=\{`Remove control: \$\{truncate\(c\.title, 50\)\.text\}`\}/);
  assert.match(src['_ControlsPanel.tsx'], /aria-label=\{`\$\{done \? 'Added' : 'Add control'\}: \$\{truncate\(s\.title, 50\)\.text\}`\}/);
  assert.match(src['_assistReview.tsx'], /aria-label=\{`\$\{done \? 'Added' : 'Add risk'\}: \$\{truncate\(s\.title, 50\)\.text\}`\}/);
});

test('the control dialog never draws a number: a person, an evidence item or a risk already chosen keeps its name even when its list does not hold it', () => {
  const c = src['_ControlsPanel.tsx'];
  assert.match(c, /const riskOptions = withChosen\(risks, f\.riskIds, riskNames\);/);
  assert.match(c, /const peopleOptions = withChosen\(people\.data \?\? \[\], \[f\.ownerId\], control\?\.owner \?/);
  assert.match(c, /const libraryOptions = withChosen\(library\.data \?\? \[\]/);
  assert.match(c, /<Combobox label="Owner" options=\{peopleOptions\}/);
  assert.match(c, /<Combobox label="Evidence item" options=\{libraryOptions\}/);
  assert.match(c, /<MultiSelect label="Covers risks" options=\{riskOptions\}/);
});
