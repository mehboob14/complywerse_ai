'use client';

// Advanced Analytics > Bow-tie: one tool of the analytics page (the frame draws the head and the strip of tools; the tool is _tools/BowTieTool).
import { AnalyticsFrame } from '../_frame/AnalyticsFrame';
import { BowTieTool } from '../_tools/BowTieTool';

export default function Page() {
  return (
    <AnalyticsFrame tool="bowtie">
      <BowTieTool />
    </AnalyticsFrame>
  );
}
