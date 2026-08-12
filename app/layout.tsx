import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import "./interview-arc-v2.css";
import "./review-queue.css";
import "./behavioral-targets.css";
import "./interview-page-hero.css";
import "./loops-redesign.css";
import "./engineering-workspace.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const baseUrl = new URL(host ? `${protocol}://${host}` : "http://localhost:3000");
  const socialImage = new URL("/og-connected.png", baseUrl).toString();

  return {
    title: "Interview Arc — Your preparation journey",
    description: "A personal training ledger with configurable session countdowns, activity stopwatches, interview records, and honest progress.",
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "Interview Arc",
      description: "Six hours. Eight activities. One honest record.",
      images: [{ url: socialImage, width: 1672, height: 941 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Interview Arc",
      description: "Six hours. Eight activities. One honest record.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} antialiased`}
      >
        {/*
          THESIS: Interview preparation is a continuous record, not a pile of tools.
          OWN WORLD: An incumbent editorial ledger extended by the approved Loop tracker.
          STORY: Choose a workspace, follow one hiring process, inspect only recorded facts.
          FIRST VIEWPORT: Workspace hierarchy, current company and role, then stage continuity.
          FORM: Deep-teal rail, quiet paper surfaces, lime status, specialty accents.
          FINISH: Responsive, keyboard-visible, reduced-motion safe, and explicit about missing data.
          DESIGN SEED: approved-loop-continuity.
        */}
        {children}
      </body>
    </html>
  );
}
