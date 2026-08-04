'use client';

import { Search, X } from 'lucide-react';
import { clsx } from 'clsx';
import { type InputHTMLAttributes, forwardRef } from 'react';

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size' | 'type'> {
  value: string;
  onChange: (value: string) => void;
  /** Optional explicit clear handler. Defaults to calling onChange('') */
  onClear?: () => void;
  /** Fully rounded pill (default) or rounded-lg square */
  variant?: 'pill' | 'square';
  size?: 'sm' | 'md' | 'lg';
  placeholder?: string;
  /** Show the X button when there's text. Default true. */
  clearable?: boolean;
  className?: string;
}

const sizeStyles = {
  sm: 'h-8 text-xs pl-8 pr-7',
  md: 'h-10 text-sm pl-10 pr-9',
  lg: 'h-11 text-sm pl-10 pr-9',
};

const iconSizes = {
  sm: 14,
  md: 16,
  lg: 16,
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onChange,
    onClear,
    variant = 'pill',
    size = 'md',
    placeholder = 'Search...',
    clearable = true,
    className,
    ...rest
  },
  ref,
) {
  const handleClear = () => {
    if (onClear) onClear();
    else onChange('');
  };

  const showClear = clearable && value.length > 0;

  return (
    <div className={clsx('relative inline-flex w-full items-center', className)}>
      <Search
        size={iconSizes[size]}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
      />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={clsx(
          'w-full border bg-white text-slate-900 placeholder-slate-400 transition-colors',
          'border-slate-300 hover:border-slate-400',
          'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/15',
          variant === 'pill' ? 'rounded-full' : 'rounded-lg',
          sizeStyles[size],
        )}
        {...rest}
      />
      {showClear && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={iconSizes[size]} />
        </button>
      )}
    </div>
  );
});

export default SearchInput;
