import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IPL Fantasy 🏏',
  description: 'Play fantasy cricket with your friends — no hassle, fully live.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <header className="border-b border-gray-800 bg-gray-950 sticky top-0 z-50">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
            <span className="text-2xl">🏏</span>
            <span className="font-bold text-lg text-ipl-gold tracking-wide">Kayastha IPL league</span>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
