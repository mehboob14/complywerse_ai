// What the folder bar above the Folders layout holds, apart from React so `node --test` can pin it (folderKeys.test.ts): the folder the toolbar acts on, which actions are buttons and which
// sit under "More", and what the Department filter holds for a folder. The words and the rights are directoryModel.unitActions's; this decides where they go.
import type { ActionKey, ActionState } from './directoryModel.ts';

/** The buttons of the toolbar, in order (the rest are under "More": Edit details and Exceptions). Where an action is hidden (the person may not do it) its button is not drawn. */
export const TOOLBAR_KEYS: readonly ActionKey[] = ['new', 'properties', 'access', 'approvals', 'move', 'toggle'];

export function splitActions(actions: readonly ActionState[]): { buttons: ActionState[]; more: ActionState[] } {
  const shown = actions.filter((a) => !a.hidden);
  return {
    buttons: TOOLBAR_KEYS.map((k) => shown.find((a) => a.key === k)).filter((a): a is ActionState => !!a),
    more: shown.filter((a) => !TOOLBAR_KEYS.includes(a.key)),
  };
}

/** The unit the toolbar acts on: the folder that is selected (a unit the list knows), else the one you are in; null: the whole organisation. A folder that is not a unit ("No department") selects nothing. */
export function toolbarTarget(selectedKey: string | null, openFolder: number | null, knows: (id: number) => boolean): number | null {
  const id = idOfKey(selectedKey);
  return id !== null && knows(id) ? id : openFolder;
}

/** `d12` -> 12; `none` and anything else -> null. */
export function idOfKey(key: string | null): number | null {
  const m = /^d(\d{1,9})$/.exec(key ?? '');
  return m ? Number(m[1]) : null;
}

/** The key of a unit's folder (libraryFolders.folderKey). */
export const keyOfUnit = (id: number): string => `d${id}`;

/** What the Department filter holds when the library is opened into a unit (or back out to the whole organisation). */
export const departmentFilter = (id: number | null): string[] => (id === null ? [] : [String(id)]);
