// The rules of the hierarchical Requirements view (a framework whose journey carries `control_structure`, today UAE IA), in one place and
// without React, so `node --test` checks them (requirementTree.test.ts): how the page's sections become family → sub-family → control
// with the standard's own structure and each control's `parent_section`, what counts as compliant, which section starts open, which
// sub-controls share a lead-in, how many are met, which artifact belongs to which sub-control, and how the open/closed state of the
// tree lives (the person's clicks, kept for the session; a temporary layer while a search or filter is on). The components only draw it.
import type {
  CertificationControl, ControlStructure, ControlStructureFamily, ControlStructureSubfamily, EvidenceRequirement, SubControlNode,
} from '../../../../../types/index.ts';

// ─── The tree ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The page's own rule for "compliant". */
export const isCompliant = (status: string | null | undefined): boolean => status === 'implemented' || status === 'verified';

/** What the page already grouped: one section per domain, its controls already filtered and sorted. */
export interface SectionInput { key: string; label: string; controls: CertificationControl[] }

export interface BandNode {
  /** unique across the tree */
  key: string;
  /** "M1.1"; '' for the band of controls whose sub-family the structure does not know */
  id: string;
  name: string;
  info: ControlStructureSubfamily | null;
  controls: CertificationControl[];
  compliant: number;
  total: number;
}

export interface FamilyNode {
  /** the page section's key */
  key: string;
  /** "M1" when the structure knows the family; the circle shows it */
  id: string | null;
  /** the section's label without the leading id (the id is in the circle) */
  title: string;
  info: ControlStructureFamily | null;
  bands: BandNode[];
  compliant: number;
  total: number;
}

export const OTHER_BAND_NAME = 'Other';

/**
 * Family → sub-family → control. The order is the order the page gave (document order, or turned round by its Sort), so the
 * structure only names things: a family the structure does not know keeps its place with its label as the title, and a control whose
 * sub-family it does not know goes to an "Other" band after the known ones.
 */
export function buildTree(sections: readonly SectionInput[], structure: ControlStructure | null | undefined): FamilyNode[] {
  const families = new Map<string, ControlStructureFamily>();
  for (const f of structure?.families ?? []) families.set(f.id, f);
  const subfamilies = new Map<string, ControlStructureSubfamily>();
  for (const s of structure?.subfamilies ?? []) subfamilies.set(s.id, s);

  return sections.map((section) => {
    const label = section.label.trim();
    const info = families.get(label.split(/\s+/)[0] ?? '') ?? null;
    const byId = new Map<string, BandNode>();
    for (const control of section.controls) {
      const sub = subfamilies.get((control.parent_section ?? '').trim()) ?? null;
      const id = sub ? sub.id : '';
      let band = byId.get(id);
      if (!band) {
        band = { key: `${section.key}|${id}`, id, name: sub ? sub.name : OTHER_BAND_NAME, info: sub, controls: [], compliant: 0, total: 0 };
        byId.set(id, band);
      }
      band.controls.push(control);
      band.total += 1;
      if (isCompliant(control.status)) band.compliant += 1;
    }
    const bands = Array.from(byId.values()).sort((a, b) => Number(a.id === '') - Number(b.id === ''));
    return {
      key: section.key,
      id: info ? info.id : null,
      title: info ? label.slice(info.id.length).trim() || label : label,
      info,
      bands,
      compliant: bands.reduce((n, b) => n + b.compliant, 0),
      total: bands.reduce((n, b) => n + b.total, 0),
    };
  });
}

/** Every control of the tree, in order. */
export const treeControls = (tree: readonly FamilyNode[]): CertificationControl[] => tree.flatMap((f) => f.bands.flatMap((b) => b.controls));

/** Where a control sits (null: it is not in this tree, e.g. a filter hides it). */
export function locate(tree: readonly FamilyNode[], controlId: number): { family: FamilyNode; band: BandNode } | null {
  for (const family of tree) for (const band of family.bands) if (band.controls.some((c) => c.id === controlId)) return { family, band };
  return null;
}

// ─── Open and closed ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** `f:<section key>`, `b:<band key>`, `c:<control id>` → open (true) or closed (false); a missing key is the default. */
export type Layer = Record<string, boolean>;
export type NodeKind = 'f' | 'b' | 'c';
export const keyOf = (kind: NodeKind, key: string | number): string => `${kind}:${key}`;

/** `normal`: the person's clicks (kept for the session); `filtered`: the clicks made while a search or filter is on (thrown away when it changes). */
export interface OpenState { normal: Layer; filtered: Layer }

/** Sections start closed except the first with something still to do. */
export function defaultLayer(tree: readonly FamilyNode[]): Layer {
  const first = tree.find((f) => f.compliant < f.total);
  return first ? { [keyOf('f', first.key)]: true } : {};
}

/** The section and sub-family holding a deep-linked control are opened too. */
export function focusLayer(tree: readonly FamilyNode[], controlId: number | null | undefined): Layer {
  const at = controlId == null ? null : locate(tree, controlId);
  return at ? { [keyOf('f', at.family.key)]: true, [keyOf('b', at.band.key)]: true } : {};
}

