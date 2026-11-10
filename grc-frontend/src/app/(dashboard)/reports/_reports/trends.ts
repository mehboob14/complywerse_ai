// Trends data layer: talks to the backend snapshot history (/reporting/trends/*). The types and the pure helpers (formatting, change, status, filters) are in ../_trends/trendsModel.ts,
// free of the API client so `node --test` can run them.

import apiClient from '@/lib/api';
import type { BreakdownResp, OverviewResp, TargetBody, TrendCard } from '../_trends/trendsModel';

export const trendsApi = {
  overview: (days = 180) =>
    apiClient.get('/reporting/trends/overview', { params: { days } }).then((r) => r.data as OverviewResp),
  series: (metric: string, days = 180, dimension = 'overall', dimension_value = 'all') =>
    apiClient.get('/reporting/trends/series', { params: { metric, days, dimension, dimension_value } })
      .then((r) => r.data as TrendCard),
  breakdown: (metric: string, days = 180) =>
    apiClient.get('/reporting/trends/breakdown', { params: { metric, days } })
      .then((r) => r.data as BreakdownResp),
  setTarget: (body: TargetBody) =>
    apiClient.put('/reporting/trends/targets', body).then((r) => r.data),
  resetTarget: (metric: string, dimension = 'overall', dimension_value = 'all') =>
    apiClient.delete('/reporting/trends/targets', { params: { metric, dimension, dimension_value } }).then((r) => r.data),
  /** Captures today's values (one point per day, repeated captures on the same day replace it). Never called by a read. */
  snapshot: () =>
    apiClient.post('/reporting/trends/snapshot').then((r) => r.data as { written: number; as_of: string }),
};
