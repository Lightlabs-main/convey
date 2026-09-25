import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Convey · Gift xStocks on X Layer",
  description: "Gift tokenized xStocks on X Layer in one link, from OKX Wallet or an AI agent. Recipients claim gasless into their own smart account.",
};

export const viewport: Viewport = { themeColor: "#050505" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
