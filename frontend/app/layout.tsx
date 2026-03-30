import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Enviapy 2.0 | AG Codelab',
  description: 'Multi-tenant WhatsApp Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-100 h-screen">{children}</body>
    </html>
  );
}
