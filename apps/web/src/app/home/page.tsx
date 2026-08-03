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
import type { FeedSection } from "@/components/stream/feed-row";
import { OneVidHeader } from "@/components/stream/onevid-header";
import { OneVidPageClient } from "@/components/stream/onevid-page-client";
import { OneVidProfileProvider } from "@/components/stream/onevid-profile-context";
import {
  CATALOG_VIEW_ALL_ITEM_LIMIT,
  fetchAddonCatalogResults,
} from "@/lib/addon-catalog";
import { auth } from "@/lib/auth";
import { oneVid, oneVidAddon, oneVidProfile } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import {
  DEFAULT_DISCOVER_ROWS,
  DEFAULT_FEED_ROWS,
  FEED_ROW_ITEM_LIMIT,
  type FeedCatalogId,
  type FeedSurface,
  getFeedRowTitle,
  parseFeedRows,
} from "@/lib/onevid-feed";
import { resolveFeed } from "@/lib/onevid-feed-sections";
import { getServerT } from "@/lib/server-t";
import {
  getCatalogOptions,
  getNetworkOptions,
  getTmdbLocale,
  getTmdbRegion,
  type MediaMeta,
  type NetworkOption,
  TmdbAuthError,
  TmdbNetworkError,
} from "@/lib/tmdb";
import {
  fetchCatalogResultsAtLeast,
  VIEW_ALL_MIN_ITEMS,
} from "@/lib/tmdb-catalog";

export const metadata: Metadata = {
  title: "Catálogo",
};

type CatalogType = "movie" | "series";

