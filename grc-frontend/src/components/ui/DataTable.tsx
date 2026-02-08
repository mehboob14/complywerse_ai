'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  X,
  Columns,
  Check,
  MoreHorizontal,
} from 'lucide-react';
import { clsx } from 'clsx';

export type SortDirection = 'asc' | 'desc' | null;

export interface ColumnDef<T> {
  id: string;
  header: string;
  accessor?: keyof T | ((row: T) => React.ReactNode);
  render?: (row: T, index: number) => React.ReactNode;
  sortable?: boolean;
  width?: string;
  minWidth?: string;
  hidden?: boolean;
}

export interface BulkAction<T> {
  id: string;
  label: string;
  icon?: React.ElementType;
  onClick: (selectedRows: T[]) => void;
  variant?: 'default' | 'danger';
}

export interface DataTableProps<T extends { id: string | number }> {
  data: T[];
  columns: ColumnDef<T>[];
  loading?: boolean;
  emptyMessage?: string;
  emptyIcon?: React.ElementType;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  selectable?: boolean;
  bulkActions?: BulkAction<T>[];
  onRowClick?: (row: T) => void;
  exportable?: boolean;
  exportFilename?: string;
  pageSize?: number;
  pageSizeOptions?: number[];
  className?: string;
  stickyHeader?: boolean;
}

function getCellValue<T>(row: T, accessor: keyof T | ((row: T) => React.ReactNode)): React.ReactNode {
  if (typeof accessor === 'function') {
    return accessor(row);
  }
  const value = row[accessor];
  if (value === null || value === undefined) return '';
  return String(value);
}

function getSortValue<T>(row: T, accessor: keyof T | ((row: T) => React.ReactNode)): string | number {
  if (typeof accessor === 'function') {
    const result = accessor(row);
    return typeof result === 'string' || typeof result === 'number' ? result : String(result ?? '');
  }
  const value = row[accessor];
  if (typeof value === 'string' || typeof value === 'number') return value;
  return String(value ?? '');
}

