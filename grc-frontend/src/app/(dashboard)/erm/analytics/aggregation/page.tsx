'use client';

// Advanced Analytics > Aggregation: one tool of the analytics page (the frame draws the head and the strip of tools; the tool is _tools/AggregationTool).
import { AnalyticsFrame } from '../_frame/AnalyticsFrame';
import { AggregationTool } from '../_tools/AggregationTool';

export default function Page() {
  return (
    <AnalyticsFrame tool="aggregation">
      <AggregationTool />
    </AnalyticsFrame>
  );
}
