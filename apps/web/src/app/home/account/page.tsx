import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OneVidProfileProvider } from "@/components/stream/onevid-profile-context";
import { OneVidProfileSwitcher } from "@/components/stream/onevid-profile-switcher";
import {
  OneVidSettingsPanel,
  type SettingsView,
} from "@/components/stream/onevid-settings-panel";
import { auth } from "@/lib/auth";
import { oneVid, oneVidAddon, oneVidProfile } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import {
  DEFAULT_DISCOVER_ROWS,
  DEFAULT_FEED_ROWS,
  parseFeedRows,
} from "@/lib/onevid-feed";

export const metadata: Metadata = {
  title: "Configuración",
};

function isSettingsView(value: string | undefined): value is SettingsView {
  return (
    value === "account" ||
    value === "catalog" ||
    value === "language" ||
    value === "profiles" ||
    value === "home"
  );
}

/**
 * Página de Configuración (estilo lista, ver captura de referencia): las
 * demás configuraciones que no caben en el dropdown del avatar (Cuenta,
 * Catálogo, Perfiles, Idioma) viven acá como su propia ruta, no en un Drawer
 * anidado en el header. `?view=profiles` abre directo en una sub-vista (usado
 * por el link "Administrar perfiles" del dropdown del avatar).
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/");
  }

  const { view } = await searchParams;
  const initialView = isSettingsView(view) ? view : "home";

  const [oneVidRow, addonRows, profileRows] = await Promise.all([
    db
      .select({
        tmdbUserAccessToken: oneVid.tmdbUserAccessToken,
        tmdbReadAccessToken: oneVid.tmdbReadAccessToken,
        torboxApiKey: oneVid.torboxApiKey,
        setupCompleted: oneVid.setupCompleted,
        feedRows: oneVid.feedRows,
        discoverRows: oneVid.discoverRows,
      })
      .from(oneVid)
      .where(eq(oneVid.userId, session.user.id))
      .limit(1),
    db
      .select({
        id: oneVidAddon.id,
        baseUrl: oneVidAddon.baseUrl,
        manifestId: oneVidAddon.manifestId,
        manifestName: oneVidAddon.manifestName,
        manifestVersion: oneVidAddon.manifestVersion,
        supportsStreams: oneVidAddon.supportsStreams,
      })
      .from(oneVidAddon)
      .where(eq(oneVidAddon.userId, session.user.id))
      .orderBy(desc(oneVidAddon.createdAt)),
    db
      .select({
        id: oneVidProfile.id,
        name: oneVidProfile.name,
        avatar: oneVidProfile.avatar,
        isKids: oneVidProfile.isKids,
        pinHash: oneVidProfile.pinHash,
      })
      .from(oneVidProfile)
      .where(eq(oneVidProfile.userId, session.user.id))
      .orderBy(oneVidProfile.createdAt),
  ]);

  const tmdbLinked = Boolean(oneVidRow[0]?.tmdbUserAccessToken);
  const torboxKey = oneVidRow[0]?.torboxApiKey ?? null;
  const setupCompleted = oneVidRow[0]?.setupCompleted ?? false;
  const parsedFeedRows = parseFeedRows(oneVidRow[0]?.feedRows);
  const feedConfigured = parsedFeedRows !== null;
  const feedRows = parsedFeedRows?.length ? parsedFeedRows : DEFAULT_FEED_ROWS;
  const parsedDiscoverRows = parseFeedRows(oneVidRow[0]?.discoverRows);
  const discoverRows = parsedDiscoverRows?.length
    ? parsedDiscoverRows
    : DEFAULT_DISCOVER_ROWS;
  const profiles = profileRows.map(({ pinHash, ...p }) => ({
    ...p,
    hasPin: Boolean(pinHash),
  }));

  return (
    <OneVidProfileProvider initialProfiles={profiles}>
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-1 flex-col border-border border-x border-dashed bg-background px-4 md:px-6">
        {/* Mismo header que /home pero sin buscador: acá no hay catálogo que
            buscar, solo logo (vuelve a /home) + el dropdown del avatar.
            -mx-4 md:-mx-6 cancela el padding de `main` para que el borde
            llegue hasta las líneas verticales dashed, igual que
            onevid-header.tsx. */}
        <section
          className="-mx-4 sticky top-0 z-20 flex items-center justify-between border-border border-b border-dashed bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/80 md:-mx-6 md:px-6"
          data-dpad-focus-subtle
        >
          <Link
            className="flex shrink-0 items-center rounded border border-transparent"
            data-dpad-focusable
            href="/home"
          >
            {/* biome-ignore lint/performance/noImgElement: logo SVG estático local */}
            <img
              alt="onevid"
              className="size-8 rounded-md border border-border/70 bg-card p-1"
              height={32}
              src="/onevid.svg"
              width={32}
            />
          </Link>
          <OneVidProfileSwitcher />
        </section>

        <div className="flex flex-1 flex-col py-6">
          <h1 className="mb-6 font-bold text-2xl">Configuración</h1>

          <OneVidSettingsPanel
            discoverRows={discoverRows}
            feedConfigured={feedConfigured}
            feedRows={feedRows}
            hasTorboxKey={Boolean(torboxKey)}
            initialAddons={addonRows}
            initialView={initialView}
            linked={tmdbLinked}
            setupCompleted={setupCompleted}
            userEmail={session.user.email ?? ""}
            userName={session.user.name ?? ""}
          />
        </div>
      </main>
    </OneVidProfileProvider>
  );
}
