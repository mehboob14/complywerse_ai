// Help Desk area wrapper — width container only. Navigation lives in the global
// app sidebar's Help Desk submenu (components/layout/Sidebar.tsx), so no
// secondary nav bar here.
export default function HelpDeskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1600px]">{children}</div>
  );
}
