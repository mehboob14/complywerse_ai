// What a failed read of the document means on the page: the server refused it (403: its own sentence), it is not there (404), or the read FAILED (a 500, no connection,
// a timeout). Only the first two are "you may not" and "not found"; a failed read must not be said as "not found" (it offers Retry instead). Pure: docLoad.test.ts.

export type LoadFailure = 'refused' | 'missing' | 'failed';

/** null while there is no error. A status the server answered with is its answer; no status at all (offline, timed out) is a failure to read. */
export function loadFailure(error: unknown): LoadFailure | null {
  if (error == null) return null;
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 403) return 'refused';
  if (status === 404) return 'missing';
  return 'failed';
}
