import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rally",
  description: "Group trips with friends, planned together.",
};

export const viewport: Viewport = {
  themeColor: "#FBF7EF",
  width: "device-width",
  initialScale: 1,
  // Lock zoom — Rally targets a mobile-app feel on phones. Disabling
  // pinch-zoom + locking maximumScale also kills iOS Safari's
  // auto-zoom-on-input-focus, so users don't get pushed sideways when
  // they tap a search field or paste an OTP code. Trade-off
  // acknowledged: low-vision users lose pinch-zoom on the page. The
  // browser's native page-zoom (via OS-level settings) still works.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
