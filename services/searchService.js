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

// Series names cache
let cachedSeriesNames = [];
let seriesNamesCacheTime = 0;
const SERIES_CACHE_TTL = 300000;

async function getSeriesNames() {
  const now = Date.now();
  if (cachedSeriesNames.length && (now - seriesNamesCacheTime) < SERIES_CACHE_TTL) {
    return cachedSeriesNames;
  }
  const connections = getConnections();
  const metadataModel = connections[0].model('Metadata');
  const seriesList = await metadataModel.find({ type: 'series' }).lean();
  cachedSeriesNames = seriesList.map(s => s.value.toLowerCase());
  seriesNamesCacheTime = now;
  return cachedSeriesNames;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasSeasonEpisodePattern(text) {
  return /\b(?:S(?:eason)?\s*\d{1,2}|S\d{1,2}|E\d{1,3})\b/i.test(text);
}

function normalizeSeriesText(text = '') {
  return (text || '').toString().toLowerCase();
}

function fileMatchesSeries(file, seriesName) {
  if (!seriesName) return false;
  const text = normalizeSeriesText([file.series_name, file.title, file.caption, file.file_name].join(' '));
  const regex = new RegExp(`\\b${escapeRegex(seriesName)}\\b`, 'i');
  return regex.test(text) && hasSeasonEpisodePattern(text);
}

function isSeriesResult(file, seriesName) {
  if (!seriesName) return false;
  const text = normalizeSeriesText([file.series_name, file.file_name, file.caption, file.title].join(' '));
  const regex = new RegExp(`\\b${escapeRegex(seriesName)}\\b`, 'i');
  if (!regex.test(text)) return false;
  if (hasSeasonEpisodePattern(text)) return true;
  if (file.type === 'series') return true;
  return false;
}

function isSeriesEpisode(file, seriesNames) {
  const text = `${file.title || ''} ${file.caption || ''} ${file.file_name || ''}`.toLowerCase();
  // Match series name as a whole word/phrase and require episode/season identifiers.
  return seriesNames.some(name => {
    const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i');
    return regex.test(text) && hasSeasonEpisodePattern(text);
  });
}

// ... (keep existing code up to findSeriesMatch) ...

// Helper: escape regex special characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper: check if query is numeric or too short to reliably match a series
function isValidSeriesQuery(query) {
  if (!query || query.length < 2) return false;
  // If query is only digits, require at least 3 digits to avoid false matches like "20"
  if (/^\d+$/.test(query) && query.length < 3) return false;
  return true;
}

// Find a series metadata entry that best matches the search query
async function findSeriesMatch(query) {
  if (!isValidSeriesQuery(query)) return null;
  
  const normalizedQuery = query.trim();
  const connections = getConnections();
  const conn = connections[0];
  const metadataModel = conn.model('Metadata');
  
  // 1. Exact match (case-insensitive)
  const exactMatch = await metadataModel.findOne({
    type: 'series',
    value: { $regex: `^${escapeRegex(normalizedQuery)}$`, $options: 'i' }
  }).lean();
  if (exactMatch) return exactMatch.value;
  
  // 2. Whole-word match (query appears as a distinct word in series name)
  const wholeWordPattern = new RegExp(`\\b${escapeRegex(normalizedQuery)}\\b`, 'i');
  const wholeWordMatch = await metadataModel.findOne({
    type: 'series',
    value: wholeWordPattern
  }).lean();
  if (wholeWordMatch) return wholeWordMatch.value;
  
  // 3. Starts with (only if query length >= 3 and not purely numeric)
  if (normalizedQuery.length >= 3 && !/^\d+$/.test(normalizedQuery)) {
    const startsWithPattern = new RegExp(`^${escapeRegex(normalizedQuery)}`, 'i');
    const startsWithMatch = await metadataModel.findOne({
      type: 'series',
      value: startsWithPattern
    }).lean();
    if (startsWithMatch) return startsWithMatch.value;
  }
  
  // No match found in metadata
  return null;
}

// In searchAllDatabases, we now only use the seriesName from findSeriesMatch
// and we do NOT attempt to guess series names from files.
async function searchAllDatabases(query, options = {}) {
  const { page = 1, category, language, type, quality, season, episode } = options;
  const connections = getConnections();
  const skip = (page - 1) * PAGE_SIZE;
  const metadataFilter = buildMetadataFilter({ category, language, type, quality, season, episode });
  
  // Determine if this is a series search (only if findSeriesMatch returns a value)
  let targetSeries = null;
  if (query && query.trim()) {
    targetSeries = await findSeriesMatch(query);
  }
  
  const fetchLimit = PAGE_SIZE * 3;
  const promises = connections.map(conn => {
    return Promise.race([
      queryDatabase(conn, query, metadataFilter, skip, fetchLimit),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), SEARCH_TIMEOUT))
    ]).catch(err => {
      logger.warn(`DB query failed: ${err.message}`);
      return { results: [], total: 0 };
    });
  });
  
  const dbResults = await Promise.all(promises);
  let mergedResults = [];
  let totalCount = 0;
  
  dbResults.forEach(({ results, total }) => {
    mergedResults.push(...results);
    totalCount += total;
  });
  
  // Deduplicate by file_id
  const seenFileIds = new Set();
  mergedResults = mergedResults.filter(file => {
    const key = file.file_id || (file._id && file._id.toString());
    if (!key || seenFileIds.has(key)) return false;
    seenFileIds.add(key);
    return true;
  });
  totalCount = mergedResults.length;
  mergedResults.sort((a, b) => b.created_at - a.created_at);
  
  // Post-filter: remove files that belong to the matched series (if any)
  if (targetSeries) {
    const before = mergedResults.length;
    mergedResults = mergedResults.filter(file => !fileMatchesSeries(file, targetSeries));
    const removed = before - mergedResults.length;
    totalCount = Math.max(0, totalCount - removed);
  }
  
  const paginatedResults = mergedResults.slice(0, PAGE_SIZE);
  
  return {
    results: paginatedResults,
    total: totalCount,
    page,
    totalPages: Math.ceil(totalCount / PAGE_SIZE)
  };
}

