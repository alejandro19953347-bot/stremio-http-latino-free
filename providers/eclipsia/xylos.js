const PROVIDER_NAME = 'ZinkMovies';
const TMDB_API_KEY = '307b7b8ef035c6aa336900aef4e203bd';
const MAIN_URL = 'https://zinkmovies.wtf';
const DOMAINS_JSON_URL = 'https://codeberg.org/eclipsia-404/eclipsia/raw/branch/main/urls.json';

let baseUrl = MAIN_URL;
let cachedDomains = null;
let domainCacheTime = 0;
const DOMAIN_CACHE_TTL = 4 * 60 * 60 * 1000;

let currentUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36';
const UAS = [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
];

const FETCH_TIMEOUT = 12000;

async function refreshDomains() {
    if (cachedDomains && Date.now() - domainCacheTime < DOMAIN_CACHE_TTL) {
        return;
    }
    try {
        const response = await fetch(DOMAINS_JSON_URL, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (response?.ok) {
            const data = JSON.parse(await response.text());
            if (data?.zinkmovies) {
                cachedDomains = data;
                domainCacheTime = Date.now();
                baseUrl = data.zinkmovies;
            }
        }
    } catch (e) { }
}

function hdrs(extra = {}) {
    return {
        'User-Agent': currentUA,
        'Accept-Language': 'en-US,en;q=0.9',
        ...extra
    };
}

function raceTimeout(ms) {
    return new Promise((resolve, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
}

async function fetchText(url, options) {
    try {
        const response = await Promise.race([fetch(url, options || {}), raceTimeout(FETCH_TIMEOUT)]);
        if (response.ok) return await response.text();
    } catch (e) { }
    return null;
}

async function fetchJson(url, options) {
    try {
        const response = await Promise.race([fetch(url, options || {}), raceTimeout(FETCH_TIMEOUT)]);
        if (response.ok) return await response.json();
    } catch (e) { }
    return null;
}

function parseQuality(label) {
    const match = label.match(/(2160|1080|720|480)\s*P/i);
    if (match) return match[1] + 'P';
    if (/4K|UHD/i.test(label)) return '2160P';
    return '1080p';
}

function cleanHubTitle(rawTitle) {
    let title = rawTitle.replace(/\.(mkv|mp4|avi)$/i, '').trim();
    title = title.replace(/\s*[-–—]\s*ZINKMOVIES.*/i, '').trim();
    title = title.replace(/\s*[-–—]\s*JiTU.*/i, '').trim();
    title = title.replace(/\s+(IMAX\s+)?(2160|1080|720|480)\s*[pP].*/i, '').trim();
    title = title.replace(/\s+4K\s+.*/i, '').trim();
    return title.trim() || rawTitle;
}

function makeStream(title, quality, format, url) {
    return {
        name: PROVIDER_NAME + ' • ' + format,
        title: PROVIDER_NAME + ' • ' + size,
        url: url,
        quality: quality,
        format: url.includes('.mkv') ? 'mkv' : 'mp4'
    };
}

async function resolveTpiLink(tpiUrl) {
    try {
        const html = await fetchText(tpiUrl, { headers: hdrs({ Referer: baseUrl + '/' }) });
        if (!html) return null;
        const tokenMatch = html.match(/<input\s+type="hidden"\s+name="token"\s+value="([^"]+)"/i);
        if (!tokenMatch) return null;
        const token = tokenMatch[1];
        const b64Start = token.indexOf('aHR0c');
        if (b64Start < 0) return null;
        const decoded = atob(token.substring(b64Start));
        return decoded.startsWith('http') ? decoded : null;
    } catch (e) { }
    return null;
}

async function serverHandler(randomId, server) {
    try {
        const response = await Promise.race([
            fetch('https://new4.zinkcloud.net/server-handler.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'User-Agent': currentUA
                },
                body: JSON.stringify({ server: server, random_id: randomId })
            }),
            raceTimeout(FETCH_TIMEOUT)
        ]);
        const data = await response.json();
        if (data?.success && data.url) return data.url;
    } catch (e) { }
    return null;
}

