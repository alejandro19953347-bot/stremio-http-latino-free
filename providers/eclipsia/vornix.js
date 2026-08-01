"use strict";

const PROVIDER_NAME = 'VegaMovies • FSL';
const TMDB_API_KEY = '307b7b8ef035c6aa336900aef4e203bd';
const baseUrl = 'https://vegamovies.navy';

const UAS = [
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
];
let currentUA = UAS[0];

const FETCH_TIMEOUT = 20000;
const QUALITY_WEIGHTS = { '2160P': 4, '1080P': 3, '720P': 2, '480P': 1 };

const _tmdbCache = {};

function enforceHttps(url) {
  if (!url) return url;
  return url.replace(/^http:\/\//i, 'https://');
}

function hdrs(extra) {
  return Object.assign({}, {
    'User-Agent': currentUA,
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  }, extra || {});
}

function raceTimeout(ms) {
  return new Promise(function (_, reject) {
    setTimeout(function () { reject(new Error('Timeout')); }, ms);
  });
}

async function fetchText(url, options) {
  try {
    const res = await Promise.race([fetch(url, options || {}), raceTimeout(FETCH_TIMEOUT)]);
    if (res && res.ok) return await res.text();
  } catch (e) { }
  return null;
}

async function fetchJson(url, options) {
  try {
    const res = await Promise.race([fetch(url, options || {}), raceTimeout(FETCH_TIMEOUT)]);
    if (res && res.ok) return await res.json();
  } catch (e) { }
  return null;
}

async function getTMDBInfo(tmdbId, type) {
  const key = tmdbId + '|' + type;
  if (_tmdbCache[key]) return _tmdbCache[key];
  const endpoint = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
  const url = 'https://api.themoviedb.org/3/' + endpoint + '/' + tmdbId
    + '?api_key=' + TMDB_API_KEY + '&language=en-US';
  const data = await fetchJson(url, { headers: { 'User-Agent': currentUA } });
  if (data) _tmdbCache[key] = data;
  return data;
}

async function searchSite(query) {
  const url = baseUrl + '/search.php?q=' + encodeURIComponent(query) + '&page=1&per_page=20';
  return await fetchJson(url, {
    headers: { 'User-Agent': currentUA, 'Accept': 'application/json, text/plain, */*' }
  });
}

function findAllMatches(searchResults, tmdbInfo, isSeries, seasonNumber) {
  if (!searchResults || !searchResults.hits || !searchResults.hits.length) return [];

  const targetTitle = ((isSeries ? tmdbInfo.name : tmdbInfo.title) || '').toLowerCase().trim();
  let targetYear = 0;
  const dateField = isSeries ? 'first_air_date' : 'release_date';
  if (tmdbInfo[dateField]) targetYear = parseInt(tmdbInfo[dateField], 10);

  const scored = [];

  for (let i = 0; i < searchResults.hits.length; i++) {
    const doc = searchResults.hits[i].document || searchResults.hits[i];
    if (!doc) continue;

    const postTitle = (doc.post_title || doc.title || '').toLowerCase().trim();

    if (targetYear) {
      const yearMatch = postTitle.match(/\((\d{4})\)/);
      const postYear = yearMatch ? parseInt(yearMatch[1], 10) : 0;
      if (postYear && Math.abs(postYear - targetYear) > 2) continue;
    }

    const words = targetTitle.split(/\s+/).filter(Boolean);
    let matched = 0;
    for (let w = 0; w < words.length; w++) {
      if (words[w].length < 3) { matched++; continue; }
      if (postTitle.indexOf(words[w]) !== -1) matched++;
    }
    let score = words.length > 0 ? matched / words.length : 0;

    if (isSeries && seasonNumber && postTitle.indexOf('season ' + seasonNumber) !== -1) score += 2;
    if (isSeries && postTitle.indexOf('season') !== -1) score += 0.5;
    if (/season\s+\d+\s*[-–—]\s*\d+/i.test(postTitle)) score -= 1.5;
    if (/batch|complete|all.?season/i.test(postTitle)) score -= 1;

    scored.push({ doc: doc, score: score, postTitle: postTitle });
  }

  scored.sort(function (a, b) { return b.score - a.score; });

  return scored
    .filter(function (item) { return item.score >= 0.5; })
    .map(function (item) { return item.doc; });
}

function extractQualitySize(text) {
  let quality = 'HD';
  let size = '';
  const resMatch = text.match(/(2160|1080|720|480)\s*[pP]/i);
  if (resMatch) quality = resMatch[1] + 'P';
  else if (/4K|UHD/i.test(text)) quality = '2160P';
  const sizeMatch = text.match(/\[([^\]]*(?:GB|MB)[^\]]*)\]/i);
  if (sizeMatch) size = sizeMatch[1];
  return { quality: quality, size: size };
}

