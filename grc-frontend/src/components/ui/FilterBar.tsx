'use client';

import { Search, X, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig {
  id: string;
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
}

export interface ActiveFilter {
  id: string;
  label: string;
  value: string;
  displayValue: string;
}

export interface FilterBarProps {
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  filters?: FilterConfig[];
  activeFilters?: ActiveFilter[];
  onClearFilter?: (id: string) => void;
  onClearAll?: () => void;
  className?: string;
}

export function FilterBar({
  searchValue = '',
  searchPlaceholder = 'Search...',
  onSearchChange,
  filters = [],
  activeFilters = [],
  onClearFilter,
  onClearAll,
  className,
}: FilterBarProps) {
  const hasActiveFilters = activeFilters.length > 0;

  return (
    <div className={clsx('space-y-2.5', className)}>
      <div className="flex flex-wrap items-center gap-2.5">
        {onSearchChange && (
          <div className="relative flex-1 min-w-64">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-sm text-black placeholder-slate-500 transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              aria-label={searchPlaceholder}
            />
            {searchValue && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-900"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {filters.map((filter) => (
          <div key={filter.id} className="relative">
            <select
              value={filter.value}
              onChange={(e) => filter.onChange(e.target.value)}
              className="cursor-pointer appearance-none rounded-lg border border-slate-300 bg-white py-1.5 pl-3 pr-8 text-sm text-black transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              aria-label={filter.label}
            >
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
              aria-hidden="true"
            />
          </div>
        ))}
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Active filters:</span>
          {activeFilters.map((filter) => (
            <span
              key={`${filter.id}-${filter.value}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-0.5 text-xs text-primary-600"
            >
              <span>{filter.label}: {filter.displayValue}</span>
              {onClearFilter && (
                <button
                  onClick={() => onClearFilter(filter.id)}
                  className="transition-colors hover:text-primary-700"
                  aria-label={`Remove ${filter.label} filter`}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
          {onClearAll && (
            <button
              onClick={onClearAll}
              className="text-xs text-slate-500 underline underline-offset-2 transition-colors hover:text-slate-900"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default FilterBar;
