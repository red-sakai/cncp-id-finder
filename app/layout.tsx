import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

const interTight = Inter_Tight({
  variable: "--font-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cisco NetConnect PUP - Manila | ID Finder",
  description:
    "Cisco NetConnect PUP - Manila is a student-led tech community empowering future network and IT professionals through learning, collaboration, and innovation.",
};

export const viewport: Viewport = {
  themeColor: "#f7fbfe",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${interTight.variable} antialiased`}
    >
      <body>{children}</body>
    </html>
  );
}