// Helper: does a file belong to a specific series?
function fileMatchesSeries(file, seriesName) {
  if (!seriesName) return false;
  const text = `${file.series_name || ''} ${file.title || ''} ${file.caption || ''} ${file.file_name || ''}`.toLowerCase();
  const regex = new RegExp(`\\b${escapeRegex(seriesName.toLowerCase())}\\b`, 'i');
  // Must contain series name as whole word AND have season/episode pattern OR be explicitly type 'series'
  return regex.test(text) && (hasSeasonEpisodePattern(text) || file.type === 'series');
}

// ... (rest of the file unchanged) ...

async function searchAllDatabases(query, options = {}) {
  const { page = 1, category, language, type, quality, season, episode } = options;
  const connections = getConnections();
  const skip = (page - 1) * PAGE_SIZE;
  const metadataFilter = buildMetadataFilter({ category, language, type, quality, season, episode });
  
  // Determine if this is a series search (from metadata)
  let targetSeries = null;
  if (query && query.trim()) {
    targetSeries = await findSeriesMatch(query);
  }
  
  const fetchLimit = PAGE_SIZE * 3;
  const promises = connections.map(conn => {
    return Promise.race([
      queryDatabase(conn, query, metadataFilter, skip, fetchLimit),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), SEARCH_TIMEOUT))
    ]).catch(err => {
      logger.warn(`DB query failed: ${err.message}`);
      return { results: [], total: 0 };
    });
  });
  
  const dbResults = await Promise.all(promises);
  let mergedResults = [];
  let totalCount = 0;
  
  dbResults.forEach(({ results, total }) => {
    mergedResults.push(...results);
    totalCount += total;
  });
  
  // Deduplicate by file_id
  const seenFileIds = new Set();
  mergedResults = mergedResults.filter(file => {
    const key = file.file_id || (file._id && file._id.toString());
    if (!key || seenFileIds.has(key)) return false;
    seenFileIds.add(key);
    return true;
  });
  
  // ===== IMPORTANT: Filter out ALL episodic content =====
  // Remove any file that appears to be a series episode (has season pattern or type='series')
  const beforeFilter = mergedResults.length;
  mergedResults = mergedResults.filter(file => {
    const text = `${file.title || ''} ${file.caption || ''} ${file.file_name || ''}`;
    // Keep the file only if it does NOT have season/episode pattern AND is not type 'series'
    return !hasSeasonEpisodePattern(text) && file.type !== 'series';
  });
  const removedByEpisodeFilter = beforeFilter - mergedResults.length;
  totalCount = Math.max(0, totalCount - removedByEpisodeFilter);
  
  // Sort by date
  mergedResults.sort((a, b) => b.created_at - a.created_at);
  
  const paginatedResults = mergedResults.slice(0, PAGE_SIZE);
  
  return {
    results: paginatedResults,
    total: totalCount,
    page,
    totalPages: Math.ceil(totalCount / PAGE_SIZE)
  };
}

// ... (getTrending, getRecent, incrementClicks unchanged) ...


// Trending files
async function getTrending(limit = 20) {
  const connections = getConnections();
  const promises = connections.map(conn => 
    conn.model('VJFile').find().sort({ clicks: -1 }).limit(limit).lean().exec()
      .catch(() => [])
  );
  const results = await Promise.all(promises);
  const merged = results.flat();
  merged.sort((a, b) => b.clicks - a.clicks);
  merged.forEach(normalizeFileSize);
  return merged.slice(0, limit);
}

