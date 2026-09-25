import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Convey · Gift xStocks on X Layer",
  description: "Send tokenized xStocks from OKX Wallet in one link. Recipients claim gasless into their own smart account on X Layer.",
};

export const viewport: Viewport = { themeColor: "#050505" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
