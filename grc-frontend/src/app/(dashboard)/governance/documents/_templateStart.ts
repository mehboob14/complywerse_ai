/**
 * Every new document is written in the AI Studio. A template picked in the library's Document Templates (standard, NCA,
 * artifact, reference law) becomes what the studio is asked to open (POST /governance/studio/sessions, kind "new"): the
 * template's own text, title and type, kept as a studio draft until Move to library. The old "+ Draft" links
 * (?aiDraftTitle=…) land in the studio's new-document popup. Pure: the page fetches the template's text and calls the studio.
 */
import type { RecommendedDoc } from './_recommendedDocsCatalog';
import { buildArtifactContent, buildTemplateContent } from './_templateContent.ts';

/** The studio's start screen with the "Write a new document" popup open. */
export const STUDIO_NEW_DOCUMENT = '/governance/documents/studio?new=1';

export interface TemplateStart {
  title: string;
  doc_type: string;
  /** The template's text; none = the studio's own template for the type (a reference law, attached as a reference instead). */
  content?: string;
  /** Where the document started, kept in its history ("Started from …"). */
  template_name?: string;
  /** What it should cover: kept as the document's focus areas, which Comply Agent reads. */
  focus?: string;
}

const TYPE_WORD: Record<string, string> = { policy: 'Policy', standard: 'Standard', procedure: 'Procedure', guideline: 'Guideline', charter: 'Charter' };

/** A template's prompts as the studio's placeholders, highlighted and counted until they are filled: "[State the requirement]"
 *  and the NCA's "\<organization name\>" become "[[…]]". Links, reference links, checkboxes, escaped brackets and "[[…]]" stay. */
export function asPlaceholders(md: string): string {
  return md
    .replace(/\\<([^<>\n\\]{2,120})\\>/g, '[[$1]]')
    .replace(/(^|[^[\\])\[([^[\]\n]{3,300})\](?![([\]:])/g, '$1[[$2]]');
}

export function recommendedStart(doc: RecommendedDoc): TemplateStart {
  return { title: doc.title, doc_type: doc.doc_type, content: asPlaceholders(buildTemplateContent(doc)), template_name: `Standard template: ${doc.title}`, focus: doc.description };
}

export interface ArtifactLike { name: string; artifact_type: string; description?: string | null; control_ref?: string | null }

/** `served`: the artifact's own text from the catalogue (GET /artifacts/catalog/content), else the one built here. */
export function artifactStart(item: ArtifactLike, frameworkName: string, docType: string, served?: string | null): TemplateStart {
  const content = served && served.trim() ? served : buildArtifactContent({
    name: item.name, artifact_type: item.artifact_type, description: item.description || undefined, framework_key: frameworkName, control_ref: item.control_ref || undefined,
  });
  return { title: item.name, doc_type: docType, content: asPlaceholders(content), template_name: `${frameworkName} artifact template: ${item.name}`, focus: item.description || undefined };
}

/** "anti Malware Protection" (a Policy) -> "Anti Malware Protection Policy". */
export function ncaTitle(title: string, category: string): string {
  const t = title.trim().replace(/\s+/g, ' ');
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  const word = ['Policy', 'Standard', 'Procedure'].includes(category) ? category : '';
  return word && !new RegExp(`\\b${word}\\b`, 'i').test(cap) ? `${cap} ${word}` : cap;
}

/** `content`: the template's text (GET /governance/nca-templates/{id}/content). Throws when it has none. */
export function ncaStart(t: { title: string; category: string }, docType: string, content: string): TemplateStart {
  if (!(content || '').trim()) throw new Error(`The NCA template “${t.title}” has no text to start from.`);
  return { title: ncaTitle(t.title, t.category), doc_type: docType, content: asPlaceholders(content), template_name: `NCA template: ${t.title}` };
}

export interface LawLike { name: string; short_name?: string | null; jurisdiction?: string | null; doc_type_hint?: string | null }

/** A law is not a template: the document starts from the studio's own template for its type, with the law attached. */
export function lawStart(law: LawLike): TemplateStart {
  const hint = (law.doc_type_hint || '').toLowerCase();
  const docType = hint in TYPE_WORD ? hint : 'policy';
  return {
    title: `${(law.short_name || law.name).trim()} Compliance ${TYPE_WORD[docType]}`,
    doc_type: docType,
    focus: `Comply with ${law.name}${law.jurisdiction ? ` (${law.jurisdiction})` : ''}: turn its obligations into requirements and cite the articles they come from. Its text is attached as a reference.`,
  };
}

/** The name the law's text is attached under. */
export function lawFileName(law: LawLike): string {
  return `${(law.short_name || law.name).replace(/[\\/:*?"<>|\s]+/g, ' ').trim().slice(0, 80) || 'Reference law'}.md`;
}

/** The body of POST /governance/studio/sessions. */
export function sessionBody(start: TemplateStart) {
  return {
    kind: 'new' as const,
    title: start.title,
    doc_type: start.doc_type,
    ...(start.content ? { content: start.content, template_name: start.template_name } : {}),
    ...(start.focus && start.focus.trim() ? { instructions: { focus_areas: start.focus.trim() } } : {}),
  };
}

/** The library's old "+ Draft" link (?aiDraftTitle=…&aiDraftType=…&aiDraftDescription=…&aiDraftParentId=…&aiDraftFrameworkIds=…)
 *  as the studio's new-document popup, filled in. None when the page was opened without one. */
export function studioDraftUrl(params: URLSearchParams | null): string | null {
  const title = params?.get('aiDraftTitle');
  if (!params || !title) return null;
  const q = new URLSearchParams({ title });
  const type = params.get('aiDraftType');
  if (type) q.set('type', type);
  const description = params.get('aiDraftDescription');
  if (description) q.set('description', description);
  const parent = params.get('aiDraftParentId');
  if (parent && /^\d+$/.test(parent)) q.set('parent', parent);
  const frameworks = (params.get('aiDraftFrameworkIds') || '').split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
  if (frameworks.length) q.set('frameworks', frameworks.join(','));
  return `/governance/documents/studio?${q.toString()}`;
}
