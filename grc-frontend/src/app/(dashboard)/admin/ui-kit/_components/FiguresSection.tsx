'use client';

// The numbers a page opens with: StatTile (a figure, with every state it can be in), ProgressBar (a share, drawn and read out) and ChartFrame (a chart
// with a title and its numbers in words). Everything here is static or simulated: no request leaves the page.
import { useEffect, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, ChartFrame, ProgressBar, StatTile, StatusPill } from '@/components/ui';
import { formatCount } from '@/lib/format';
import { Grid, GuideSection, Row, Spec, Specimen } from './Guide';

const TILES = 'grid grid-cols-1 gap-[16px] sm:grid-cols-2 xl:grid-cols-3';
const FRAME = 'rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';

// An SVG attribute cannot read a class, so a chart spells the hex of the token it means.
const GRID = '#e1e6eb';        // --ds-border
const INK = '#586472';         // --ds-fg-muted
const BRAND = '#0f766e';       // --ds-primary
const TIP = { fontSize: 12, border: '1px solid #e1e6eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)', color: '#1f2933' };

const MONTHS = [
  { month: 'May', created: 4, published: 2 }, { month: 'Jun', created: 6, published: 3 }, { month: 'Jul', created: 3, published: 4 },
  { month: 'Aug', created: 8, published: 5 }, { month: 'Sep', created: 5, published: 6 }, { month: 'Oct', created: 7, published: 4 },
];
const STATUSES = [
  { label: 'Draft', value: 50, fill: '#586472' }, { label: 'Pending approval', value: 44, fill: '#6d28d9' }, { label: 'Approved', value: 40, fill: '#08794f' },
  { label: 'Rejected', value: 22, fill: '#b42318' }, { label: 'Revoked', value: 18, fill: '#9a5007' },
];

function FailedTile() {
  const [phase, setPhase] = useState<'failed' | 'loading' | 'ok'>('failed');
  const tries = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const retry = () => {
    setPhase('loading');
    tries.current += 1;
    timer.current = setTimeout(() => setPhase(tries.current >= 2 ? 'ok' : 'failed'), 600);        // the simulated server answers on the second try
  };
  return (
    <div className="space-y-[8px]">
      <StatTile
        label="Exceptions"
        value={phase === 'ok' ? formatCount(174) : null}
        unit={phase === 'ok' ? 'exceptions' : undefined}
        loading={phase === 'loading'}
        error={phase === 'failed' ? { title: "Couldn't load exceptions", message: "The server didn't answer. Check your connection and try again.", onRetry: retry } : null}
      />
      {phase === 'ok' && <Button size="sm" onClick={() => { tries.current = 0; setPhase('failed'); }}>Reset the demo</Button>}
    </div>
  );
}

function TileDemo() {
  return (
    <div className="space-y-[16px]">
      <div className={TILES}>
        <Specimen label="A figure, what it counts and a line of facts">
          <StatTile label="Documents" value={formatCount(41)} unit="documents" note="3 archived" />
        </Specimen>
        <Specimen label="link: the figure opens the records (Tab to it: a ring, a 24 px target)">
          <StatTile label="Documents" value={formatCount(41)} unit="documents" note="3 archived" link={{ href: '#figures', label: '41 documents. Open the library (this demo stays on the page)' }} />
        </Specimen>
        <Specimen label="info and progress: the (i) and the share bar">
          <StatTile label="Coverage" value="78%" progress={78} info="Documents mapped to at least one framework control, as a share of all documents." note="32 of 41 documents mapped" />
        </Specimen>
        <Specimen label="tone=&quot;danger&quot;: something is wrong">
          <StatTile label="Overdue actions" value={formatCount(12)} tone="danger" note="3 more than last week" />
        </Specimen>
        <Specimen label="tone=&quot;success&quot;: something is done">
          <StatTile label="Actions done" value="92%" tone="success" progress={92} note="46 of 50 actions" />
        </Specimen>
        <Specimen label="children: pills and links under the figure">
          <StatTile label="Exceptions" value={formatCount(174)} unit="exceptions">
            <div className="flex flex-wrap gap-[8px]"><StatusPill size="sm" tone="pending" label="Pending 44" /><StatusPill size="sm" tone="warning" label="Expiring soon 10" /></div>
          </StatTile>
        </Specimen>
      </div>
      <div className={TILES}>
        <Specimen label="value={null}: nothing is recorded (not 0); the (i) says why">
          <StatTile label="Attendance" value={null} info="No meeting has been marked completed yet, so there is no attendance to average." />
        </Specimen>
        <Specimen label="loading: a skeleton, announced to a screen reader">
          <StatTile label="Overdue actions" value={null} loading />
        </Specimen>
        <Specimen label="error: what failed and Retry, never a 0 (works on the second try)">
          <FailedTile />
        </Specimen>
        <Specimen label="Narrow (200 px): the words wrap, the figure keeps its size">
          <StatTile className="w-[200px] max-w-full" label="Documents awaiting approval" value={formatCount(1234)} unit="documents" note="in review or in approval" info="Documents whose approval has been asked for and not yet given." />
        </Specimen>
      </div>
    </div>
  );
}

