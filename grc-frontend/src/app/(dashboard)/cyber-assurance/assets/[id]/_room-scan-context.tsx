"use client";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Room-scan selection — shared between HostApplicationsPanel (renders the
 * checkboxes) and ComplianceTab (uses the selection to augment the matched-
 * benchmark count and the existing "Scan now" button).
 *
 * Why context: selectedPeerIds is read in two unrelated components on the
 * same page, but lives below a query result that only HostApplicationsPanel
 * has. A small context is cheaper than prop-drilling through every parent.
 *
 * `peerRuleCount(id)` is filled by HostApplicationsPanel after its ip-peers
 * query resolves, so ComplianceTab can show "296 + 74 = 370 rules" without
 * having to re-query. If the panel hasn't reported a peer's rule count yet,
 * the getter returns 0 (a safe lower bound for the additive display).
 */
export type PeerInfo = { name: string; ruleCount: number };

export type RoomScanContextValue = {
  selectedPeerIds: number[];
  togglePeer: (id: number) => void;
  clearSelection: () => void;
  isSelected: (id: number) => boolean;
  // Panel reports each peer's name + rule count once ip-peers resolves.
  reportPeer: (id: number, info: PeerInfo) => void;
  // Back-compat shim — old callers wrote only rule_count; keeping for
  // anything I missed. Prefer reportPeer going forward.
  reportPeerRuleCount: (id: number, ruleCount: number) => void;
  peerRuleCount: (id: number) => number;
  peerName: (id: number) => string | undefined;
  // Sum of rule counts for currently-selected peers (memoized).
  selectedPeerRuleSum: number;
};

const RoomScanCtx = createContext<RoomScanContextValue | null>(null);

export function RoomScanProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // peer id -> { name, rule_count }, populated by HostApplicationsPanel.
  const [peers, setPeers] = useState<Record<number, PeerInfo>>({});

  const togglePeer = useCallback((id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const reportPeer = useCallback((id: number, info: PeerInfo) => {
    setPeers(prev => {
      const existing = prev[id];
      if (existing && existing.name === info.name && existing.ruleCount === info.ruleCount) return prev;
      return { ...prev, [id]: info };
    });
  }, []);

  const reportPeerRuleCount = useCallback((id: number, ruleCount: number) => {
    setPeers(prev => {
      const existing = prev[id];
      if (existing && existing.ruleCount === ruleCount) return prev;
      return { ...prev, [id]: { name: existing?.name ?? `Asset ${id}`, ruleCount } };
    });
  }, []);

  const peerRuleCount = useCallback(
    (id: number) => peers[id]?.ruleCount ?? 0,
    [peers],
  );

  const peerName = useCallback(
    (id: number) => peers[id]?.name,
    [peers],
  );

  const selectedIdsArr = useMemo(() => Array.from(selected), [selected]);

  const selectedPeerRuleSum = useMemo(
    () => selectedIdsArr.reduce((sum, id) => sum + (peers[id]?.ruleCount ?? 0), 0),
    [selectedIdsArr, peers],
  );

  const value = useMemo<RoomScanContextValue>(() => ({
    selectedPeerIds: selectedIdsArr,
    togglePeer,
    clearSelection,
    isSelected: (id: number) => selected.has(id),
    reportPeer,
    reportPeerRuleCount,
    peerRuleCount,
    peerName,
    selectedPeerRuleSum,
  }), [selectedIdsArr, togglePeer, clearSelection, selected, reportPeer, reportPeerRuleCount, peerRuleCount, peerName, selectedPeerRuleSum]);

  return <RoomScanCtx.Provider value={value}>{children}</RoomScanCtx.Provider>;
}

/**
 * Hook for consumers. Returns a no-op fallback when used outside a provider —
 * this lets HostApplicationsPanel be embedded on pages that don't wrap with
 * RoomScanProvider (e.g. a standalone preview), without crashing.
 */
export function useRoomScan(): RoomScanContextValue {
  const ctx = useContext(RoomScanCtx);
  if (ctx) return ctx;
  return {
    selectedPeerIds: [],
    togglePeer: () => {},
    clearSelection: () => {},
    isSelected: () => false,
    reportPeer: () => {},
    reportPeerRuleCount: () => {},
    peerRuleCount: () => 0,
    peerName: () => undefined,
    selectedPeerRuleSum: 0,
  };
}
