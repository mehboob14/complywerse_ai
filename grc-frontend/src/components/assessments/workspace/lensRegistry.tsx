// The lenses of the assessment workspace: ONE list, edited by whoever builds a lens. The contract is lens.ts (props: assessmentId, readOnly, onChanged).
//
//   {
//     key: 'maturity',                      // unique; a 'tab' lens is opened with ?tab=<key>
//     label: 'Capabilities',                // the tab's name
//     slot: 'controls',                     // 'controls' replaces the built-in Controls tab; 'tab' adds one
//     appliesTo: (c) => c.format === 'xlsx_maturity',
//     Component: dynamic(() => import('./lenses/MaturityLens')),   // load a heavy lens only when its tab opens
//   },
//
// The first def whose slot is 'controls' and that applies wins, so put the more specific lens before a general one.
import type { LensDef } from './lens';

export const LENSES: LensDef[] = [];
