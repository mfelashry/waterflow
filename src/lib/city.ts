import { USER_AGENT } from "@/lib/geo";

export type CityContext = {
  title: string;
  /** Short one-line description from Wikipedia. */
  description: string | null;
  /** Longer encyclopedia extract for the PDF. */
  extract: string;
  url: string | null;
  thumbnailUrl: string | null;
  population: number | null;
  river: string | null;
  country: string | null;
  areaKm2: number | null;
};

function cleanTitle(placeName: string) {
  const parts = placeName.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : placeName;
}

function candidatesFrom(placeName: string, detail?: string) {
  const fromDetail = detail
    ? detail
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
  return [
    placeName,
    cleanTitle(placeName),
    fromDetail[0] ?? null,
    fromDetail.length > 1 ? fromDetail[fromDetail.length - 2] : null,
    fromDetail[fromDetail.length - 1] ?? null,
    detail ?? null,
  ].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);
}

async function wikiSummary(title: string) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    next: { revalidate: 86400 },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    title?: string;
    extract?: string;
    description?: string;
    type?: string;
    thumbnail?: { source?: string };
    content_urls?: { desktop?: { page?: string } };
  };
  if (json.type === "disambiguation" || !json.extract) return null;
  return {
    title: json.title ?? title,
    extract: json.extract,
    description: json.description ?? null,
    url: json.content_urls?.desktop?.page ?? null,
    thumbnailUrl: json.thumbnail?.source ?? null,
  };
}

/** Longer intro than the REST summary alone, via MediaWiki extracts. */
async function wikiLongExtract(title: string) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("prop", "extracts");
  url.searchParams.set("exintro", "1");
  url.searchParams.set("explaintext", "1");
  url.searchParams.set("redirects", "1");
  url.searchParams.set("titles", title);
  url.searchParams.set("origin", "*");

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      query?: { pages?: Record<string, { extract?: string; missing?: boolean }> };
    };
    const page = Object.values(json.query?.pages ?? {})[0];
    if (!page || page.missing || !page.extract) return null;
    return page.extract.trim().slice(0, 2800);
  } catch {
    return null;
  }
}

async function wikidataExtras(title: string) {
  const safe = title.replace(/"/g, "");
  const sparql = `
SELECT ?pop ?area ?riverLabel ?countryLabel WHERE {
  ?item rdfs:label "${safe}"@en.
  OPTIONAL { ?item wdt:P1082 ?pop. }
  OPTIONAL { ?item wdt:P2046 ?area. }
  OPTIONAL { ?item wdt:P206 ?river. }
  OPTIONAL { ?item wdt:P17 ?country. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 1`.trim();

  const url = new URL("https://query.wikidata.org/sparql");
  url.searchParams.set("format", "json");
  url.searchParams.set("query", sparql);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) {
      return { population: null, river: null, country: null, areaKm2: null };
    }
    const json = (await res.json()) as {
      results?: {
        bindings?: {
          pop?: { value?: string };
          area?: { value?: string };
          riverLabel?: { value?: string };
          countryLabel?: { value?: string };
        }[];
      };
    };
    const row = json.results?.bindings?.[0];
    const pop = row?.pop?.value ? Number.parseFloat(row.pop.value) : null;
    const area = row?.area?.value ? Number.parseFloat(row.area.value) : null;
    const label = (value?: string) =>
      value && !value.endsWith("Label") ? value : null;
    return {
      population: Number.isFinite(pop) ? Math.round(pop as number) : null,
      areaKm2: Number.isFinite(area) ? Number((area as number).toFixed(1)) : null,
      river: label(row?.riverLabel?.value),
      country: label(row?.countryLabel?.value),
    };
  } catch {
    return { population: null, river: null, country: null, areaKm2: null };
  }
}

/** Encyclopedia context for a place - Wikipedia + Wikidata, no key. */
export async function cityContext(placeName: string, detail?: string): Promise<CityContext | null> {
  for (const candidate of candidatesFrom(placeName, detail)) {
    try {
      const summary = await wikiSummary(candidate);
      if (!summary) continue;
      const [longExtract, extras] = await Promise.all([
        wikiLongExtract(summary.title),
        wikidataExtras(summary.title),
      ]);
      return {
        title: summary.title,
        description: summary.description,
        extract: longExtract || summary.extract,
        url: summary.url,
        thumbnailUrl: summary.thumbnailUrl,
        population: extras.population,
        river: extras.river,
        country: extras.country,
        areaKm2: extras.areaKm2,
      };
    } catch (error) {
      console.warn("City context failed for", candidate, error);
    }
  }
  return null;
}
