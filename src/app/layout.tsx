import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@xyflow/react/dist/style.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "Liveboard · Architecture in motion",
  description:
    "Build systems, follow requests, and solve incident challenges. A system design interview workbench.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { themeColor: "#f7f8f6" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