function extractHeadingsForNexdrive(html) {
  const map = {};
  const patterns = [/<h5\b[^>]*>/ig, /<h1\b[^>]*>/ig, /<h3\b[^>]*>/ig, /<strong\b[^>]*>/ig];

  for (let p = 0; p < patterns.length; p++) {
    const parts = html.split(patterns[p]);
    for (let i = 1; i < parts.length; i++) {
      const section = parts[i];
      if (/\bbatch\b|all.?episode|complete.?season/i.test(section)) continue;

      const linkRe = /<a[^>]*href="([^"]*nexdrive[^"]*)"[^>]*>/gi;
      let match;
      while ((match = linkRe.exec(section)) !== null) {
        const href = match[1];
        if (map[href]) continue;

        let label = section.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const ndIdx = label.indexOf('nexdrive');
        if (ndIdx > 0) label = label.substring(0, ndIdx).trim();
        if (label.length > 80) label = label.substring(0, 80).trim();

        const qs = extractQualitySize(section);
        map[href] = { quality: qs.quality, size: qs.size, label: label };
      }
    }
  }
  return map;
}

function extractNexdriveHrefs(html) {
  const hrefs = [];
  const linkRe = /<a[^>]*href="([^"]*nexdrive[^"]*)"[^>]*>/gi;
  let match;

  while ((match = linkRe.exec(html)) !== null) {
    const href = match[1].trim();
    if (!href) continue;
    const anchorEnd = html.indexOf('</a>', match.index);
    const anchorText = anchorEnd > 0
      ? html.substring(match.index, anchorEnd).replace(/<[^>]+>/g, '').trim()
      : '';
    if (/\bbatch\b|all.?episode|complete\s+season/i.test(anchorText)) continue;
    if (hrefs.indexOf(href) === -1) hrefs.push(href);
  }
  return hrefs;
}

function extractNexdriveVcloudLinks(html) {
  const links = [];
  const linkRe = /<a\s+href="(https:\/\/vcloud\.zip\/[^"]+)"/gi;
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    const url = match[1].trim();
    links.push({
      type: /api\/index\.php/i.test(url) ? 'api' : 'direct',
      url: url
    });
  }
  return links;
}

async function resolveVcloudApi(url) {
  const html = await fetchText(url, { headers: hdrs({ 'Referer': baseUrl + '/' }) });
  if (!html) return null;
  const match = html.match(/<a\s+href="(https:\/\/vcloud\.zip\/[^"]+)"[^>]*>Direct\s+Download/i);
  return match ? match[1].trim() : null;
}

async function resolveVcloudToken(url) {
  const html = await fetchText(url, {
    headers: hdrs({ 'Referer': baseUrl + '/', 'Cookie': 'xla=s4t' })
  });
  if (!html) return null;
  const match = html.match(/atob\s*\(\s*atob\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\)/);
  if (!match) return null;
  try { return atob(atob(match[1])); } catch (e) { return null; }
}