function BarDemo() {
  return (
    <div className="space-y-[16px]">
      <Grid>
        <Specimen label="0, a value (72) and 100: the number is beside the bar"><div className="space-y-[10px]"><ProgressBar value={0} label="Not started" /><ProgressBar value={72} label="Delivery progress" /><ProgressBar value={100} label="Complete" /></div></Specimen>
        <Specimen label="One decimal only below 10; a stored value above 100 fills the track and still says 120%"><div className="space-y-[10px]"><ProgressBar value={7.5} label="Early progress" /><ProgressBar value={120} label="Over-reported progress" /></div></Specimen>
        <Specimen label="Not recorded (null): no bar and a dash, never 0%; a screen reader hears &quot;Delivery progress: not recorded&quot;"><ProgressBar value={null} label="Delivery progress" /></Specimen>
        <Specimen label="tone: primary (default), success, warning, danger"><div className="space-y-[10px]"><ProgressBar value={60} label="Primary" /><ProgressBar tone="success" value={60} label="Success" /><ProgressBar tone="warning" value={60} label="Warning" /><ProgressBar tone="danger" value={60} label="Danger" /></div></Specimen>
        <Specimen label="valueText: the words are the page's (&quot;3 of 5 steps&quot;); the bar is drawn from value"><ProgressBar value={60} valueText="3 of 5 steps" label="Onboarding steps" /></Specimen>
        <Specimen label="showValue={false}: the bar alone, for a tile that already shows the figure"><ProgressBar value={45} label="Coverage" showValue={false} /></Specimen>
      </Grid>
      <Specimen label="The width is the caller's: 72 px in a table cell, 160 px beside a name, and the full line">
        <Row gap={16}>
          <ProgressBar className="w-[72px]" value={64} label="Row progress" />
          <ProgressBar className="w-[160px]" value={64} label="Milestone progress" />
          <ProgressBar className="w-full" value={64} label="Programme progress" />
        </Row>
      </Specimen>
    </div>
  );
}

function ChartDemo() {
  return (
    <Grid cols={2}>
      <Specimen label="An area chart in a frame: the title, the chart (a picture, hidden from assistive technology) and its numbers as a table that only a screen reader sees. Tab goes past it: it takes no focus">
        <div className={FRAME}>
          <ChartFrame
            title="Documents created and published each month"
            note="The last six months"
            height={240}
            data={{ columns: ['Month', 'Created', 'Published'], rows: MONTHS.map((m) => [m.month, m.created, m.published]) }}
          >
            {(focusOff) => (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={MONTHS} margin={{ top: 8, right: 12, left: -14, bottom: 0 }} {...focusOff}>
                  <CartesianGrid strokeDasharray="2 2" stroke={GRID} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: INK }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: INK }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TIP} />
                  <Area type="monotone" dataKey="created" name="Created" stroke={INK} fill={INK} fillOpacity={0.1} strokeWidth={2} isAnimationActive={false} />
                  <Area type="monotone" dataKey="published" name="Published" stroke={BRAND} fill={BRAND} fillOpacity={0.14} strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
        </div>
      </Specimen>
      <Specimen label="A donut: the Pie takes the same props (rootTabIndex), or its group is a tab stop of its own">
        <div className={FRAME}>
          <ChartFrame
            title="Exceptions by status"
            note="174 exceptions"
            height={240}
            data={{ columns: ['Status', 'Exceptions'], rows: STATUSES.map((st) => [st.label, st.value]) }}
          >
            {(focusOff) => (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart {...focusOff}>
                  <Pie data={STATUSES} dataKey="value" nameKey="label" innerRadius={52} outerRadius={84} paddingAngle={2} isAnimationActive={false} {...focusOff}>
                    {STATUSES.map((st) => <Cell key={st.label} fill={st.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={TIP} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
        </div>
      </Specimen>
    </Grid>
  );
}

export function FiguresSection() {
  return (
    <GuideSection id="figures" title="Figures and charts" lead="The numbers a page opens with, the shares it draws and the charts that picture them. A figure is never a 0 that stands for a failure, a wait or nothing recorded: each of those has its own state. A chart always has its numbers in words.">
      <Spec name="StatTile"><TileDemo /></Spec>
      <Spec name="ProgressBar"><BarDemo /></Spec>
      <Spec name="ChartFrame"><ChartDemo /></Spec>
    </GuideSection>
  );
}
