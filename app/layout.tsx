import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Convey — a stock gift, in one link",
  description: "Receive a real tokenized stock on X Layer without a prior wallet or gas.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
