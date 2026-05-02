import Providers from '@/components/Providers';
import AuthHandoff from '@/components/AuthHandoff';
import './globals.css';

export const metadata = {
  title: 'CompliverseAI',
  description: 'Enterprise Governance, Risk, and Compliance Platform',
  icons: {
    icon: [
      { url: '/icon.png',  },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-800">
        <Providers>
          {/* Reads auth_token + tenant context from URL fragment on first mount,
              hydrates localStorage, then strips the fragment. Required for the
              cross-subdomain login redirect to carry auth across origins. */}
          <AuthHandoff />
          {children}
        </Providers>
      </body>
    </html>
  );
}
