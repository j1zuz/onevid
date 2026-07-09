import { promises as fs } from "node:fs";
import path from "node:path";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SetupStepper } from "@/components/stepper-onevid";
import { OneVidHeader } from "@/components/stream/onevid-header";
import { OneVidPageClient } from "@/components/stream/onevid-page-client";
import { OneVidProfileProvider } from "@/components/stream/onevid-profile-context";
import { auth } from "@/lib/auth";
import { oneVid, oneVidAddon, oneVidProfile } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { getServerT } from "@/lib/server-t";
import {
  catalogToSortBy,
  discoverMovies,
  discoverTv,
  getCatalogOptions,
  getNetworkOptions,
  getTmdbLocale,
  getTmdbRegion,
  type MediaMeta,
  type NetworkOption,
  TmdbAuthError,
  TmdbNetworkError,
  trendingMovies,
  trendingTv,
} from "@/lib/tmdb";

export const metadata: Metadata = {
  title: "Catálogo",
};

type CatalogType = "movie" | "series";

type SearchParams = Promise<{
  type?: string;
  catalog?: string;
  network?: string;
}>;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: catalog page with setup gating, token fallback and TMDB error handling
export default async function OneVidPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/");
  }

  const { locale: appLocale } = await getServerT();

  const [params, oneVidRow, addonRows, profileRows] = await Promise.all([
    searchParams,
    db
      .select({
        tmdbUserAccessToken: oneVid.tmdbUserAccessToken,
        tmdbReadAccessToken: oneVid.tmdbReadAccessToken,
        torboxApiKey: oneVid.torboxApiKey,
        setupCompleted: oneVid.setupCompleted,
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

  // v4 user token preferred, legacy read token as fallback
  const tmdbToken =
    oneVidRow[0]?.tmdbUserAccessToken ??
    oneVidRow[0]?.tmdbReadAccessToken ??
    null;
  const tmdbLinked = Boolean(oneVidRow[0]?.tmdbUserAccessToken);
  const torboxKey = oneVidRow[0]?.torboxApiKey ?? null;
  const setupCompleted = oneVidRow[0]?.setupCompleted ?? false;
  // Expose only a boolean lock flag per profile; never the hash.
  const profiles = profileRows.map(({ pinHash, ...p }) => ({
    ...p,
    hasPin: Boolean(pinHash),
  }));

  const oneVidSvgPath = path.join(
    process.cwd(),
    "src/components/img/onevid.svg"
  );
  const oneVidSvg = await fs.readFile(oneVidSvgPath, "utf8");

  // Listas de catálogos/redes son estáticas (no dependen del token TMDB), así
  // que se calculan siempre: el header se muestra incluso sin setup completo.
  const allCatalogs = getCatalogOptions();
  const allNetworks = getNetworkOptions();

  const typeOptions: CatalogType[] = Array.from(
    new Set(allCatalogs.map((c) => c.type))
  );

  let selectedType: CatalogType;
  if (params.type === "series") {
    selectedType = "series";
  } else if (params.type === "movie") {
    selectedType = "movie";
  } else if (typeOptions.includes("movie")) {
    selectedType = "movie";
  } else {
    selectedType = "series";
  }

  const catalogsByType = allCatalogs.filter((c) => c.type === selectedType);

  const selectedCatalogOption =
    catalogsByType.find((c) => c.id === params.catalog) ?? catalogsByType[0];

  const selectedCatalog = selectedCatalogOption?.id ?? "trending";

  // Network filter (both types: movies use providerId, series use id)
  const requestedNetwork = params.network?.trim() || "";
  let selectedNetwork: NetworkOption | undefined;
  if (requestedNetwork) {
    const networkId = Number(requestedNetwork);
    if (!Number.isNaN(networkId)) {
      selectedNetwork = allNetworks.find((n) => n.id === networkId);
    }
  }

  const headerProps = {
    addons: addonRows,
    allNetworks,
    catalogs: allCatalogs,
    catalogsByType,
    hasTorboxKey: Boolean(torboxKey),
    linked: tmdbLinked,
    selectedCatalog,
    selectedCatalogOption,
    selectedNetwork,
    selectedType,
    setupCompleted,
    typeOptions,
  };

  // TMDB is "configured" only when the account is connected via OAuth v4.
  // A leftover legacy read token must not unlock the catalog on its own.
  // (tmdbToken is checked too so it narrows to non-null below.)
  if (!(tmdbLinked && tmdbToken && setupCompleted)) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-1 flex-col border-border border-x border-dashed bg-background px-4 pt-0 pb-6 md:px-6">
        <OneVidProfileProvider initialProfiles={profiles}>
          <OneVidHeader {...headerProps} />
          <section className="mt-8 rounded-xl border border-dashed bg-background p-8">
            <Empty className="min-h-0 border-0 p-0">
              <EmptyHeader>
                <EmptyMedia
                  className="size-16 rounded-xl bg-transparent"
                  variant="icon"
                >
                  {/* biome-ignore lint/performance/noImgElement: SVG data URI */}
                  <img
                    alt="onevid"
                    className="size-8 rounded-(--radius) border border-border/70 object-contain"
                    height={32}
                    src={`data:image/svg+xml;utf8,${encodeURIComponent(oneVidSvg)}`}
                    width={32}
                  />
                </EmptyMedia>
                <EmptyTitle>Configura onevid para empezar</EmptyTitle>
                <EmptyDescription>
                  Completa los pasos para empezar a ver contenido.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <SetupStepper
                  hasTorboxKey={Boolean(torboxKey)}
                  initialAddons={addonRows}
                  linked={tmdbLinked}
                  setupCompleted={setupCompleted}
                />
              </EmptyContent>
            </Empty>
          </section>
        </OneVidProfileProvider>
      </main>
    );
  }

  const token: string = tmdbToken;
  const tmdbLocale = getTmdbLocale(appLocale);
  const tmdbRegion = getTmdbRegion(appLocale);
  const sortBy = catalogToSortBy(selectedCatalog);

  // Fetch catalog items
  let posters: MediaMeta[];
  try {
    if (selectedCatalog === "trending") {
      // Trending no admite filtro de red en TMDB; se ignora selectedNetwork.
      posters =
        selectedType === "movie"
          ? await trendingMovies(token, undefined, tmdbLocale)
          : await trendingTv(token, undefined, tmdbLocale);
    } else {
      posters =
        selectedType === "movie"
          ? await discoverMovies(
              token,
              sortBy,
              undefined,
              tmdbLocale,
              selectedNetwork?.providerId,
              tmdbRegion,
              selectedNetwork?.companyIds
            )
          : await discoverTv(
              token,
              selectedNetwork?.id,
              sortBy,
              undefined,
              tmdbLocale
            );
    }
  } catch (error) {
    if (error instanceof TmdbAuthError) {
      return (
        <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-1 flex-col border-border border-x border-dashed bg-background px-4 pt-0 pb-6 md:px-6">
          <OneVidProfileProvider initialProfiles={profiles}>
            <OneVidHeader {...headerProps} linked={false} />
            <section className="mt-8 rounded-xl border border-dashed bg-background p-8">
              <Empty className="min-h-0 border-0 p-0">
                <EmptyHeader>
                  <EmptyTitle>Token TMDB inválido</EmptyTitle>
                  <EmptyDescription>
                    Tu token ha expirado o no es válido. Configúralo de nuevo.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <SetupStepper
                    hasTorboxKey={Boolean(torboxKey)}
                    initialAddons={addonRows}
                    linked={false}
                    setupCompleted={false}
                  />
                </EmptyContent>
              </Empty>
            </section>
          </OneVidProfileProvider>
        </main>
      );
    }
    if (error instanceof TmdbNetworkError) {
      return (
        <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-1 flex-col border-border border-x border-dashed bg-background px-4 pt-0 pb-6 md:px-6">
          <OneVidProfileProvider initialProfiles={profiles}>
            <OneVidHeader {...headerProps} />
            <section className="mt-8 rounded-xl border border-dashed bg-background p-8">
              <Empty className="min-h-0 border-0 p-0">
                <EmptyHeader>
                  <EmptyTitle>No pudimos cargar el catálogo</EmptyTitle>
                  <EmptyDescription>
                    Hubo un problema al conectar con TMDB. Vuelve a intentarlo
                    en unos momentos.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </section>
          </OneVidProfileProvider>
        </main>
      );
    }
    throw error;
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-7xl flex-1 flex-col border-border border-x border-dashed bg-background px-4 pt-0 pb-6 md:px-6">
      <OneVidPageClient
        addons={addonRows}
        allNetworks={allNetworks}
        catalogs={allCatalogs}
        catalogsByType={catalogsByType}
        hasTorboxKey={Boolean(torboxKey)}
        initialProfiles={profiles}
        linked={tmdbLinked}
        posters={posters}
        selectedCatalog={selectedCatalog}
        selectedCatalogOption={selectedCatalogOption}
        selectedNetwork={selectedNetwork}
        selectedType={selectedType}
        setupCompleted={setupCompleted}
        typeOptions={typeOptions}
      />
    </main>
  );
}
