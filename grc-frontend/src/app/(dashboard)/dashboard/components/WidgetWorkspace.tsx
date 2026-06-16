'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { GripHorizontal, Maximize2, Minimize2, RotateCcw } from 'lucide-react';

export interface WorkspaceWidgetConfig {
  id: string;
  title: string;
  content: ReactNode;
  defaultW?: number;
  defaultH?: number;
  minW?: number;
  minH?: number;
}

type LayoutItem = {
  x: number;
  y: number;
  w: number;
  h: number;
  minW: number;
  minH: number;
  minimized: boolean;
  lastH: number;
  z: number;
};

type LayoutState = Record<string, LayoutItem>;

type InteractionState = {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  initial: LayoutItem;
} | null;

const GRID_COLS = 12;
const ROW_HEIGHT = 84;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 1.15;
const MAX_ROWS = 500;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function rectsOverlap(a: Pick<LayoutItem, 'x' | 'y' | 'w' | 'h'>, b: Pick<LayoutItem, 'x' | 'y' | 'w' | 'h'>) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function resolveLayoutCollisions(layout: LayoutState): LayoutState {
  const entries = Object.entries(layout).sort(([, a], [, b]) => {
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return a.z - b.z;
  });

  const placed: Array<{ id: string; item: LayoutItem }> = [];
  const resolved: LayoutState = {};

  const fitsAt = (candidate: Pick<LayoutItem, 'x' | 'y' | 'w' | 'h'>) => {
    if (candidate.x < 0 || candidate.y < 0) return false;
    if (candidate.x + candidate.w > GRID_COLS) return false;
    if (candidate.y + candidate.h > MAX_ROWS) return false;
    for (const p of placed) {
      if (rectsOverlap(candidate, p.item)) return false;
    }
    return true;
  };

  for (const [id, item] of entries) {
    const startX = clamp(item.x, 0, GRID_COLS - item.w);
    const startY = clamp(item.y, 0, MAX_ROWS - item.h);
    let finalX = startX;
    let finalY = startY;
    let found = false;

    for (let y = startY; y <= MAX_ROWS - item.h; y++) {
      for (let x = y === startY ? startX : 0; x <= GRID_COLS - item.w; x++) {
        if (fitsAt({ x, y, w: item.w, h: item.h })) {
          finalX = x;
          finalY = y;
          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      // Deterministic fallback: append lower in the canvas.
      finalX = 0;
      finalY = placed.reduce((max, p) => Math.max(max, p.item.y + p.item.h), 0);
    }

    const next = { ...item, x: finalX, y: finalY };
    resolved[id] = next;
    placed.push({ id, item: next });
  }

  return resolved;
}

function buildDefaultLayout(widgets: WorkspaceWidgetConfig[]): LayoutState {
  const layout: LayoutState = {};
  let x = 0;
  let y = 0;
  let rowH = 0;

  widgets.forEach((widget, index) => {
    const w = clamp(widget.defaultW ?? 3, 2, GRID_COLS);
    const h = clamp(widget.defaultH ?? 2, 1, 8);
    const minW = clamp(widget.minW ?? 2, 1, GRID_COLS);
    const minH = clamp(widget.minH ?? 1, 1, 8);

    if (x + w > GRID_COLS) {
      x = 0;
      y += rowH;
      rowH = 0;
    }

    layout[widget.id] = {
      x,
      y,
      w,
      h,
      minW,
      minH,
      minimized: false,
      lastH: h,
      z: index + 1,
    };

    x += w;
    rowH = Math.max(rowH, h);
  });

  return layout;
}

function sanitizeStoredLayout(
  raw: unknown,
  widgets: WorkspaceWidgetConfig[]
): LayoutState | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Record<string, Partial<LayoutItem>>;
  const fallback = buildDefaultLayout(widgets);
  const sanitized: LayoutState = {};

  widgets.forEach((widget, index) => {
    const stored = parsed[widget.id];
    const base = fallback[widget.id];
    if (!stored) {
      sanitized[widget.id] = base;
      return;
    }
    const w = clamp(Math.round(stored.w ?? base.w), widget.minW ?? 2, GRID_COLS);
    const h = clamp(Math.round(stored.h ?? base.h), widget.minH ?? 1, 8);
    const x = clamp(Math.round(stored.x ?? base.x), 0, GRID_COLS - w);
    const y = clamp(Math.round(stored.y ?? base.y), 0, 200);

    sanitized[widget.id] = {
      x,
      y,
      w,
      h,
      minW: clamp(Math.round(stored.minW ?? widget.minW ?? base.minW), 1, GRID_COLS),
      minH: clamp(Math.round(stored.minH ?? widget.minH ?? base.minH), 1, 8),
      minimized: Boolean(stored.minimized ?? false),
      lastH: clamp(Math.round(stored.lastH ?? h), 1, 8),
      z: Math.max(1, Math.round(stored.z ?? index + 1)),
    };
  });

  return resolveLayoutCollisions(sanitized);
}

export default function WidgetWorkspace({
  tabKey,
  widgets,
}: {
  tabKey: string;
  widgets: WorkspaceWidgetConfig[];
}) {
  // Bump the version any time the per tab widget set changes shape so that
  // stale layouts from prior sessions do not pin removed widget ids or hide
  // newly added ones below the fold.
  const storageKey = `dashboard_workspace_layout_${tabKey}_v4`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<LayoutState>(() => buildDefaultLayout(widgets));
  const [interaction, setInteraction] = useState<InteractionState>(null);
  const [zoom, setZoom] = useState(0.92);
  const [maximizedWidgetId, setMaximizedWidgetId] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  useEffect(() => {
    const fallback = buildDefaultLayout(widgets);
    if (typeof window === 'undefined') {
      setLayout(fallback);
      return;
    }
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      setLayout(fallback);
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const sanitized = sanitizeStoredLayout(parsed, widgets);
      setLayout(sanitized ?? fallback);
    } catch {
      setLayout(fallback);
    }
  }, [storageKey, widgets]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, JSON.stringify(layout));
  }, [layout, storageKey]);

  useEffect(() => {
    const target = containerRef.current;
    if (!target || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerWidth(Math.max(360, entry.contentRect.width));
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const colWidth = useMemo(() => Math.max(10, containerWidth / GRID_COLS), [containerWidth]);

  useEffect(() => {
    if (!interaction) return;

    const onMove = (event: MouseEvent) => {
      const dx = event.clientX - interaction.startX;
      const dy = event.clientY - interaction.startY;
      const dxGrid = Math.round(dx / colWidth);
      const dyGrid = Math.round(dy / ROW_HEIGHT);

      setLayout((prev) => {
        const current = prev[interaction.id];
        if (!current) return prev;
        const base = interaction.initial;

        if (interaction.mode === 'move') {
          const nextW = current.w;
          const nextX = clamp(base.x + dxGrid, 0, GRID_COLS - nextW);
          const nextY = clamp(base.y + dyGrid, 0, 200);
          return {
            ...prev,
            [interaction.id]: {
              ...current,
              x: nextX,
              y: nextY,
            },
          };
        }

        const nextW = clamp(base.w + dxGrid, current.minW, GRID_COLS - base.x);
        const maxPossibleH = 200 - base.y;
        const nextH = clamp(base.h + dyGrid, current.minH, Math.max(current.minH, maxPossibleH));
        return {
          ...prev,
          [interaction.id]: {
            ...current,
            w: nextW,
            h: nextH,
            lastH: current.minimized ? current.lastH : nextH,
          },
        };
      });
    };

      const onUp = () => {
        setInteraction(null);
        setLayout((prev) => resolveLayoutCollisions(prev));
      };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [interaction, colWidth]);

  const raiseWidget = (id: string) => {
    setLayout((prev) => {
      const target = prev[id];
      if (!target) return prev;
      const maxZ = Object.values(prev).reduce((max, item) => Math.max(max, item.z), 1);
      return {
        ...prev,
        [id]: {
          ...target,
          z: maxZ + 1,
        },
      };
    });
  };

  const beginInteraction = (id: string, mode: 'move' | 'resize', event: ReactMouseEvent) => {
    event.preventDefault();
    const item = layout[id];
    if (!item) return;
    raiseWidget(id);
    setInteraction({
      id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      initial: item,
    });
  };

  const toggleMinimize = (id: string) => {
    setLayout((prev) => {
      const item = prev[id];
      if (!item) return prev;
      if (item.minimized) {
        return resolveLayoutCollisions({
          ...prev,
          [id]: {
            ...item,
            minimized: false,
            h: Math.max(item.minH, item.lastH || item.minH),
          },
        });
      }
      return resolveLayoutCollisions({
        ...prev,
        [id]: {
          ...item,
          minimized: true,
          lastH: item.h,
          h: 1,
        },
      });
    });
  };

  const resetLayout = () => {
    // Nuke every cached dashboard layout, not just this tab's. Fixes the
    // edge case where new widgets were added to multiple tabs but the
    // operator's cached layouts pin the old widget set.
    if (typeof window !== 'undefined') {
      try {
        const keys = Object.keys(window.localStorage).filter((k) =>
          k.startsWith('dashboard_workspace_layout_')
        );
        keys.forEach((k) => window.localStorage.removeItem(k));
      } catch {
        // best effort; if localStorage is unavailable the default layout
        // still applies for the current tab.
      }
    }
    setLayout(resolveLayoutCollisions(buildDefaultLayout(widgets)));
    setMaximizedWidgetId(null);
  };

  const totalRows = useMemo(() => {
    const maxY = Object.values(layout).reduce((max, item) => Math.max(max, item.y + item.h), 8);
    return Math.max(8, maxY);
  }, [layout]);

  const canvasHeight = totalRows * ROW_HEIGHT;

  const activeMaxWidget = maximizedWidgetId
    ? widgets.find((widget) => widget.id === maximizedWidgetId) ?? null
    : null;

  return (
    <div className="flex h-[calc(100vh-164px)] flex-col gap-3 overflow-hidden bg-[var(--color-surface)]">
      <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
        <p className="text-xs cw-text-muted">
          Drag by header, resize from bottom-right, minimize or maximize any widget.
        </p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1">
            <button
              type="button"
              onClick={() => setZoom((z) => clamp(Number((z - 0.05).toFixed(2)), MIN_ZOOM, MAX_ZOOM))}
              className="rounded px-1 text-xs cw-text-muted hover:bg-[var(--color-hover)]"
            >
              -
            </button>
            <span className="min-w-[44px] text-center text-xs font-medium cw-text">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => clamp(Number((z + 0.05).toFixed(2)), MIN_ZOOM, MAX_ZOOM))}
              className="rounded px-1 text-xs cw-text-muted hover:bg-[var(--color-hover)]"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={resetLayout}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs font-medium cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div
          className="absolute inset-0 origin-top-left"
          style={{
            transform: `scale(${zoom})`,
            width: `${100 / zoom}%`,
            height: `${100 / zoom}%`,
          }}
        >
          <div className="relative" style={{ height: `${canvasHeight}px` }}>
            {widgets.map((widget) => {
              const item = layout[widget.id];
              if (!item) return null;
              return (
                <div
                  key={widget.id}
                  className="absolute overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm"
                  style={{
                    left: `${(item.x / GRID_COLS) * 100}%`,
                    width: `${(item.w / GRID_COLS) * 100}%`,
                    top: `${item.y * ROW_HEIGHT}px`,
                    height: `${item.h * ROW_HEIGHT - 8}px`,
                    zIndex: item.z,
                  }}
                  onMouseDown={() => raiseWidget(widget.id)}
                >
                  <div
                    className="flex cursor-move items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5"
                    onMouseDown={(event) => beginInteraction(widget.id, 'move', event)}
                  >
                    <div className="flex items-center gap-1.5">
                      <GripHorizontal className="h-3.5 w-3.5 cw-text-muted" />
                      <span className="text-xs font-medium cw-text">{widget.title}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleMinimize(widget.id)}
                        className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
                        title={item.minimized ? 'Restore' : 'Minimize'}
                      >
                        <Minimize2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setMaximizedWidgetId(widget.id)}
                        className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
                        title="Maximize"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {!item.minimized && maximizedWidgetId !== widget.id && (
                    <div className="h-[calc(100%-32px)] overflow-auto p-2">
                      {widget.content}
                    </div>
                  )}

                  {!item.minimized && (
                    <button
                      type="button"
                      className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize rounded-tl-sm bg-[var(--color-border)] hover:bg-[var(--color-base)]/40"
                      onMouseDown={(event) => beginInteraction(widget.id, 'resize', event)}
                      title="Resize"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {activeMaxWidget && (
          <div className="absolute inset-0 z-[1200] bg-black/30 p-3">
            <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
                <h3 className="text-sm font-semibold cw-text">{activeMaxWidget.title}</h3>
                <button
                  type="button"
                  onClick={() => setMaximizedWidgetId(null)}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text"
                >
                  Close
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-3">{activeMaxWidget.content}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
