const { getConnections } = require('../config/db');
const logger = require('../utils/logger');

const PAGE_SIZE = 20;
const SEARCH_TIMEOUT = 2000;

function normalizeFileSize(file) {
  if (typeof file.file_size === 'object' && file.file_size.$numberLong) {
    file.file_size = parseInt(file.file_size.$numberLong, 10);
  } else {
    file.file_size = parseInt(file.file_size, 10) || 0;
  }
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasSeasonEpisodePattern(text) {
  if (!text) return false;
  const patterns = [
  /\bS(?:eason)?\s*\d{1,3}\b/i,
  /\bE(?:pisode)?\s*\d{1,3}(?:[-–]?\s*E?\d{1,3})?\b/i,  // handles E05, E05-E08, E05E06, etc.
  /\bS\d{1,3}[._-]?E\d{1,3}\b/i,
  /[._-]S\d{1,3}[._-]?E?\d{0,3}\b/i
];
  return patterns.some(pattern => pattern.test(text));
}

function buildPrefixFilter(query) {
  if (!query || !query.trim()) return {};
  const terms = query.trim().split(/\s+/).filter(t => t.length > 0);
  if (terms.length === 0) return {};
  const conditions = terms.map(term => ({
    $or: [
      { file_name: { $regex: `\\b${term}`, $options: 'i' } },
      { caption: { $regex: `\\b${term}`, $options: 'i' } },
      { title: { $regex: `\\b${term}`, $options: 'i' } },
      { tags: { $regex: `\\b${term}`, $options: 'i' } }
    ]
  }));
  return { $and: conditions };
}

function buildMetadataFilter(options) {
  const filter = {};
  if (options.category) filter.category = options.category;
  if (options.language) filter.lang = options.language;
  if (options.type) filter.type = options.type;
  if (options.quality) filter.quality = options.quality;
  if (options.season) filter.season = parseInt(options.season, 10);
  if (options.episode) filter.episode = parseInt(options.episode, 10);
  return filter;
}

async function queryDatabase(connection, query, metadataFilter, skip, limit) {
  const model = connection.model('VJFile');
  let dbFilter = { ...metadataFilter };
  if (query && query.trim()) {
    const prefixFilter = buildPrefixFilter(query);
    dbFilter = { ...dbFilter, ...prefixFilter };
  }
  const [results, total] = await Promise.all([
    model.find(dbFilter).sort({ created_at: -1 }).skip(skip).limit(limit).lean().exec(),
    model.countDocuments(dbFilter).exec()
  ]);
  results.forEach(normalizeFileSize);
  return { results, total };
}

// ========== SERIES DETECTION (plural, returns array) ==========
function isValidSeriesQuery(query) {
  if (!query || query.length < 2) return false;
  if (/^\d+$/.test(query) && query.length < 3) return false;
  return true;
}

async function findSeriesMatches(query) {
  if (!query || query.length < 2) return [];
  const normalizedQuery = query.trim().toLowerCase();
  const connections = getConnections();
  const conn = connections[0];
  const metadataModel = conn.model('Metadata');
  
  const allSeries = await metadataModel.find({ type: 'series' }).lean();
  if (!allSeries.length) return [];
  
  const matches = [];
  for (const series of allSeries) {
    const name = series.value.toLowerCase();
    // Exact match
    if (name === normalizedQuery) {
      matches.push({ series, priority: 1 });
      continue;
    }
    // Whole-word match
    const wholeWordPattern = new RegExp(`\\b${escapeRegex(normalizedQuery)}\\b`, 'i');
    if (wholeWordPattern.test(name)) {
      matches.push({ series, priority: 2 });
      continue;
    }
    // Starts with (query length >= 3 and not purely numeric)
    if (normalizedQuery.length >= 3 && !/^\d+$/.test(normalizedQuery) && name.startsWith(normalizedQuery)) {
      matches.push({ series, priority: 3 });
    }
  }
  matches.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.series.value.length - a.series.value.length;
  });
  return matches.map(m => m.series);
}

// ========== SEARCH ==========
async function searchAllDatabases(query, options = {}) {
  const { page = 1, category, language, type, quality } = options;
  const connections = getConnections();
  const skip = (page - 1) * PAGE_SIZE;
  const metadataFilter = buildMetadataFilter({ category, language, type, quality });
  const FETCH_ALL_LIMIT = 1000;
  const promises = connections.map(conn => {
    return Promise.race([
      queryDatabase(conn, query, metadataFilter, 0, FETCH_ALL_LIMIT),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), SEARCH_TIMEOUT))
    ]).catch(err => {
      logger.warn(`DB query failed: ${err.message}`);
      return { results: [], total: 0 };
    });
  });
  const dbResults = await Promise.all(promises);
  let allResults = [];
  dbResults.forEach(({ results }) => allResults.push(...results));
  const seenFileIds = new Set();
  allResults = allResults.filter(file => {
    const key = file.file_id || (file._id && file._id.toString());
    if (!key || seenFileIds.has(key)) return false;
    seenFileIds.add(key);
    return true;
  });
  allResults = allResults.filter(file => {
    const text = `${file.title || ''} ${file.caption || ''} ${file.file_name || ''}`;
    return !hasSeasonEpisodePattern(text) && file.type !== 'series';
  });
  allResults.sort((a, b) => b.created_at - a.created_at);
  const totalCount = allResults.length;
  const paginatedResults = allResults.slice(skip, skip + PAGE_SIZE);
  return {
    results: paginatedResults,
    total: totalCount,
    page,
    totalPages: Math.ceil(totalCount / PAGE_SIZE)
  };
}

