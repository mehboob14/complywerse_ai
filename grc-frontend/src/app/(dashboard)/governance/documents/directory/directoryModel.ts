// The Directory's rules, apart from React so `node --test` can pin them (directoryModel.test.ts): the units as one list of nodes (built from the Directory API
// `GET /admin/departments/directory` when the backend answers it, else from the flat `GET /admin/departments` list that always exists), the tree over them, the rows
// the tree shows for a set of open units, what the arrow keys do in it, what each toolbar action may do for a unit (and why not), the choices of the Move and New
// dialogs, a unit's summary, and which tabs the unit popup lists. The words of a department (levels, depth cap, member chips, parent choices) are lib/departments.ts's:
// a department is read, saved and switched off the same way here as in Administration and Governance settings; this file only adds the tree-as-a-folder view.

import { DEFAULT_LEVEL_LABELS, MAX_DEPTH, departmentTree, levelLabel, parentPickItems, type PickItem } from '../../../../../lib/departments.ts';

// ── nodes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The four things a unit can define for its documents and exceptions (the approval defaults, C1): a badge on its row says it has its own. */
export type DefaultSubject = 'doc_review' | 'doc_approval' | 'doc_route' | 'exc_implementer';
export const DEFAULT_BADGES: ReadonlyArray<{ subject: DefaultSubject; label: string }> = [
  { subject: 'doc_review', label: 'Reviewers' },
  { subject: 'doc_approval', label: 'Approvers' },
  { subject: 'doc_route', label: 'Workflow' },
  { subject: 'exc_implementer', label: 'Implementer' },
];

/** One unit. The names are the contract's (C2), except the parent: `parent_department_id` (the contract says `parent_id`) is what lib/departments.ts reads, so its
 *  tree and parent choices work on a node as they are. */
export interface DirectoryNode {
  id: number;
  parent_department_id: number | null;
  name: string;
  code: string | null;
  /** 1 = a top department, 2 = under one, 3 = the deepest */
  level: number;
  /** what the organisation calls that level */
  level_label: string;
  head: { id: number; name: string } | null;
  is_active: boolean;
  /** `documents` are its own (the ones the person may read); the unit with everything under it is `documentsTotal` of the tree (the server's own `documents_total` when it says it) */
  counts: { documents: number; members: number; children: number; documentsTotal?: number };
  /** whether this person may change this unit (its details, people, roles, move it, switch it off, add units under it) */
  can_manage: boolean;
  /** which defaults the unit defines itself; absent until the approval-defaults overview is read (no badge is then drawn: unknown is not "none") */
  defaults?: Partial<Record<DefaultSubject, boolean>>;
}