async function processFile(fileId, label, quality, isSeries, season, episode) {
    const finalQuality = quality || parseQuality(label);
    const results = [];

    const resMatch = finalQuality.match(/(\d+)\s*P/i);
    if (resMatch && parseInt(resMatch[1]) < 720) return results;

    const [hubcloudUrl, workerUrl] = await Promise.all([
        serverHandler(fileId, 'hubcloud'),
        serverHandler(fileId, 'worker')
    ]);

    let displayTitle = label;

    if (hubcloudUrl) {
        const hubHtml = await fetchText(hubcloudUrl, { headers: hdrs() });
        if (hubHtml) {
            const pageTitle = (hubHtml.match(/<title>(.*?)<\/title>/i) || [])[1] || '';
            const cleaned = cleanHubTitle(pageTitle);
            if (cleaned) displayTitle = cleaned;

            const phpLinkMatch = hubHtml.match(/href="([^"]*hubcloud\.php[^"]*)"/i);
            if (phpLinkMatch) {
                const phpUrl = phpLinkMatch[1].replace(/&amp;/g, '&');
                const phpHtml = await fetchText(phpUrl, { headers: hdrs({ Referer: hubcloudUrl }) });
                if (phpHtml && phpHtml.length > 500) {
                    const streamLinks = [];
                    const linkRegex = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
                    let match;
                    while ((match = linkRegex.exec(phpHtml)) !== null) {
                        let url = match[1].replace(/&amp;/g, '&');
                        const text = match[2].replace(/<[^>]+>/g, '').trim();

                        if (!url || url.includes('javascript:') || /telegram|tg\/|pixeldrain|hubcloud\.cx|pixel\.hubcloud|gpdl2|bzzhr/i.test(url)) continue;

                        let type = '';
                        if (/cdn\.fsl-buckets\.life|r2\.cloudflarestorage|r2\.dev/i.test(url)) {
                            type = 'FSLv2';
                        } else if (/hub\.(latent|whistle)/i.test(url)) {
                            type = 'FSL';
                            url = url + '1' + new Date().getMinutes();
                        } else if (/workers\.dev/i.test(url)) {
                            type = 'Worker';
                        } else {
                            continue;
                        }

                        const qualityMatch = text.match(/(2160|1080|720|480)\s*[pP]/i);
                        streamLinks.push({
                            url: url,
                            type: type,
                            quality: qualityMatch ? qualityMatch[1] + 'P' : ''
                        });
                    }

                    for (const link of streamLinks) {
                        results.push(makeStream(
                            displayTitle,
                            link.quality || finalQuality,
                            link.type,
                            link.url
                        ));
                    }
                }
            }
        }
    }

    if (workerUrl) {
        results.push(makeStream(displayTitle, finalQuality, 'Worker', workerUrl));
    }

    return results;
}

async function extractEpisodeFromLinkstore(url, season, quality) {
    const html = await fetchText(url, { headers: hdrs() });
    if (!html) return [];

    const episodes = [];
    const fileRegex = /<a[^>]*href="(https:\/\/new[34]\.zinkcloud\.net\/file\/([^"]+))"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;

    while ((match = fileRegex.exec(html)) !== null) {
        const label = match[3].replace(/<[^>]+>/g, '').trim();
        if (/all\s*episodes/i.test(label)) continue;

        if (season > 0) {
            const epMatch = label.match(/(?:EPISODE|EP|E)\s*[-_]?\s*0?(\d+)/i);
            if (epMatch && parseInt(epMatch[1]) === season) {
                episodes.push({ id: match[2], label, quality });
            }
        } else {
            episodes.push({ id: match[2], label, quality });
        }
    }

    return episodes;
}

function extractConfig(html) {
    try {
        const match1 = html.match(/new HDVBPlayer\((\{[\s\S]*?\})\)/);
        if (match1) return JSON.parse(match1[1]);

        const match2 = html.match(/(?:let|var|const)\s+\w+\s*=\s*(\{[\s\S]*?"file":[\s\S]*?\});/);
        if (match2) return JSON.parse(match2[1]);
    } catch (e) { }
    return null;
}

