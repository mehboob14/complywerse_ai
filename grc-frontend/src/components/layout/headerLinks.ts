// Where each item of the top bar's Notifications and Pending approvals opens. Every href is a page of this app.
import { actionHref, type RequestKind } from '../../lib/documentTasks.ts';

/** A page of this app ("/governance/documents/3?tab=lifecycle"), never another site ("//x", "/\x", "https://x", "javascript:…").
 * A tab or line break inside is refused too: the browser drops them, so "/\t/x" would open the site x. */
export function appPath(to: string | null | undefined): string | null {
  const s = (to ?? '').trim();
  return /^\/(?![/\\])/.test(s) && !/[\t\n\r]/.test(s) ? s : null;
}

/** A notification opens its link; one without (older rows, other modules) the page its text names ("Open: /vendor-risk/vendors/4"),
 * else none: it is shown as plain text. */
export function notificationHref(n: { link?: string | null; url?: string | null; message?: string | null }): string | null {
  const named = /(?:^|\s)(\/[A-Za-z][^\s<>]*)/.exec(n.message ?? '')?.[1]?.replace(/[.,;:!?)\]'"]+$/, '');
  return appPath(n.link) ?? appPath(n.url) ?? appPath(named);
}

/** A document request opens the document with the person's own step open (Review and sign, Approve and sign, Acknowledge), as My
 * Approvals and Task Management do; a decision on a proposed change opens that proposal. */
export function docRequestHref(r: { kind: string; document_id: number; proposal_id?: number | null }): string {
  return actionHref(r.document_id, r.kind as RequestKind, r.proposal_id);
}

/** The id of an item on the assessment approvals page (its source and id: evidence and assessment ids can be equal). */
export function approvalAnchor(source: string, id: number): string {
  return `approval-${source}-${id}`;
}

/** An evidence approval opens the approvals page at its own item, where Approve, Reject and Return are. */
export function assessmentApprovalHref(item: { id: number }): string {
  return `/compliance/assessments/approvals#${approvalAnchor('compliance', item.id)}`;
}