export function DataTable<T extends { id: string | number }>({
  data,
  columns: initialColumns,
  loading = false,
  emptyMessage = 'No data available',
  emptyIcon: EmptyIcon,
  searchable = false,
  searchPlaceholder = 'Search...',
  searchValue: externalSearchValue,
  onSearchChange: externalOnSearchChange,
  selectable = false,
  bulkActions = [],
  onRowClick,
  exportable = false,
  exportFilename = 'export',
  pageSize: initialPageSize = 10,
  pageSizeOptions = [10, 25, 50, 100],
  className,
  stickyHeader = false,
}: DataTableProps<T>) {
  const [internalSearchValue, setInternalSearchValue] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string | number>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() => {
    const visibility: Record<string, boolean> = {};
    initialColumns.forEach((col) => {
      visibility[col.id] = !col.hidden;
    });
    return visibility;
  });
  const [showColumnMenu, setShowColumnMenu] = useState(false);

  const searchValue = externalSearchValue ?? internalSearchValue;
  const onSearchChange = externalOnSearchChange ?? setInternalSearchValue;

  const visibleColumns = useMemo(() => {
    return initialColumns.filter((col) => columnVisibility[col.id] !== false);
  }, [initialColumns, columnVisibility]);

  const filteredData = useMemo(() => {
    if (!searchValue.trim()) return data;
    const query = searchValue.toLowerCase();
    return data.filter((row) => {
      return visibleColumns.some((col) => {
        if (!col.accessor) return false;
        const value = getCellValue(row, col.accessor);
        return String(value).toLowerCase().includes(query);
      });
    });
  }, [data, searchValue, visibleColumns]);

  const sortedData = useMemo(() => {
    if (!sortColumn || !sortDirection) return filteredData;
    const column = visibleColumns.find((col) => col.id === sortColumn);
    if (!column || !column.accessor) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aVal = getSortValue(a, column.accessor!);
      const bVal = getSortValue(b, column.accessor!);
      
      let comparison = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      } else {
        comparison = String(aVal).localeCompare(String(bVal));
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredData, sortColumn, sortDirection, visibleColumns]);

  const totalPages = Math.ceil(sortedData.length / pageSize);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const handleSort = useCallback((columnId: string) => {
    if (sortColumn === columnId) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(columnId);
      setSortDirection('asc');
    }
  }, [sortColumn, sortDirection]);

  const handleSelectRow = useCallback((rowId: string | number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedRows.size === paginatedData.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(paginatedData.map((row) => row.id)));
    }
  }, [paginatedData, selectedRows.size]);

  const handleExportCSV = useCallback(() => {
    const headers = visibleColumns
      .filter((col) => col.accessor)
      .map((col) => col.header);
    
    const rows = sortedData.map((row) => {
      return visibleColumns
        .filter((col) => col.accessor)
        .map((col) => {
          const value = getCellValue(row, col.accessor!);
          const strValue = String(value ?? '');
          if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
            return `"${strValue.replace(/"/g, '""')}"`;
          }
          return strValue;
        });
    });

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${exportFilename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [visibleColumns, sortedData, exportFilename]);

  const selectedRowsData = useMemo(() => {
    return data.filter((row) => selectedRows.has(row.id));
  }, [data, selectedRows]);

  const toggleColumnVisibility = useCallback((columnId: string) => {
    setColumnVisibility((prev) => ({
      ...prev,
      [columnId]: !prev[columnId],
    }));
  }, []);

  if (loading) {
    return (
      <div className={clsx('rounded-xl border border-slate-200 bg-white overflow-hidden', className)}>
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center gap-4">
            <div className="h-10 w-64 rounded-lg bg-slate-200 animate-pulse" />
            <div className="h-10 w-32 rounded-lg bg-slate-200 animate-pulse" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {initialColumns.slice(0, 5).map((_, i) => (
                  <th key={i} className="px-4 py-3">
                    <div className="h-4 w-24 rounded bg-slate-200 animate-pulse" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-200">
                  {initialColumns.slice(0, 5).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 w-full max-w-32 rounded bg-slate-200 animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('rounded-xl border border-slate-200 bg-white overflow-hidden', className)}>
      {(searchable || exportable || initialColumns.some((c) => !c.hidden)) && (
        <div className="p-4 border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-3">
            {searchable && (
              <div className="relative flex-1 min-w-64">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchValue}
                  onChange={(e) => {
                    onSearchChange(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder={searchPlaceholder}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-sm text-black placeholder-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 transition-colors"
                  aria-label={searchPlaceholder}
                />
                {searchValue && (
                  <button
                    onClick={() => {
                      onSearchChange('');
                      setCurrentPage(1);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 transition-colors"
                    aria-label="Clear search"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 ml-auto">
              <div className="relative">
                <button
                  onClick={() => setShowColumnMenu(!showColumnMenu)}
                  className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:text-slate-900 hover:border-slate-400 transition-colors"
                  aria-label="Toggle column visibility"
                >
                  <Columns size={16} />
                  <span className="hidden sm:inline">Columns</span>
                </button>
                {showColumnMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowColumnMenu(false)}
                    />
                    <div className="absolute right-0 top-full mt-2 z-50 w-48 rounded-lg border border-slate-300 bg-white py-1 shadow-elevated">
                      {initialColumns.map((col) => (
                        <button
                          key={col.id}
                          onClick={() => toggleColumnVisibility(col.id)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                        >
                          <div className={clsx(
                            'flex h-4 w-4 items-center justify-center rounded border',
                            columnVisibility[col.id]
                              ? 'border-primary-500 bg-primary-500'
                              : 'border-slate-400'
                          )}>
                            {columnVisibility[col.id] && <Check size={12} className="text-white" />}
                          </div>
                          <span>{col.header}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {exportable && (
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:text-slate-900 hover:border-slate-400 transition-colors"
                  aria-label="Export to CSV"
                >
                  <Download size={16} />
                  <span className="hidden sm:inline">Export</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {selectable && selectedRows.size > 0 && (
        <div className="flex items-center gap-4 px-4 py-3 bg-primary-50 border-b border-primary-200">
          <span className="text-sm text-primary-600">
            {selectedRows.size} row{selectedRows.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            {bulkActions.map((action) => {
              const ActionIcon = action.icon;
              return (
                <button
                  key={action.id}
                  onClick={() => action.onClick(selectedRowsData)}
                  className={clsx(
                    'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    action.variant === 'danger'
                      ? 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                      : 'bg-primary-50 text-primary-600 hover:bg-primary-100'
                  )}
                >
                  {ActionIcon && <ActionIcon size={14} />}
                  {action.label}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setSelectedRows(new Set())}
            className="ml-auto text-sm text-slate-500 hover:text-slate-900 transition-colors"
          >
            Clear selection
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className={clsx(stickyHeader && 'sticky top-0 z-10')}>
            <tr className="border-b border-slate-200 bg-slate-50">
              {selectable && (
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={paginatedData.length > 0 && selectedRows.size === paginatedData.length}
                    onChange={handleSelectAll}
                    className="h-4 w-4 rounded border-slate-300 bg-white text-primary-500 focus:ring-primary-500 focus:ring-offset-0"
                    aria-label="Select all rows"
                  />
                </th>
              )}
              {visibleColumns.map((column) => (
                <th
                  key={column.id}
                  className={clsx(
                    'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500',
                    column.sortable && 'cursor-pointer select-none hover:text-slate-900 transition-colors'
                  )}
                  style={{ width: column.width, minWidth: column.minWidth }}
                  onClick={column.sortable ? () => handleSort(column.id) : undefined}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{column.header}</span>
                    {column.sortable && (
                      <span className="flex-shrink-0">
                        {sortColumn === column.id ? (
                          sortDirection === 'asc' ? (
                            <ChevronUp size={14} className="text-primary-600" />
                          ) : (
                            <ChevronDown size={14} className="text-primary-600" />
                          )
                        ) : (
                          <ChevronsUpDown size={14} className="text-slate-500" />
                        )}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + (selectable ? 1 : 0)}
                  className="px-4 py-12 text-center"
                >
                  <div className="flex flex-col items-center gap-3">
                    {EmptyIcon && (
                      <EmptyIcon size={48} className="text-slate-600" />
                    )}
                    <p className="text-slate-500">{emptyMessage}</p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedData.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={clsx(
                    'border-b border-slate-200 transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-slate-50',
                    selectedRows.has(row.id) && 'bg-primary-500/5'
                  )}
                >
                  {selectable && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedRows.has(row.id)}
                        onChange={() => handleSelectRow(row.id)}
                        className="h-4 w-4 rounded border-slate-300 bg-white text-primary-500 focus:ring-primary-500 focus:ring-offset-0"
                        aria-label={`Select row ${row.id}`}
                      />
                    </td>
                  )}
                  {visibleColumns.map((column) => (
                    <td
                      key={column.id}
                      className="px-4 py-3 text-sm text-slate-600"
                      style={{ width: column.width, minWidth: column.minWidth }}
                    >
                      {column.render
                        ? column.render(row, rowIndex)
                        : column.accessor
                        ? getCellValue(row, column.accessor)
                        : null}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {sortedData.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 border-t border-slate-200">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span>Show</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-black focus:border-primary-500 focus:outline-none"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span>
              of {sortedData.length} result{sortedData.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
              <span className="hidden sm:inline">Previous</span>
            </button>
            <span className="text-sm text-slate-500">
              Page {currentPage} of {totalPages || 1}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Next page"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;
