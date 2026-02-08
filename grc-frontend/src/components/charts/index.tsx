'use client';

import { useMemo } from 'react';
import { BarChart3, PieChart, TrendingUp, AlertTriangle, Info } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
}

export function ChartEmptyState({ title, description, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center p-6">
      <div className="rounded-xl bg-white p-4 mb-4">
        {icon || <BarChart3 className="h-8 w-8 text-slate-500" />}
      </div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {description && (
        <p className="text-xs text-slate-500 mt-1 max-w-[200px]">{description}</p>
      )}
    </div>
  );
}

interface RiskHeatmapProps {
  data: Array<{ likelihood: number; impact: number; count: number }>;
  onCellClick?: (likelihood: number, impact: number) => void;
}

export function RiskHeatmap({ data, onCellClick }: RiskHeatmapProps) {
  const grid = useMemo(() => {
    const matrix: number[][] = Array(5).fill(null).map(() => Array(5).fill(0));
    
    for (const item of data) {
      const row = 5 - item.likelihood;
      const col = item.impact - 1;
      if (row >= 0 && row < 5 && col >= 0 && col < 5) {
        matrix[row][col] = item.count;
      }
    }
    return matrix;
  }, [data]);

  const getCellColor = (likelihood: number, impact: number) => {
    const score = likelihood * impact;
    if (score >= 20) return 'bg-red-500/80 hover:bg-red-500';
    if (score >= 12) return 'bg-orange-500/80 hover:bg-orange-500';
    if (score >= 6) return 'bg-yellow-500/80 hover:bg-yellow-500';
    return 'bg-green-500/80 hover:bg-green-500';
  };

  if (data.length === 0) {
    return (
      <ChartEmptyState
        title="No risk data available"
        description="Risks will appear here once added to the register"
        icon={<AlertTriangle className="h-8 w-8 text-slate-500" />}
      />
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-end gap-2">
        <div className="flex flex-col justify-between h-[200px] text-xs text-slate-500 pr-2">
          <span>5</span>
          <span>4</span>
          <span>3</span>
          <span>2</span>
          <span>1</span>
        </div>
        <div className="flex-1">
          <div className="grid grid-cols-5 gap-1">
            {grid.map((row, rowIdx) =>
              row.map((count, colIdx) => {
                const likelihood = 5 - rowIdx;
                const impact = colIdx + 1;
                return (
                  <button
                    key={`${rowIdx}-${colIdx}`}
                    onClick={() => onCellClick?.(likelihood, impact)}
                    className={`
                      aspect-square rounded-md flex items-center justify-center
                      text-xs font-medium text-white transition-all duration-200
                      ${count > 0 ? getCellColor(likelihood, impact) : 'bg-slate-700/50 hover:bg-slate-700'}
                    `}
                  >
                    {count > 0 ? count : ''}
                  </button>
                );
              })
            )}
          </div>
          <div className="flex justify-between text-xs text-slate-500 mt-2 px-1">
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
            <span>5</span>
          </div>
        </div>
      </div>
      <div className="flex justify-center gap-4 mt-4 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-green-500" />
          <span className="text-slate-600">Low</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-yellow-500" />
          <span className="text-slate-600">Medium</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-orange-500" />
          <span className="text-slate-600">High</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-red-500" />
          <span className="text-slate-600">Critical</span>
        </div>
      </div>
      <div className="text-center mt-2">
        <span className="text-xs text-slate-500">Likelihood ↑ | Impact →</span>
      </div>
    </div>
  );
}

interface RadarChartProps {
  data: Array<{ label: string; value: number; maxValue?: number }>;
  size?: number;
}

export function RadarChart({ data, size = 200 }: RadarChartProps) {
  if (data.length === 0) {
    return (
      <ChartEmptyState
        title="No framework data"
        description="Upload frameworks to see maturity scores"
        icon={<PieChart className="h-8 w-8 text-slate-500" />}
      />
    );
  }

  const numPoints = data.length;
  const angleStep = (2 * Math.PI) / numPoints;
  const center = size / 2;
  const maxRadius = (size / 2) - 30;
  const levels = [20, 40, 60, 80, 100];

  const getPoint = (angle: number, radius: number) => ({
    x: center + radius * Math.sin(angle),
    y: center - radius * Math.cos(angle),
  });

  const points = data.map((d, i) => {
    const angle = i * angleStep;
    const normalizedValue = Math.min(100, Math.max(0, d.value));
    const radius = (normalizedValue / 100) * maxRadius;
    return getPoint(angle, radius);
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="overflow-visible">
        {levels.map((level) => {
          const r = (level / 100) * maxRadius;
          const levelPoints = data.map((_, i) => getPoint(i * angleStep, r));
          const levelPath = levelPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
          return (
            <path
              key={level}
              d={levelPath}
              fill="none"
              stroke="rgba(100, 116, 139, 0.3)"
              strokeWidth="1"
            />
          );
        })}

        {data.map((_, i) => {
          const angle = i * angleStep;
          const endPoint = getPoint(angle, maxRadius);
          return (
            <line
              key={i}
              x1={center}
              y1={center}
              x2={endPoint.x}
              y2={endPoint.y}
              stroke="rgba(100, 116, 139, 0.3)"
              strokeWidth="1"
            />
          );
        })}

        <path
          d={pathD}
          fill="rgba(59, 130, 246, 0.2)"
          stroke="rgb(59, 130, 246)"
          strokeWidth="2"
        />

        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="4"
            fill="rgb(59, 130, 246)"
            stroke="white"
            strokeWidth="2"
          />
        ))}

        {data.map((d, i) => {
          const angle = i * angleStep;
          const labelRadius = maxRadius + 20;
          const labelPoint = getPoint(angle, labelRadius);
          return (
            <text
              key={i}
              x={labelPoint.x}
              y={labelPoint.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-slate-400 text-[10px]"
            >
              {d.label.length > 10 ? d.label.substring(0, 8) + '..' : d.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

interface TrendLineProps {
  data: Array<{ label: string; value: number }>;
  color?: string;
  height?: number;
  showLabels?: boolean;
}

export function TrendLine({ data, color = '#3b82f6', height = 60, showLabels = true }: TrendLineProps) {
  if (data.length === 0) {
    return (
      <ChartEmptyState
        title="No trend data"
        description="Data will populate as activity occurs"
        icon={<TrendingUp className="h-8 w-8 text-slate-500" />}
      />
    );
  }

  const values = data.map(d => d.value);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const range = maxValue - minValue || 1;

  const width = 100;
  const padding = 5;
  const effectiveWidth = width - 2 * padding;
  const effectiveHeight = height - 2 * padding;

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1 || 1)) * effectiveWidth;
    const y = height - padding - ((d.value - minValue) / range) * effectiveHeight;
    return { x, y };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = pathD + ` L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

  const trend = values.length > 1 ? values[values.length - 1] - values[0] : 0;

  return (
    <div className="w-full">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`gradient-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#gradient-${color.replace('#', '')})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2" fill={color} />
        ))}
      </svg>
      {showLabels && (
        <div className="flex justify-between text-[10px] text-slate-500 mt-1 px-1">
          {data.map((d, i) => (
            <span key={i}>{d.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

interface DonutChartProps {
  data: Array<{ label: string; value: number; color: string }>;
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string | number;
}

export function DonutChart({ data, size = 120, thickness = 20, centerLabel, centerValue }: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  
  if (total === 0) {
    return (
      <ChartEmptyState
        title="No data available"
        description="Data will appear once activities begin"
        icon={<PieChart className="h-8 w-8 text-slate-500" />}
      />
    );
  }

  const radius = (size - thickness) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  let accumulatedOffset = 0;
  const segments = data.filter(d => d.value > 0).map((d) => {
    const percentage = d.value / total;
    const strokeLength = percentage * circumference;
    const offset = accumulatedOffset;
    accumulatedOffset += strokeLength;
    return { ...d, offset, strokeLength };
  });

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="rgba(100, 116, 139, 0.2)"
            strokeWidth={thickness}
          />
          {segments.map((seg, i) => (
            <circle
              key={i}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={`${seg.strokeLength} ${circumference - seg.strokeLength}`}
              strokeDashoffset={-seg.offset}
              strokeLinecap="round"
              className="transition-all duration-500"
            />
          ))}
        </svg>
        {(centerLabel || centerValue !== undefined) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {centerValue !== undefined && (
              <span className="text-xl font-bold text-white">{centerValue}</span>
            )}
            {centerLabel && (
              <span className="text-xs text-slate-600">{centerLabel}</span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-3 mt-4">
        {data.filter(d => d.value > 0).map((d, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="text-slate-600">{d.label}</span>
            <span className="text-slate-300 font-medium">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  color?: 'success' | 'warning' | 'danger' | 'primary';
  showPercentage?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function ProgressBar({ value, max = 100, label, color = 'primary', showPercentage = true, size = 'md' }: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  
  const colorClasses = {
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
    primary: 'bg-blue-500',
  };

  const heightClasses = {
    sm: 'h-1.5',
    md: 'h-2',
    lg: 'h-3',
  };

  return (
    <div className="w-full">
      {(label || showPercentage) && (
        <div className="flex justify-between items-center mb-1.5">
          {label && <span className="text-sm text-slate-300">{label}</span>}
          {showPercentage && <span className="text-sm font-medium text-slate-600">{Math.round(percentage)}%</span>}
        </div>
      )}
      <div className={`w-full rounded-full bg-slate-700 ${heightClasses[size]} overflow-hidden`}>
        <div
          className={`${heightClasses[size]} rounded-full ${colorClasses[color]} transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: string;
  icon?: React.ReactNode;
  color?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'cyan';
  onClick?: () => void;
}

export function KPICard({ title, value, subtitle, trend, trendValue, icon, color = 'blue', onClick }: KPICardProps) {
  const colorConfig = {
    blue: { gradient: 'from-blue-500/20 to-blue-600/10', text: 'text-blue-600', hover: 'hover:border-blue-500/50' },
    green: { gradient: 'from-emerald-500/20 to-emerald-600/10', text: 'text-emerald-600', hover: 'hover:border-emerald-500/50' },
    amber: { gradient: 'from-amber-500/20 to-amber-600/10', text: 'text-amber-600', hover: 'hover:border-amber-500/50' },
    red: { gradient: 'from-red-500/20 to-red-600/10', text: 'text-red-600', hover: 'hover:border-red-500/50' },
    purple: { gradient: 'from-purple-500/20 to-purple-600/10', text: 'text-primary-600', hover: 'hover:border-primary-500/50' },
    cyan: { gradient: 'from-cyan-500/20 to-cyan-600/10', text: 'text-cyan-600', hover: 'hover:border-cyan-500/50' },
  };

  const trendColors = {
    up: 'text-emerald-600',
    down: 'text-red-600',
    stable: 'text-slate-600',
  };

  const trendIcons = {
    up: '↑',
    down: '↓',
    stable: '→',
  };

  const config = colorConfig[color];

  return (
    <div 
      onClick={onClick}
      className={`
        rounded-xl border border-slate-200 bg-white p-5 
        transition-all duration-300 ${config.hover}
        ${onClick ? 'cursor-pointer hover:shadow-lg' : ''}
      `}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-slate-600 mb-1">{title}</p>
          <p className="text-3xl font-bold text-white">{value}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
          {trend && trendValue && (
            <div className={`flex items-center gap-1 mt-2 text-xs ${trendColors[trend]}`}>
              <span>{trendIcons[trend]}</span>
              <span>{trendValue}</span>
            </div>
          )}
        </div>
        {icon && (
          <div className={`rounded-xl bg-gradient-to-br ${config.gradient} p-3 ${config.text}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

interface StatusDistributionProps {
  data: Record<string, number>;
  colorMap?: Record<string, string>;
}

export function StatusDistribution({ data, colorMap }: StatusDistributionProps) {
  const total = Object.values(data).reduce((sum, v) => sum + v, 0);
  
  if (total === 0) {
    return (
      <ChartEmptyState
        title="No status data"
        description="Status distribution will appear here"
        icon={<Info className="h-8 w-8 text-slate-500" />}
      />
    );
  }

  const defaultColors: Record<string, string> = {
    compliant: '#10b981',
    partial: '#f59e0b',
    at_risk: '#ef4444',
    draft: '#6b7280',
    pending: '#f59e0b',
    approved: '#10b981',
    published: '#3b82f6',
    archived: '#6b7280',
    open: '#ef4444',
    closed: '#10b981',
    in_progress: '#3b82f6',
    critical: '#dc2626',
    high: '#f97316',
    medium: '#eab308',
    low: '#22c55e',
  };

  const colors = { ...defaultColors, ...colorMap };

  return (
    <div className="space-y-3">
      {Object.entries(data).map(([key, value]) => {
        const percentage = (value / total) * 100;
        const color = colors[key] || '#6b7280';
        return (
          <div key={key}>
            <div className="flex justify-between items-center text-sm mb-1">
              <span className="text-slate-300 capitalize">{key.replace(/_/g, ' ')}</span>
              <span className="text-slate-600">{value} ({Math.round(percentage)}%)</span>
            </div>
            <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${percentage}%`, backgroundColor: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