export interface Directory {
  nodes: DirectoryNode[];
  /** the three level names, top first */
  levels: string[];
  /** where it came from: the Directory API, or the flat list of departments */
  source: 'directory' | 'list';
  /** the Directory API says whether the person may add a department at the top (`can_create_top`); the flat list cannot, so the caller uses the global right then */
  canCreateTop?: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const whole = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const idOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const byName = (a: { name: string; id: number }, b: { name: string; id: number }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.id - b.id;
const namesOf = (v: unknown): string[] | undefined => (Array.isArray(v) && v.length === MAX_DEPTH && v.every((x) => typeof x === 'string' && x.trim()) ? (v as string[]) : undefined);

/** The nodes of a Directory API answer (`{ levels, nodes: [{ id, parent_id, name, code, level, level_label, head, is_active, counts, can_manage }] }`). null when the answer is not
 *  that (a backend without the endpoint answers something else, or a node is unusable): the caller then reads the flat list, which says the same things. */
export function fromDirectory(payload: unknown): Directory | null {
  if (!isRecord(payload) || !Array.isArray(payload.nodes)) return null;
  const nodes: DirectoryNode[] = [];
  for (const raw of payload.nodes) {
    if (!isRecord(raw)) return null;
    const id = idOf(raw.id);
    if (id === null || typeof raw.name !== 'string') return null;
    const parent = idOf(raw.parent_id ?? raw.parent_department_id);
    const head = isRecord(raw.head) && idOf(raw.head.id) !== null && typeof raw.head.name === 'string' ? { id: raw.head.id as number, name: raw.head.name } : null;
    const counts = isRecord(raw.counts) ? raw.counts : {};
    nodes.push({
      id, parent_department_id: parent, name: raw.name, code: typeof raw.code === 'string' && raw.code ? raw.code : null,
      level: whole(raw.level) || 1, level_label: typeof raw.level_label === 'string' ? raw.level_label : '', head, is_active: raw.is_active !== false,
      counts: { documents: whole(counts.documents), members: whole(counts.members), children: whole(counts.children), ...(whole(counts.documents_total) || counts.documents_total === 0 ? { documentsTotal: whole(counts.documents_total) } : {}) },
      can_manage: raw.can_manage === true,
    });
  }
  const levels = namesOf(payload.levels) ?? [...DEFAULT_LEVEL_LABELS];
  return { nodes: fill(nodes, levels), levels, source: 'directory', ...(typeof payload.can_create_top === 'boolean' ? { canCreateTop: payload.can_create_top } : {}) };
}

/** The parts of a row of `GET /admin/departments` this reads (lib/api.ts `Department`). */
export interface ListRow {
  id: number;
  name: string;
  code?: string | null;
  parent_department_id?: number | null;
  level?: number;
  level_label?: string;
  department_head_user_id?: number | null;
  department_head_name?: string | null;
  is_active: boolean;
  member_count?: number;
  document_count?: number;
  child_count?: number;
}

/** The nodes of the flat department list (every unit, the switched-off ones too). `canManage`: what the person holds globally (`admin:organization:edit`); until the
 *  Directory API says it per unit, that is the answer for every unit. */
export function fromList(rows: readonly ListRow[], canManage: boolean, levelNames?: readonly string[]): Directory {
  const levels = namesOf(levelNames) ?? [...DEFAULT_LEVEL_LABELS];
  const tree = departmentTree(rows);
  const nodes = rows.map<DirectoryNode>((r) => ({
    id: r.id, parent_department_id: tree.parentOf(r.id), name: r.name, code: r.code || null, level: r.level ?? tree.level(r.id), level_label: r.level_label ?? '',
    head: r.department_head_user_id != null ? { id: r.department_head_user_id, name: r.department_head_name || 'Unnamed owner' } : null,
    is_active: r.is_active !== false,
    counts: { documents: whole(r.document_count), members: whole(r.member_count), children: r.child_count ?? tree.childrenOf(r.id).length },
    can_manage: canManage,
  }));
  return { nodes: fill(nodes, levels), levels, source: 'list' };
}

/** A node with no level label gets the organisation's name for its level; the nodes come out in the order they came in. */
function fill(nodes: DirectoryNode[], levels: readonly string[]): DirectoryNode[] {
  return nodes.map((n) => (n.level_label ? n : { ...n, level_label: levelLabel(n.level, levels) }));
}

// ── the tree ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DirectoryTree {
  nodes: readonly DirectoryNode[];
  node(id: number): DirectoryNode | undefined;
  /** the units directly under one, A-Z; null: the top units, under the organisation */
  childrenOf(id: number | null): DirectoryNode[];
  /** the unit above one; null: it sits under the organisation */
  parentOf(id: number): number | null;
  /** the unit and the ones above it, the top one first; [] for the organisation (null) */
  path(id: number | null): DirectoryNode[];
  /** the unit and everything under it */
  subtree(id: number): Set<number>;
  /** how many levels sit under it (0: none) */
  height(id: number): number;
  /** the documents of the unit and everything under it; null: of the whole organisation */
  documentsTotal(id: number | null): number;
}

export function buildTree(nodes: readonly DirectoryNode[]): DirectoryTree {
  const t = departmentTree(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const top = nodes.filter((n) => t.parentOf(n.id) === null).sort(byName);
  const sums = new Map<number, number>();
  const total = (id: number): number => {
    let sum = sums.get(id) ?? byId.get(id)?.counts.documentsTotal;
    if (sum === undefined) { sum = 0; t.subtree(id).forEach((i) => { sum = (sum as number) + (byId.get(i)?.counts.documents ?? 0); }); sums.set(id, sum); }
    return sum;
  };
  return {
    nodes,
    node: (id) => byId.get(id),
    childrenOf: (id) => (id === null ? top : t.childrenOf(id)),
    parentOf: (id) => t.parentOf(id),
    path: (id) => (id === null ? [] : t.path(id)),
    subtree: (id) => t.subtree(id),
    height: (id) => t.height(id),
    documentsTotal: (id) => (id === null ? nodes.reduce((n, x) => n + x.counts.documents, 0) : total(id)),
  };
}

/** A unit's own facts and what is under it. For the organisation (null) `people` is null: a person in two units would count twice. */
export interface UnitSummary { owner: string | null; documents: number; documentsTotal: number; people: number | null; units: number; unitsBelow: number }

export function summaryOf(tree: DirectoryTree, id: number | null): UnitSummary {
  if (id === null) return { owner: null, documents: 0, documentsTotal: tree.documentsTotal(null), people: null, units: tree.childrenOf(null).length, unitsBelow: tree.nodes.length };
  const n = tree.node(id);
  return {
    owner: n?.head?.name ?? null, documents: n?.counts.documents ?? 0, documentsTotal: tree.documentsTotal(id), people: n?.counts.members ?? 0,
    units: tree.childrenOf(id).length, unitsBelow: tree.subtree(id).size - 1,
  };
}

// ── the tree on screen ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One line of the tree: the organisation (id null, always open) or a unit. `depth` 0 for the organisation, 1 for a top unit. */
export interface TreeRow { id: number | null; depth: number; hasChildren: boolean; open: boolean; posInSet: number; setSize: number }

/** The lines the tree shows when these units are open: depth first, each level A-Z. */
export function treeRows(tree: DirectoryTree, expanded: ReadonlySet<number>): TreeRow[] {
  const top = tree.childrenOf(null);
  const rows: TreeRow[] = [{ id: null, depth: 0, hasChildren: top.length > 0, open: true, posInSet: 1, setSize: 1 }];
  const walk = (list: readonly DirectoryNode[], depth: number) => {
    list.forEach((n, i) => {
      const kids = tree.childrenOf(n.id);
      const open = kids.length > 0 && expanded.has(n.id);
      rows.push({ id: n.id, depth, hasChildren: kids.length > 0, open, posInSet: i + 1, setSize: list.length });
      if (open) walk(kids, depth + 1);
    });
  };
  walk(top, 1);
  return rows;
}

/** The open units plus every unit above `id`, so the line of `id` is on screen. The same set when nothing is to be added (so a state update is skipped). */
export function openPathTo(tree: DirectoryTree, expanded: ReadonlySet<number>, id: number | null): ReadonlySet<number> {
  if (id === null) return expanded;
  const missing = tree.path(id).slice(0, -1).filter((n) => !expanded.has(n.id));
  return missing.length === 0 ? expanded : new Set([...Array.from(expanded), ...missing.map((n) => n.id)]);
}

/** What closing a unit does to the selection: the selected unit under the one being closed becomes the closed one (as Explorer does), else it stays. */
export function selectionAfterClose(tree: DirectoryTree, selected: number | null, closed: number): number | null {
  return selected !== null && selected !== closed && tree.subtree(closed).has(selected) ? closed : selected;
}

export type TreeKey = { focus: number | null } | { expand: number } | { collapse: number } | { open: number } | null;

/** What a key does in the tree when the line of `at` (null: the organisation) has focus: the arrows move (Right opens a closed unit, then goes to its first unit; Left closes an
 *  open one, then goes to the unit above), Home and End go to the first and last line, Enter opens the unit's popup, a letter goes to the next unit that starts with it. */
export function treeKey(rows: readonly TreeRow[], names: (id: number) => string, parentOf: (id: number) => number | null, at: number | null, key: string): TreeKey {
  const i = rows.findIndex((r) => r.id === at);
  if (i < 0) return null;
  const row = rows[i];
  switch (key) {
    case 'ArrowDown': return i + 1 < rows.length ? { focus: rows[i + 1].id } : null;
    case 'ArrowUp': return i > 0 ? { focus: rows[i - 1].id } : null;
    case 'Home': return i > 0 ? { focus: rows[0].id } : null;
    case 'End': return i < rows.length - 1 ? { focus: rows[rows.length - 1].id } : null;
    case 'ArrowRight':
      if (row.id === null || !row.hasChildren) return null;
      return row.open ? { focus: rows[i + 1].id } : { expand: row.id };
    case 'ArrowLeft':
      if (row.id === null) return null;
      return row.open ? { collapse: row.id } : { focus: parentOf(row.id) };
    case 'Enter': return row.id === null ? null : { open: row.id };
    default: {
      if (key.length !== 1 || !/\S/.test(key)) return null;
      const c = key.toLowerCase();
      for (let step = 1; step <= rows.length; step++) {
        const r = rows[(i + step) % rows.length];
        if (r.id !== null && names(r.id).toLowerCase().startsWith(c)) return { focus: r.id };
      }
      return null;
    }
  }
}

// ── what the toolbar and the menus may do ───────────────────────────────────────────────────────────────────────────────────────────────

export type ActionKey = 'new' | 'edit' | 'move' | 'toggle' | 'access' | 'approvals';
export interface ActionState {
  key: ActionKey;
  label: string;
  /** not offered at all (the person may not do it, or the module is not there) */
  hidden: boolean;
  /** offered but not now; `reason` says why, in words */
  disabled: boolean;
  reason?: string;
}
export interface ActionContext {
  /** the person holds the right to add and move whole departments (`admin:organization:edit`): a top-level unit needs it */
  canTop: boolean;
  levels: readonly string[];
  /** the popup tabs that exist (the toolbar's Access and Approvals open them) */
  tabs: readonly string[];
}

export const ORGANISATION = 'Organisation';

/** The actions for a unit, or for the organisation (null). A person who may not change a unit does not get its buttons (a read-only note says so on the page). */
export function unitActions(tree: DirectoryTree, id: number | null, ctx: ActionContext): ActionState[] {
  const gone = (key: ActionKey, label: string): ActionState => ({ key, label, hidden: true, disabled: true });
  if (id === null) {
    return [
      { key: 'new', label: `New ${levelLabel(1, ctx.levels)}`, hidden: !ctx.canTop, disabled: false },
      gone('edit', 'Details'), gone('move', 'Move to…'), gone('toggle', 'Deactivate'), gone('access', 'Access'), gone('approvals', 'Approvals'),
    ];
  }
  const n = tree.node(id);
  if (!n) return (['new', 'edit', 'move', 'toggle', 'access', 'approvals'] as const).map((k) => gone(k, k));
  const parent = tree.parentOf(id);
  const manage = n.can_manage;
  const nextLevel = levelLabel(Math.min(n.level + 1, MAX_DEPTH), ctx.levels);
  const newReason = !n.is_active ? 'Switched off: activate it first' : n.level >= MAX_DEPTH ? `Units go ${MAX_DEPTH} levels deep` : undefined;
  const moves = moveChoices(tree, id, ctx).filter((c) => c.value !== String(parent ?? ''));
  return [
    { key: 'new', label: `New ${nextLevel}`, hidden: !manage, disabled: !!newReason, reason: newReason },
    { key: 'edit', label: manage ? 'Edit details' : 'Details', hidden: false, disabled: false },
    { key: 'move', label: 'Move to…', hidden: !manage, disabled: moves.length === 0, reason: moves.length === 0 ? 'Nowhere else it can go' : undefined },
    { key: 'toggle', label: n.is_active ? 'Deactivate' : 'Activate', hidden: !manage, disabled: false },
    { key: 'access', label: 'Access', hidden: !ctx.tabs.includes('access'), disabled: false },
    { key: 'approvals', label: 'Approvals', hidden: !ctx.tabs.includes('approvals'), disabled: false },
  ];
}

/** Whether the person may change nothing in the Directory at all (the page then says it is view only). */
export const viewOnly = (nodes: readonly DirectoryNode[], canTop: boolean): boolean => !canTop && !nodes.some((n) => n.can_manage);

/** Where a unit can be moved to, by whole path with its level under it: the places lib/departments.ts allows (not itself, not under itself, not too deep, not switched
 *  off) that the person may manage, the unit's own place included (choosing it changes nothing), and the organisation's top where the person may add departments. */
export function moveChoices(tree: DirectoryTree, id: number, ctx: Pick<ActionContext, 'canTop' | 'levels'>): PickItem[] {
  const parent = tree.parentOf(id);
  return placeChoices(tree, id, parent, ctx);
}

/** Where a new unit can go: the same places, for a unit that does not exist yet (`start`: the one it is opened under, null: the top). */
export function newPlaceChoices(tree: DirectoryTree, start: number | null, ctx: Pick<ActionContext, 'canTop' | 'levels'>): PickItem[] {
  return placeChoices(tree, null, start, ctx);
}

function placeChoices(tree: DirectoryTree, self: number | null, current: number | null, ctx: Pick<ActionContext, 'canTop' | 'levels'>): PickItem[] {
  const manageable = new Set(tree.nodes.filter((n) => n.can_manage).map((n) => n.id));
  const places = parentPickItems(tree.nodes, self, current, [...ctx.levels]).filter((p) => manageable.has(Number(p.value)) || Number(p.value) === current);
  const top: PickItem[] = ctx.canTop || current === null ? [{ value: '', label: `${ORGANISATION} (top level)` }] : [];
  return top.concat(places);
}

// ── finding a unit, and the words ──────────────────────────────────────────────────────────────────────────────────────────────────────

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The units whose name or code holds what was typed (A-Z, at most `limit`). Nothing for a blank query. */
export function findUnits(nodes: readonly DirectoryNode[], query: string, limit = 50): DirectoryNode[] {
  const q = fold(query).trim();
  if (!q) return [];
  return nodes.filter((n) => fold(n.name).includes(q) || fold(n.code ?? '').includes(q)).sort(byName).slice(0, limit);
}

/** "1 document", "5 documents". */
export const countText = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The library, filtered to a unit and everything under it (`?dept=` is the library's own address). */
export const libraryHref = (id: number | null): string => (id === null ? '/governance/documents' : `/governance/documents?dept=${id}`);

/** The unit an address names (`?unit=7`); null when it is not a unit of the tree (the organisation). */
export function unitFromAddress(raw: string, tree: DirectoryTree): number | null {
  const id = /^\d{1,9}$/.test(raw.trim()) ? Number(raw) : null;
  return id !== null && tree.node(id) ? id : null;
}

/** The defaults badges a unit's row draws: only those it defines itself (nothing is drawn for unknown). */
export const badgesOf = (n: Pick<DirectoryNode, 'defaults'>): string[] => DEFAULT_BADGES.filter((b) => n.defaults?.[b.subject]).map((b) => b.label);

// ── the popup's tabs ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const TAB_IDS = ['details', 'people', 'access', 'approvals', 'exceptions'] as const;
export type TabId = (typeof TAB_IDS)[number];

/** The registered tabs that are enabled, in registry order: what the popup's strip lists. */
export function shownTabs<T extends { id: string }>(registry: readonly T[], enabled: readonly string[]): T[] {
  return registry.filter((t) => enabled.includes(t.id));
}

/** The tab an address asks for, or the first one shown (an address can name a tab that does not exist yet). */
export function tabOr(raw: string, shown: readonly { id: string }[]): string {
  return shown.find((t) => t.id === raw)?.id ?? shown[0]?.id ?? 'details';
}

// ── the organisation as a popup ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The id of the organisation's stand-in node: no unit has it (ids start at 1). */
export const ORG_NODE_ID = 0;
/** What the approval-defaults API calls the whole organisation (`?department_id=org`), and what the address calls it (`?open=org`). */
export const ORG_PARAM = 'org';

/** The `department_id` the approval-defaults API takes for a popup's node: a unit's id, or "org" for the organisation. */
export const defaultsParam = (node: Pick<DirectoryNode, 'id'>): number | typeof ORG_PARAM => (node.id === ORG_NODE_ID ? ORG_PARAM : node.id);

/** Whether the address asks for the organisation's popup (`?open=org`). */
export const isOrgAddress = (raw: string): boolean => raw.trim().toLowerCase() === ORG_PARAM;

/** The organisation as the node a popup is opened on: it has no counts and no owner; `can_manage` is whether the person may write the organisation's defaults. */
export function organisationNode(canWrite: boolean): DirectoryNode {
  return {
    id: ORG_NODE_ID, parent_department_id: null, name: ORGANISATION, code: null, level: 0, level_label: 'Whole organisation', head: null, is_active: true,
    counts: { documents: 0, members: 0, children: 0 }, can_manage: canWrite,
  };
}
