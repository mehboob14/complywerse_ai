// A control domain of the Library (/control-library/[id]) as pure functions (no React): given the domain's "rich" payload (GET /control-library/groups/{id}/rich) and the frameworks the person picked
// ("Build your view", ?fw=A,B), what is on screen: the normalized sets that involve a picked framework (all their members kept, so the cross-framework mapping stays whole; the evidence and artifacts
// scoped to the picked frameworks), the standalone controls of a picked framework, the controls of each framework, and the six figures. The formulas are the ones the page had.
import { shortFramework as sf } from './libraryModel.ts';

export interface Member { framework: string; control_id: string; original_title: string; reference?: string }
export interface Ev { name: string; absorbs?: string[]; sources?: string[] }
export interface Art { name: string; type?: string; sources?: string[] }
export interface SetT {
  set_id: string; normalized_title: string; member_count: number; frameworks: string[];
  members: Member[]; normalized_evidence: Ev[]; excluded_evidence?: { name: string; reason: string }[];
  normalized_artifacts: Art[]; nc_id?: number;
}
export interface Rich {
  domain: string; controls_in: number; frameworks: string[]; framework_count: number;
  absent_frameworks: { name: string; reason: string; present_in?: string[]; present_in_count?: number }[];
  framework_catalog_artifacts: { framework: string; note: string; artifacts: Art[] }[];
  normalized_sets: number; standalone: number; sets: SetT[]; standalone_controls: SetT[];
}
export interface FwControl { control_id: string; title: string; set: string | null }

/** The frameworks that have controls of this domain's type, and (apart) the ones that have none here: shown in the picker, disabled, so nothing looks missing. */
export function frameworkChoices(data: Rich): { all: string[]; absent: string[] } {
  const all = Array.from(new Set(data.frameworks.map(sf))).sort();
  const absent = Array.from(new Set((data.absent_frameworks || []).map((a) => sf(a.name)))).filter((f) => !all.includes(f)).sort();
  return { all, absent };
}

/** A set scoped to the picked frameworks: every member stays, the evidence and artifacts keep what comes from a picked framework (or from none in particular). */
export function scopeSet(s: SetT, selected: readonly string[]): SetT {
  if (selected.length === 0) return s;
  const fromPicked = (src: string) => selected.includes(sf(src));
  return {
    ...s,
    normalized_evidence: (s.normalized_evidence || []).filter((e) => !e.sources?.length || e.sources.some(fromPicked)),
    normalized_artifacts: (s.normalized_artifacts || []).filter((a) => !a.sources?.length || a.sources.some(fromPicked)),
  };
}

/** How many of a set's controls belong to the picked frameworks (all of them when none is picked). */
export const membersOfPicked = (s: SetT, selected: readonly string[]): number =>
  selected.length ? s.members.filter((m) => selected.includes(sf(m.framework))).length : s.member_count;

export interface DomainView {
  filterOn: boolean;
  sets: SetT[];
  standalone: SetT[];
  /** standalone controls grouped by framework, the biggest first */
  standaloneByFw: Array<[string, SetT[]]>;
  /** every framework's controls in this domain (in a set or standalone), the biggest first, limited to the picked frameworks */
  byFw: Array<[string, FwControl[]]>;
  bannerFrameworks: string[];
  stats: { controls: number; frameworks: number | string; sets: number; standalone: number; evidence: number; artifacts: number };
  totals: { evidence: number; artifacts: number };
}

