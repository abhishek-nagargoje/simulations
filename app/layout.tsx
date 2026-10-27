import type { Metadata, Viewport } from 'next';
import './globals.css';

// Icons come from the file conventions app/favicon.ico, app/icon.svg and app/apple-icon.png.
export const metadata: Metadata = {
  title: { default: 'Applications', template: '%s' },
  description: 'Business applications.',
  applicationName: 'Applications',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#334155',
};

// Browser extensions (e.g. UI.Vision adds data-kantu, ColorZilla adds
// cz-shortcut-listen) write attributes onto <html> and <body> before React
// loads. suppressHydrationWarning applies only to these two elements' own
// attributes, one level deep: mismatches anywhere inside the application are
// still reported. See docs/TROUBLESHOOTING.md.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