function extractFSLLinks(html) {
  const results = [];
  if (!html) return results;
  const anchors = html.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi);
  if (!anchors) return results;

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const hrefM = anchor.match(/href="([^"]+)"/i);
    const textM = anchor.match(/>([\s\S]*?)<\/a>/i);
    if (!hrefM) continue;

    const href = hrefM[1].replace(/&amp;/g, '&');
    const label = textM ? textM[1].replace(/<[^>]+>/g, '').trim() : '';

    if (!href || href.indexOf('javascript:') === 0) continue;
    if (/telegram/i.test(label) || /tg\//i.test(href) || /pixeldrain/i.test(href)) continue;
    if (/hubcloud\.cx|gpdl2/i.test(href)) continue;

    let type;
    if (/r2\.cloudflarestorage/i.test(href) || /fslv2/i.test(label)) type = 'FSLv2';
    else if (/r2\.dev|hub\.latent/i.test(href) || (/fsl/i.test(label) && !/fslv2/i.test(label))) type = 'FSL';
    else if (/workers\.dev/i.test(href)) type = 'Worker';
    else continue;

    let quality = '';
    const qMatch = label.match(/(2160|1080|720|480)\s*[pP]/i);
    if (qMatch) quality = qMatch[1] + 'P';

    results.push({ url: href, type: type, quality: quality });
  }
  return results;
}

