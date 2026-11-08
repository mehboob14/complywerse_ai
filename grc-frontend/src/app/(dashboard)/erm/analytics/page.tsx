'use client';

// Advanced Analytics > the Heat map (the page's home): one tool of the analytics page (the frame draws the head and the strip of tools; the tool is _tools/HeatMapTool).
import { AnalyticsFrame } from './_frame/AnalyticsFrame';
import { HeatMapTool } from './_tools/HeatMapTool';

export default function Page() {
  return (
    <AnalyticsFrame tool="heatmap">
      <HeatMapTool />
    </AnalyticsFrame>
  );
}
