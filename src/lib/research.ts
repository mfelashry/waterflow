import { USER_AGENT } from "@/lib/geo";

export type ResearchSource = {
  title: string;
  url: string;
  snippet: string;
  kind: "wikipedia" | "scholarly" | "web" | "agency";
};

export type PlaceResearch = {
  query: string;
  summary: string;
  sources: ResearchSource[];
};

type OpenAlexWork = {
  id?: string;
  display_name?: string;
  publication_year?: number;
  doi?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: { landing_page_url?: string | null; source?: { display_name?: string } | null } | null;
  open_access?: { oa_url?: string | null } | null;
};

function reconstructAbstract(index: Record<string, number[]> | null | undefined) {
  if (!index) return "";
  const words: { word: string; pos: number }[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) words.push({ word, pos });
  }
  words.sort((a, b) => a.pos - b.pos);
  const text = words.map((item) => item.word).join(" ");
  return text.length > 280 ? `${text.slice(0, 277)}…` : text;
}

async function wikipediaResearch(placeName: string, detail: string): Promise<ResearchSource[]> {
  const sources: ResearchSource[] = [];
  const queries = [
    placeName,
    detail ? `${placeName} ${detail.split(",")[0]}` : null,
  ].filter(Boolean) as string[];

  for (const query of queries.slice(0, 2)) {
    try {
      const searchUrl = new URL("https://en.wikipedia.org/w/api.php");
      searchUrl.searchParams.set("action", "opensearch");
      searchUrl.searchParams.set("search", query);
      searchUrl.searchParams.set("limit", "3");
      searchUrl.searchParams.set("format", "json");
      searchUrl.searchParams.set("origin", "*");
      const searchRes = await fetch(searchUrl, {
        headers: { "User-Agent": USER_AGENT },
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(6000),
      });
      if (!searchRes.ok) continue;
      const searchJson = (await searchRes.json()) as [string, string[], string[], string[]];
      const titles = searchJson[1] ?? [];
      const urls = searchJson[3] ?? [];

      for (let i = 0; i < Math.min(titles.length, 2); i += 1) {
        const title = titles[i];
        const pageUrl = urls[i];
        if (!title || !pageUrl) continue;
        const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
        const summaryRes = await fetch(summaryUrl, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
          next: { revalidate: 3600 },
          signal: AbortSignal.timeout(6000),
        });
        if (!summaryRes.ok) {
          sources.push({
            title,
            url: pageUrl,
            snippet: "Wikipedia article matched this place.",
            kind: "wikipedia",
          });
          continue;
        }
        const summary = (await summaryRes.json()) as { extract?: string; content_urls?: { desktop?: { page?: string } } };
        sources.push({
          title,
          url: summary.content_urls?.desktop?.page ?? pageUrl,
          snippet: (summary.extract ?? "").slice(0, 320),
          kind: "wikipedia",
        });
      }
    } catch {
      // keep going with other sources
    }
  }

  return sources;
}

async function openAlexResearch(query: string): Promise<ResearchSource[]> {
  try {
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", query);
    url.searchParams.set("per_page", "5");
    url.searchParams.set("sort", "relevance_score:desc");
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: OpenAlexWork[] };
    return (json.results ?? [])
      .map((work) => {
        const landing =
          work.open_access?.oa_url ||
          work.primary_location?.landing_page_url ||
          (work.doi ? `https://doi.org/${work.doi.replace(/^https?:\/\/doi\.org\//, "")}` : null) ||
          work.id;
        if (!landing || !work.display_name) return null;
        const year = work.publication_year ? ` (${work.publication_year})` : "";
        const venue = work.primary_location?.source?.display_name
          ? ` · ${work.primary_location.source.display_name}`
          : "";
        return {
          title: `${work.display_name}${year}`,
          url: landing,
          snippet: reconstructAbstract(work.abstract_inverted_index) || `Scholarly work${venue}.`,
          kind: "scholarly" as const,
        };
      })
      .filter(Boolean) as ResearchSource[];
  } catch {
    return [];
  }
}