// Recent files
async function getRecent(limit = 20) {
  const connections = getConnections();
  const promises = connections.map(conn => 
    conn.model('VJFile').find().sort({ created_at: -1 }).limit(limit).lean().exec()
      .catch(() => [])
  );
  const results = await Promise.all(promises);
  const merged = results.flat();
  merged.sort((a, b) => b.created_at - a.created_at);
  merged.forEach(normalizeFileSize);
  return merged.slice(0, limit);
}

// Increment click count
async function incrementClicks(fileId) {
  const connections = getConnections();
  for (const conn of connections) {
    try {
      await conn.model('VJFile').updateOne({ file_id: fileId }, { $inc: { clicks: 1 } });
    } catch (err) {
      // ignore
    }
  }
}

async function getSeriesList(limit = 20) {
  const connections = getConnections();
  const conn = connections[0];
  const fileModel = conn.model('VJFile');
  const metadataModel = conn.model('Metadata');
  
  const seriesMetadata = await metadataModel.find({ type: 'series' }).lean();
  const canonicalMap = new Map();
  seriesMetadata.forEach(m => canonicalMap.set(m.value.toLowerCase(), m));
  
  const candidates = await fileModel.find({
    $or: [
      { type: 'series' },
      { caption: /S\d{1,2}/i },
      { file_name: /S\d{1,2}/i }
    ]
  }).sort({ created_at: -1 }).lean();
  
  const seriesMap = new Map();
  
  candidates.forEach(file => {
    let seriesName = file.series_name;
    let metadata = null;
    
    if (seriesName) {
      metadata = canonicalMap.get(seriesName.toLowerCase());
      if (metadata) seriesName = metadata.value;
    } else {
      const text = (file.title || file.caption || file.file_name).toLowerCase();
      for (const [key, m] of canonicalMap.entries()) {
        if (text.includes(key)) {
          seriesName = m.value;
          metadata = m;
          break;
        }
      }
      if (!seriesName) return;
    }
    
    const key = seriesName.toLowerCase();
    if (!seriesMap.has(key)) {
      seriesMap.set(key, {
        name: seriesName,
        poster: (metadata && metadata.image) || file.image || null,
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
  const connections = getConnections();
  const conn = connections[0];
  const model = conn.model('VJFile');
  const metadataModel = conn.model('Metadata');

  const seriesMeta = await metadataModel.findOne({ type: 'series', value: seriesName }).lean();
  const seriesPoster = seriesMeta?.image || null;
  
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
    
    // Check if file contains series name (whole word)
    const text = [ep.title, ep.caption, ep.file_name, ep.series_name].join(' ').toLowerCase();
    const seriesPattern = new RegExp(`\\b${seriesName.toLowerCase()}\\b`, 'i');
    if (!seriesPattern.test(text)) continue;
    
    // Try to extract season/episode from caption or file_name
    let seasonFromText = null;
    let episodeFromText = null;
    
    const seasonMatch = (ep.caption || '').match(/S(\d{1,2})/i) || (ep.file_name || '').match(/S(\d{1,2})/i);
    if (seasonMatch) seasonFromText = parseInt(seasonMatch[1], 10);
    
    const episodeMatch = (ep.caption || '').match(/E(\d{1,3})/i) || (ep.file_name || '').match(/E(\d{1,3})/i);
    if (episodeMatch) episodeFromText = parseInt(episodeMatch[1], 10);
    
    // Use database field if present, otherwise extracted value
    const finalSeason = ep.season || seasonFromText;
    const finalEpisode = ep.episode || episodeFromText;
    
    // ONLY include if it has a season number (either from DB or extracted)
    if (!finalSeason) continue; // Skip files without season info
    
    ep.season = finalSeason;
    ep.episode = finalEpisode;
    parsedEpisodes.push(ep);
  }
  
  // Group by season
  const grouped = {};
  parsedEpisodes.forEach(ep => {
    const s = ep.season || 1;
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(ep);
  });
  
  // Sort episodes within each season by episode number
  Object.keys(grouped).forEach(s => {
    grouped[s].sort((a, b) => (a.episode || 0) - (b.episode || 0));
  });
  
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

async function getFilterOptions() {
  const connections = getConnections();
  const pipeline = [
    { $group: {
      _id: null,
      categories: { $addToSet: '$category' },
      languages: { $addToSet: '$lang' },
      qualities: { $addToSet: '$quality' },
      types: { $addToSet: '$type' }
    }},
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

module.exports = {
  searchAllDatabases,
  getTrending,
  getRecent,
  incrementClicks,
  getSeriesList,
  getSeriesEpisodes,
  findSeriesMatch,
  getFilterOptions
};