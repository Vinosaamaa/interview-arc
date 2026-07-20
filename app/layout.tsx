import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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
    description: "A personal training ledger with six-hour session countdowns, activity stopwatches, interview records, and honest progress.",
    icons: {
      icon: "/og.png",
      shortcut: "/og.png",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