async function getGemmaStreams(imdbId, isSeries, season, episode, showTitle) {
    const streams = [];

    try {
        const playUrl = 'https://gemma416okl.com/play/' + imdbId;
        const pageHtml = await fetchText(playUrl, { headers: hdrs({ Referer: baseUrl + '/' }) });
        if (!pageHtml) return streams;

        const config = extractConfig(pageHtml);
        if (!config?.file || !config?.key) return streams;

        let fileUrl = config.file;
        if (!fileUrl.includes('://')) fileUrl = 'https://gemma416okl.com' + fileUrl;

        const token = config.key;
        const folderData = await fetchJson(fileUrl, {
            method: 'POST',
            headers: {
                'X-CSRF-TOKEN': token,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': 'https://gemma416okl.com',
                'Referer': playUrl
            }
        });
        if (!folderData) return streams;

        const basePath = fileUrl.substring(0, fileUrl.lastIndexOf('/') + 1);
        let targetFiles = [];

        if (isSeries) {
            for (const item of folderData) {
                if (targetFiles.length) break;
                if (item.id == season || (item.title && item.title.includes(String(season)))) {
                    if (!item.folder) continue;
                    for (const subItem of item.folder) {
                        if (subItem.episode == episode || subItem.id == season + '-' + episode) {
                            if (!subItem.folder) continue;
                            for (const file of subItem.folder) {
                                if (file.file && file.file.startsWith('~')) {
                                    targetFiles.push(file);
                                }
                            }
                            break;
                        }
                    }
                }
            }
        } else {
            for (const item of folderData) {
                if (item.file && item.file.startsWith('~')) {
                    targetFiles.push(item);
                }
            }
        }

        for (const file of targetFiles) {
            const txtUrl = basePath + file.file.substring(1) + '.txt';
            const m3u8Content = await fetchText(txtUrl, {
                method: 'POST',
                headers: {
                    'X-CSRF-TOKEN': token,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Origin': 'https://gemma416okl.com',
                    'Referer': playUrl
                }
            });
            if (m3u8Content && m3u8Content.includes('.m3u8')) {
                const suffix = file.title ? ' • ' + file.title : '';
                const sizeStr = '1080p · ' + (file.title || 'Embed');
                streams.push({
                    name: PROVIDER_NAME + suffix,
                    title: PROVIDER_NAME + suffix,
                    url: m3u8Content.trim(),
                    quality: '1080p',
                    headers: {
                        origin: 'https://i-arch-400.keymi417exx.com',
                        referer: 'https://i-arch-400.keymi417exx.com/'
                    }
                });
            }
        }
    } catch (e) { }

    return streams;
}

async function scrapeZinkCloud(searchTitle, year, isTV, season, episode) {
    const results = [];

    try {
        const searchHtml = await fetchText(baseUrl + '/?s=' + encodeURIComponent(searchTitle));
        if (!searchHtml) return results;

        const typePath = isTV ? 'tvshows' : 'movies';
        const linkRegex = new RegExp('href="(https?:\\/\\/[^\\/]+\\/' + typePath + '\\/([^"]+))"', 'ig');
        let match, targetLink;

        while ((match = linkRegex.exec(searchHtml)) !== null) {
            if (!year || match[1].includes(year)) {
                targetLink = match[1];
                break;
            }
        }
        if (!targetLink) return results;

        const pageHtml = await fetchText(targetLink);
        if (!pageHtml) return results;

        if (isTV) {
            let episodes = [];
            if (/<div\s+class="seriecontainer">/i.test(pageHtml)) {
                const seasonBlocks = pageHtml.split('<div class="seriecontainer">');
                for (let i = 1; i < seasonBlocks.length; i++) {
                    const block = seasonBlocks[i].split('<div class="seriecontainer">')[0];
                    const seasonMatch = block.match(/Season\s*0?(\d+)/i);
                    if (!seasonMatch || parseInt(seasonMatch[1]) !== season) continue;

                    const tpiRegex = /href="(https:\/\/tpi\.li\/[^"]+)"[^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/ig;
                    let tpiMatch;
                    while ((tpiMatch = tpiRegex.exec(block)) !== null) {
                        episodes.push({
                            tpiUrl: tpiMatch[1],
                            label: tpiMatch[2].replace(/<[^>]+>/g, '').trim()
                        });
                    }
                    break;
                }
            } else {
                const tpiRegex = /href="(https:\/\/tpi\.li\/[^"]+)"[^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/ig;
                let tpiMatch;
                while ((tpiMatch = tpiRegex.exec(pageHtml)) !== null) {
                    episodes.push({
                        tpiUrl: tpiMatch[1],
                        label: tpiMatch[2].replace(/<[^>]+>/g, '').trim()
                    });
                }
            }

            const resolvedEpisodes = await Promise.all(
                episodes.map(async (ep) => {
                    const linkstoreUrl = await resolveTpiLink(ep.tpiUrl);
                    if (!linkstoreUrl) return [];
                    const quality = parseQuality(ep.label);
                    const files = await extractEpisodeFromLinkstore(linkstoreUrl, episode, quality);
                    return files.map(f => ({ ...f, label: ep.label }));
                })
            );

            for (const fileGroup of resolvedEpisodes) {
                const streamGroups = await Promise.all(
                    fileGroup.map(f => processFile(f.id, f.label, f.quality, true, season, episode))
                );
                for (const streams of streamGroups.flat()) {
                    results.push(streams);
                }
            }
        } else {
            const movieLinks = [];
            const tpiRegex = /href="(https:\/\/tpi\.li\/[^"]+)"[^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/ig;
            let tpiMatch;
            while ((tpiMatch = tpiRegex.exec(pageHtml)) !== null) {
                movieLinks.push({
                    tpiUrl: tpiMatch[1],
                    label: tpiMatch[2].replace(/<[^>]+>/g, '').trim()
                });
            }

            if (movieLinks.length) {
                const resolved = await Promise.all(
                    movieLinks.map(async (link) => {
                        const linkstoreUrl = await resolveTpiLink(link.tpiUrl);
                        if (!linkstoreUrl) return null;
                        const quality = parseQuality(link.label);
                        const fileIdMatch = linkstoreUrl.match(/zinkcloud\.net\/file\/([^\/]+)$/);
                        if (fileIdMatch) {
                            return { id: fileIdMatch[1], label: link.label, quality };
                        }
                        const episodes = await extractEpisodeFromLinkstore(linkstoreUrl, 0, quality);
                        if (episodes.length) {
                            return { id: episodes[0].id, label: link.label, quality: episodes[0].quality };
                        }
                        return null;
                    })
                );

                const validFiles = resolved.filter(Boolean);
                const streamGroups = await Promise.all(
                    validFiles.map(f => processFile(f.id, f.label, f.quality, false, 0, 0))
                );
                for (const streams of streamGroups.flat()) {
                    results.push(streams);
                }
            }
        }
    } catch (e) { }

    return results;
}

