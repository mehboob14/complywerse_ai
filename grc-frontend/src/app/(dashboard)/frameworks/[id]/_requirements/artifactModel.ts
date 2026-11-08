// The artifacts of one requirement, apart from React so `node --test` can pin them (artifactModel.test.ts): the codes the server is asked about (the requirement's own and its
// sub-controls'), the suggestions made from what the requirement asks for when the framework's catalog has no entry for it, and which artifact the organisation already made for an item.
// The server filters by token-equal matching of `control_ref` (artifacts_router._ref_matches_any); a catalog item names the sub-controls it belongs to (`sub_controls`).

/** The catalog item as the server sends it, and the ones this tab invents. */
export interface CatalogLike {
  id: number;
  artifact_id: string;
  stage: string;
  stage_number: number | null;
  name: string;
  artifact_type: string;
  control_ref: string | null;
  mandatory: boolean;
  description: string | null;
  format: string | null;
  owner: string | null;
  is_platform_native: boolean;
  platform_data_type: string | null;
  provides?: string[] | null;
  sub_controls?: string[] | null;
}
export interface MadeLike { id: number; name: string; control_ref?: string | null; catalog_item_id?: number | null }
export interface EvidenceAskLike { name?: string; title?: string; type?: string; description?: string; is_required?: boolean; format?: string; filetype?: string }

/** The codes to ask about: the requirement's original, system and shown codes, and its sub-controls' codes. */
export function artifactCodes(control: { original_control_code?: string | null; system_control_code?: string | null; control_code?: string | null }, subCodes: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const c of [control.original_control_code, control.system_control_code, control.control_code, ...subCodes]) {
    if (c && typeof c === 'string' && !out.includes(c)) out.push(c);
  }
  return out;
}

/** The kind of artifact an evidence ask stands for (Policy, Register, Plan ...), from what is known of it; the file type is the last resort. */
export function inferArtifactType(typeHint?: string, nameHint?: string, fileHint?: string): string {
  const combined = `${typeHint || ''} ${nameHint || ''}`.toLowerCase();
  if (combined.includes('policy')) return 'Policy';
  if (combined.includes('procedure')) return 'Procedure';
  if (combined.includes('register') || combined.includes('inventory')) return 'Register';
  if (combined.includes('matrix')) return 'Matrix';
  if (combined.includes('plan')) return 'Plan';
  if (combined.includes('contract') || combined.includes('agreement') || combined.includes('nda')) return 'Contract';
  if (combined.includes('attest') || combined.includes('acknowledg')) return 'Attestation';
  if (combined.includes('config')) return 'Configuration';
  if (combined.includes('screenshot')) return 'Screenshot';
  if (combined.includes('training') || combined.includes('awareness')) return 'Training Record';
  if (combined.includes('audit') || combined.includes('assessment')) return 'Assessment';
  if (combined.includes('report')) return 'Report';
  if (combined.includes('log')) return 'Log';
  if (combined.includes('minute') || combined.includes('email') || (fileHint || '').toUpperCase() === 'EML') return 'Record/Log';
  if (combined.includes('certificate')) return 'Evidence';
  const ft = (fileHint || '').toUpperCase();
  if (ft === 'XLSX') return 'Register';
  if (ft === 'EML') return 'Record/Log';
  return 'Evidence';
}

const norm = (s: string | null | undefined): string => (s || '').toLowerCase().trim();

/**
 * One suggestion for each thing the requirement asks for that the framework's catalog does not cover (and no catalog item "provides"), so every requirement offers at least as many
 * artifact slots as it has evidence asks. They carry negative ids, which never meet a real catalog id.
 */
export function suggestedArtifacts(asks: readonly EvidenceAskLike[] | null | undefined, real: readonly CatalogLike[], ref: string | null): CatalogLike[] {
  const covered = new Set(real.map((c) => norm(c.name)).filter(Boolean));
  const provided = new Set(real.flatMap((c) => c.provides || []).map(norm));
  return (asks || [])
    .filter((ev) => { const name = norm(ev.name ?? ev.title); return !!name && !covered.has(name) && !provided.has(name); })
    .map((ev, idx) => {
      const fileType = (ev.filetype || ev.format || 'DOCX').toUpperCase();
      const docName = (ev.name ?? ev.title ?? `Evidence ${idx + 1}`).trim();
      return {
        id: -(idx + 1), artifact_id: `virtual_${idx + 1}`, stage: 'Auto-suggested', stage_number: null, name: docName, artifact_type: inferArtifactType(ev.type, docName, fileType),
        control_ref: ref, mandatory: !!ev.is_required, description: ev.description || '', format: fileType, owner: '', is_platform_native: false, platform_data_type: null,
      };
    });
}

/** The artifact the organisation already made for an item: by catalog id for a real one; a suggestion has no link, so it is matched by name and reference. */
export function madeFor<M extends MadeLike>(item: CatalogLike, artifacts: readonly M[]): M | undefined {
  if (item.id > 0) return artifacts.find((a) => a.catalog_item_id === item.id);
  const key = `${norm(item.name)}|${norm(item.control_ref)}`;
  return artifacts.find((a) => !a.catalog_item_id && `${norm(a.name)}|${norm(a.control_ref)}` === key);
}

/** The artifacts nobody made from a catalog item (added by hand for this requirement). */
export const handMade = <M extends MadeLike>(artifacts: readonly M[]): M[] => artifacts.filter((a) => !a.catalog_item_id);

/** "5 suggested, 2 made". */
export function artifactSummary(items: number, made: number): string {
  return `${items} suggested${made > 0 ? `, ${made} made` : ''}`;
}
