// The lens contract of the assessment workspace (`/assessments/a/<id>`). Pure: `node --test` runs lens.test.ts against it.
//
// ONE workspace opens every assessment, whatever its type. What differs between types is a LENS: a component that draws one tab of that workspace for the types it
// is made for (a maturity scale of 1 to 5 with a target, a risk register with a likelihood by impact grid, ASVS levels, a bilingual five-state control...).
// The workspace owns the page: the address, the heading, the score and the counts, the Remediation clock, the tabs and who may change what. A lens owns its tab.
//
// Two slots:
//   'controls'  stands in for the built-in Controls tab (the generic list of controls with the item drawer). At most one wins for an assessment: the first
//               def in the registry whose `appliesTo` is true. Its `label` is the tab's name ("Controls", "Risks", "Capabilities").
//   'tab'       one more tab after the built-in ones ("Artifacts", "Workbook"). Every def whose `appliesTo` is true is added, in registry order.
//
// A lens is a component with ONE contract (LensProps). It loads what it shows from the server itself (the workspace's own reads are in the query cache under
// the keys of workspaceApi.ts, so asking for the same thing again costs nothing) and tells the workspace when it wrote something (`onChanged`).
// Register a lens by adding a LensDef to LENSES in lensRegistry.tsx: nothing else changes. The tab keys of the built-in tabs are reserved (BUILT_IN_TABS).
import type { ComponentType } from 'react';

/** What the workspace hands every lens. */
export interface LensProps {
  /** the assessment: `ComplianceAssessmentDocument.id`, the id of `/compliance/assessments/<id>` */
  assessmentId: number;
  /** The person may look and not change: draw no upload, no edit, no delete, no "Add" (a button that would fail must not look usable). Only the workspace decides it. */
  readOnly: boolean;
  /** Call it once after the lens wrote anything the page shows around it (an answer, an upload, a new row, a delete): the heading's score and counts, the
   *  Remediation clock and the registers read again. It is cheap to call and safe to call twice. */
  onChanged: () => void;
}

/** What `appliesTo` may look at: facts of the assessment that are known before anything else is loaded. */
export interface LensContext {
  /** the assessment's format (`assessment_format`): "asvs_checklist", "pdpl_assessment_toolkit", "nist_800_53a"... */
  format: string;
  /** made per application, function or system (Cyber Security and NIST) rather than uploaded as one workbook */
  scoped: boolean;
  /** 'scoping' while a scoped draft is being filled in (no questions exist yet), 'in_progress' once it started; null for an uploaded workbook */
  phase: 'scoping' | 'in_progress' | null;
}

export type LensSlot = 'controls' | 'tab';

export interface LensDef {
  /** unique; for a 'tab' lens it is the value of `?tab=`, so it is lower case words joined with "-" and not one of BUILT_IN_TABS */
  key: string;
  /** the tab's name, 1 to 3 words ("Controls", "Artifacts") */
  label: string;
  slot: LensSlot;
  /** true for the assessments this lens is made for */
  appliesTo: (context: LensContext) => boolean;
  Component: ComponentType<LensProps>;
}

/** The tabs the workspace draws itself. A lens key may not be one of these. */
export const BUILT_IN_TABS = ['controls', 'remediation', 'scope', 'people', 'plan'] as const;

export interface ResolvedLenses {
  /** replaces the Controls tab's body and name; null: the built-in list of controls */
  controls: LensDef | null;
  /** extra tabs, in registry order */
  tabs: LensDef[];
}

/** Which lenses draw this assessment. A scoped draft that has not started has no questions, so no lens applies to it (its tabs are the scoping stages). */
export function resolveLenses(defs: readonly LensDef[], context: LensContext): ResolvedLenses {
  if (context.scoped && context.phase === 'scoping') return { controls: null, tabs: [] };
  const fits = defs.filter((d) => d.appliesTo(context));
  return { controls: fits.find((d) => d.slot === 'controls') ?? null, tabs: fits.filter((d) => d.slot === 'tab') };
}

/** Why a registry is wrong, in words ("" when it is fine): keys unique, shaped like a tab key, and not a built-in tab. A test calls it on the real registry. */
export function registryProblem(defs: readonly LensDef[]): string {
  const seen = new Set<string>();
  for (const d of defs) {
    if (!/^[a-z][a-z0-9-]*$/.test(d.key)) return `lens key "${d.key}" must be lower case words joined with "-"`;
    if ((BUILT_IN_TABS as readonly string[]).includes(d.key)) return `lens key "${d.key}" is a built-in tab`;
    if (seen.has(d.key)) return `lens key "${d.key}" is registered twice`;
    seen.add(d.key);
    if (!d.label.trim()) return `lens "${d.key}" has no label`;
    if (d.slot !== 'controls' && d.slot !== 'tab') return `lens "${d.key}" has no slot`;
  }
  return '';
}
