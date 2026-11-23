import { CookieConsent } from "@/components/cookie-consent";
import { OfflineIndicator } from "@/components/offline/offline-indicator";
import { AuthCacheGuard } from "@/components/pwa/auth-cache-guard";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import { SearchRestoreScript } from "@/components/stream/search-restore-script";
import { DpadNavigation } from "@/components/dpad-navigation";
import { ReactScan } from "@/components/react-scan";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_CODES,
  type SupportedLanguage,
} from "@/lib/languages";
import { OnevidI18nProvider } from "@/lib/onevid-i18n-context";
import { Toaster } from "@workspace/ui/components/sonner";
import "@workspace/ui/globals.css";
import { GlimmProvider, InterceptLinks } from "glimm/next";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { NuqsAdapter } from "nuqs/adapters/next/app";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Onevid",
    template: "%s • Onevid",
  },
  description: "Reproductor de video",
  metadataBase: new URL("https://onevid.hackw.tech"),
  openGraph: {
    type: "website",
    title: "Onevid",
    description: "Reproductor de video",
    url: "https://onevid.hackw.tech",
    siteName: "Onevid",
    images: [
      {
        url: "/opengraph.jpg",
        width: 1200,
        height: 675,
        alt: "Onevid — Reproductor de video",
        type: "image/jpeg",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Onevid",
    description: "Reproductor de video",
    images: ["/opengraph.jpg"],
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
    saved as never,
  )
    ? (saved as SupportedLanguage)
    : DEFAULT_LANGUAGE;

  return (
    <html
      lang={initialLocale}
      className={`dark ${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        {process.env.NODE_ENV === "development" && <ReactScan />}
        <GlimmProvider
          brightness={0.9}
          palette="azure"
          sweepMs={1000}
          waveAmount={0.8}
        >
          <InterceptLinks />
          <DpadNavigation />
          <OnevidI18nProvider initialLocale={initialLocale}>
            <NuqsAdapter>
              {children}
              <CookieConsent />
              <OfflineIndicator />
            </NuqsAdapter>
            <ServiceWorkerRegistrar />
            <AuthCacheGuard />
          </OnevidI18nProvider>
          <SearchRestoreScript />
          <Toaster position="bottom-center" />
        </GlimmProvider>
      </body>
    </html>
  );
}
