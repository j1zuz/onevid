// Deep-links reales a cada plataforma de streaming. TMDB solo da un enlace
// agregador por región (a su propia página), NO deep-links por proveedor; esos
// datos vienen de JustWatch, que TMDB usa por detrás. La API GraphQL de
// JustWatch no es oficial pero devuelve `standardWebURL` (el enlace directo a la
// ficha del título en cada servicio) y su `packageId` coincide con el
// `provider_id` de TMDB, así que podemos cruzarlos.

const JUSTWATCH_GRAPHQL = "https://apis.justwatch.com/graphql";
const JW_TIMEOUT_MS = 6000;

const SEARCH_QUERY = `query($country: Country!, $language: Language!, $first: Int!, $filter: TitleFilter) {
  popularTitles(country: $country, first: $first, filter: $filter) {
    edges { node {
      objectType
      content(country: $country, language: $language) { originalReleaseYear }
      offers(country: $country, platform: WEB) {
        monetizationType
        standardWebURL
        package { packageId }
      }
    } }
  }
}`;

interface JwOffer {
  monetizationType?: string;
  package?: { packageId?: number };
  standardWebURL?: string;
}

interface JwNode {
  content?: { originalReleaseYear?: number };
  objectType?: string;
  offers?: JwOffer[];
}

interface JwResponse {
  data?: { popularTitles?: { edges?: { node: JwNode }[] } };
}

/**
 * Busca el título en JustWatch y devuelve un mapa `packageId -> deep-link` de
 * TODAS sus ofertas (suscripción, alquiler y compra). El `packageId` de
 * JustWatch equivale al `provider_id` de TMDB, y el `standardWebURL` de un mismo
 * proveedor apunta a la misma ficha independientemente del tipo de oferta.
 *
 * Ante cualquier fallo (red, sin match) devuelve un mapa vacío: los proveedores
 * se muestran igual, solo que sin enlace.
 */
export async function fetchJustWatchLinks({
  title,
  year,
  type,
  country,
  language,
}: {
  country: string;
  language: string;
  title: string;
  type: "movie" | "series";
  year?: number;
}): Promise<Map<number, string>> {
  const wantType = type === "series" ? "SHOW" : "MOVIE";

  let res: Response;
  try {
    res = await fetch(JUSTWATCH_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // JustWatch bloquea peticiones sin UA de navegador.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables: {
          country,
          language,
          first: 5,
          filter: { searchQuery: title },
        },
      }),
      signal: AbortSignal.timeout(JW_TIMEOUT_MS),
      next: { revalidate: 3600 },
    });
  } catch {
    return new Map();
  }

  if (!res.ok) {
    return new Map();
  }

  const json = (await res.json().catch(() => null)) as JwResponse | null;
  const nodes = (json?.data?.popularTitles?.edges ?? [])
    .map((e) => e.node)
    .filter((n) => n.objectType === wantType);

  if (nodes.length === 0) {
    return new Map();
  }

  // Desambiguar por año de estreno; si ninguno coincide, tomar el primero
  // (la búsqueda ya viene ordenada por popularidad).
  const chosen =
    (year
      ? nodes.find((n) => n.content?.originalReleaseYear === year)
      : undefined) ?? nodes[0];

  const links = new Map<number, string>();
  for (const offer of chosen.offers ?? []) {
    const pid = offer.package?.packageId;
    if (pid && offer.standardWebURL && !links.has(pid)) {
      links.set(pid, offer.standardWebURL);
    }
  }
  return links;
}
