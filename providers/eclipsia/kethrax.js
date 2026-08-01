const VIXSRC_BASE = "https://unitv.mom";
const TMDB_API_KEY = "307b7b8ef035c6aa336900aef4e203bd";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36";

function getCommonHeaders() {
    return {
        "User-Agent": UA,
        "Referer": `${VIXSRC_BASE}/`,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1"
    };
}

function getEmbedHeaders(embedUrl) {
    return {
        "User-Agent": UA,
        "Referer": `${VIXSRC_BASE}/`,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    };
}

function getPlaylistHeaders(embedUrl) {
    return {
        "User-Agent": UA,
        "Referer": embedUrl,
        "Origin": VIXSRC_BASE,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin"
    };
}

function extractEmbedSrcFromApiPayload(payload) {
    const rawSrc = payload && typeof payload === "object" ? payload.src : null;
    if (!rawSrc) return null;
    try {
        return new URL(rawSrc, VIXSRC_BASE).toString();
    } catch {
        return null;
    }
}

function extractMasterPlaylistFromEmbedHtml(html) {
    if (!html) return null;
    const tokenMatch = html.match(/'token'\s*:\s*'([^']+)'/i);
    const expiresMatch = html.match(/'expires'\s*:\s*'([^']+)'/i);
    const urlMatch = html.match(/url\s*:\s*'([^']+\/playlist\/\d+[^']*)'/i);
    if (!tokenMatch || !expiresMatch || !urlMatch) return null;
    return {
        token: tokenMatch[1],
        expires: expiresMatch[1],
        url: urlMatch[1]
    };
}

function getQualityFromName(qualityStr) {
    if (!qualityStr) return "Unknown";
    const upper = qualityStr.toUpperCase();
    if (upper === "ORG" || upper === "ORIGINAL") return "Original";
    if (upper === "4K" || upper === "2160P") return "4K";
    if (upper === "1440P" || upper === "2K") return "1440p";
    if (upper === "1080P" || upper === "FHD") return "1080p";
    if (upper === "720P" || upper === "HD") return "720p";
    if (upper === "480P" || upper === "SD") return "480p";
    if (upper === "360P") return "360p";
    if (upper === "240P") return "240p";

    const match = qualityStr.match(/(\d{3,4})[pP]?/);
    if (match) {
        const resolution = parseInt(match[1], 10);
        if (resolution >= 2160) return "4K";
        if (resolution >= 1440) return "1440p";
        if (resolution >= 1080) return "1080p";
        if (resolution >= 720) return "720p";
        if (resolution >= 480) return "480p";
        if (resolution >= 360) return "360p";
        return "240p";
    }
    return "Unknown";
}

function checkQualityFromText(playlistText) {
    if (!playlistText) return null;
    if (/RESOLUTION=\d+x2160/i.test(playlistText) || /RESOLUTION=2160/i.test(playlistText)) return "4K";
    if (/RESOLUTION=\d+x1440/i.test(playlistText) || /RESOLUTION=1440/i.test(playlistText)) return "1440p";
    if (/RESOLUTION=\d+x1080/i.test(playlistText) || /RESOLUTION=1080/i.test(playlistText)) return "1080p";
    if (/RESOLUTION=\d+x720/i.test(playlistText) || /RESOLUTION=720/i.test(playlistText)) return "720p";
    if (/RESOLUTION=\d+x480/i.test(playlistText) || /RESOLUTION=480/i.test(playlistText)) return "480p";
    return null;
}

async function getTmdbId(imdbId, type) {
    const normalizedType = String(type).toLowerCase();
    const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data) return null;
        if (normalizedType === "movie" && data.movie_results && data.movie_results.length > 0) {
            return data.movie_results[0].id.toString();
        } else if (normalizedType === "tv" && data.tv_results && data.tv_results.length > 0) {
            return data.tv_results[0].id.toString();
        }
        return null;
    } catch {
        return null;
    }
}

async function getMetadata(id, type) {
    const normalizedType = String(type).toLowerCase();
    let url;
    if (String(id).startsWith("tt")) {
        url = `https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_API_KEY}&external_source=imdb_id&language=en-US`;
    } else {
        const endpoint = normalizedType === "movie" ? "movie" : "tv";
        url = `https://api.themoviedb.org/3/${endpoint}/${id}?api_key=${TMDB_API_KEY}&language=en-US`;
    }
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (String(id).startsWith("tt")) {
            const results = normalizedType === "movie" ? data.movie_results : data.tv_results;
            if (results && results.length > 0) return results[0];
        } else {
            return data;
        }
        return null;
    } catch {
        return null;
    }
}