async function duckDuckGoResearch(query: string): Promise<ResearchSource[]> {
  try {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      RelatedTopics?: { Text?: string; FirstURL?: string; Topics?: { Text?: string; FirstURL?: string }[] }[];
    };
    const sources: ResearchSource[] = [];
    if (json.AbstractText && json.AbstractURL) {
      sources.push({
        title: json.Heading || "DuckDuckGo abstract",
        url: json.AbstractURL,
        snippet: json.AbstractText.slice(0, 320),
        kind: "web",
      });
    }
    const topics = json.RelatedTopics ?? [];
    for (const topic of topics) {
      if (topic.FirstURL && topic.Text) {
        sources.push({
          title: topic.Text.split(" - ")[0]?.slice(0, 120) || "Related topic",
          url: topic.FirstURL,
          snippet: topic.Text.slice(0, 280),
          kind: "web",
        });
      }
      for (const nested of topic.Topics ?? []) {
        if (nested.FirstURL && nested.Text) {
          sources.push({
            title: nested.Text.split(" - ")[0]?.slice(0, 120) || "Related topic",
            url: nested.FirstURL,
            snippet: nested.Text.slice(0, 280),
            kind: "web",
          });
        }
      }
      if (sources.length >= 6) break;
    }
    return sources.slice(0, 6);
  } catch {
    return [];
  }
}

function buildSearchQueries(placeName: string, detail: string, question: string) {
  const region = detail.split(",").slice(0, 2).join(",").trim();
  const base = region ? `${placeName} ${region}` : placeName;
  const lowered = question.toLowerCase();
  const topical: string[] = [];
  if (/data\s*cent|datacent|server farm|hyperscale/i.test(lowered)) {
    topical.push(`${base} data center water use`, `${base} data center stormwater watershed`);
  }
  if (/flood|fema|inundat/i.test(lowered)) {
    topical.push(`${base} flood hazard FEMA`, `${base} floodplain study`);
  }
  if (/stormwater|runoff|impervious|development|urban/i.test(lowered)) {
    topical.push(`${base} stormwater management`, `${base} urban runoff watershed`);
  }
  if (/drought|climate|precip|rainfall/i.test(lowered)) {
    topical.push(`${base} precipitation climate watershed`);
  }
  if (!topical.length) {
    topical.push(`${base} watershed hydrology`, `${base} water resources case study`);
  }
  return [...new Set([`${base} ${question}`.slice(0, 160), ...topical])].slice(0, 3);
}

/**
 * Gather public external evidence about a place/question so Ask Grok can cite
 * case studies beyond the screening-map measurements.
 */
export async function researchPlace(input: {
  placeName: string;
  detail: string;
  question: string;
}): Promise<PlaceResearch> {
  const queries = buildSearchQueries(input.placeName, input.detail, input.question);
  const primary = queries[0];

  const [wiki, openAlexBundles, ddgBundles] = await Promise.all([
    wikipediaResearch(input.placeName, input.detail),
    Promise.all(queries.map((query) => openAlexResearch(query))),
    Promise.all(queries.slice(0, 2).map((query) => duckDuckGoResearch(query))),
  ]);

  const openAlex = openAlexBundles.flat();
  const ddg = ddgBundles.flat();

  const seen = new Set<string>();
  const sources: ResearchSource[] = [];
  for (const source of [...wiki, ...openAlex, ...ddg]) {
    const key = source.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
    if (sources.length >= 10) break;
  }

  const summary = sources.length
    ? sources
        .slice(0, 8)
        .map(
          (source, index) =>
            `[${index + 1}] (${source.kind}) ${source.title}\nURL: ${source.url}\n${source.snippet}`,
        )
        .join("\n\n")
    : "No external encyclopedia or scholarly hits returned for this query.";

  return { query: primary, summary, sources };
}
