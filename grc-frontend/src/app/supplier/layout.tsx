// The supplier portal's pages carry a personal link in their address: it must not leave
// in a Referer header, and the pages are not for search engines.

export const metadata = {
  title: 'Supplier portal',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
