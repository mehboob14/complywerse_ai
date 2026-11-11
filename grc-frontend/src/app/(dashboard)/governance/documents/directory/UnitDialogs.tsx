'use client';

// The two small dialogs of the Directory: New (a unit under the one you are in, or a department at the top) and Move to… (a unit to another place). Both are the kit's centered
// dialog: focus inside, Escape closes, and they ask "Discard changes?" when something was typed or chosen. The fields and rules are UnitForm's and lib/departments.ts's; the
// places a unit can go are directoryModel's (not itself, not under itself, not too deep, not switched off, only where the person may manage); the server's refusal (a name
// already taken, a place that would be too deep) is shown in the dialog as it says it, with the choice kept.
import { useMemo, useState } from 'react';
import { MAX_DEPTH, levelLabel, willBeText } from '@/lib/departments';
import { departmentsApi, type Department } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Button, FormError, FormField, Select, useReportedMutation } from '@/components/ui/ds';
import { UnitForm } from './UnitForm';
import { useRefreshDirectory } from './directoryData';
import { ORGANISATION, moveChoices, type DirectoryNode, type DirectoryTree } from './directoryModel';

interface Common { tree: DirectoryTree; levels: readonly string[]; canTop: boolean; onClose: () => void }

export function NewUnitDialog({ start, tree, levels, canTop, onClose, onCreated }: Common & { start: number | null; onCreated: (created: Department) => void }) {
  const [dirty, setDirty] = useState(false);
  const level = levelLabel(start === null ? 1 : (tree.node(start)?.level ?? 0) + 1, [...levels]);
  return (
    <AnimatedModal isOpen onClose={onClose} size="lg" title={`New ${level}`} subtitle={start === null ? ORGANISATION : tree.path(start).map((p) => p.name).join(' › ')} dirty={dirty} discardLabel="Discard">
      <div className="p-[16px] sm:p-[20px]">
        <UnitForm mode="create" tree={tree} levels={levels} canTop={canTop} start={start} onCancel={onClose} onDirty={setDirty} onSaved={onCreated} />
      </div>
    </AnimatedModal>
  );
}

export function MoveDialog({ node, tree, levels, canTop, onClose, onMoved }: Common & { node: DirectoryNode; onMoved: (id: number) => void }) {
  const refresh = useRefreshDirectory();
  const places = useMemo(() => moveChoices(tree, node.id, { canTop, levels }), [tree, node.id, canTop, levels]);
  const now = node.parent_department_id === null ? '' : String(node.parent_department_id);
  const [to, setTo] = useState(now);
  const [problem, setProblem] = useState<unknown>(null);
  const target = to === '' ? null : Number(to);
  const where = places.find((p) => p.value === to)?.label ?? ORGANISATION;
  const move = useReportedMutation({
    mutationFn: async () => (await departmentsApi.update(node.id, { parent_department_id: target })).data,
    success: () => `${node.name} moved to ${where}`,
    failure: "The unit wasn't moved",
    toast: 'success',                                       // a refusal is said here, in the dialog, in the server's words
    onSuccess: () => { refresh(); onMoved(node.id); },
    onError: setProblem,
    retryable: false,
  });
  return (
    <AnimatedModal isOpen onClose={onClose} size="md" title={`Move ${node.name}`} subtitle={`Now under ${now === '' ? ORGANISATION : tree.path(node.id).slice(0, -1).map((p) => p.name).join(' › ')}`} dirty={to !== now} discardLabel="Discard">
      <form
        noValidate
        onSubmit={(e) => { e.preventDefault(); setProblem(null); if (to !== now) move.mutate(); }}
        className="flex flex-col gap-[12px] p-[16px] sm:p-[20px]"
      >
        <FormError title="Couldn't move the unit" error={problem} />
        <FormField
          label="Move to"
          info={`Units go ${MAX_DEPTH} levels deep: ${levels.slice(0, MAX_DEPTH).join(', ')}. Not listed: itself, the units under it, switched-off units, places that would take it too deep, and places you cannot manage.`}
          hint={willBeText(tree.nodes, target, [...levels])}
        >
          <Select value={to} onChange={(e) => setTo(e.target.value)} autoFocus>
            {places.map((p) => <option key={p.value} value={p.value}>{p.label}{p.subLabel ? ` · ${p.subLabel}` : ''}</option>)}
          </Select>
        </FormField>
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={move.isPending} disabled={to === now}>Move</Button>
        </div>
      </form>
    </AnimatedModal>
  );
}
