'use client';

// The unit's PROPERTIES: a centered dialog over the Directory (focus kept inside, Escape or X closes it, focus goes back to the unit that opened it) with the unit's name under its folder
// icon, "Properties" and its place in the organisation, and a strip of tabs. It opens from the toolbar's Properties, the menus, Alt+Enter and a link; a double-click goes INTO the folder. Which tabs there are is directoryTabs.ts (a tab is registered there and enabled there; this file knows none by name). The open tab is
// in the address (?open=<unit>&tab=<tab>), so a link opens the same popup and a reload keeps it. A tab says when it holds typed input (`setDirty`), and then Escape, X and a
// press on the dim area ask "Discard changes?" first (the dialog's own guard). A tab is drawn when first opened and kept, so what was typed in one stays while another is read.
import { useCallback, useMemo, useRef, useState } from 'react';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { InfoTip } from '@/components/ui/InfoTip';
import { ReadOnlyNote, TabPanel, Tabs } from '@/components/ui/ds';
import { DIRECTORY_TABS, ENABLED_TABS, ORG_TABS, type DirectoryTabProps } from './directoryTabs';
import { FolderIcon } from './folderIcon';
import { ORGANISATION, shownTabs, tabOr, type DirectoryNode, type DirectoryTree, type TabId } from './directoryModel';
import { useRefreshDirectory } from './directoryData';

interface Props {
  node: DirectoryNode;
  tree: DirectoryTree;
  levels: readonly string[];
  canTop: boolean;
  /** the open tab (an id that is not shown opens the first) */
  tab: string;
  onTab: (tab: TabId) => void;
  onClose: () => void;
  onOpenUnit: (id: number, tab?: TabId) => void;
  /** the popup is on the whole organisation (its defaults): `node` is its stand-in (organisationNode) and only the tabs of ORG_TABS show */
  organisation?: boolean;
  /** opened by "Edit details": the Details tab puts the cursor in the first field */
  focusName?: boolean;
}

export function UnitPopup({ node, tree, levels, canTop, tab, onTab, onClose, onOpenUnit, organisation = false, focusName = false }: Props) {
  const refresh = useRefreshDirectory();
  const shown = useMemo(() => shownTabs(DIRECTORY_TABS, ENABLED_TABS).filter((t) => !organisation || ORG_TABS.includes(t.id)), [organisation]);
  const open = tabOr(tab, shown) as TabId;
  const [dirty, setDirtyMap] = useState<Record<string, boolean>>({});
  const setters = useRef<Record<string, (value: boolean) => void>>({});
  const dirtyFor = useCallback((id: string) => {
    if (!setters.current[id]) setters.current[id] = (value) => setDirtyMap((m) => (!!m[id] === value ? m : { ...m, [id]: value }));
    return setters.current[id];
  }, []);
  const above = organisation ? ORGANISATION : tree.path(node.id).slice(0, -1).map((p) => p.name).join(' › ') || ORGANISATION;
  const subtitle = organisation ? 'Defaults for every unit' : `Properties · ${node.level_label}${node.is_active ? '' : ' · Inactive'} · in ${above}`;
  const props = (id: TabId): DirectoryTabProps => ({
    node, tree, levels, canTop, canManage: node.can_manage, refresh, setDirty: dirtyFor(id), organisation, focusName, openUnit: onOpenUnit, close: onClose,
  });

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="xl"
      title={<span className="flex min-w-0 items-center gap-[8px]"><FolderIcon size={24} open inactive={!node.is_active} /><span className="min-w-0 truncate">{node.name}</span></span>}
      subtitle={subtitle}
      dirty={Object.values(dirty).some(Boolean)}
      discardLabel="Discard changes"
    >
      {!node.can_manage && (
        <div className="px-[20px] pt-[12px]">
          <ReadOnlyNote>
            View only
            <InfoTip text={organisation ? 'You can read these defaults but not change them. An administrator, or someone who can edit the governance settings, can.' : "You can read this unit but not change its details or who has access. An administrator, or whoever manages it, can. The approval defaults follow the governance settings right."} label={organisation ? 'Why the defaults are view only' : 'Why this unit is view only'} />
          </ReadOnlyNote>
        </div>
      )}
      <Tabs tabs={shown.map((t) => ({ key: t.id, label: t.label }))} value={open} onChange={(k) => onTab(k as TabId)} ariaLabel={`${node.name}: sections`} className="mt-[4px]">
        {shown.map((t) => (
          <TabPanel key={t.id} tabKey={t.id} lazy className="p-[16px] sm:p-[20px]">{t.render(props(t.id))}</TabPanel>
        ))}
      </Tabs>
    </AnimatedModal>
  );
}
