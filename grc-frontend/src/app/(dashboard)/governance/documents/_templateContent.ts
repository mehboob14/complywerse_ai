/**
 * Ready-made template CONTENT generator.
 *
 * Turns a catalog template (or an artifact template) into a fully-structured,
 * ready-to-edit document body — deterministically, with no AI call and no wait.
 * Picking a template fills the WYSIWYG editor instantly; the user then refines
 * it. Output is **markdown** (the existing storage format), so the parser, AI
 * features and the react-markdown viewer all keep working unchanged.
 *
 * The section scaffold is tailored per `doc_type` (policy / standard /
 * procedure / guideline) following common GRC document structure. Each template's
 * rich catalog `description` is used as the Overview narrative so the draft is
 * specific to the artefact, not boilerplate.
 */

import type { RecommendedDoc, RecommendedDocType } from './_recommendedDocsCatalog';

const TODAY_HINT = '<!-- Replace the bracketed prompts below, then save. -->';

function header(title: string, docType: string, category?: string): string {
  const meta = [
    `**Document type:** ${cap(docType)}`,
    category ? `**Category:** ${category}` : '',
    '**Status:** Draft',
    '**Version:** 0.1',
  ].filter(Boolean).join('  ·  ');
  return `# ${title}\n\n${meta}\n`;
}

function cap(s: string): string {
  return (s || '').charAt(0).toUpperCase() + (s || '').slice(1);
}

function overview(description?: string): string {
  const body = (description || '').trim()
    || 'Summarise the purpose of this document and the business context it supports.';
  return `## Purpose\n\n${body}\n`;
}

const SCOPE = `## Scope\n\nThis document applies to [all business units / the following functions], including employees, contractors, and third parties acting on behalf of the organisation. State any explicit exclusions here.\n`;

const ROLES = `## Roles & Responsibilities\n\n- **Document Owner** — maintains this document, drives the annual review, and approves changes.
- **Accountable Executive** — owns the outcomes this document governs and sponsors remediation.
- **First Line (Business)** — operates the controls and produces the required evidence.
- **Second Line (Risk / Compliance)** — sets requirements, monitors, and challenges.
- **Third Line (Internal Audit)** — independently assures effectiveness.
`;

const REVIEW = `## Review & Maintenance\n\nThis document is reviewed at least annually, and additionally on any material change (regulatory update, organisational change, significant incident, or audit finding). Record the reviewer, date, and summary of changes in the version history.\n`;

const EXCEPTIONS = `## Exceptions\n\nDeviations require a formal, time-bound exception with documented justification, a risk assessment, compensating controls, and approval through the governance workflow. Exceptions are tracked to expiry and reviewed at renewal.\n`;

function policyBody(): string {
  return [
    SCOPE,
    `## Policy Statements\n\n1. [State the first mandatory requirement — use clear, prescriptive language ("must" / "shall").]
2. [State the second requirement.]
3. [State the third requirement.]
4. [Add further numbered statements as needed — each should be testable and assignable to an owner.]\n`,
    ROLES,
    `## Compliance & Enforcement\n\nCompliance is monitored by the Second Line and assured by Internal Audit. Non-compliance may result in remediation actions and, where appropriate, disciplinary measures in line with HR policy.\n`,
    EXCEPTIONS,
    REVIEW,
  ].join('\n');
}

function standardBody(): string {
  return [
    SCOPE,
    `## Mandatory Requirements\n\n1. [Requirement — the specific, measurable control or configuration that must be met.]
2. [Requirement.]
3. [Requirement.]\n\nEach requirement should be objectively verifiable and map to the control(s) and risk(s) it supports.\n`,
    ROLES,
    `## Measurement & Compliance\n\nDefine how conformance is measured (metrics, evidence, sampling), the cadence of checks, and the thresholds that trigger escalation.\n`,
    EXCEPTIONS,
    REVIEW,
  ].join('\n');
}

function procedureBody(): string {
  return [
    SCOPE,
    `## Prerequisites\n\nList the inputs, access, tools, and approvals required before this procedure can be performed.\n`,
    `## Procedure Steps\n\n1. **[Step name]** — [what is done, by whom, and the expected output.]
2. **[Step name]** — [detail.]
3. **[Step name]** — [detail.]
4. **[Step name]** — [detail, including any four-eyes / approval checkpoint.]\n`,
    ROLES,
    `## Records & Evidence\n\nSpecify the records produced at each step, where they are stored, the retention period, and the access controls.\n`,
    REVIEW,
  ].join('\n');
}

function guidelineBody(): string {
  return [
    SCOPE,
    `## Guidance\n\nProvide the recommended approach. Guidelines are advisory — explain the intent so teams can apply judgement appropriately.\n`,
    `## Good Practices\n\n- [Recommended practice.]
- [Recommended practice.]
- [Common anti-pattern to avoid.]\n`,
    `## Worked Example\n\n[Provide a concrete, illustrative example that shows the guidance applied in practice.]\n`,
    REVIEW,
  ].join('\n');
}

function bodyFor(docType: RecommendedDocType | string): string {
  switch (docType) {
    case 'policy': return policyBody();
    case 'standard': return standardBody();
    case 'procedure': return procedureBody();
    case 'guideline': return guidelineBody();
    default: return policyBody();
  }
}

/** Build ready-to-edit markdown content from a Standard-Template catalog entry. */
export function buildTemplateContent(doc: RecommendedDoc): string {
  return [
    header(doc.title, doc.doc_type, doc.category),
    TODAY_HINT,
    '',
    overview(doc.description),
    bodyFor(doc.doc_type),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Build ready-to-edit markdown content for an Artifact template (backend item). */
export function buildArtifactContent(args: {
  name: string;
  artifact_type?: string;
  description?: string;
  framework_key?: string;
  control_ref?: string;
}): string {
  const dt = mapArtifactType(args.artifact_type);
  const metaExtra = [
    args.framework_key ? `**Framework:** ${args.framework_key}` : '',
    args.control_ref ? `**Control reference:** ${args.control_ref}` : '',
  ].filter(Boolean);
  const head = header(args.name, dt, args.artifact_type ? cap(args.artifact_type) : undefined)
    + (metaExtra.length ? `\n${metaExtra.join('  ·  ')}\n` : '');
  return [
    head,
    TODAY_HINT,
    '',
    overview(args.description),
    bodyFor(dt),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function mapArtifactType(t?: string): RecommendedDocType {
  const k = (t || '').toLowerCase();
  if (k.includes('policy')) return 'policy';
  if (k.includes('standard')) return 'standard';
  if (k.includes('guideline')) return 'guideline';
  if (k.includes('procedure') || k.includes('process') || k.includes('register') || k.includes('plan')) return 'procedure';
  return 'procedure';
}
