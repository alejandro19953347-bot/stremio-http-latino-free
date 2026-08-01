"use strict";

const __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    const fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    const rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    const step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

const cheerio = require("cheerio-without-node-native");
const CryptoJS = require("crypto-js");

const TMDB_API_KEY = "307b7b8ef035c6aa336900aef4e203bd";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const DEFAULT_API_BASE = "https://id-mapping-api-showbox-proxy.hf.space/api/media";

const WORKING_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Content-Type": "application/json"
};

function getUiToken() {
  try {
    let rawToken = "";
    if (typeof global !== "undefined" && global.SCRAPER_SETTINGS && global.SCRAPER_SETTINGS.uiToken) {
      rawToken = String(global.SCRAPER_SETTINGS.uiToken).trim();
    } else if (typeof window !== "undefined" && window.SCRAPER_SETTINGS && window.SCRAPER_SETTINGS.uiToken) {
      rawToken = String(window.SCRAPER_SETTINGS.uiToken).trim();
    }
    if (!rawToken) return "";
    if (rawToken.startsWith("eyJ")) {
      try {
        const parsedWords = CryptoJS.enc.Base64.parse(rawToken);
        const decodedStr = parsedWords.toString(CryptoJS.enc.Utf8);
        const parsed = JSON.parse(decodedStr);
        if (parsed && parsed.encrypt_data) {
          const IV_KEY = "wEiphTn!";
          const DES_KEY = "123d6cedf626dy54233aa1w6";
          const key = CryptoJS.enc.Utf8.parse(DES_KEY);
          const iv = CryptoJS.enc.Utf8.parse(IV_KEY);
          const decrypted = CryptoJS.TripleDES.decrypt(
            parsed.encrypt_data,
            key,
            { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
          );
          const decryptedText = decrypted.toString(CryptoJS.enc.Utf8);
          const decryptedJson = JSON.parse(decryptedText);
          if (decryptedJson && decryptedJson.uid) {
            return String(decryptedJson.uid);
          }
        }
      } catch (err) { }
    }
    return rawToken;
  } catch (e) { }
  return "";
}

function getOssGroup() {
  try {
    if (typeof global !== "undefined" && global.SCRAPER_SETTINGS && global.SCRAPER_SETTINGS.ossGroup) {
      return String(global.SCRAPER_SETTINGS.ossGroup);
    }
    if (typeof window !== "undefined" && window.SCRAPER_SETTINGS && window.SCRAPER_SETTINGS.ossGroup) {
      return String(window.SCRAPER_SETTINGS.ossGroup);
    }
  } catch (e) { }
  return null;
}

function getApiBase() {
  try {
    if (typeof global !== "undefined" && global.SCRAPER_SETTINGS && global.SCRAPER_SETTINGS.apiBase) {
      return String(global.SCRAPER_SETTINGS.apiBase);
    }
    if (typeof window !== "undefined" && window.SCRAPER_SETTINGS && window.SCRAPER_SETTINGS.apiBase) {
      return String(window.SCRAPER_SETTINGS.apiBase);
    }
  } catch (e) { }
  return DEFAULT_API_BASE;
}

function getQualityFromName(qualityStr) {
  if (!qualityStr) return "Unknown";
  const quality = qualityStr.toUpperCase();
  if (quality === "ORG" || quality === "ORIGINAL") return "Original";
  if (quality === "4K" || quality === "2160P") return "4K";
  if (quality === "1440P" || quality === "2K") return "1440p";
  if (quality === "1080P" || quality === "FHD") return "1080p";
  if (quality === "720P" || quality === "HD") return "720p";
  if (quality === "480P" || quality === "SD") return "480p";
  if (quality === "360P") return "360p";
  if (quality === "240P") return "240p";
  const match = qualityStr.match(/(\d{3,4})[pP]?/);
  if (match) {
    const resolution = parseInt(match[1]);
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

function formatFileSize(sizeStr) {
  if (!sizeStr) return "Unknown";
  if (typeof sizeStr === "string" && (sizeStr.includes("GB") || sizeStr.includes("MB") || sizeStr.includes("KB"))) {
    return sizeStr;
  }
  if (typeof sizeStr === "number") {
    const gb = sizeStr / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = sizeStr / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  }
  return sizeStr;
}

function validateIds(tmdbId, mediaType, seasonNum, episodeNum) {
  const idStr = String(tmdbId).trim();
  if (!/^\d+$/.test(idStr)) return false;
  if (parseInt(idStr) <= 0) return false;

  if (mediaType === "tv") {
    if (!seasonNum || !episodeNum) return false;
    const ssn = parseInt(String(seasonNum).trim());
    const ep = parseInt(String(episodeNum).trim());
    if (isNaN(ssn) || isNaN(ep)) return false;
    if (ssn < 1 || ep < 1) return false;
  }
  return true;
}

function getTMDBDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    const endpoint = mediaType === "tv" ? "tv" : "movie";
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}`;
    try {
      const response = yield fetch(url, {
        headers: { "Authorization": `Bearer ${TMDB_API_KEY}` }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = yield response.json();
      const title = mediaType === "tv" ? data.name : data.title;
      const releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
      const year = releaseDate ? parseInt(releaseDate.split("-")[0]) : null;
      return { title, year };
    } catch (e) {
      return { title: `TMDB ID ${tmdbId}`, year: null };
    }
  });
}

function extractFebBoxShare(showboxId, mediaType, seasonNum, episodeNum, uiToken) {
  return __async(this, null, function* () {
    const streams = [];
    try {
      const boxType = mediaType === "tv" ? 2 : 1;
      const sharePageUrl = `https://www.febbox.com/mbp/to_share_page?box_type=${boxType}&mid=${showboxId}&json=1`;
      const shareRes = yield fetch(sharePageUrl).then((res) => res.json());
      if (!shareRes || shareRes.code !== 1 || !shareRes.data) return [];
      const shareLink = shareRes.data.share_link || shareRes.data.shareLink;
      if (!shareLink) return [];
      const shareKey = shareLink.split("/").pop();
      const listUrl = `https://www.febbox.com/file/file_share_list?share_key=${shareKey}`;
      const listRes = yield fetch(listUrl, { headers: { "Accept-Language": "en" } }).then((res) => res.json());
      if (!listRes || listRes.code !== 1 || !listRes.data || !listRes.data.file_list) return [];
      let fids = [];
      if (mediaType === "movie") {
        fids = listRes.data.file_list;
      } else {
        const seasonName = `season ${seasonNum}`;
        const seasonFolder = listRes.data.file_list.find((f) => f.file_name && f.file_name.toLowerCase() === seasonName);
        if (!seasonFolder) return [];
        const seasonListUrl = `https://www.febbox.com/file/file_share_list?share_key=${shareKey}&parent_id=${seasonFolder.fid}&page=1`;
        const seasonRes = yield fetch(seasonListUrl, { headers: { "Accept-Language": "en" } }).then((res) => res.json());
        if (!seasonRes || seasonRes.code !== 1 || !seasonRes.data || !seasonRes.data.file_list) return [];
        const seasonSlug = String(seasonNum).padStart(2, "0");
        const episodeSlug = String(episodeNum).padStart(2, "0");
        fids = seasonRes.data.file_list.filter(
          (f) => f.file_name && (f.file_name.toLowerCase().includes(`s${seasonSlug}e${episodeSlug}`) || f.file_name.toLowerCase().includes(`s${seasonNum}e${episodeNum}`))
        );
      }
      const videoHeaders = {
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.8",
        "Connection": "keep-alive",
        "Range": "bytes=0-",
        "Referer": "https://www.febbox.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      };
      const formattedCookie = uiToken.startsWith("ui=") ? uiToken : `ui=${uiToken}`;
      for (const file of fids) {
        const qualityUrl = `https://www.febbox.com/console/video_quality_list?fid=${file.fid}&share_key=${shareKey}`;
        const qualityRes = yield fetch(qualityUrl, {
          headers: { "Cookie": formattedCookie }
        }).then((res) => res.json()).catch(() => null);
        if (!qualityRes || !qualityRes.html) continue;
        const $ = cheerio.load(qualityRes.html);
        $("div.file_quality").each((i, el) => {
          const $quality = $(el);
          const streamUrl = $quality.attr("data-url");
          const qualityLabel = $quality.attr("data-quality");
          const sizeText = $quality.find(".size").text().trim();
          if (streamUrl) {
            const normalizedQuality = getQualityFromName(qualityLabel);
            if (normalizedQuality !== "4K" && normalizedQuality !== "1080p") return;
            streams.push({
              name: `ShowBox • FebBox [${normalizedQuality}]`,
              title: file.file_name,
              url: streamUrl,
              quality: normalizedQuality,
              size: sizeText || file.file_size || "Unknown",
              headers: videoHeaders,
              provider: "pynvix"
            });
          }
        });
      }
    } catch (e) { }
    return streams;
  });
}

