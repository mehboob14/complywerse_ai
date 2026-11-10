// What a public page of the supplier side says when a call fails, with no React in it so each case can be tested. The pages are opened
// by a link and nothing else, so the person must be told the right thing: a link that no longer works (ask for a new one), an address
// that has no organisation in it (the link was not opened as it was sent: asking for a new one would fail the same way), a server that is
// busy, or a failure that says nothing about the link (try again). The server's own sentence is shown only when it is a plain refusal
// meant for the supplier; the words about a tenant header are never shown.

export type ProblemKind = 'gone' | 'busy' | 'address' | 'other';

export const BUSY = 'Too many requests. Wait a few minutes and try again.';
export const GONE = 'This link is no longer valid. Ask your contact for a new one, or request one below.';
export const WRONG_ADDRESS =
  "This address needs your organisation's link. Open the link from the e-mail we sent you, exactly as it was sent, or ask your contact to send it again.";
export const UNREACHABLE = 'The portal could not be reached. Check your connection and try again.';

interface Failure { response?: { status?: number; data?: { detail?: unknown } } }

const responseOf = (e: unknown) => (e as Failure | null | undefined)?.response;

/** A 400 from the tenant check of the server: the address (host name) names no organisation. */
const namesNoOrganisation = (e: unknown) => {
  const res = responseOf(e);
  return res?.status === 400 && typeof res.data?.detail === 'string' && /tenant context/i.test(res.data.detail);
};

export function kindOf(e: unknown): ProblemKind {
  const status = responseOf(e)?.status;
  if (status === 404 || status === 410) return 'gone';
  if (status === 429) return 'busy';
  if (namesNoOrganisation(e)) return 'address';
  return 'other';
}

/** The sentence for a failure of a call that opens a page (the home, a questionnaire, an examiner report). */
export function problemText(e: unknown, fallback = UNREACHABLE): string {
  const kind = kindOf(e);
  if (kind === 'busy') return BUSY;
  if (kind === 'address') return WRONG_ADDRESS;
  if (kind === 'gone') {
    const detail = responseOf(e)?.data?.detail;
    return typeof detail === 'string' && detail.trim() ? detail : GONE;
  }
  return fallback;
}

/** The sentence for a refusal of something the supplier did (a save, an upload, a message): the server's words when it gave a plain reason. */
export function actionText(e: unknown, fallback: string): string {
  const kind = kindOf(e);
  if (kind === 'busy') return BUSY;
  if (kind === 'address') return WRONG_ADDRESS;
  const detail = responseOf(e)?.data?.detail;
  return typeof detail === 'string' && detail.trim() ? detail : fallback;
}

/** Whether trying the same thing again can work: the network, a busy server or a server error; not a refusal with a reason. */
export function canRetry(e: unknown): boolean {
  const status = responseOf(e)?.status;
  return !status || status === 408 || status === 429 || status >= 500;
}