export function viewOf(data: Rich, selected: readonly string[]): DomainView {
  const filterOn = selected.length > 0;
  const fwOn = (f: string) => !filterOn || selected.includes(f);
  const sets = data.sets.filter((s) => !filterOn || s.frameworks.some((f) => selected.includes(sf(f)))).map((s) => scopeSet(s, selected));
  const standalone = data.standalone_controls.filter((s) => fwOn(sf(s.members[0]?.framework || '')));

  const stdMap: Record<string, SetT[]> = {};
  standalone.forEach((s) => { const f = sf(s.members[0]?.framework || ''); (stdMap[f] ||= []).push(s); });
  const standaloneByFw = Object.entries(stdMap).sort((a, b) => b[1].length - a[1].length);

  const fwMap: Record<string, FwControl[]> = {};
  data.sets.forEach((s) => s.members.forEach((m) => { (fwMap[sf(m.framework)] ||= []).push({ control_id: m.control_id, title: m.original_title, set: s.normalized_title }); }));
  data.standalone_controls.forEach((s) => { const m = s.members[0]; if (m) (fwMap[sf(m.framework)] ||= []).push({ control_id: m.control_id, title: m.original_title, set: null }); });
  const byFw = Object.entries(fwMap).filter(([f]) => fwOn(f)).sort((a, b) => b[1].length - a[1].length);

  const sum = (list: readonly SetT[], pick: (s: SetT) => number) => list.reduce((a, s) => a + pick(s), 0);
  const evidence = sum(sets, (s) => s.normalized_evidence?.length || 0) + sum(standalone, (s) => s.normalized_evidence?.length || 0);
  const artifacts = sum(sets, (s) => s.normalized_artifacts?.length || 0) + sum(standalone, (s) => s.normalized_artifacts?.length || 0);
  const wholeEvidence = data.sets.reduce((a, s) => a + (s.normalized_evidence?.length || 0), 0);
  const wholeArtifacts = data.sets.reduce((a, s) => a + (s.normalized_artifacts?.length || 0), 0)
    + (data.standalone_controls?.reduce((a, s) => a + (s.normalized_artifacts?.length || 0), 0) || 0);
  const controls = sum(sets, (s) => membersOfPicked(s, selected)) + standalone.length;
  return {
    filterOn, sets, standalone, standaloneByFw, byFw,
    bannerFrameworks: filterOn ? data.frameworks.filter((f) => selected.includes(sf(f))) : data.frameworks,
    stats: {
      controls: filterOn ? controls : data.controls_in,
      frameworks: filterOn ? byFw.length : data.framework_count,
      sets: filterOn ? sets.length : data.normalized_sets,
      standalone: filterOn ? standalone.length : data.standalone,
      evidence: filterOn ? evidence : wholeEvidence,
      artifacts: filterOn ? artifacts : wholeArtifacts,
    },
    totals: { evidence: wholeEvidence, artifacts: wholeArtifacts },
  };
}

/** Sets whose title or a framework name contains the search words. */
export function searchSets(sets: readonly SetT[], q: string): SetT[] {
  const needle = q.trim().toLowerCase();
  return needle ? sets.filter((s) => s.normalized_title.toLowerCase().includes(needle) || s.frameworks.some((f) => sf(f).toLowerCase().includes(needle))) : [...sets];
}
export function searchStandalone(items: readonly SetT[], q: string): SetT[] {
  const needle = q.trim().toLowerCase();
  return needle ? items.filter((s) => (s.members[0]?.original_title || '').toLowerCase().includes(needle) || (s.members[0]?.control_id || '').toLowerCase().includes(needle)) : [...items];
}
export function searchFw(items: readonly FwControl[], q: string): FwControl[] {
  const needle = q.trim().toLowerCase();
  return needle ? items.filter((c) => (c.title || '').toLowerCase().includes(needle) || (c.control_id || '').toLowerCase().includes(needle) || (c.set || '').toLowerCase().includes(needle)) : [...items];
}

/** The frameworks of a set, short and distinct; under a view the picked ones come first. */
export function setFrameworks(s: SetT, selected: readonly string[]): string[] {
  return Array.from(new Set(s.frameworks.map(sf))).sort((a, b) => (selected.length ? (selected.includes(b) ? 1 : 0) - (selected.includes(a) ? 1 : 0) : 0));
}

/** A starter Word document for an artifact the library names (a specification, not a stored file). Pure: the page turns the string into a download. */
export function artifactDocument(a: Art, domain: string): string {
  const esc = (s: unknown) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
  const typeLabel = a.type || 'Document';
  return `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">`
    + `<head><meta charset="utf-8"><title>${esc(a.name)}</title></head>`
    + `<body style="font-family:Calibri,Arial,sans-serif;color:#1e293b;line-height:1.5;">`
    + `<h1 style="color:#0f766e;margin-bottom:4px;">${esc(a.name)}</h1>`
    + `<p style="margin-top:0;"><b>Artifact type:</b> ${esc(typeLabel)}<br><b>Domain:</b> ${esc(domain)}`
    + (a.sources?.length ? `<br><b>Maps to:</b> ${esc(a.sources.join('; '))}` : '') + `</p><hr>`
    + `<h2>Purpose</h2><p>This is the <b>${esc(a.name)}</b> required to satisfy the related control(s). Replace the guidance below with your organisation's actual content.</p>`
    + `<h2>1. Scope</h2><p>[Describe what this ${esc(typeLabel.toLowerCase())} covers.]</p>`
    + `<h2>2. Content</h2><p>[Add the ${esc(typeLabel.toLowerCase())} content here.]</p>`
    + `<h2>3. Ownership &amp; Review</h2><p>Owner: ____________&nbsp;&nbsp;&nbsp;Approved by: ____________&nbsp;&nbsp;&nbsp;Review cycle: ____________</p>`
    + `<p style="color:#94a3b8;font-size:10pt;">Generated from the Control Library as a starter template: this is a blank document to fill in, not pre-filled evidence.</p>`
    + `</body></html>`;
}
export const artifactFileName = (a: Art): string => `${(a.name || 'artifact').replace(/[^a-z0-9]+/gi, '_')}.doc`;
