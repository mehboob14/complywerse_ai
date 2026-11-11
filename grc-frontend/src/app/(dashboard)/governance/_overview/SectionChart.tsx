'use client';

// The ten section scores as bars against the target: one bar a section, weakest first, each in the colour of its band (strong, fair, weak: the legend says which,
// and the number is printed at the end of the bar), a dashed line at the target. A section with nothing to score yet is not a bar (it is not a 0): it is named
// under the chart. A bar opens its section's page with the mouse; the keyboard has the same pages in the posture card below (an arrow on every section). The
// numbers are a table for a screen reader (Picture). The rows, colours and bands are visualsModel.ts (sectionChart); this draws them.
import { useRouter } from 'next/navigation';
import { Bar, BarChart, Cell as BarCell, CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Picture, Swatches } from '@/components/overview/charts';
import { useNarrow } from '@/components/overview/useNarrow';
import { AXIS, GRID, HOVER, INK, INK_STRONG, TIP } from '@/components/overview/charts/palette';
import { link } from './parts';
import { BANDS, type SectionChart as SectionChartModel } from './visualsModel';

const ROW = 34;
const clip = (n: number) => (name: string): string => (name.length > n ? `${name.slice(0, n - 1)}…` : name);

export function SectionChart({ chart }: { chart: SectionChartModel }) {
  const router = useRouter();
  const narrow = useNarrow();                              // a phone: the names are shorter, so the bars have the width
  const data = chart.bars.map((b) => ({ name: b.name, score: b.score, color: b.color, page: b.page }));
  const go = (entry: unknown) => { const page = (entry as { payload?: { page?: string } } | null)?.payload?.page; if (page) router.push(link(page)); };
  return (
    <div>
      <Picture
        label="Section scores against the target"
        height={Math.max(200, chart.bars.length * ROW + 40)}
        data={{
          columns: ['Section', 'Score', 'Weight', 'Band'],
          rows: [...chart.bars.map((b) => [b.name, b.score, `${b.weightPct}%`, b.band]), ...chart.noData.map((n) => [n, null, null, 'No data'])],
        }}
      >
        {(focusOff) => (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 20, right: 28, left: 0, bottom: 0 }} barCategoryGap="24%" {...focusOff}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 2" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={narrow ? 104 : 150} interval={0} tick={AXIS} tickFormatter={clip(narrow ? 15 : 22)} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: HOVER }} contentStyle={TIP} formatter={(v: unknown) => [`${String(v)} out of 100`, 'Score']} />
              <ReferenceLine x={chart.target} stroke={INK} strokeDasharray="4 4" label={{ value: `Target ${chart.target}`, position: 'top', fontSize: 12, fill: INK }} />
              <Bar dataKey="score" name="Score" radius={[0, 4, 4, 0]} isAnimationActive={false} cursor="pointer" onClick={go}>
                {data.map((d) => <BarCell key={d.name} fill={d.color} />)}
                <LabelList dataKey="score" position="right" style={{ fontSize: 12, fill: INK_STRONG }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Picture>
      <Swatches items={BANDS} />
      {chart.noData.length > 0 && (
        <p className="mt-[8px] text-ds-label text-ds-fg-muted">{`No data yet: ${chart.noData.join(', ')}`}</p>
      )}
    </div>
  );
}
