import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { AuthPanel } from "@/components/auth-panel";
import { getRuntimeConfig } from "@/lib/config";

const config = getRuntimeConfig();

export const metadata: Metadata = {
  title: config.app.title,
  description: "Custom interface for Microsoft Foundry Content Understanding workflows.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <div>
              <p className="eyebrow">Microsoft Foundry Content Understanding</p>
              <Link className="brand" href="/">
                {config.app.title}
              </Link>
            </div>
            <nav className="nav-links" aria-label="Primary navigation">
              <Link href="/">Overview</Link>
              <Link href="/upload">Upload</Link>
            </nav>
            <AuthPanel />
          </header>
          <main className="page-frame">{children}</main>
        </div>
      </body>
    </html>
  );
}
