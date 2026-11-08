// The lenses of the assessment workspace: ONE list, edited by whoever builds a lens. The contract is lens.ts (props: assessmentId, readOnly, onChanged).
//
//   {
//     key: 'maturity',                      // unique; a 'tab' lens is opened with ?tab=<key>
//     label: 'Capabilities',                // the tab's name
//     slot: 'controls',                     // 'controls' replaces the built-in Controls tab; 'tab' adds one
//     appliesTo: (c) => c.format === 'xlsx_maturity',
//     Component: dynamic(() => import('./lenses/MaturityLens')),   // a heavy lens loads only when its tab opens
//   },
//
// The first def whose slot is 'controls' and that applies wins, so put the more specific lens before a general one.
//
// Today's entries put the older tabs of components/compliance behind the contract so that no type loses a screen when its three old detail pages forward here. The group that builds the
// kit lenses (assess-lenses) replaces the Component of an entry, or deletes the entry once the built-in controls are enough. The singletons whose older tab finds its own assessment
// (PDPL, DPIA, the Digital Operations workbook, the KPI report, the NCA registers, the DCC tool) have no entry yet: they open as the built-in controls until their lens exists.
import dynamic from 'next/dynamic';
import type { LensDef } from './lens';
import { isNist } from './kinds';

const MATURITY = ['csir_maturity', 'cti_maturity', 'incident_maturity', 'itsecops_maturity', 'digital_ops_maturity'];

export const LENSES: LensDef[] = [
  { key: 'asvs', label: 'Requirements', slot: 'controls', appliesTo: (c) => c.format === 'asvs_checklist', Component: dynamic(() => import('./lenses/AsvsLens')) },
  { key: 'owasp', label: 'Tests', slot: 'controls', appliesTo: (c) => c.format === 'owasp_v4_testing_checklist', Component: dynamic(() => import('./lenses/OwaspLens')) },
  { key: 'mobile', label: 'Requirements', slot: 'controls', appliesTo: (c) => c.format === 'mobile_app_security', Component: dynamic(() => import('./lenses/MobileLens')) },
  { key: 'maturity', label: 'Capabilities', slot: 'controls', appliesTo: (c) => MATURITY.includes(c.format), Component: dynamic(() => import('./lenses/MaturityLens')) },
  { key: 'nist', label: 'Determinations', slot: 'controls', appliesTo: (c) => isNist(c.format), Component: dynamic(() => import('./lenses/NistLens')) },
  { key: 'nca', label: 'NCA workspace', slot: 'controls', appliesTo: (c) => c.format === 'nca_container', Component: dynamic(() => import('./lenses/NcaLens')) },
  { key: 'workbook', label: 'Workbook', slot: 'tab', appliesTo: (c) => c.format === 'xlsx_maturity', Component: dynamic(() => import('./lenses/WorkbookLens')) },
  { key: 'artifacts', label: 'Artifacts', slot: 'tab', appliesTo: (c) => !c.scoped && c.format !== 'nca_container', Component: dynamic(() => import('./lenses/ArtifactsLens')) },
];
