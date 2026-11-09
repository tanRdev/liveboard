import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DM_Sans, IBM_Plex_Mono } from "next/font/google";
import "@xyflow/react/dist/style.css";
import "./styles.css";

const sans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Liveboard · Architecture in motion",
  description:
    "Build systems, follow requests, and solve incident challenges. A system design interview workbench.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { themeColor: "#f7f8f6" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${sans.className}`}>
      <body>{children}</body>
    </html>
  );
}