// ========== TRENDING / RECENT ==========
function isEpisodeFile(file) {
  if (file.type === 'series') return true;
  const text = `${file.title || ''} ${file.caption || ''} ${file.file_name || ''}`;
  return hasSeasonEpisodePattern(text);
}

async function fetchTrendingFromConnection(conn, skip, limit) {
  const model = conn.model('VJFile');
  const results = await model.find().sort({ clicks: -1 }).skip(skip).limit(limit).lean().exec();
  results.forEach(normalizeFileSize);
  return results;
}

async function fetchRecentFromConnection(conn, skip, limit) {
  const model = conn.model('VJFile');
  const results = await model.find().sort({ created_at: -1 }).skip(skip).limit(limit).lean().exec();
  results.forEach(normalizeFileSize);
  return results;
}

async function getTrending(limit = 20) {
  const connections = getConnections();
  const validFiles = [];
  let skip = 0, batchSize = 50;
  while (validFiles.length < limit && skip < 500) {
    const promises = connections.map(conn => fetchTrendingFromConnection(conn, skip, batchSize).catch(() => []));
    const results = await Promise.all(promises);
    const merged = results.flat();
    const filtered = merged.filter(file => !isEpisodeFile(file));
    validFiles.push(...filtered);
    skip += batchSize;
  }
  validFiles.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
  return validFiles.slice(0, limit);
}

async function getRecent(limit = 20) {
  const connections = getConnections();
  const validFiles = [];
  let skip = 0, batchSize = 50;
  while (validFiles.length < limit && skip < 500) {
    const promises = connections.map(conn => fetchRecentFromConnection(conn, skip, batchSize).catch(() => []));
    const results = await Promise.all(promises);
    const merged = results.flat();
    const filtered = merged.filter(file => !isEpisodeFile(file));
    validFiles.push(...filtered);
    skip += batchSize;
  }
  validFiles.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return validFiles.slice(0, limit);
}

// ========== SERIES LIST & EPISODES (with longest match) ==========
async function getSeriesList(limit = 20) {
  const connections = getConnections();
  const conn = connections[0];
  const fileModel = conn.model('VJFile');
  const metadataModel = conn.model('Metadata');
  const seriesMetadata = await metadataModel.find({ type: 'series' }).lean();
  if (!seriesMetadata.length) return [];
  const sortedMeta = [...seriesMetadata].sort((a, b) => b.value.length - a.value.length);
  const candidates = await fileModel.find({
    $or: [{ type: 'series' }, { caption: /S\d{1,2}/i }, { file_name: /S\d{1,2}/i }]
  }).sort({ created_at: -1 }).lean();
  const seriesMap = new Map();
  function matchesSeries(text, name) {
    const pattern = new RegExp(`(?:^|[\\s._-])${escapeRegex(name)}(?:$|[\\s._-])`, 'i');
    return pattern.test(text);
  }
  candidates.forEach(file => {
    const text = [file.title, file.caption, file.file_name, file.series_name].join(' ').toLowerCase();
    const bestMeta = sortedMeta.find(meta => matchesSeries(text, meta.value));
    if (!bestMeta) return;
    const seriesName = bestMeta.value;
    const key = seriesName.toLowerCase();
    if (!seriesMap.has(key)) {
      seriesMap.set(key, {
        name: seriesName,
        poster: bestMeta.image || file.image || null,
        count: 0,
        latest: file.created_at
      });
    }
    const entry = seriesMap.get(key);
    entry.count++;
    if (!entry.poster && file.image) entry.poster = file.image;
    if (file.created_at > entry.latest) entry.latest = file.created_at;
  });
  return Array.from(seriesMap.values())
    .sort((a, b) => b.count - a.count || b.latest - a.latest)
    .slice(0, limit);
}

