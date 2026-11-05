// The public attestation page carries a private link in its address: it must not leave in a Referer header (the document may link out),
// and the page is not for search engines.

export const metadata = {
  title: 'Document attestation',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function AttestLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
