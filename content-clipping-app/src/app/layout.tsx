import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "ClipMaster - Content Clipping Made Easy",
  description: "Create, edit, and export video clips with professional-grade tools designed for content creators.",
  keywords: ["video editing", "content creation", "video clips", "social media"],
  authors: [{ name: "ClipMaster Team" }],
  openGraph: {
    title: "ClipMaster - Content Clipping Made Easy",
    description: "Create, edit, and export video clips with professional-grade tools designed for content creators.",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "ClipMaster - Content Clipping Made Easy",
    description: "Create, edit, and export video clips with professional-grade tools designed for content creators.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full font-sans bg-background text-foreground">
        <div className="relative flex min-h-full flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
