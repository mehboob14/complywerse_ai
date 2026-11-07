import localFont from 'next/font/local';
import Providers from '@/components/Providers';
import AuthHandoff from '@/components/AuthHandoff';
import './globals.css';

// Self-hosted (Latin subset, the same files next/font/google fetched): a build on a server with a poor route to Google
// no longer fails on a font download. Keep this the Latin subset; add a file here for another script.
const poppins = localFont({
  src: [
    { path: './fonts/poppins-300.woff2', weight: '300', style: 'normal' },
    { path: './fonts/poppins-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/poppins-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/poppins-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/poppins-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-poppins',
  display: 'swap',
});

// One variable file covers every weight (400-600 are used).
const jetbrainsMono = localFont({
  src: [{ path: './fonts/jetbrains-mono-latin.woff2', weight: '100 800', style: 'normal' }],
  variable: '--font-mono',
  display: 'swap',
});

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
      <body className={`${poppins.variable} ${jetbrainsMono.variable} bg-slate-50 text-slate-800`}>
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
