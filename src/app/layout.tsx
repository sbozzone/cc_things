import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'getToDo',
  description: 'A calm task manager: capture a thought, plan your day, keep commitments visible.',
  applicationName: 'getToDo',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'getToDo', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/apple-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Text must stay zoomable to 200% (N06), so scaling is never locked.
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f6f4' },
    { media: '(prefers-color-scheme: dark)', color: '#17181a' },
  ],
};

/**
 * Applies the stored theme before first paint so a dark-mode user never sees a light
 * flash. Kept inline and tiny; it reads one localStorage key and sets two attributes.
 */
const themeBootstrap = `
(function () {
  try {
    var raw = localStorage.getItem('clearing.appearance');
    if (!raw) return;
    var v = JSON.parse(raw);
    if (v.theme === 'light' || v.theme === 'dark') document.documentElement.dataset.theme = v.theme;
    if (v.colorTheme === 'orange' || v.colorTheme === 'sage' || v.colorTheme === 'bright' || v.colorTheme === 'white') document.documentElement.dataset.palette = v.colorTheme;
    if (v.reducedMotion) document.documentElement.dataset.motion = 'reduced';
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        {children}
      </body>
    </html>
  );
}
