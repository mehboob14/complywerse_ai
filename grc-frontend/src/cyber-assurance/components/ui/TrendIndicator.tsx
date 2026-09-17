'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { clsx } from 'clsx';

export type TrendDirection = 'up' | 'down' | 'neutral';
export type TrendSize = 'sm' | 'md' | 'lg';

export interface TrendIndicatorProps {
  direction: TrendDirection;
  value: number;
  size?: TrendSize;
  className?: string;
  showIcon?: boolean;
  inverted?: boolean;
}

const sizeStyles: Record<TrendSize, { text: string; icon: number }> = {
  sm: { text: 'text-xs', icon: 12 },
  md: { text: 'text-sm', icon: 14 },
  lg: { text: 'text-base', icon: 18 },
};

export function TrendIndicator({
  direction,
  value,
  size = 'md',
  className,
  showIcon = true,
  inverted = false,
}: TrendIndicatorProps) {
  const sizeStyle = sizeStyles[size];

  const getColor = () => {
    if (direction === 'neutral') return 'text-slate-600';
    const isPositive = inverted ? direction === 'down' : direction === 'up';
    return isPositive ? 'text-success-500' : 'text-danger-500';
  };

  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 font-medium',
        sizeStyle.text,
        getColor(),
        className
      )}
      role="status"
      aria-label={`Trend ${direction} by ${Math.abs(value)}%`}
    >
      {showIcon && <Icon size={sizeStyle.icon} aria-hidden="true" />}
      <span>{Math.abs(value)}%</span>
    </span>
  );
}

export default TrendIndicator;
