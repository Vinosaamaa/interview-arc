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
import "./workspace-atmosphere.css";

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
  axes: ["opsz"],
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
          THESIS: Engineering memory is an immutable evidence ledger, not a generic analytics dashboard.
          OWN-WORLD: Deep-teal shell, pale-mint field, cream reader, lime signal, Geist workhorse type, selective Newsreader display, and flat bordered instruments.
          STORY: Choose Engineering, find one exact record, verify its source and lineage, then move through factual views without losing context.
          FIRST VIEWPORT: A compact workspace rail and six-item Engineering nav frame a two-pane Journal; the selected record opens with status, title, immutable lineage, and exact-source action before narrative detail.
          FORM: Approved two-pane Continuity Ledger, direction 1 of 1; seed key continuity-ledger-engineering.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        */}
        {children}
      </body>
    </html>
  );
}
