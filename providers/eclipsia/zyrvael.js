"use strict";

const PROVIDER_NAME = "Anikoto";
const TMDB_API_KEY = "307b7b8ef035c6aa336900aef4e203bd";
const TMDB_API = "https://api.themoviedb.org/3";
const ARM_API = "https://arm.haglund.dev/api/v2/ids";
const ANILIST_API = "https://graphql.anilist.co";

const PROVIDERS = [
  { id: "MegaPlay", domain: "megaplay.buzz" },
  { id: "VidWish", domain: "vidwish.live" },
];

async function fetchSafe(url, options = {}) {
  try {
    return await fetch(url, options);
  } catch {
    return null;
  }
}

async function getTMDBTitle(id, type) {
  const mediaType = type === "tv" || type === "series" ? "tv" : "movie";

  if (String(id).startsWith("tt")) {
    const url = `${TMDB_API}/find/${id}?external_source=imdb_id&api_key=${TMDB_API_KEY}`;
    try {
      const res = await fetchSafe(url);
      if (res?.ok) {
        const data = await res.json();
        if (mediaType === "tv" && data.tv_results?.length > 0)
          return { title: data.tv_results[0].name, numericId: data.tv_results[0].id };
        if (mediaType === "movie" && data.movie_results?.length > 0)
          return { title: data.movie_results[0].title, numericId: data.movie_results[0].id };
      }
    } catch { }
    return { title: null, numericId: null };
  }

  const url = `${TMDB_API}/${mediaType}/${id}?api_key=${TMDB_API_KEY}`;
  try {
    const res = await fetchSafe(url);
    if (res?.ok) {
      const data = await res.json();
      return { title: mediaType === "tv" ? data.name : data.title, numericId: id };
    }
  } catch { }
  return { title: null, numericId: null };
}

async function getTMDBSeasonName(showId, season) {
  const url = `${TMDB_API}/tv/${showId}/season/${season}?api_key=${TMDB_API_KEY}`;
  try {
    const res = await fetchSafe(url);
    if (res?.ok) {
      const data = await res.json();
      return data.name ?? null;
    }
  } catch { }
  return null;
}

async function aniListBridge(search) {
  const query = `query ($search: String) { Media(search: $search, type: ANIME) { id idMal } }`;
  try {
    const res = await fetchSafe(ANILIST_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables: { search } }),
    });
    if (res?.ok) {
      const data = await res.json();
      if (data?.data?.Media)
        return { malId: data.data.Media.idMal, aniId: data.data.Media.id, absEp: null };
    }
  } catch { }
  return null;
}

async function getMalId(id, type, season, episode) {
  try {
    let url = `${ARM_API}?source=tmdb&id=${id}`;
    if (type === "tv" || type === "series") url += `&season=${season}&episode=${episode}`;

    const res = await fetchSafe(url);
    if (res?.ok) {
      const data = await res.json();
      if (data.mal || data.mal_id || data.anilist || data.anilist_id)
        return {
          malId: data.mal || data.mal_id,
          aniId: data.anilist || data.anilist_id,
          absEp: data.episodeOffset || episode,
        };
    }
  } catch { }

  const { title, numericId } = await getTMDBTitle(id, type);
  if (!title) return null;

  let searchTitle = title;
  if ((type === "tv" || type === "series") && season > 1 && numericId) {
    const seasonName = await getTMDBSeasonName(numericId, season);
    if (seasonName) {
      searchTitle = seasonName.toLowerCase().includes(title.toLowerCase())
        ? seasonName
        : `${title} ${seasonName}`;
    } else {
      searchTitle = `${title} Season ${season}`;
    }
  }

  const result = await aniListBridge(searchTitle);
  if (result) {
    result.absEp = episode;
    return result;
  }
  return null;
}

async function extractHLS(url, domain) {
  try {
    const res = await fetchSafe(url, { headers: { Referer: `https://${domain}/` } });
    if (!res?.ok) return null;

    const html = await res.text();
    const match = html.match(/data-id="(\d+)"/);
    if (!match) return null;

    const embedId = match[1];
    const sourcesRes = await fetchSafe(`https://${domain}/stream/getSources?id=${embedId}`, {
      headers: { "X-Requested-With": "XMLHttpRequest", Referer: url },
    });
    if (!sourcesRes?.ok) return null;

    const data = await sourcesRes.json();
    if (!data.sources?.file) return null;

    const subtitles = (data.tracks ?? [])
      .filter((t) => t.kind === "captions" || t.kind === "subtitles")
      .map((t) => ({ url: t.file, lang: t.label || "Unknown" }));

    return {
      url: data.sources.file,
      subtitles,
      headers: { Referer: `https://${domain}/`, Origin: `https://${domain}` },
    };
  } catch { }
  return null;
}

async function getStreams(id, type, season, episode) {
  try {
    const ids = await getMalId(id, type, season, episode);
    if (!ids?.malId && !ids?.aniId) return [];

    const useMal = !!ids.malId;
    const resolvedId = useMal ? ids.malId : ids.aniId;
    const idType = useMal ? "mal" : "ani";
    const absEp = type === "movie" ? 1 : (ids.absEp || episode);

    const epSuffix = type === "movie"
      ? ""
      : ` S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;

    const streams = [];

    for (const p of PROVIDERS) {
      for (const dub of ["sub", "dub"]) {
        const url = `https://${p.domain}/stream/${idType}/${resolvedId}/${absEp}/${dub}`;
        const result = await extractHLS(url, p.domain);
        if (result)
          streams.push({
            name: `${PROVIDER_NAME} • ${dub === "sub" ? "Sub" : "Dub"}`,
            quality: "1080p",
            title: `${PROVIDER_NAME}`,
            url: result.url,
            subtitles: result.subtitles,
            headers: result.headers,
          });
      }
    }

    return streams;
  } catch {
    return [];
  }
}

typeof module !== "undefined" && module.exports
  ? (module.exports = { getStreams })
  : (global.getStreams = getStreams);