async function getSeriesEpisodes(seriesName, season = null) {
  // Normalize input
  if (Array.isArray(seriesName)) seriesName = seriesName[0];
  if (seriesName && typeof seriesName === 'object' && seriesName.value) seriesName = seriesName.value;
  if (typeof seriesName !== 'string') {
    return { seriesName: 'Unknown', seriesPoster: null, seasons: [], episodesBySeason: {}, episodes: [], totalEpisodes: 0 };
  }
  const connections = getConnections();
  const conn = connections[0];
  const model = conn.model('VJFile');
  const metadataModel = conn.model('Metadata');
  const seriesMeta = await metadataModel.findOne({ type: 'series', value: seriesName }).lean();
  const seriesPoster = seriesMeta?.image || null;
  const allSeriesMeta = await metadataModel.find({ type: 'series' }).lean();
  const seriesNames = allSeriesMeta.map(m => m.value.trim()).sort((a, b) => b.length - a.length);
  function seriesBoundaryPattern(name) {
    return new RegExp(`(?:^|[\\s._-])${escapeRegex(name)}(?:$|[\\s._-])`, 'i');
  }
  const filter = {
    $or: [
      { series_name: { $regex: seriesName, $options: 'i' } },
      { caption: { $regex: seriesName, $options: 'i' } },
      { title: { $regex: seriesName, $options: 'i' } },
      { file_name: { $regex: seriesName, $options: 'i' } }
    ]
  };
  const episodes = await model.find(filter).sort({ created_at: -1 }).lean();
  const parsedEpisodes = [];
  for (const ep of episodes) {
    normalizeFileSize(ep);
    const text = [ep.title, ep.caption, ep.file_name, ep.series_name].join(' ').toLowerCase();
    const matchingSeries = seriesNames.filter(name => seriesBoundaryPattern(name).test(text));
    if (matchingSeries.length === 0) continue;
    const bestMatch = matchingSeries[0];
    if (bestMatch.toLowerCase() !== seriesName.toLowerCase()) continue;

    let seasonFromText = null;
    let episodeFromText = null;
    let displayEpisode = null;

    // Season
    const seasonMatch = (ep.caption || '').match(/S(\d{1,2})/i) || (ep.file_name || '').match(/S(\d{1,2})/i);
    if (seasonMatch) seasonFromText = parseInt(seasonMatch[1], 10);

    // Episode or episode range (E05, E05-E08, E05-08, E05E06)
    const episodeRangePattern = /E(\d{1,3})(?:[-](?:E)?(\d{1,3}))?/i;
    const episodeRangeMatch = (ep.caption || '').match(episodeRangePattern) ||
                              (ep.file_name || '').match(episodeRangePattern);

    if (episodeRangeMatch) {
      episodeFromText = parseInt(episodeRangeMatch[1], 10);
      if (episodeRangeMatch[2]) {
        // Valid range: second number captured only when a dash is present
        displayEpisode = `E${episodeRangeMatch[1]}-E${episodeRangeMatch[2]}`;
      } else {
        displayEpisode = `E${episodeRangeMatch[1]}`;
      }
    }

    const finalSeason = ep.season || seasonFromText;
    const finalEpisode = ep.episode || episodeFromText;
    if (!finalSeason) continue;

    ep.season = finalSeason;
    ep.episode = finalEpisode;
    ep.displayEpisode = displayEpisode;
    parsedEpisodes.push(ep);
  }
  const grouped = {};
  parsedEpisodes.forEach(ep => {
    const s = ep.season || 1;
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(ep);
  });
  Object.keys(grouped).forEach(s => grouped[s].sort((a, b) => (a.episode || 0) - (b.episode || 0)));
  const seasons = Object.keys(grouped).map(Number).sort((a, b) => a - b);
  return {
    seriesName,
    seriesPoster,
    seasons,
    episodesBySeason: grouped,
    episodes: season !== null ? (grouped[season] || []) : parsedEpisodes,
    totalEpisodes: parsedEpisodes.length,
    selectedSeason: season
  };
}

// ========== FILTER OPTIONS ==========
async function getFilterOptions() {
  const connections = getConnections();
  const pipeline = [
    { $group: { _id: null, categories: { $addToSet: '$category' }, languages: { $addToSet: '$lang' }, qualities: { $addToSet: '$quality' }, types: { $addToSet: '$type' } } },
    { $project: { _id: 0 } }
  ];
  try {
    const conn = connections[0];
    const result = await conn.model('VJFile').aggregate(pipeline);
    const options = result[0] || { categories: [], languages: [], qualities: [], types: [] };
    return {
      categories: options.categories.filter(Boolean).sort(),
      languages: options.languages.filter(Boolean).sort(),
      qualities: options.qualities.filter(Boolean).sort(),
      types: options.types.filter(Boolean).sort()
    };
  } catch (err) {
    return { categories: [], languages: [], qualities: [], types: [] };
  }
}

// ========== CLICKS ==========
async function incrementClicks(fileId) {
  const connections = getConnections();
  for (const conn of connections) {
    try {
      await conn.model('VJFile').updateOne({ file_id: fileId }, { $inc: { clicks: 1 } });
    } catch (err) {}
  }
}

module.exports = {
  searchAllDatabases,
  getTrending,
  getRecent,
  incrementClicks,
  getSeriesList,
  getSeriesEpisodes,
  findSeriesMatches,
  getFilterOptions
};