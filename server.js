const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const path = require('path');
const fs = require('fs');

const TMDB_API_KEY = '307b7b8ef035c6aa336900aef4e203bd';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const PORT = process.env.PORT || 7000;

// ── Manifest ──────────────────────────────────────────────────────
const manifest = {
    id: 'org.stremio.latinuvio',
    version: '1.0.0',
    name: 'Latinuvio',
    description: 'Streaming providers ported from Latinuvio V2 / Eclipsia / Saimuel',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    behaviorHints: {
        adult: false,
    },
};

// ── Load all providers ─────────────────────────────────────────────
const PROVIDERS_DIRS = [
    path.join(__dirname, 'providers', 'eclipsia'),
    path.join(__dirname, 'providers', 'saimuel'),
];

const providers = [];

for (const dir of PROVIDERS_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    for (const file of files) {
        try {
            const mod = require(path.join(dir, file));
            if (typeof mod.getStreams === 'function') {
                const name = file.replace('.js', '');
                providers.push({ name, getStreams: mod.getStreams });
                console.log(`[OK] Loaded provider: ${name}`);
            }
        } catch (err) {
            console.error(`[SKIP] Failed to load ${file}: ${err.message}`);
        }
    }
}

console.log(`Loaded ${providers.length} providers`);

// ── IMDB → TMDB converter ─────────────────────────────────────────
const tmdbCache = new Map();

async function imdbToTmdb(imdbId, type) {
    const cacheKey = `${imdbId}|${type}`;
    if (tmdbCache.has(cacheKey)) return tmdbCache.get(cacheKey);

    try {
        const url = `${TMDB_BASE}/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();

        let result = null;
        if (type === 'movie' && data.movie_results && data.movie_results.length > 0) {
            result = { id: data.movie_results[0].id, type: 'movie' };
        } else if (type === 'series' && data.tv_results && data.tv_results.length > 0) {
            result = { id: data.tv_results[0].id, type: 'tv' };
        }

        tmdbCache.set(cacheKey, result);
        return result;
    } catch (err) {
        console.error(`[TMDB] Failed to convert ${imdbId}: ${err.message}`);
        return null;
    }
}

// ── Provider timeout helper ────────────────────────────────────────
const PROVIDER_TIMEOUT = 20000; // 20 seconds per provider

function withTimeout(promise, providerName, timeoutMs = PROVIDER_TIMEOUT) {
    const start = Date.now();
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            console.log(`[${providerName}] TIMEOUT after ${timeoutMs}ms`);
            resolve({ provider: providerName, streams: [], timedOut: true });
        }, timeoutMs);

        promise
            .then(streams => {
                clearTimeout(timer);
                const elapsed = Date.now() - start;
                if (elapsed > 5000) console.log(`[${providerName}] Done in ${elapsed}ms, ${(streams || []).length} streams`);
                resolve({ provider: providerName, streams: streams || [] });
            })
            .catch(err => {
                clearTimeout(timer);
                const elapsed = Date.now() - start;
                console.log(`[${providerName}] Error after ${elapsed}ms: ${err.message}`);
                resolve({ provider: providerName, streams: [] });
            });
    });
}

// ── Stream handler ─────────────────────────────────────────────────
async function handleStream(args) {
    const startTime = Date.now();
    const { type, id: imdbId } = args;

    // Parse season/episode from Stremio args for series
    let season = null;
    let episode = null;
    let mediaType = type === 'series' ? 'tv' : 'movie';

    // Stremio sends series as {type:'series', id:'tt1234567:1:2'} for season 1 ep 2
    // or just {type:'series', id:'tt1234567'}
    const idParts = imdbId.split(':');
    const cleanImdbId = idParts[0];
    if (type === 'series' && idParts.length >= 3) {
        season = parseInt(idParts[1], 10);
        episode = parseInt(idParts[2], 10);
    }

    // Convert IMDB to TMDB
    const tmdb = await imdbToTmdb(cleanImdbId, type);
    if (!tmdb) {
        console.log(`[STREAM] No TMDB match for ${cleanImdbId}`);
        return { streams: [] };
    }

    console.log(`[STREAM] ${cleanImdbId} → TMDB ${tmdb.id} (${mediaType})${season ? ` S${season}E${episode}` : ''}`);

    // Call all providers in parallel with individual timeouts
    const results = await Promise.allSettled(
        providers.map(p =>
            withTimeout(
                Promise.resolve(p.getStreams(tmdb.id, mediaType, season, episode)),
                p.name
            )
        )
    );

    // Merge all streams and map to Stremio format
    const stremioStreams = [];
    const seenUrls = new Set();

    for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const { provider, streams } = result.value;
        if (!streams || !Array.isArray(streams)) continue;

        for (const s of streams) {
            if (!s.url || seenUrls.has(s.url)) continue;
            seenUrls.add(s.url);

            const stremioStream = {
                name: provider,
                title: `${s.name || provider}\n${s.quality || ''}`.trim(),
                url: s.url,
            };

            // Pass headers if present (Stremio doesn't directly support them,
            // but some players read behaviorHints)
            if (s.headers && s.headers.Referer) {
                stremioStream.behaviorHints = {
                    proxyHeaders: {
                        request: {
                            Referer: s.headers.Referer,
                            Origin: s.headers.Origin || s.headers.Referer,
                            'User-Agent': s.headers['User-Agent'] || '',
                        }
                    }
                };
            }

            // Attach subtitles if present
            if (s.subtitles && Array.isArray(s.subtitles)) {
                stremioStream.subtitles = s.subtitles.map(sub => ({
                    id: sub.language || 'eng',
                    url: sub.url,
                    lang: (sub.language || 'eng').substring(0, 2).toLowerCase(),
                }));
            }

            stremioStreams.push(stremioStream);
        }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[STREAM] ${stremioStreams.length} streams in ${elapsed}ms`);
    return { streams: stremioStreams };
}

// ── Build and serve ────────────────────────────────────────────────
const builder = new addonBuilder(manifest);
builder.defineStreamHandler(handleStream);

serveHTTP(builder.getInterface(), { port: PORT });

console.log(`Latinuvio Stremio Addon listening on http://127.0.0.1:${PORT}/manifest.json`);
