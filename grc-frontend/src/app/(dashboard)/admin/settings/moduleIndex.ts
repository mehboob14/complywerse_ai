// The index of the modules' own Settings (Administration > Module settings): one row per module the server lets an organisation tune, what can be changed
// there in words, and where in the module the Settings are. The list of modules is the server's (GET /module-settings); this file only knows the words and
// the page each module keeps its Settings on. Pure (no React, relative imports): `node --test`.

export interface ServerModule { key: string; label: string; sections?: readonly string[] }

export interface ModuleRow { key: string; label: string; parts: string; where: string; href: string | null }

const PART_WORDS: Record<string, string> = { statuses: 'statuses', sla: 'SLA', fields: 'custom fields', lists: 'dropdown lists' };
const PART_ORDER = ['statuses', 'sla', 'fields', 'lists'];

/** "Statuses, SLA, custom fields and dropdown lists" (in the order the Settings show them; a part the page does not know is left out). */
export function partsText(sections: readonly string[] | undefined): string {
  const known = PART_ORDER.filter((part) => (sections ?? []).indexOf(part) >= 0).map((part) => PART_WORDS[part]);
  if (known.length === 0) return 'Settings';
  const text = known.length === 1 ? known[0] : `${known.slice(0, -1).join(', ')} and ${known[known.length - 1]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Where each module keeps its Settings: the page that holds them and how to reach them there. A module the server lists that is not here has no link. */
export const SETTINGS_PLACE: Record<string, { href: string; where: string }> = {
  tasks: { href: '/tasks?tab=settings', where: 'Task Management, Settings tab' },
  evidence: { href: '/evidence', where: 'Evidence Management, Settings' },
  risks: { href: '/erm/risks', where: 'Risk Register, the register settings menu' },
  controls: { href: '/automation/soc2-controls', where: 'Controls, the Settings menu' },
  vendors: { href: '/vendor-risk/vendors', where: 'Vendors, Settings' },
  statutory_audit: { href: '/auditor-portal/statutory-audit/settings', where: 'Statutory Audit, Settings' },
  internal_audit: { href: '/auditor-portal/internal-audit', where: 'Internal Audit, open an audit, Audit Plan lens, Settings' },
  vulnerabilities: { href: '/vulnerabilities/sla', where: 'Vulnerabilities, SLA' },
};

/** The rows of the index, in the server's order. */
export function moduleRows(modules: readonly ServerModule[]): ModuleRow[] {
  return modules.map((m) => {
    const place = SETTINGS_PLACE[m.key];
    return { key: m.key, label: m.label, parts: partsText(m.sections), where: place ? place.where : "In the module's own Settings", href: place ? place.href : null };
  });
}
