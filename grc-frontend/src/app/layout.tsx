import Providers from '@/components/Providers';
import './globals.css';

export const metadata = {
  title: 'Enterprise GRC Platform',
  description: 'Governance, Risk, and Compliance Management Platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-900 text-slate-100">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