function parseStreamMeta(rawLabel, fallbackQuality, fallbackSize, fslType) {
  const text = (rawLabel || '').replace(/\s+/g, ' ').trim();

  let quality = fallbackQuality || 'HD';
  const qm = text.match(/(2160|1080|720|480)\s*[pP]/i);
  if (qm) quality = qm[1] + 'P';
  else if (/4K|UHD/i.test(text)) quality = '2160P';

  let size = '';
  const sm = text.match(/\[([^\]]*(?:GB|MB)[^\]]*)\]/i) || text.match(/([\d.]+\s*(?:GB|MB))/i);
  if (sm) size = sm[1].trim();
  if (!size && fallbackSize) size = fallbackSize;

  let sizeWeight = 0;
  const swm = size.match(/([\d.]+)\s*(GB|MB)/i);
  if (swm) sizeWeight = parseFloat(swm[1]) * (swm[2].toUpperCase() === 'GB' ? 1024 : 1);

  let source = '';
  if (/\bWEB[.\s-]?DL\b/i.test(text)) source = 'WEB-DL';
  else if (/\bWEBRip\b/i.test(text)) source = 'WEBRip';
  else if (/\bBlu[.\s-]?Ray\b/i.test(text)) source = 'BluRay';
  else if (/\bHDRip\b/i.test(text)) source = 'HDRip';
  else if (/\bHDTV\b/i.test(text)) source = 'HDTV';
  else if (/\bDVDRip\b/i.test(text)) source = 'DVDRip';
  else if (/\bCAMRip\b|\bCAM\b/i.test(text)) source = 'CAMRip';

  let codec = '';
  if (/\bx265\b|\bHEVC\b/i.test(text)) codec = 'x265';
  else if (/\bx264\b|\bH\.?264\b/i.test(text)) codec = 'H.264';
  else if (/\bAV1\b/i.test(text)) codec = 'AV1';
  else if (/\bVP9\b/i.test(text)) codec = 'VP9';

  let bitDepth = '';
  const bdm = text.match(/\b(10|8|12)[.\s-]?bit\b/i);
  if (bdm) bitDepth = bdm[1] + 'bit';

  let hdr = '';
  if (/\bDolby\s*Vision\b|\bDV\b/i.test(text)) hdr = 'DV';
  else if (/\bHDR10\+/i.test(text)) hdr = 'HDR10+';
  else if (/\bHDR10\b/i.test(text)) hdr = 'HDR10';
  else if (/\bHDR\b/i.test(text)) hdr = 'HDR';
  else if (/\bSDR\b/i.test(text)) hdr = 'SDR';

  const imax = /\bIMAX\b/i.test(text) ? 'IMAX' : '';

  let fps = '';
  const fpm = text.match(/\b(60|48|30|24)\s*FPS\b/i);
  if (fpm) fps = fpm[1] + 'FPS';

  let audio = '';
  if (/\bDolby\s*Atmos\b/i.test(text)) audio = 'Atmos';
  else if (/\bTrueHD\b/i.test(text)) audio = 'TrueHD';
  else if (/\bDTS[.\s-]?HD\b/i.test(text)) audio = 'DTS-HD';
  else if (/\bDTS\b/i.test(text)) audio = 'DTS';
  else if (/\bDD[+P]\b|\bEAC3\b/i.test(text)) audio = 'DD+';
  else if (/\bDD\b|\bAC3\b|\bDolby\s*Digital\b/i.test(text)) audio = 'DD';
  else if (/\bAAC\b/i.test(text)) audio = 'AAC';

  let channels = '';
  const chm = text.match(/\b(7\.1|5\.1|2\.0|2\.1)\b/);
  if (chm) channels = chm[1];

  const knownLangs = [
    'English', 'Hindi', 'Tamil', 'Telugu', 'Malayalam', 'Kannada',
    'Bengali', 'Punjabi', 'Marathi', 'Gujarati', 'Urdu',
    'French', 'Spanish', 'German', 'Italian', 'Japanese', 'Korean', 'Chinese', 'Arabic', 'Russian'
  ];
  let langs = [];
  for (let l = 0; l < knownLangs.length; l++) {
    if (new RegExp('\\b' + knownLangs[l] + '\\b', 'i').test(text)) langs.push(knownLangs[l]);
  }
  if (/\bDual\s*Audio\b/i.test(text) && !langs.length) langs.push('Dual Audio');
  if (/\bMulti\s*Audio\b/i.test(text)) langs = ['Multi Audio'];

  let service = '';
  if (/\bNetflix\b/i.test(text)) service = 'Netflix';
  else if (/\bAmazon\b|\bAMZN\b|\bPrime\s*Video\b/i.test(text)) service = 'Prime Video';
  else if (/\bDisney\+?\b|\bDisney\s*Plus\b/i.test(text)) service = 'Disney+';
  else if (/\bApple\s*TV\+?\b|\bAPTV\b/i.test(text)) service = 'Apple TV+';
  else if (/\bHBO\s*Max\b|\bMax\b/i.test(text)) service = 'Max';
  else if (/\bHBO\b/i.test(text)) service = 'HBO';
  else if (/\bHulu\b/i.test(text)) service = 'Hulu';
  else if (/\bParamount\+?\b/i.test(text)) service = 'Paramount+';
  else if (/\bPeacock\b/i.test(text)) service = 'Peacock';
  else if (/\bSony\s*LIV\b|\bSonyLIV\b/i.test(text)) service = 'SonyLIV';
  else if (/\bJioCinema\b|\bJio\s*Cinema\b/i.test(text)) service = 'JioCinema';
  else if (/\bZEE5\b/i.test(text)) service = 'ZEE5';
  else if (/\bHotstar\b/i.test(text)) service = 'Hotstar';
  else if (/\bAHA\b/i.test(text)) service = 'AHA';
  else if (/\bMX\s*Player\b/i.test(text)) service = 'MX Player';
  else if (/\bVoot\b/i.test(text)) service = 'Voot';
  else if (/\bALTBalaji\b/i.test(text)) service = 'ALTBalaji';

  const hostLabel = fslType === 'FSLv2' ? 'FSL-v2' : fslType || 'FSL';

  return { quality, size, sizeWeight, source, codec, bitDepth, hdr, imax, fps, audio, channels, langs, service, hostLabel };
}

function buildStreamLabel(meta) {
  const nameParts = [PROVIDER_NAME, meta.quality];
  if (meta.imax) nameParts.push(meta.imax);
  if (meta.service) nameParts.push(meta.service);
  const name = nameParts.join(' • ');

  const line1Parts = [];
  if (meta.langs.length) line1Parts.push(meta.langs.join(' • '));
  if (meta.size) line1Parts.push(meta.size);
  const line1 = line1Parts.join(' • ');

  const line2Parts = [];
  if (meta.source) line2Parts.push(meta.source);
  if (meta.fps) line2Parts.push(meta.fps);
  if (meta.audio) {
    let audioStr = meta.audio;
    if (meta.channels) audioStr += ' ' + meta.channels;
    line2Parts.push(audioStr);
  }
  if (meta.hdr) line2Parts.push(meta.hdr);
  if (meta.codec) line2Parts.push(meta.codec);
  if (meta.bitDepth) line2Parts.push(meta.bitDepth);
  if (meta.hostLabel) line2Parts.push(meta.hostLabel);
  const line2 = line2Parts.join(' • ');

  const qualityBlock = line1 && line2 ? line1 + '\n' + line2
    : line1 ? line1
      : line2;

  return { name, qualityBlock };
}

