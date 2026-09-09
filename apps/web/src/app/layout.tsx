import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "@workspace/ui/globals.css";
import { Toaster } from "@workspace/ui/components/sonner";
import { CookieConsent } from "@/components/cookie-consent";
import { DpadNavigation } from "@/components/dpad-navigation";
import { ReactScan } from "@/components/react-scan";
import { OnevidI18nProvider } from "@/lib/onevid-i18n-context";
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

const SITE_DESCRIPTION = "Tu reproductor de video.";

export const metadata: Metadata = {
  title: {
    default: "onevid",
    template: "%s | onevid",
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL("https://onevid.hackw.tech"),
  openGraph: {
    type: "website",
    title: "onevid",
    description: SITE_DESCRIPTION,
    url: "https://onevid.hackw.tech",
    siteName: "onevid",
    images: [
      {
        url: "/opengraph.jpg",
        width: 1200,
        height: 675,
        alt: "onevid — tu reproductor de video",
        type: "image/jpeg",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "onevid",
    description: SITE_DESCRIPTION,
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
        <DpadNavigation />
        <OnevidI18nProvider initialLocale={initialLocale}>
          <NuqsAdapter>
            {children}
            <CookieConsent />
          </NuqsAdapter>
        </OnevidI18nProvider>
        <Toaster />
      </body>
    </html>
  );
}