function processShowBoxResponse(data, mediaInfo, mediaType, seasonNum, episodeNum) {
  const streams = [];
  try {
    if (!data || !data.success) return streams;
    if (!data.versions || !Array.isArray(data.versions) || data.versions.length === 0) return streams;
    let streamTitle = mediaInfo.title || "Unknown Title";
    if (mediaInfo.year) streamTitle += ` (${mediaInfo.year})`;
    if (mediaType === "tv" && seasonNum && episodeNum) {
      streamTitle = `${mediaInfo.title || "Unknown"} S${String(seasonNum).padStart(2, "0")}E${String(episodeNum).padStart(2, "0")}`;
      if (mediaInfo.year) streamTitle += ` (${mediaInfo.year})`;
    }
    data.versions.forEach(function (version, versionIndex) {
      const versionName = version.name || `Version ${versionIndex + 1}`;
      const versionSize = version.size || "Unknown";
      if (version.links && Array.isArray(version.links)) {
        version.links.forEach(function (link) {
          if (!link.url) return;
          const normalizedQuality = getQualityFromName(link.quality || "Unknown");
          if (normalizedQuality !== "4K" && normalizedQuality !== "1080p") return;
          const linkSize = link.size || versionSize;
          let streamName = "ShowBox";
          if (data.versions.length > 1) streamName += ` V${versionIndex + 1}`;
          streamName += ` ${normalizedQuality}`;
          streams.push({
            name: streamName,
            title: streamTitle,
            url: link.url,
            quality: normalizedQuality,
            size: formatFileSize(linkSize),
            provider: "showbox",
            speed: link.speed || null
          });
        });
      }
    });
  } catch (error) { }
  return streams;
}

