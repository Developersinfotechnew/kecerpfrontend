import type { Metadata } from 'next';
import { SessionProvider } from './session';
import { ToastHost } from '@/components/toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'KEC Agritech ERP',
  description: 'PMC, EPTP, EPC and O&M in one application.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/*
         * Fonts via CDN link rather than next/font. next/font fetches at
         * build time and would fail the build in an offline environment; a
         * link degrades gracefully to the system stack in globals.css.
         *
         * Inter is the primary UI face — a neutral, professional grotesk
         * used by most enterprise tools. JetBrains Mono for numerals and
         * code so figures line up.
         */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <SessionProvider>
          {children}
          <ToastHost />
        </SessionProvider>
      </body>
    </html>
  );
}