function dedupe(streams) {
  const seen = {};
  return (streams || []).filter(function (s) {
    if (!s || !s.url) return false;
    if (seen[s.url]) return false;
    seen[s.url] = true;
    return true;
  });
}

async function processNexdrive(nexdriveUrl, headingMap, movieTitle, isSeries, seasonNum, episodeNum) {
  const meta = headingMap[nexdriveUrl] || { quality: 'HD', size: '' };

  const knownQuality = meta.quality;
  if (knownQuality && knownQuality !== 'HD'
    && knownQuality !== '1080P' && knownQuality !== '2160P') return [];

  const fullUrl = enforceHttps(nexdriveUrl.startsWith('http')
    ? nexdriveUrl
    : baseUrl + '/' + nexdriveUrl.replace(/^\//, ''));

  const pageHtml = await fetchText(fullUrl, { headers: hdrs({ 'Referer': baseUrl + '/' }) });
  if (!pageHtml) return [];

  const vcloudLinks = extractNexdriveVcloudLinks(pageHtml);
  if (!vcloudLinks.length) return [];

  let selectedLinks = [];

  if (isSeries && episodeNum) {
    for (let v0 = 0; v0 < vcloudLinks.length; v0++) {
      const linkIdx = pageHtml.indexOf(vcloudLinks[v0].url);
      if (linkIdx < 0) continue;
      const before = pageHtml.substring(Math.max(0, linkIdx - 300), linkIdx);
      const epMatches = [];
      const epRe2 = /(?:episode|ep\.?|:episodes?:)\s*0*(\d+)/gi;
      let epM;
      while ((epM = epRe2.exec(before)) !== null) epMatches.push(parseInt(epM[1], 10));
      if (epMatches.length && epMatches[epMatches.length - 1] === episodeNum) {
        selectedLinks.push(vcloudLinks[v0]);
      }
    }

    if (!selectedLinks.length) {
      const posIdx = episodeNum - 1;
      if (posIdx >= 0 && posIdx < vcloudLinks.length) {
        selectedLinks.push(vcloudLinks[posIdx]);
      }
    }

    if (!selectedLinks.length) {
      for (let v1 = 0; v1 < vcloudLinks.length; v1++) {
        const li = pageHtml.indexOf(vcloudLinks[v1].url);
        if (li < 0) continue;
        const ctx2 = pageHtml.substring(Math.max(0, li - 600), li + 200);
        if (new RegExp('\\bE0*' + episodeNum + '\\b', 'i').test(ctx2)) {
          selectedLinks.push(vcloudLinks[v1]);
        }
      }
    }

    if (!selectedLinks.length) return [];
  } else {
    selectedLinks = vcloudLinks;
  }

  const streams = [];

  await Promise.all(selectedLinks.map(async function (vlink) {
    let vUrl = vlink.url;

    if (vlink.type === 'api') {
      const resolved = await resolveVcloudApi(vUrl);
      if (!resolved) return;
      vUrl = resolved;
    }

    const directPageUrl = enforceHttps(await resolveVcloudToken(vUrl));
    if (!directPageUrl) return;

    const directHtml = await fetchText(directPageUrl, {
      headers: hdrs({ 'Referer': baseUrl + '/', 'Cookie': 'xla=s4t' })
    });
    if (!directHtml) return;

    const fslLinks = extractFSLLinks(directHtml);

    for (let f = 0; f < fslLinks.length; f++) {
      const fsl = fslLinks[f];
      const quality = fsl.quality || meta.quality;

      if (fsl.type === 'Worker') continue;
      if (quality !== '1080P' && quality !== '2160P') continue;

      let rawLabel = meta.label || movieTitle;
      if (isSeries && seasonNum) rawLabel += ' S' + seasonNum;
      if (isSeries && episodeNum) rawLabel += ' E' + episodeNum;

      const parsed = parseStreamMeta(rawLabel, quality, meta.size, fsl.type);
      const labels = buildStreamLabel(parsed);

      streams.push({
        name: labels.name,
        quality: labels.qualityBlock,
        url: enforceHttps(fsl.url),
        _resWeight: QUALITY_WEIGHTS[parsed.quality] || 0,
        _sizeWeight: parsed.sizeWeight,
        headers: { 'Referer': baseUrl + '/', 'User-Agent': currentUA }
      });
    }
  }));

  return streams;
}

async function getStreams(tmdbId, type, seasonNumber, episodeNumber) {
  currentUA = UAS[Math.floor(Math.random() * UAS.length)];

  const isSeries = (type === 'tv' || type === 'series');

  const tmdbInfo = await getTMDBInfo(tmdbId, type);
  if (!tmdbInfo) return [];

  const title = (isSeries ? tmdbInfo.name : tmdbInfo.title) || '';

  const searchResults = await searchSite(title);
  if (!searchResults) return [];

  const matches = findAllMatches(searchResults, tmdbInfo, isSeries, seasonNumber || 1);
  if (!matches.length) return [];

  for (let m = 0; m < matches.length; m++) {
    const doc = matches[m];
    let postUrl = doc.permalink || doc.url || '';
    if (!postUrl.startsWith('http')) postUrl = baseUrl + '/' + postUrl.replace(/^\//, '');
    postUrl = enforceHttps(postUrl);

    const postHtml = await fetchText(postUrl, { headers: hdrs() });
    if (!postHtml) continue;

    const headingMap = extractHeadingsForNexdrive(postHtml);
    let nexdriveHrefs = extractNexdriveHrefs(postHtml);

    if (!nexdriveHrefs.length) continue;

    if (isSeries && seasonNumber) {
      const seasonFiltered = [];
      for (let n = 0; n < nexdriveHrefs.length; n++) {
        const idx = postHtml.indexOf(nexdriveHrefs[n]);
        if (idx > 0) {
          const ctx = postHtml.substring(Math.max(0, idx - 2000), idx);
          const sAll = [];
          const sRe = /season\s+(\d+)/gi;
          let sMatch;
          while ((sMatch = sRe.exec(ctx)) !== null) sAll.push(parseInt(sMatch[1], 10));
          const lastSeason = sAll.length ? sAll[sAll.length - 1] : null;
          if (lastSeason === null || lastSeason === seasonNumber) {
            seasonFiltered.push(nexdriveHrefs[n]);
          }
        }
      }
      if (seasonFiltered.length) nexdriveHrefs = seasonFiltered;
    }

    const linkCap = isSeries ? 15 : 20;
    if (nexdriveHrefs.length > linkCap) continue;

    const qualityFiltered = nexdriveHrefs.filter(function (href) {
      const meta = headingMap[href];
      if (!meta || meta.quality === 'HD') return true;
      return meta.quality === '1080P' || meta.quality === '2160P';
    });
    const hrefs = qualityFiltered.length ? qualityFiltered : nexdriveHrefs;

    const tasks = hrefs.map(function (href) {
      return processNexdrive(href, headingMap, title, isSeries, seasonNumber, episodeNumber);
    });

    const results = await Promise.all(tasks);
    let streams = [].concat.apply([], results);
    streams = dedupe(streams);
    streams.sort(function (a, b) {
      if (b._resWeight !== a._resWeight) return b._resWeight - a._resWeight;
      return b._sizeWeight - a._sizeWeight;
    });

    if (streams.length > 0) return streams;
  }

  return [];
}

module.exports = { getStreams };