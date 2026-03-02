import Providers from '@/components/Providers';
import './globals.css';

export const metadata = {
  title: 'ComplyVerse',
  description: 'Enterprise Governance, Risk, and Compliance Platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
