// The tabs of a unit's popup: ONE list, so a tab is added by registering it here and nowhere else (the popup, the toolbar's Access and Approvals buttons and the context menu all
// read it). A tab is `{ id, label, render(props) }`; `render` gets the unit it is for, the whole tree, whether the person may change THIS unit, and the helpers below.
//
//   Details, People and Access (who has access and why, the levels given on the unit and inherited, "Block here") are built, and so are Approvals (the unit's default
//   reviewers, approvers and custom route for its documents: ApprovalsTab) and Exceptions (the exception rules that apply and the default implementer: ExceptionsTab), which
//   take the unit's id or "org" (`defaultsParam(node)`), so the organisation's popup mounts the same two. A tab that is registered but not built is a placeholder: it is not in
//   the strip, and nothing on screen mentions it, until its id is in ENABLED_TABS. To bring one in: (1) write its component taking DirectoryTabProps, (2) replace the
//   placeholder's `render` with it, (3) add its id to ENABLED_TABS. Nothing else in this folder changes.
//
//   THE ORGANISATION POPUP (toolbar: "Organisation defaults"): the same popup shell opened on the whole organisation, with only the tabs in ORG_TABS that are enabled (Approvals
//   and Exceptions: the defaults every unit inherits). A tab then gets `organisation: true` and a stand-in `node` (id ORG_NODE_ID = 0, name "Organisation", `can_manage` =
//   the person may write the organisation's defaults); `defaultsParam(node)` (directoryModel.ts) is what the approval-defaults API takes for it: a unit's id, or "org".
import { createElement, type ReactNode } from 'react';
import { defaultsParam, type DirectoryNode, type DirectoryTree, type TabId } from './directoryModel';
import { AccessTab } from './AccessTab';
import { ApprovalsTab } from './ApprovalsTab';
import { ExceptionsTab } from './ExceptionsTab';
import { DetailsTab } from './DetailsTab';
import { PeopleTab } from './PeopleTab';

/** What a tab is given. */
export interface DirectoryTabProps {
  /** the unit the popup is open on */
  node: DirectoryNode;
  /** every unit, with the tree rules (children, path, subtree, documents with everything under it) */
  tree: DirectoryTree;
  /** the three level names, top first */
  levels: readonly string[];
  /** whether the person may change THIS unit (its details, people, access, defaults); false: show what there is, read-only */
  canManage: boolean;
  /** whether the person may add and move whole departments (`admin:organization:edit`) */
  canTop: boolean;
  /** the Directory and every list of departments are out of date: call it after any change to a unit */
  refresh: () => void;
  /** say that the tab holds typed input (true) or no longer does (false), so the popup asks before it is closed over it */
  setDirty: (dirty: boolean) => void;
  /** the popup is open on the whole organisation (its defaults), not on a unit: `node` is its stand-in (see the note at the top) */
  organisation: boolean;
  /** the popup was opened by "Edit details" (F2): the Details tab puts the cursor in the first field */
  focusName?: boolean;
  /** go to another unit in the popup (a child, the parent), optionally on a tab */
  openUnit: (id: number, tab?: TabId) => void;
  /** close the popup */
  close: () => void;
}

export interface DirectoryTab {
  id: TabId;
  label: string;
  render: (props: DirectoryTabProps) => ReactNode;
}

export const DIRECTORY_TABS: readonly DirectoryTab[] = [
  { id: 'details', label: 'Details', render: (props) => createElement(DetailsTab, props) },
  { id: 'people', label: 'People', render: (props) => createElement(PeopleTab, props) },
  { id: 'access', label: 'Access', render: (props) => createElement(AccessTab, props) },
  { id: 'approvals', label: 'Approvals', render: (props) => createElement(ApprovalsTab, { departmentId: defaultsParam(props.node), tree: props.tree, setDirty: props.setDirty, openUnit: (id) => props.openUnit(id, 'approvals'), popupSaysViewOnly: !props.canManage }) },
  { id: 'exceptions', label: 'Exceptions', render: (props) => createElement(ExceptionsTab, { departmentId: defaultsParam(props.node), tree: props.tree, setDirty: props.setDirty, openUnit: (id) => props.openUnit(id, 'exceptions'), popupSaysViewOnly: !props.canManage }) },
];

/** The ids of the tabs the popup lists, in DIRECTORY_TABS order. A tab joins when its module exists. */
export const ENABLED_TABS: readonly TabId[] = ['details', 'people', 'access', 'approvals', 'exceptions'];

/** The tabs the Organisation popup can have, in order: the defaults every unit inherits. */
export const ORG_TABS: readonly TabId[] = ['approvals', 'exceptions'];
/** Of those, the ones that exist now: with none, the toolbar has no "Organisation defaults" button. */
export const ENABLED_ORG_TABS: readonly TabId[] = ORG_TABS.filter((id) => ENABLED_TABS.includes(id));
