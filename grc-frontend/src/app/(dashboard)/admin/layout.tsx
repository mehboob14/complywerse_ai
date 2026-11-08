import type { ReactNode } from 'react';
import SettingsLayout from './_shell/SettingsLayout';

// Every page under /admin: the Administration sections get the section list beside them (see _shell/SettingsLayout.tsx), the others pass through.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <SettingsLayout>{children}</SettingsLayout>;
}
