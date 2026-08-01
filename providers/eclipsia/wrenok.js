"use strict";

const PURSTREAM_API = 'https://api.purstream.club/api/v1';
const PURSTREAM_REFERER = 'https://purstream.club/';
const PURSTREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TMDB_KEY = '307b7b8ef035c6aa336900aef4e203bd';

async function getEnglishTitle(tmdbId, mediaType) {
  const isTV = mediaType === 'tv' || mediaType === 'series';
  try {
    const url = `https://api.themoviedb.org/3/${isTV ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`;
    const res = await fetch(url);
    const data = await res.json();
    return data.title || data.name || '';
  } catch { return ''; }
}

function parseLang(n) {
  const up = (n || '').toUpperCase();
  if (up.includes('VOSTFR')) return 'VOSTFR';
  if (up.includes('VF')) return 'VF';
  return 'MULTI';
}

function parseQuality(n) {
  const up = (n || '').toUpperCase();
  if (up.includes('4K')) return '4K';
  if (up.includes('1080')) return '1080p';
  if (up.includes('720')) return '720p';
  return '1080p';
}

function buildTitle(title, quality, lang, format, season, episode) {
  const dispLang = lang === 'MULTI' ? 'MULTI' : lang === 'VOSTFR' ? 'VOSTFR' : 'VF';
  const fmt = (format || 'M3U8').toUpperCase();
  let line1 = title;
  if (season && episode) line1 = `S${season} E${episode} | ${title}`;
  return `${line1}\n${[quality, dispLang, fmt].join(' | ')}`;
}

async function findIdByTitle(title, preferType) {
  const encoded = encodeURIComponent(title);
  const res = await fetch(`${PURSTREAM_API}/search-bar/search/${encoded}`, {
    headers: { 'User-Agent': PURSTREAM_UA, 'Referer': PURSTREAM_REFERER }
  });
  const data = await res.json();
  const items = data?.data?.items?.movies?.items || [];
  if (!items.length) throw new Error();

  const match = items.find(i => i.type === preferType) || items[0];
  return match.id;
}

async function fetchMovieSources(id) {
  const res = await fetch(`${PURSTREAM_API}/media/${id}/sheet`, {
    headers: { 'User-Agent': PURSTREAM_UA, 'Referer': PURSTREAM_REFERER }
  });
  const data = await res.json();
  return data.data.items.urls || [];
}

async function fetchEpisodeSources(id, season, episode) {
  const res = await fetch(`${PURSTREAM_API}/stream/${id}/episode?season=${season}&episode=${episode}`, {
    headers: { 'User-Agent': PURSTREAM_UA, 'Referer': PURSTREAM_REFERER }
  });
  const data = await res.json();
  return data.data.items.sources || [];
}

function normalizeMovieSources(urls, title) {
  return urls.filter(u => u.url && (u.url.match(/\.m3u8/i) || u.url.match(/\.mp4/i)))
    .map(u => {
      const q = parseQuality(u.name);
      const l = parseLang(u.name);
      const f = u.url.match(/\.mp4/i) ? 'mp4' : 'm3u8';
      return {
        name: `Purstream • ${q}`,
        title: buildTitle(title, q, l, f),
        url: u.url,
        quality: q,
        headers: { 'User-Agent': PURSTREAM_UA, 'Referer': PURSTREAM_REFERER }
      };
    });
}

function normalizeEpisodeSources(sources, title, season, episode) {
  return sources.map(s => {
    const q = parseQuality(s.source_name);
    const l = parseLang(s.source_name);
    return {
      name: `Purstream • ${q}`,
      title: buildTitle(title, q, l, s.format || 'm3u8', season, episode),
      url: s.stream_url,
      quality: q,
      headers: { 'User-Agent': PURSTREAM_UA, 'Referer': PURSTREAM_REFERER }
    };
  });
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const isSeries = mediaType === 'tv' || mediaType === 'series';
    const title = await getEnglishTitle(tmdbId, mediaType);
    if (!title) return [];

    const preferType = isSeries ? 'tv' : 'movie';
    const id = await findIdByTitle(title, preferType);

    if (isSeries) {
      const sources = await fetchEpisodeSources(id, season, episode);
      return normalizeEpisodeSources(sources, title, season, episode);
    } else {
      const urls = await fetchMovieSources(id);
      return normalizeMovieSources(urls, title);
    }
  } catch {
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}