// The requests of the Regulatory Changes / Feed screens that lib/api.ts does not carry (the routes added for the revamp, and the feed's, which the old page called through the bare client).
// Everything else is regulatoryApi in lib/api.ts, unchanged.
import apiClient from '@/lib/api';
import type { FeedAssignee } from './types';

const CHANGES = '/governance/regulatory-changes';
const FEEDS = '/governance/regulatory-feeds';

export const regulatoryExtra = {
  /** Every change in one request, with the true total in the X-Total-Count header. */
  listChanges: (limit = 1000) => apiClient.get(`${CHANGES}/changes`, { params: { limit } }),
  overview: () => apiClient.get(`${CHANGES}/overview`),
  myWork: () => apiClient.get(`${CHANGES}/my-work`),
  /** The people and roles the pickers offer; any signed-in person may read them. */
  people: () => apiClient.get(`${CHANGES}/people`),
};

export const feedApi = {
  counts: () => apiClient.get(`${FEEDS}/items/counts`),
  items: (params: { status?: string; limit?: number; search?: string }) => apiClient.get(`${FEEDS}/items`, { params }),
  sources: () => apiClient.get(`${FEEDS}/sources`),
  createSource: (data: Record<string, unknown>) => apiClient.post(`${FEEDS}/sources`, data),
  deleteSource: (id: number) => apiClient.delete(`${FEEDS}/sources/${id}`),
  pollSource: (id: number) => apiClient.post(`${FEEDS}/sources/${id}/poll`),
  pollAll: () => apiClient.post(`${FEEDS}/poll-all`),
  assign: (id: number, assignees: FeedAssignee[]) => apiClient.put(`${FEEDS}/sources/${id}/assignments`, { assignees }),
  /** Adds the Federal Reserve and ECB feeds (the route is named for a former seed). */
  seedDefaults: () => apiClient.post(`${FEEDS}/seed-cbsl`),
  analyze: (id: number) => apiClient.post(`${FEEDS}/items/${id}/analyze`, undefined, { timeout: 3 * 60 * 1000 }),
  convert: (id: number) => apiClient.post(`${FEEDS}/items/${id}/convert`),
  dismiss: (id: number) => apiClient.post(`${FEEDS}/items/${id}/dismiss`),
  restore: (id: number) => apiClient.post(`${FEEDS}/items/${id}/restore`),
};