/** What the tree looks like on arrival: what the session kept, else the default; the deep-linked control's place always open. */
export function initialState(tree: readonly FamilyNode[], stored: Layer | null, focusControlId: number | null | undefined): OpenState {
  return { normal: { ...(stored ?? defaultLayer(tree)), ...focusLayer(tree, focusControlId) }, filtered: {} };
}

/**
 * Sections: closed, except what the layer says (a search or filter shows everything it found). Sub-families: open, so an open
 * section shows its controls. Controls: closed.
 */
export function isOpen(state: OpenState, filtersActive: boolean, kind: NodeKind, key: string | number): boolean {
  const k = keyOf(kind, key);
  if (kind === 'c') return state.normal[k] ?? false;
  if (filtersActive) return state.filtered[k] ?? true;
  return state.normal[k] ?? (kind === 'b');
}

export function toggled(state: OpenState, filtersActive: boolean, kind: NodeKind, key: string | number): OpenState {
  const k = keyOf(kind, key);
  const open = !isOpen(state, filtersActive, kind, key);
  return filtersActive && kind !== 'c'
    ? { ...state, filtered: { ...state.filtered, [k]: open } }
    : { ...state, normal: { ...state.normal, [k]: open } };
}

const withoutControls = (layer: Layer): Layer => Object.fromEntries(Object.entries(layer).filter(([k]) => !k.startsWith('c:')));

/** Expand all / Collapse all: every section and sub-family; collapsing also closes the controls, expanding leaves them (each open control asks for its artifacts). */
export function setAll(state: OpenState, filtersActive: boolean, tree: readonly FamilyNode[], open: boolean): OpenState {
  const keys: Layer = {};
  for (const f of tree) {
    keys[keyOf('f', f.key)] = open;
    for (const b of f.bands) keys[keyOf('b', b.key)] = open;
  }
  const normal = open ? state.normal : withoutControls(state.normal);
  return filtersActive
    ? { normal, filtered: { ...state.filtered, ...keys } }
    : { normal: { ...normal, ...keys }, filtered: state.filtered };
}

/** What sessionStorage gave back: null when it is missing or is not a layer. */
export function parseLayer(raw: string | null | undefined): Layer | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const out: Layer = {};
    for (const [k, v] of Object.entries(value)) if (/^[fbc]:/.test(k) && typeof v === 'boolean') out[k] = v;
    return out;
  } catch {
    return null;
  }
}

export const storageKey = (journeyId: number): string => `requirements-tree:${journeyId}`;

// ─── Sub-controls ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A control's sub-controls in the standard's order. */
export const subControlsOf = (control: Pick<CertificationControl, 'sub_control_tree'>): SubControlNode[] =>
  [...(control.sub_control_tree ?? [])].sort((a, b) => a.number - b.number);

/** Only a sub-control that is a criterion of its control can be ticked (annex "take into account" lines cannot). */
export const isTickable = (node: Pick<SubControlNode, 'criterion_index'>): boolean => node.criterion_index != null;

/** The ticks of a control as the page sees them now: the local override, else what the server sent (null: neither). */
export const statusOf = (
  control: Pick<CertificationControl, 'id' | 'criteria_status'>,
  overrides: Readonly<Record<number, Record<string, boolean>>>,
): Record<string, boolean> | null => overrides[control.id] ?? control.criteria_status ?? null;

/** Met by the ticks given; without ticks, by what the server computed. */
export function isMet(node: Pick<SubControlNode, 'criterion_index' | 'met'>, status: Record<string, boolean> | null | undefined): boolean {
  if (node.criterion_index == null) return false;
  return status ? !!status[String(node.criterion_index)] : !!node.met;
}

export interface Progress { met: number; total: number }

export function progress(control: Pick<CertificationControl, 'sub_control_tree'>, status: Record<string, boolean> | null | undefined): Progress {
  let met = 0;
  let total = 0;
  for (const node of control.sub_control_tree ?? []) {
    if (!isTickable(node)) continue;
    total += 1;
    if (isMet(node, status)) met += 1;
  }
  return { met, total };
}

export function totalProgress(
  controls: readonly CertificationControl[],
  overrides: Readonly<Record<number, Record<string, boolean>>>,
): Progress {
  const sum: Progress = { met: 0, total: 0 };
  for (const control of controls) {
    const p = progress(control, statusOf(control, overrides));
    sum.met += p.met;
    sum.total += p.total;
  }
  return sum;
}

export interface LeadGroup {
  /** printed once above the rows; null: the rows print their whole sentence */
  leadIn: string | null;
  rows: { node: SubControlNode; text: string }[];
}

/** The sentence as the standard prints it: `text` begins with its lead-in; should the data keep them apart, they are put together. */
function sentence(node: SubControlNode): string {
  const lead = node.lead_in?.trim();
  return lead && !node.text.startsWith(lead) ? `${lead} ${node.text}` : node.text;
}

