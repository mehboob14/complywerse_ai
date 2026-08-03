// Stage-wise ordering for the framework-specific Templates and Documents
// dropdowns. The seeded template definitions carry no stage/order field and are
// stored alphabetically, so we impose the natural compliance-lifecycle sequence
// with keyword ranking: scope → mapping → gap → risk → controls → readiness →
// roadmap → attestation → evidence → audit for registers, and scope → core
// policy → risk → domain policies → procedures → plans for documents. First
// matching keyword group wins; unmatched items sort last, alphabetically.

export interface SeqItem { id: string; label: string }

const REGISTER_SEQ: string[][] = [
  ['scope', 'context', 'boundary', 'cde'],
  ['inventory', 'cardholder', 'asset', 'data map'],
  ['gap'],
  ['risk'],
  ['applicability', 'soa', 'statement of applicability', 'trust services', 'control matrix', 'matrix'],
  ['readiness'],
  ['roadmap', 'implementation', 'remediation', 'plan of action', 'poa'],
  ['saq', 'selector', 'self-assessment', 'self assessment', 'questionnaire'],
  ['evidence', 'tracker', 'request'],
  ['audit', 'monitoring', 'testing'],
];

const DOCUMENT_SEQ: string[][] = [
  ['scope statement', 'system description', 'aims scope', 'isms scope', 'context of'],
  ['information security policy', 'information security program', 'isms policy', 'ai policy', 'master policy', 'governance policy', 'security program'],
  ['risk', 'impact'],
  ['access', 'identity', 'authentication'],
  ['cryptograph', 'encryption', 'key management'],
  ['network', 'firewall', 'segmentation'],
  ['logging', 'monitoring', 'log management'],
  ['data for', 'data protection', 'data classification', 'privacy', 'retention'],
  ['transparency', 'roles', 'responsibilit', 'acceptable use', 'use policy', 'human oversight'],
  ['lifecycle', 'secure development', 'development', 'change management', 'sdlc', 'configuration'],
  ['vulnerability', 'patch', 'threat'],
  ['incident', 'breach'],
  ['continuity', 'backup', 'disaster', 'bcp', 'resilience', 'recovery'],
  ['procedure'],
  ['plan'],
];

function rankBy(seq: string[][], text: string): number {
  const t = text.toLowerCase();
  for (let i = 0; i < seq.length; i++) {
    if (seq[i].some((k) => t.includes(k))) return i;
  }
  return seq.length + 1;
}

function orderBy<T extends SeqItem>(seq: string[][], items: T[]): T[] {
  return items
    .map((it, idx) => ({ it, idx, r: rankBy(seq, `${it.label} ${it.id}`) }))
    .sort((a, b) => a.r - b.r || a.it.label.localeCompare(b.it.label) || a.idx - b.idx)
    .map((x) => x.it);
}

export const orderRegisters = <T extends SeqItem>(items: T[]): T[] => orderBy(REGISTER_SEQ, items);
export const orderDocuments = <T extends SeqItem>(items: T[]): T[] => orderBy(DOCUMENT_SEQ, items);
