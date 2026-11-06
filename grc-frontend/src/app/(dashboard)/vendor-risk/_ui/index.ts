// The TPRM ("Vendors") UI kit. Pages import from '@/app/(dashboard)/vendor-risk/_ui'. The names and props below are a contract with
// the page builders: add optional props, never rename or remove one.
export { ModuleHeader, DetailHeader } from './Headers';
export { Panel, ChartCard, EmptyState, ErrorState, Skeleton } from './Cards';
export { SegmentedControl, FilterFacet, ClearFilters, ToggleChip } from './Filters';
export { useUrlParams } from './useUrlParams';
export { StatTile, TierBadge, StatusPill, GradePill, SeverityChip, PersonChip } from './Stats';
export { ThresholdRuler, Donut, HalfGauge } from './Charts';
export { Dialog } from './Dialog';
export { tones, TONE, type Tone, type ToneColors } from './tones';
export { fmt } from './fmt';
// colours for the places a component takes a hex (a donut slice, a bar): the tier ramp, and a status family's dot
export { tierColor, tierLabel } from './tiers';
export { BTN, BTN_PRIMARY, BTN_ICON, BTN_TEXT, BTN_DANGER } from './buttons';
