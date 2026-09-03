import type { Metadata } from "next";
import { Playfair_Display, DM_Sans, Poppins } from "next/font/google";
import { brandTitle } from "@attatta/shared";
import "./globals.css";

const display = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["600", "700"],
});

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

/** Geometric rounded sans — closest public stand-in for AT&T Aleck / Omnes. */
const att = Poppins({
  subsets: ["latin"],
  variable: "--font-att",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: brandTitle(),
  description:
    "Assemble modular paid-social variants for Celtra distribution — SCOTTY, Paul's name on the IP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${sans.variable} ${att.variable}`}
    >
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