async function getStreams(tmdbId, type, season, episode) {
    await refreshDomains();
    currentUA = UAS[Math.floor(Math.random() * UAS.length)];

    const isTV = type === 'series' || type === 'tv';
    const allStreams = [];
    let showTitle = '';

    try {
        const details = await fetchJson(
            'https://api.themoviedb.org/3/' + (isTV ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + TMDB_API_KEY
        );
        if (details) {
            const title = isTV ? details.name : details.title;
            const year = isTV
                ? (details.first_air_date || '').split('-')[0]
                : (details.release_date || '').split('-')[0];
            if (isTV) {
                showTitle = title + ' S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0');
            } else {
                showTitle = title + (year ? ' (' + year + ')' : '');
            }

            const zinkStreams = await scrapeZinkCloud(title, year, isTV, season, episode);
            for (const stream of zinkStreams) allStreams.push(stream);
        }
    } catch (e) { }

    try {
        const externalIds = await fetchJson(
            'https://api.themoviedb.org/3/' + (isTV ? 'tv' : 'movie') + '/' + tmdbId + '/external_ids?api_key=' + TMDB_API_KEY
        );
        if (externalIds?.imdb_id) {
            const gemmaStreams = await getGemmaStreams(externalIds.imdb_id, isTV, season, episode, showTitle);
            for (const stream of gemmaStreams) allStreams.push(stream);
        }
    } catch (e) { }

    function getServerPriority(name) {
        if (name.includes('FSLv2') || name.includes('(FSLv2)')) return 4;
        if (name.includes('FSL') || name.includes('(FSL)')) return 3;
        if (name.includes('Worker') || name.includes('(Worker)')) return 2;
        return 1;
    }

    const qualityRank = {
        '2160P': 5,
        '1080p': 4,
        '720P': 3,
        '480P': 2
    };

    allStreams.sort((a, b) => {
        const prioA = getServerPriority(a.name);
        const prioB = getServerPriority(b.name);
        if (prioA !== prioB) return prioB - prioA;
        return (qualityRank[b.quality] || 0) - (qualityRank[a.quality] || 0);
    });

    return allStreams;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else if (typeof window !== 'undefined') {
    window.getStreams = getStreams;
}