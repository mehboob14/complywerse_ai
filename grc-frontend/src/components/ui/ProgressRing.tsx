'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';

export type ProgressRingColor = 'primary' | 'success' | 'warning' | 'danger' | 'info';

export interface ProgressRingProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color?: ProgressRingColor;
  label?: string;
  showPercentage?: boolean;
  animated?: boolean;
  className?: string;
}

const colorStyles: Record<ProgressRingColor, { stroke: string; text: string }> = {
  primary: { stroke: 'stroke-primary-500', text: 'text-primary-600' },
  success: { stroke: 'stroke-success-500', text: 'text-success-400' },
  warning: { stroke: 'stroke-warning-500', text: 'text-warning-400' },
  danger: { stroke: 'stroke-danger-500', text: 'text-danger-400' },
  info: { stroke: 'stroke-info-500', text: 'text-info-400' },
};

export function ProgressRing({
  percentage,
  size = 80,
  strokeWidth = 6,
  color = 'primary',
  label,
  showPercentage = true,
  animated = true,
  className,
}: ProgressRingProps) {
  const [animatedPercentage, setAnimatedPercentage] = useState(animated ? 0 : percentage);
  
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (animatedPercentage / 100) * circumference;
  const colorStyle = colorStyles[color];

  useEffect(() => {
    if (!animated) {
      setAnimatedPercentage(percentage);
      return;
    }

    const timer = setTimeout(() => {
      setAnimatedPercentage(percentage);
    }, 100);

    return () => clearTimeout(timer);
  }, [percentage, animated]);

  return (
    <div
      className={clsx('relative inline-flex items-center justify-center', className)}
      role="progressbar"
      aria-valuenow={percentage}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || `Progress: ${percentage}%`}
    >
      <svg
        width={size}
        height={size}
        className="transform -rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-slate-700"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={clsx(
            colorStyle.stroke,
            animated && 'transition-[stroke-dashoffset] duration-1000 ease-out'
          )}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {showPercentage && (
          <span className={clsx('font-bold', colorStyle.text, size < 60 ? 'text-sm' : size < 100 ? 'text-lg' : 'text-xl')}>
            {Math.round(animatedPercentage)}%
          </span>
        )}
        {label && (
          <span className="text-xs text-slate-600 mt-0.5 text-center px-1 truncate max-w-full">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

export default ProgressRing;