async function getEpisodeMetadata(tvId, season, episode) {
    try {
        const url = `https://api.themoviedb.org/3/tv/${tvId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}&language=en-US`;
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

function normalizePlaybackHeaders(headers) {
    if (!headers || typeof headers !== "object") return headers;
    const normalized = {};
    for (const [key, value] of Object.entries(headers)) {
        if (value == null) continue;
        const lowerKey = String(key).toLowerCase();
        if (lowerKey === "user-agent") normalized["User-Agent"] = value;
        else if (lowerKey === "referer" || lowerKey === "referrer") normalized["Referer"] = value;
        else if (lowerKey === "origin") normalized["Origin"] = value;
        else if (lowerKey === "accept") normalized["Accept"] = value;
        else if (lowerKey === "accept-language") normalized["Accept-Language"] = value;
        else normalized[key] = value;
    }
    return normalized;
}

function shouldForceNotWebReady(text) {
    const lower = text.toLowerCase();
    return lower.includes("loadm") || lower.includes("loadm.cam") || lower.includes("mixdrop") || lower.includes("mxcontent");
}

function formatStream(stream, providerName) {
    const rawQuality = stream.quality || "1080p";
    let cleanQuality = "1080p";
    if (["2160p", "4k"].includes(rawQuality.toLowerCase())) cleanQuality = "4K";
    else if (rawQuality.toLowerCase() === "1440p") cleanQuality = "1440p";
    else if (rawQuality.toLowerCase() === "720p") cleanQuality = "720p";
    else if (["576p", "480p", "360p", "240p"].includes(rawQuality.toLowerCase())) cleanQuality = "SD";

    let audioChannels = "Stereo";
    if (cleanQuality === "4K") {
        audioChannels = "DD5.1";
    } else if (stream.url && (stream.url.includes("hq") || stream.url.includes("hevc"))) {
        audioChannels = "DD5.1";
    }

    let detectedLanguages = "English • Italian";

    const streamUrlLower = stream.url ? stream.url.toLowerCase() : "";
    const metaTitleLower = (stream._meta_layout && stream._meta_layout.title) ? stream._meta_layout.title.toLowerCase() : "";

    if (metaTitleLower.includes("dhurandhar") || streamUrlLower.includes("hindi") || streamUrlLower.includes("hin")) {
        detectedLanguages = "Hindi";
    } else if (metaTitleLower.includes("teach you a lesson") || streamUrlLower.includes("korean") || streamUrlLower.includes("kor")) {
        detectedLanguages = "Korean + Italian";
    } else if (streamUrlLower.includes("lang=it") || streamUrlLower.includes("ita") || streamUrlLower.includes("dual")) {
        detectedLanguages = "English • Italian";
    } else if (streamUrlLower.includes("eng") && !streamUrlLower.includes("it")) {
        detectedLanguages = "English";
    }
    const formatCodec = (cleanQuality === "4K" || (stream.url && stream.url.includes("hevc"))) ? "HEVC" : "H.264";
    const durationStr = (stream._meta_layout && stream._meta_layout.duration) ? `${stream._meta_layout.duration} min` : "Variable";
    const subLine1 = `${cleanQuality} • ${durationStr} `;
    const subLine2 = `${formatCodec} • ${audioChannels}`;

    const finalTitle = `${subLine1}\n${subLine2}`;

    let behaviorHints = stream.behaviorHints && typeof stream.behaviorHints === "object" ? { ...stream.behaviorHints } : {};
    let finalHeaders = stream.headers;
    if (behaviorHints.proxyHeaders && behaviorHints.proxyHeaders.request) {
        finalHeaders = behaviorHints.proxyHeaders.request;
    } else if (behaviorHints.headers) {
        finalHeaders = behaviorHints.headers;
    }
    finalHeaders = normalizePlaybackHeaders(finalHeaders);
    if (finalHeaders) {
        behaviorHints.proxyHeaders = { request: finalHeaders };
        behaviorHints.headers = finalHeaders;
    }

    const providerExplicitNotWebReady = stream.behaviorHints && "notWebReady" in stream.behaviorHints;
    const textCheck = [stream.url, stream.name, stream.title, stream.server, "VixSrc"].filter(Boolean).join(" ");
    if (shouldForceNotWebReady(textCheck)) {
        behaviorHints.notWebReady = true;
    } else if (!providerExplicitNotWebReady) {
        delete behaviorHints.notWebReady;
    }

    const playbackReferer = stream.referer || finalHeaders?.Referer || finalHeaders?.referer;
    const playbackUserAgent = stream.userAgent || finalHeaders?.["User-Agent"] || finalHeaders?.["user-agent"];

    const baseStream = {
        ...stream,
        name: `VixSrc • ${detectedLanguages}`,
        title: finalTitle,
        quality: finalTitle,
        behaviorHints,
        provider: "kethrax",
        referer: playbackReferer,
        userAgent: playbackUserAgent,
        headers: finalHeaders
    };

    return baseStream;
}

async function getStreams(id, type, season, episode, providerContext = null) {
    const requestedType = String(type).toLowerCase();
    const normalizedType = requestedType === "series" ? "tv" : requestedType;
    let tmdbId = String(id);

    const contextTmdbId = (providerContext && /^\d+$/.test(String(providerContext.tmdbId || ""))) ? String(providerContext.tmdbId) : null;
    if (contextTmdbId) {
        tmdbId = contextTmdbId;
    } else if (tmdbId.startsWith("tmdb:")) {
        tmdbId = tmdbId.slice(5);
    } else if (tmdbId.startsWith("tt")) {
        const converted = await getTmdbId(tmdbId, normalizedType);
        if (converted) {
            tmdbId = converted;
        }
    }

    let metadata = null;
    try {
        metadata = await getMetadata(tmdbId, type);
    } catch { }

    const layoutMeta = {
        type: normalizedType,
        title: "Stream",
        year: "",
        season,
        episode,
        episodeName: "",
        duration: "Variable"
    };

    if (metadata) {
        layoutMeta.title = metadata.title || metadata.name || metadata.original_title || metadata.original_name || "Stream";
        const dateRaw = metadata.release_date || metadata.first_air_date || "";
        if (dateRaw) layoutMeta.year = dateRaw.split("-")[0];
        if (metadata.runtime) layoutMeta.duration = String(metadata.runtime);
        else if (metadata.episode_run_time && metadata.episode_run_time.length) layoutMeta.duration = String(metadata.episode_run_time[0]);
    }

    if (normalizedType === "tv") {
        try {
            const epMeta = await getEpisodeMetadata(tmdbId, season, episode);
            if (epMeta) {
                if (epMeta.name) layoutMeta.episodeName = epMeta.name;
                if (epMeta.runtime) layoutMeta.duration = String(epMeta.runtime);
            }
        } catch { }
    }

    let apiUrl;
    if (normalizedType === "movie") {
        apiUrl = `${VIXSRC_BASE}/api/movie/${tmdbId}`;
    } else if (normalizedType === "tv") {
        apiUrl = `${VIXSRC_BASE}/api/tv/${tmdbId}/${season}/${episode}`;
    } else {
        return [];
    }

    try {
        const apiRes = await fetch(apiUrl, { headers: getCommonHeaders() });
        if (!apiRes.ok) return [];

        const apiPayload = await apiRes.json().catch(() => null);
        const embedUrl = extractEmbedSrcFromApiPayload(apiPayload);
        if (!embedUrl) return [];

        const embedRes = await fetch(embedUrl, { headers: getEmbedHeaders(embedUrl) });
        if (!embedRes.ok) return [];

        const embedHtml = await embedRes.text();
        const master = extractMasterPlaylistFromEmbedHtml(embedHtml);
        if (!master) return [];

        const [basePath, existingQuery] = master.url.split("?");
        const urlWithExt = basePath.endsWith(".m3u8") ? basePath : `${basePath}.m3u8`;
        const streamUrl = `${urlWithExt}${existingQuery ? "?" + existingQuery + "&" : "?"}token=${encodeURIComponent(master.token)}&expires=${encodeURIComponent(master.expires)}&h=1&lang=it`;
        const streamHeaders = getPlaylistHeaders(embedUrl);

        let quality = "1080p";
        try {
            const plRes = await fetch(streamUrl, { headers: streamHeaders });
            if (plRes.ok) {
                const plText = await plRes.text();
                const detected = checkQualityFromText(plText);
                if (detected) quality = detected;
            }
        } catch { }

        const normalizedQuality = getQualityFromName(quality);

        const rawStream = {
            name: "VixSrc",
            url: streamUrl,
            easyProxySourceUrl: embedUrl,
            quality: normalizedQuality,
            type: "direct",
            headers: streamHeaders,
            behaviorHints: { notWebReady: false },
            _meta_layout: layoutMeta
        };

        return [formatStream(rawStream, "VixSrc")].filter(s => s !== null);

    } catch {
        return [];
    }
}

module.exports = { getStreams };