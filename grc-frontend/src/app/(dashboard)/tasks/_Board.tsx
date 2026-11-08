'use client';

// The Board tab of Task Management is the All tasks register (_register/TaskRegister): the facet explorer over every task the person may see. This file is the seam the page imports, so the
// page that holds the tabs does not change when the register does.
import { TaskRegister } from './_register/TaskRegister';

export function Board({ canCreate, onNew }: { canCreate: boolean; onNew: () => void }) {
  return <TaskRegister canCreate={canCreate} onNew={onNew} />;
}
