// Analytics, the launcher: what the page decides, as pure functions apart from React so `node --test` can pin them (analyticsModel.test.ts). It reads the status the server answers in plain words (`ready`, `can_embed`, `headline`,
// `detail`; a server older than those still answers `configured` and `static_embed`, and the page works from those), says for each ready-made dashboard how it opens (in this page, or in a new tab), and puts a failed request
// into words a person can act on. The deployment keys of the same payload (site address, mode, licence note, mail settings) are never read: they belong to Administration.

/** `viewId` is the dashboard's number in the tool (used only to build the address; never shown), or null when no view is mapped for it yet. */
export interface StarterDashboard { key: string; title: string; hint: string; viewId: string | null }
export interface AnalyticsStatus { ready: boolean; canEmbed: boolean; headline: string; detail: string; dashboards: StarterDashboard[] }

type Raw = Record<string, unknown> | null | undefined;
const bool = (v: unknown): boolean => v === true;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export const NOT_SET_UP = 'Not set up yet';
export const NOT_SET_UP_DETAIL = 'Advanced analytics has not been set up for your organisation. Ask your administrator to set it up.';
export const CONNECTED = 'Connected';
export const CONNECTED_DETAIL = 'Open the analytics tool, or start from one of the ready-made dashboards below.';

/** The status, in the page's words. */
export function readStatus(raw: Raw): AnalyticsStatus {
  const ready = raw && 'ready' in raw ? bool(raw.ready) : bool(raw?.configured);
  const list = Array.isArray(raw?.starter_dashboards) ? (raw?.starter_dashboards as unknown[]) : [];
  const dashboards: StarterDashboard[] = list
    .map((d) => (d && typeof d === 'object' ? (d as Record<string, unknown>) : {}))
    .filter((d) => str(d.key) !== '')
    .map((d) => ({ key: str(d.key), title: str(d.title) || str(d.key), hint: str(d.hint), viewId: d.metabase_dashboard_id != null && String(d.metabase_dashboard_id).trim() !== '' ? String(d.metabase_dashboard_id).trim() : null }));
  return {
    ready,
    canEmbed: ready && ('can_embed' in (raw ?? {}) ? bool(raw?.can_embed) : bool(raw?.static_embed)),
    headline: str(raw?.headline) || (ready ? CONNECTED : NOT_SET_UP),
    detail: str(raw?.detail) || (ready ? CONNECTED_DETAIL : NOT_SET_UP_DETAIL),
    dashboards,
  };
}

export type OpenHow = 'here' | 'tab';

/** How a ready-made dashboard opens: in this page when the server can embed it and it has a view mapped to embed, else in a new tab (a dashboard with no view opens the tool's start page). */
export const openHow = (status: AnalyticsStatus, dashboard: StarterDashboard): OpenHow => (status.canEmbed && dashboard.viewId !== null ? 'here' : 'tab');
export const openLabel = (how: OpenHow): string => (how === 'here' ? 'View here' : 'Open in a new tab');

/** What a failed request to open the tool or a dashboard says: never the server's own words (they can name settings and addresses). */
export function openFailure(status: number | undefined): string {
  if (status === undefined) return 'The server could not be reached. Check your connection and try again.';
  if (status === 503) return NOT_SET_UP_DETAIL;
  if (status === 401 || status === 403) return 'Your role does not include advanced analytics.';
  return "Couldn't open it. Try again in a moment.";
}

/** "about 10 minutes" from the seconds an embedded view stays available (the server says 600); '' when it does not say. */
export function validFor(seconds: unknown): string {
  const n = typeof seconds === 'number' && Number.isFinite(seconds) ? Math.round(seconds / 60) : 0;
  return n >= 1 ? `about ${n} ${n === 1 ? 'minute' : 'minutes'}` : '';
}

/** Where a failed axios error came from: its HTTP status, or undefined when no answer arrived. */
export function statusOf(error: unknown): number | undefined {
  const s = (error as { response?: { status?: unknown } } | null | undefined)?.response?.status;
  return typeof s === 'number' ? s : undefined;
}
