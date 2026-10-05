import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "readback",
  description: "A prescription status demo on synthetic data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
