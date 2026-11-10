// The words for a report's measure in the "Number to show" list: the report's own name for it, else what the builder calls it ("Total Residual score").
import { measureLabel } from '../../_reports/aggregate-utils';
import type { Measure, ReportSpec } from '../../_reports/types';
import { datasetByKey } from '../../_reports/datasets';

export function aggLabelFor(m: Measure, spec: ReportSpec | null): string {
  const ds = spec ? datasetByKey(spec.dataset) : undefined;
  const field = m.key ? ds?.columns.find((c) => c.key === m.key)?.label ?? '' : '';
  return measureLabel(m, field);
}
