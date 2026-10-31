// The design-system kit (UX revamp, Phase 1): one export line per component. Kit rules: kitRules.ts, enforced by kitGuard.test.ts.
export { Button, IconButton, type ButtonProps, type IconButtonProps } from './Button';
export { FormField, useFieldControl, type FormFieldProps } from './FormField';
export { TextInput, type TextInputProps } from './TextInput';
export { Textarea, type TextareaProps } from './Textarea';
export { Select, type SelectProps } from './Select';
export { Checkbox, type CheckboxProps } from './Checkbox';
export { StatusPill, type StatusPillProps } from './StatusPill';
export { Avatar, type AvatarProps, type AvatarSize } from './Avatar';
export { PersonChip, type PersonChipProps } from './PersonChip';
export { PersonStack, type PersonStackProps } from './PersonStack';
export { EmptyState, type EmptyStateProps, type EmptyStateKind } from './EmptyState';
export { ErrorState, type ErrorStateProps } from './ErrorState';
export { NoAccessState, type NoAccessStateProps } from './NoAccessState';
export { Notice, type NoticeProps, type NoticeTone } from './Notice';
export { Skeleton, SkeletonLines, SkeletonRows, type SkeletonProps, type SkeletonLinesProps, type SkeletonRowsProps } from './Skeleton';
export { Menu, type MenuItem, type MenuProps } from './Menu';
export { Pager, type PagerProps } from './Pager';
export { Tabs, TabPanel, type TabItem, type TabPanelProps, type TabsProps } from './Tabs';
export { useTabParam } from './useTabParam';
export { useAddressState, type AddressStateOptions } from './useAddressState';
export {
  TableFrame, Table, THead, TBody, Tr, Th, Td, RowHeaderCell,
  type TableFrameProps, type TableProps, type TrProps, type ThProps, type TdProps, type RowHeaderCellProps, type CellAlign,
} from './Table';
export { RegisterTable, type RegisterTableProps, type RegisterColumn } from './RegisterTable';
export {
  nextSort, ariaSort, sortRows, priorityClass, rowCountText,
  type SortState, type SortDir, type SortCycle, type SortValue, type ColumnPriority,
} from './tableModel';
export { SectionCard, type SectionCardProps } from './SectionCard';
export { SaveBar, type SaveBarProps } from './SaveBar';
export { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from './SegmentedControl';
export { ReadOnlyNote, type ReadOnlyNoteProps } from './ReadOnlyNote';
export { StatTile, type StatTileProps, type StatTone } from './StatTile';
export { ProgressBar, type ProgressBarProps, type ProgressTone } from './ProgressBar';
export { ChartFrame, type ChartFrameProps, type ChartData } from './ChartFrame';
export { chartFocusOff } from './chartText';
export { ConfirmDialog, type ConfirmDialogProps, type ConfirmRequest } from './ConfirmDialog';
export { useConfirm, type ConfirmOptions } from './useConfirm';
export { useNotify, type Notify, type NotifyOptions, type NotifyErrorOptions } from './useNotify';
export { useReportedMutation, type ReportedMutationConfig } from './useReportedMutation';
export { DiscardBar, useDiscardGuard } from './DiscardBar';
