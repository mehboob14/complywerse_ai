'use client';

// The records a person can link to an issue, one list per kind, read when the picker opens: the Create issue form's loaders (the complete lean lists) for the kinds with one list, and two
// lists merged for controls (the organisation's own, and the library's) and for documents (documents and the policy statements of documents the person may read), as the Risk record does.
// A value is the record's id, or `<kind>:<id>` where two lists meet (linkedModel.addBody reads both). A refusal by the other module reaches the picker as an error with Retry.
import { LINK_LOADERS } from '@/components/issue-management/linkLoaders';
import { controlsApi } from '@/lib/api';
import type { PickItem } from '@/app/(dashboard)/erm/risks/[id]/_workspace/LinkPicker';
import { familyOf, type FamilyKey } from './linkedModel';

const prefixed = (kind: string, sub: string, rows: Array<{ value: string; label: string; description?: string }>): PickItem[] =>
  rows.map((r) => ({ value: `${kind}:${r.value}`, label: r.label, sub: r.description ? `${sub} · ${r.description}` : sub }));

export async function loadCandidates(family: FamilyKey): Promise<PickItem[]> {
  if (family === 'controls') {
    const [own, library] = await Promise.all([LINK_LOADERS.linked_internal_control_ids(), controlsApi.getNormalized()]);
    return [
      ...prefixed('internal', 'Our control', own),
      ...((library.data ?? []) as unknown as Array<Record<string, string | number | null>>).map((c): PickItem => {
        const code = (c.scf_id || c.code || c.internal_id || null) as string | null;
        return { value: `normalized:${c.id}`, label: (c.name as string) || (code ? `Control ${code}` : 'A control'), sub: code ? `Library · ${code}` : 'Library' };
      }),
    ];
  }
  if (family === 'governance') {
    const [documents, statements] = await Promise.all([LINK_LOADERS.linked_governance_document_ids(), LINK_LOADERS.linked_policy_statement_ids()]);
    return [...prefixed('governance_document', 'Document', documents), ...prefixed('policy_statement', 'Policy statement', statements)];
  }
  const loader = familyOf(family).loader as keyof typeof LINK_LOADERS | undefined;
  if (!loader) return [];
  return (await LINK_LOADERS[loader]()).map((o): PickItem => ({ value: o.value, label: o.label, sub: o.description }));
}
