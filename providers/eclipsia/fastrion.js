const FASTRION_API = "https://fsharetv.cc";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_KEY = "307b7b8ef035c6aa336900aef4e203bd";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

function createSlug(str) {
    if (!str) return null;
    return str
        .split("")
        .filter(c => /[\s\p{L}\p{N}]/u.test(c))
        .join("")
        .trim()
        .replace(/\s+/g, "-")
        .toLowerCase();
}

async function fetchTmdbDetails(tmdbId, mediaType) {
    const endpoint = mediaType === "tv" ? "tv" : "movie";
    const res = await fetch(
        `${TMDB_BASE}/${endpoint}/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=external_ids`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
        title: mediaType === "tv" ? data.name : data.title,
        imdbId: (data.external_ids && data.external_ids.imdb_id) || null
    };
}

async function getStreams(tmdbId, mediaType, season, episode) {
    if (mediaType !== "movie") return [];

    const info = await fetchTmdbDetails(tmdbId, mediaType);
    if (!info || !info.title || !info.imdbId) return [];

    const slug = createSlug(`${info.title} episode 1 ${info.imdbId}`);
    if (!slug) return [];

    const pageUrl = `${FASTRION_API}/w/${slug}`;
    const baseHeaders = {
        "User-Agent": UA,
        "Referer": pageUrl
    };

    const pageRes = await fetch(pageUrl, { headers: { "User-Agent": UA } });
    if (!pageRes.ok) return [];
    const html = await pageRes.text();

    const tokenMatch = html.match(/Movie\.setSource\('([^']+)'/);
    if (!tokenMatch) return [];
    const token = tokenMatch[1];

    const trailerMatch = html.match(/<input[^>]+id=["']trailer["'][^>]*value=["']([^"']*)["']|<input[^>]+value=["']([^"']*)["'][^>]*id=["']trailer["']/);
    if (!trailerMatch) return [];
    const trailer = trailerMatch[1] !== undefined ? trailerMatch[1] : trailerMatch[2];

    const apiRes = await fetch(
        `${FASTRION_API}/api/file/${token}/source?trailer=${trailer}&type=watch`,
        { headers: baseHeaders }
    );
    if (!apiRes.ok) return [];

    const json = await apiRes.json();
    if (!json || !json.data || !json.data.file) return [];

    const file = json.data.file;
    const allSources = [
        ...(file.sources || []),
        ...(file.alternatives || []).flat()
    ];

    const seen = new Set();
    const streams = [];

    for (const source of allSources) {
        if (!source.src || seen.has(source.id)) continue;
        seen.add(source.id);

        const quality = source.quality ? `${source.quality}p` : "Unknown";
        streams.push({
            name: "FshareTV",
            title: `FshareTV • ${quality}`,
            url: FASTRION_API + source.src,
            quality,
            headers: baseHeaders
        });
    }

    streams.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));

    return streams;
}

module.exports = { getStreams };