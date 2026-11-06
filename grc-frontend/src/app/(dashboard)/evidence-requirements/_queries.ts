// What the Evidence Requirements page asks the server. The requirements list answers at most 500 rows a page, so a framework is read page by page until the
// server's own total is reached (UAE IA has 860, the largest in the scratch tenant 1,070); the parsed-controls list likewise (it was cut at 1,000 before).
import apiClient from '@/lib/api';
import { nextSkips, type Catalogue, type ParsedControl } from './requirementsModel';

export interface UploadedFramework {
  id: number;
  name: string;
  version: string;
  upload_status: string;
  parsed_controls_count: number;
}

const REQUIREMENTS_PAGE = 500;
const CONTROLS_PAGE = 1000;

/** The frameworks that have been read (completed, parsed or published): the ones whose controls can have evidence requirements. */
export async function loadFrameworks(): Promise<UploadedFramework[]> {
  const response = await apiClient.get('/framework-upload/upload');
  const items = (response.data?.items || []) as UploadedFramework[];
  return items.filter((f) => f.upload_status === 'completed' || f.upload_status === 'parsed' || f.upload_status === 'published');
}

/** Every evidence requirement of a framework, filters off: the page filters, searches and pages them itself, so a filter change is instant and runs over
 *  the whole set. `total` and `status_counts` are the framework's own. */
export async function loadCatalogue(framework: number): Promise<Catalogue> {
  const url = `/framework-upload/parser/${framework}/evidence-requirements`;
  const first = (await apiClient.get(url, { params: { limit: REQUIREMENTS_PAGE } })).data as Catalogue;
  const rows = first.requirements.slice();
  for (const skip of nextSkips(rows.length, first.total, REQUIREMENTS_PAGE)) {
    const next = (await apiClient.get(url, { params: { limit: REQUIREMENTS_PAGE, skip } })).data as Catalogue;
    if (!next.requirements.length) break;
    next.requirements.forEach((r) => rows.push(r));
  }
  const seen = new Set<number>();
  return { ...first, requirements: rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))) };
}

/** The framework's parsed controls, for the reference each control is printed with (`original_reference`). Read in full, not the first 1,000. */
export async function loadControls(framework: number): Promise<ParsedControl[]> {
  const url = `/framework-upload/parser/${framework}/controls`;
  const first = (await apiClient.get(url, { params: { limit: CONTROLS_PAGE } })).data as { items?: ParsedControl[]; total?: number };
  const items = (first.items || []).slice();
  for (const skip of nextSkips(items.length, first.total ?? items.length, CONTROLS_PAGE)) {
    const next = (await apiClient.get(url, { params: { limit: CONTROLS_PAGE, skip } })).data as { items?: ParsedControl[] };
    if (!next.items?.length) break;
    next.items.forEach((c) => items.push(c));
  }
  return items;
}

export const stepUrl = (id: number, key: 'submit' | 'review' | 'approve' | 'reject'): string => `/framework-upload/parser/evidence-requirements/${id}/${key}`;
