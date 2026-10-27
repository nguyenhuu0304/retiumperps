import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Retium Perps | Sandbox', description: 'An isolated perpetuals research sandbox. Simulated balances and manual scenario prices. No live trading.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="vi"><body>{children}</body></html>; }
