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
  success: { stroke: 'stroke-success-500', text: 'text-success-600' },
  warning: { stroke: 'stroke-warning-500', text: 'text-warning-600' },
  danger: { stroke: 'stroke-danger-500', text: 'text-danger-600' },
  info: { stroke: 'stroke-info-500', text: 'text-info-600' },
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
      className={clsx('inline-flex flex-col items-center justify-center', className)}
      role="progressbar"
      aria-valuenow={percentage}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || `Progress: ${percentage}%`}
    >
      <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
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
            className="text-slate-200"
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
        {showPercentage && (
          <span
            className={clsx(
              'absolute inset-0 flex items-center justify-center font-bold leading-none',
              colorStyle.text,
              size < 50 ? 'text-[11px]' : size < 70 ? 'text-xs' : size < 100 ? 'text-base' : 'text-xl'
            )}
          >
            {Math.round(animatedPercentage)}%
          </span>
        )}
      </div>
      {label && (
        <span className="mt-1.5 text-[11px] font-medium text-slate-600 text-center max-w-[calc(100%+1rem)] truncate">
          {label}
        </span>
      )}
    </div>
  );
}

export default ProgressRing;