function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  return __async(this, null, function* () {
    if (!validateIds(tmdbId, mediaType, seasonNum, episodeNum)) return [];

    const uiToken = getUiToken();
    const ossGroup = getOssGroup();
    const apiBase = getApiBase();
    if (!uiToken) return [];

    try {
      const mediaInfo = yield getTMDBDetails(tmdbId, mediaType);
      let proxyUrl;
      if (mediaType === "tv" && seasonNum && episodeNum) {
        if (ossGroup) {
          proxyUrl = `${apiBase}/tv/${tmdbId}/oss=${ossGroup}/${seasonNum}/${episodeNum}`;
        } else {
          proxyUrl = `${apiBase}/tv/${tmdbId}/${seasonNum}/${episodeNum}`;
        }
      } else {
        proxyUrl = `${apiBase}/movie/${tmdbId}`;
      }

      let showboxId = null;
      let streams = [];
      try {
        const response = yield fetch(proxyUrl, {
          headers: {
            ...WORKING_HEADERS,
            "X-FebBox-Token": uiToken
          }
        });
        if (response.ok) {
          const data = yield response.json();
          streams = processShowBoxResponse(data, mediaInfo, mediaType, seasonNum, episodeNum);
          if (data.id || data.mid) {
            showboxId = data.id || data.mid;
          } else if (data.data && (data.data.id || data.data.mid)) {
            showboxId = data.data.id || data.data.mid;
          }
        }
      } catch (e) { }
      if (showboxId) {
        const directStreams = yield extractFebBoxShare(showboxId, mediaType, seasonNum, episodeNum, uiToken);
        if (directStreams.length > 0) {
          streams = streams.concat(directStreams);
        }
      }
      if (streams.length === 0) return [];
      return streams;
    } catch (error) {
      return [];
    }
  });
}

function onSettings() {
  return __async(this, null, function* () {
    return [
      { type: "header", label: "ShowBox Configuration" },
      {
        type: "text",
        isPassword: true,
        key: "uiToken",
        label: "FebBox UI Token (Cookie)",
        placeholder: "ui=...",
        description: "Go to febbox.com, login, and copy your 'ui' cookie value from your browser."
      }
    ];
  });
}

module.exports = { getStreams, onSettings };
