// The public pages under /vendor-risk (the examiner report and the older questionnaire link) carry a secret in their address:
// it must not leave in a Referer header and the pages are not for search engines.

export const metadata = {
  title: 'Vendor risk',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function PublicVendorRiskLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
