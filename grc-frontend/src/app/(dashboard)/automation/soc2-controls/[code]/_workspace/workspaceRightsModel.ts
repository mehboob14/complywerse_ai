// What the SERVER lets a person do on one control, read from the rights they hold (the same reading the Controls explorer uses: the exact name, or an administrator; see
// ../../_explorer/controlsRightsModel.ts for why the platform's wildcard reading is not asked). Each key is the permission the route checks:
//   testing    automation/assurance.py _require_testing_edit   procedures, tests, samples, maturity, testing details
//   signOff    automation/assurance.py _require_testing_approve  sign off a test
//   evidence   automation/router.py _require_evidence_edit      attach, unlink and upload evidence
//   libraryEdit scf/router.py _require_cl_edit                  edit, retire and move a custom control through its lifecycle, mappings, attached checks, fields
//   riskLink   erm:risks:edit OR controls:control_library:edit   (automation/router.py _require_risk_link_edit)
//   assetLink  assets:asset_inventory:edit OR controls:control_library:edit
//   anyLink    the right of the TYPE of record (document, vendor, ...) OR controls:control_library:edit: the page cannot know every type's right, so a person with none of the ones
//              it knows is told the server decides
// Nothing here grants or removes a right: a button the server would refuse is drawn disabled, with the reason; a button it allows is never hidden.
import { holds } from '../../_explorer/controlsRightsModel.ts';

export { holds };

/** The permission names, exactly as the backend checks them. */
export const WS_RIGHT = {
  testing: ['controls:control_testing:edit'],
  signOff: ['controls:controls:approve'],
  evidence: ['evidence:evidence_library:edit'],
  libraryEdit: ['controls:control_library:edit'],
  riskLink: ['erm:risks:edit', 'controls:control_library:edit'],
  assetLink: ['assets:asset_inventory:edit', 'controls:control_library:edit'],
  assign: ['controls:controls:assign'],
  frameworks: ['compliance:frameworks:*'],
  scan: ['compliance:scan:execute'],
} as const;

export type WsRightKey = keyof typeof WS_RIGHT;

/** What a disabled button says. */
export const WS_NO_RIGHT: Record<WsRightKey, string> = {
  testing: 'You need the right to record tests.',
  signOff: 'You need the right to approve tests.',
  evidence: 'You need the right to attach evidence.',
  libraryEdit: 'You need the right to edit controls.',
  riskLink: 'You need the right to link risks.',
  assetLink: 'You need the right to link assets.',
  assign: 'You need the right to assign owners.',
  frameworks: 'You need the right to manage frameworks.',
  scan: 'You need the right to run scans.',
};

/** Whether a person holds a right of the workspace: any one of the names a route accepts. */
export function mayDo(key: WsRightKey, held: readonly string[], isAdmin: boolean): boolean {
  return WS_RIGHT[key].some((name) => holds(name, held, isAdmin));
}

export type WsRights = Record<WsRightKey, boolean>;

export function rightsOf(held: readonly string[], isAdmin: boolean): WsRights {
  const out = {} as WsRights;
  (Object.keys(WS_RIGHT) as WsRightKey[]).forEach((k) => { out[k] = mayDo(k, held, isAdmin); });
  return out;
}

/** The reason a button is off for a right, or undefined when the person holds it. */
export const whyNot = (rights: WsRights, key: WsRightKey): string | undefined => (rights[key] ? undefined : WS_NO_RIGHT[key]);