/**
 * Sub-controls that begin with the same lead-in ("The entity shall determine:") print it once, and each row shows what follows it.
 * Two or more neighbours sharing a lead-in make a group (when every sub-control shares it, that is the whole list); one that stands
 * alone keeps its whole sentence, so a control that mixes both (annex E: a sentence, then "take into account" lines) reads in order.
 */
export function leadInGroups(nodes: readonly SubControlNode[]): LeadGroup[] {
  const groups: LeadGroup[] = [];
  const standalone = (node: SubControlNode) => {
    const last = groups[groups.length - 1];
    const row = { node, text: sentence(node) };
    if (last && last.leadIn === null) last.rows.push(row);
    else groups.push({ leadIn: null, rows: [row] });
  };
  let i = 0;
  while (i < nodes.length) {
    const lead = nodes[i].lead_in?.trim() || null;
    let j = i + 1;
    while (lead && j < nodes.length && (nodes[j].lead_in?.trim() || null) === lead) j += 1;
    if (lead && j - i >= 2) {
      groups.push({
        leadIn: lead,
        rows: nodes.slice(i, j).map((node) => {
          const whole = sentence(node);
          return { node, text: whole.slice(lead.length).trim() || whole };
        }),
      });
    } else {
      nodes.slice(i, j).forEach(standalone);
    }
    i = j;
  }
  return groups;
}

// ─── Evidence and artifacts ──────────────────────────────────────────────────────────────────────────────────────────────

export interface EvidenceChip { name: string; filetype: string | null; description: string | null }

const norm = (s: string): string => s.trim().toLowerCase();

/** One chip per evidence name, with the file type of the recommendation of that name when there is one (the name alone otherwise). */
export function evidenceChips(
  names: readonly string[] | null | undefined,
  requirements: readonly Pick<EvidenceRequirement, 'title' | 'description' | 'filetype' | 'format' | 'evidence_format'>[] | null | undefined,
): EvidenceChip[] {
  const byTitle = new Map<string, NonNullable<typeof requirements>[number]>();
  for (const r of requirements ?? []) if (r?.title) byTitle.set(norm(r.title), r);
  const seen = new Set<string>();
  const out: EvidenceChip[] = [];
  for (const name of names ?? []) {
    if (!name || seen.has(norm(name))) continue;
    seen.add(norm(name));
    const r = byTitle.get(norm(name));
    out.push({ name, filetype: (r?.filetype || r?.format || r?.evidence_format || '').toUpperCase() || null, description: r?.description || null });
  }
  return out;
}

/** What a sub-control needs as evidence: its titles, each with the file type of the control's own recommendation of that title (the bare title when there is none). */
export function evidenceOf(
  control: Pick<CertificationControl, 'evidence_requirements'>,
  node: Pick<SubControlNode, 'evidence'>,
): EvidenceChip[] {
  return evidenceChips(node.evidence, control.evidence_requirements);
}

/**
 * What the control as a whole needs as evidence. With sub-controls that is what covers none of them (`control_evidence`); a control
 * without any (the annex F mappings) has no sub-control to put its evidence under, so all of it is the control's.
 */
export function controlEvidenceOf(
  control: Pick<CertificationControl, 'sub_control_tree' | 'control_evidence' | 'evidence_requirements'>,
): EvidenceChip[] {
  const ownOnly = (control.sub_control_tree?.length ?? 0) > 0 || (control.control_evidence?.length ?? 0) > 0;
  const names = ownOnly ? control.control_evidence : (control.evidence_requirements ?? []).map((r) => r.title);
  return evidenceChips(names, control.evidence_requirements);
}

/**
 * Artifacts of one control (what `/artifacts/by-control` returned for the control's code and its sub-controls' codes) by sub-control:
 * an item sits under every sub-control its `sub_controls` names; an item that names none of them belongs to the control itself.
 */
export function placeCatalog<T extends { sub_controls?: string[] | null }>(
  items: readonly T[],
  codes: readonly string[],
): { byCode: Record<string, T[]>; controlLevel: T[] } {
  const wanted = new Set(codes);
  const byCode: Record<string, T[]> = {};
  const controlLevel: T[] = [];
  for (const item of items) {
    const hits = (item.sub_controls ?? []).filter((code) => wanted.has(code));
    if (hits.length === 0) controlLevel.push(item);
    for (const code of Array.from(new Set(hits))) (byCode[code] ??= []).push(item);
  }
  return { byCode, controlLevel };
}

// ─── Words ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const isTier = (value: string | null | undefined): value is 'P1' | 'P2' | 'P3' | 'P4' => !!value && /^P[1-4]$/.test(value);

export const priorityTip = (tier: string): string =>
  `Implementation priority ${tier} of 4 — the order the standard suggests for planning, not a measure of criticality`;

const APPLICABILITY_TIP: Record<string, string> = {
  'Always applicable': 'Applies to every entity',
  'Based on risk assessment': "Applies unless the entity's risk assessment justifies leaving it out",
};

/** The two wordings of the core standard are explained; an annex wording is its own explanation. */
export const applicabilityTip = (text: string): string => APPLICABILITY_TIP[text] ?? text;