type SearchParams = Promise<{
  type?: string;
  catalog?: string;
  network?: string;
  surface?: string;
  addonId?: string;
  addonCatalogId?: string;
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

  const { locale: appLocale, t } = await getServerT();

  const [params, oneVidRow, addonRows, profileRows] = await Promise.all([
    searchParams,
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
        catalogs: oneVidAddon.catalogs,
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
  // `null` = nunca configuró el feed (columna NULL): el paso 2 sale sin
  // completar y /home usa el preset por defecto.
  const parsedFeedRows = parseFeedRows(oneVidRow[0]?.feedRows);
  const feedConfigured = parsedFeedRows !== null;
  const feedRows = parsedFeedRows?.length ? parsedFeedRows : DEFAULT_FEED_ROWS;
  const parsedDiscoverRows = parseFeedRows(oneVidRow[0]?.discoverRows);
  const discoverRows = parsedDiscoverRows?.length
    ? parsedDiscoverRows
    : DEFAULT_DISCOVER_ROWS;
  // ?surface=discover pinta las filas de Descubrir en vez de las del inicio.
  // Es un query param y no una ruta aparte porque el resto de la página (auth,
  // perfiles, setup, hero, "Continuar viendo") es idéntico; ver el patrón de
  // ?view=continuing.
  const surface: FeedSurface =
    params.surface === "discover" ? "discover" : "home";
  const surfaceRows = surface === "discover" ? discoverRows : feedRows;
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

  // Con cualquiera de estos params estamos en la vista "Ver todo" (la grilla
  // completa de una fila); sin ellos, /home es el feed configurado.
  const viewAll = Boolean(params.type || params.catalog || params.network);
  const isAddonView =
    viewAll &&
    params.catalog === "addon" &&
    Boolean(params.addonId && params.addonCatalogId);

  // Listas de catálogos/redes son estáticas (no dependen del token TMDB).
  const allCatalogs = getCatalogOptions();
  const allNetworks = getNetworkOptions();
  const networksById = new Map(allNetworks.map((n) => [n.id, n]));
  const addons = addonRows.map((addon) => ({
    ...addon,
    catalogs: addon.catalogs ?? [],
  }));
  const addonsById = new Map(
    addons.map((addon) => [
      addon.id,
      {
        baseUrl: addon.baseUrl,
        catalogs: addon.catalogs,
        manifestName: addon.manifestName,
      },
    ])
  );

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
    addons,
    discoverRows,
    feedConfigured,
    feedRows,
    hasTorboxKey: Boolean(torboxKey),
    linked: tmdbLinked,
    setupCompleted,
    surface,
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
                  Completa los pasos para empezar a ver tu contenido.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <SetupStepper
                  discoverRows={discoverRows}
                  feedConfigured={feedConfigured}
                  feedRows={feedRows}
                  hasTorboxKey={Boolean(torboxKey)}
                  initialAddons={addons}
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

  // Modo "Ver todo": una grilla; modo feed: N filas en paralelo.
  let posters: MediaMeta[] | undefined;
  let viewAllTitle: string | undefined;
  let feedSections: FeedSection[] | undefined;
  let heroItems: MediaMeta[] = [];
  let loadError: "auth" | "network" | null = null;

  if (isAddonView) {
    // A diferencia de las filas de TMDB, un addon entrega su catálogo en una
    // sola respuesta: "Ver todo" reutiliza esa misma respuesta pidiendo más
    // items (CATALOG_VIEW_ALL_ITEM_LIMIT) en vez de paginar.
    const addon = addonsById.get(params.addonId ?? "");
    const catalogRef = addon?.catalogs.find(
      (c) => c.id === params.addonCatalogId
    );
    if (addon && catalogRef) {
      try {
        posters = await fetchAddonCatalogResults({
          addonBaseUrl: addon.baseUrl,
          catalogId: catalogRef.id,
          limit: CATALOG_VIEW_ALL_ITEM_LIMIT,
          tmdbLocale,
          token,
          type: catalogRef.type,
        });
        viewAllTitle = getFeedRowTitle(
          { catalog: "addon", type: catalogRef.type },
          t,
          catalogRef.name
        );
      } catch (error) {
        // El primer id hidratado deja propagar auth/red de TMDB tal cual
        // (mismo contrato que fetchAddonCatalogResults); cualquier otro fallo
        // (addon caído, timeout) también se trata como error de red: no hay
        // nada que mostrar, pero no debe tumbar la página.
        loadError = error instanceof TmdbAuthError ? "auth" : "network";
      }
    } else {
      // Addon o catálogo ya no existe (quitado desde entonces): grilla
      // vacía en vez de reventar, igual que una fila del feed sin resultados.
      posters = [];
      viewAllTitle = t("Catálogo del addon");
    }
  } else if (viewAll) {
    try {
      posters = await fetchCatalogResultsAtLeast(
        {
          catalog: selectedCatalog,
          network: selectedNetwork,
          tmdbLocale,
          tmdbRegion,
          token,
          type: selectedType,
        },
        VIEW_ALL_MIN_ITEMS
      );
      viewAllTitle = getFeedRowTitle(
        {
          catalog: selectedCatalog as FeedCatalogId,
          networkId: selectedNetwork?.id,
          type: selectedType,
        },
        t,
        selectedNetwork?.name
      );
    } catch (error) {
      if (error instanceof TmdbAuthError) {
        loadError = "auth";
      } else if (error instanceof TmdbNetworkError) {
        loadError = "network";
      } else {
        throw error;
      }
    }
  } else {
    const feed = await resolveFeed({
      addonsById,
      itemsPerRow: FEED_ROW_ITEM_LIMIT,
      networksById,
      rows: surfaceRows,
      t,
      tmdbLocale,
      tmdbRegion,
      token,
    });
    feedSections = feed.sections;
    heroItems = feed.hero;
    loadError = feed.error;
  }

  if (loadError === "auth") {
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
                  discoverRows={discoverRows}
                  feedConfigured={feedConfigured}
                  feedRows={feedRows}
                  hasTorboxKey={Boolean(torboxKey)}
                  initialAddons={addons}
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

  if (loadError === "network") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-1 flex-col border-border border-x border-dashed bg-background px-4 pt-0 pb-6 md:px-6">
        <OneVidProfileProvider initialProfiles={profiles}>
          <OneVidHeader {...headerProps} />
          <section className="mt-8 rounded-xl border border-dashed bg-background p-8">
            <Empty className="min-h-0 border-0 p-0">
              <EmptyHeader>
                <EmptyTitle>No pudimos cargar el catálogo</EmptyTitle>
                <EmptyDescription>
                  Hubo un problema al conectar con TMDB. Vuelve a intentarlo en
                  unos momentos.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </section>
        </OneVidProfileProvider>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-7xl flex-1 flex-col border-border border-x border-dashed bg-background px-4 pt-0 pb-6 md:px-6">
      <OneVidPageClient
        addons={addons}
        discoverRows={discoverRows}
        feedConfigured={feedConfigured}
        feedRows={feedRows}
        feedSections={feedSections}
        hasTorboxKey={Boolean(torboxKey)}
        heroItems={heroItems}
        initialProfiles={profiles}
        linked={tmdbLinked}
        posters={posters}
        setupCompleted={setupCompleted}
        surface={surface}
        viewAllTitle={viewAllTitle}
      />
    </main>
  );
}
