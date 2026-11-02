// Arrow-key movement inside a flyout menu (the rail's group menus, the Administration menu), as a pure decision:
// `node --test src/components/layout/menuKeys.test.ts`. NavTree.tsx moves focus to the item this names.

/** The item focus goes to on `key` in a menu of `count` items while it is on `index` (-1: on none of them), or null when the key does not move it.
 *  Down and Up wrap around; Home and End jump to the ends. */
export function menuTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown': return index < 0 ? 0 : (index + 1) % count;
    case 'ArrowUp': return index < 0 ? count - 1 : (index - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}
