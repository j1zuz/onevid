import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import Script from "next/script";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "@workspace/ui/globals.css";
import { Toaster } from "@workspace/ui/components/sonner";
import { CookieConsent } from "@/components/cookie-consent";
import { ThemeProvider } from "@/components/theme-provider";
import { HackwProvider } from "@/lib/hackw-i18n-context";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_CODES,
  type SupportedLanguage,
} from "@/lib/languages";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_DESCRIPTION =
  "Reproductor de video: modo local sin cuenta o streaming con tu catálogo TMDB.";

export const metadata: Metadata = {
  title: {
    default: "onevid",
    template: "%s | onevid",
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL("https://onevid.hackw.tech"),
  openGraph: {
    title: "onevid",
    description: SITE_DESCRIPTION,
    url: "https://onevid.hackw.tech",
    siteName: "onevid",
    images: ["/opengraph.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "onevid",
    description: SITE_DESCRIPTION,
    images: ["/opengraph.png"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const store = await cookies();
  const saved = store.get("NEXT_LOCALE")?.value;
  const initialLocale: SupportedLanguage = SUPPORTED_CODES.includes(
    saved as never
  )
    ? (saved as SupportedLanguage)
    : DEFAULT_LANGUAGE;

  return (
    <html lang={initialLocale} suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === "development" && (
          <Script
            crossOrigin="anonymous"
            src="//unpkg.com/react-grab/dist/index.global.js"
            strategy="beforeInteractive"
          />
        )}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <HackwProvider initialLocale={initialLocale}>
            <NuqsAdapter>
              {children}
              <CookieConsent />
            </NuqsAdapter>
          </HackwProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
