// The chart kit of the Overview pages (graphical dashboards on the design-system kit). One import line for a page:
//   import { ChartCard, ChartGrid, Cell, KpiRow, KpiTile, DonutChart, BarList, SegmentBar, StackedBars, TrendChart, Heatmap, ScoreRing, Sparkline, Picture } from '@/components/overview/charts';
// and, for the colours and the pure rules (tested in chartModel.test.ts): { SERIES, STATUS, BRAND, … } from '@/components/overview/charts/palette' and the helpers from
// '@/components/overview/charts/chartModel'. Rules of use: charts/README in this folder's header comments, and features/ux-revamp-platform.md §13.
export { ChartCard, type ChartCardProps, type ChartState } from './ChartCard';
export { ChartGrid, Cell, type Span } from './ChartGrid';
export { KpiTile, KpiRow, type KpiTileProps, type KpiTone } from './KpiTile';
export { Sparkline, type SparklineProps } from './Sparkline';
export { DonutChart, type DonutChartProps } from './DonutChart';
export { BarList, type BarListProps, type BarRow } from './BarList';
export { SegmentBar, type SegmentBarProps } from './SegmentBar';
export { StackedBars, type StackedBarsProps, type StackCategory, type StackSeries } from './StackedBars';
export { TrendChart, type TrendChartProps, type TrendRow, type TrendSeries } from './TrendChart';
export { Heatmap, type HeatmapProps } from './Heatmap';
export { ScoreRing, type ScoreRingProps } from './ScoreRing';
export { Picture, Swatches, type PictureProps } from './Picture';
export * from './chartModel';
export { SERIES, STATUS, BRAND, OTHER, RAMP, seriesColor, type StatusColor } from './palette';
