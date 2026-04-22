const searchService = require('../services/searchService');
const cacheService = require('../services/cacheService');
const asyncWrapper = require('../utils/asyncWrapper');

const search = asyncWrapper(async (req, res) => {
  const { q = '', page = 1, category, language, type, quality } = req.query;
  const pageNum = parseInt(page, 10) || 1;
  
  // 1. Find all matching series (array of metadata documents)
  const matchedSeriesList = await searchService.findSeriesMatches(q) || [];
  // console.log('matchedSeriesList:', matchedSeriesList.map(s => s.value));

  // 2. Build cache key and try to get cached search results
  const cacheKey = `search:${q}:${pageNum}:${category}:${language}:${type}:${quality}`;
  let results = await cacheService.getCachedResults(cacheKey);
  
  if (!results) {
    // 3. Perform actual search (episodes are already filtered out)
    results = await searchService.searchAllDatabases(q, {
      page: pageNum,
      category,
      language,
      type,
      quality
    });
    await cacheService.setCachedResults(cacheKey, results);
  }

  // 4. Inject series cards only on page 1
  if (matchedSeriesList.length > 0 && pageNum === 1) {
    const seriesCards = [];
    for (const seriesMeta of matchedSeriesList) {
      const seriesName = seriesMeta.value;
      const seriesData = await searchService.getSeriesEpisodes(seriesName);
      seriesCards.push({
        _id: `series-${seriesName}`,
        isSeries: true,
        name: seriesName,
        poster: seriesMeta.image || seriesData.seriesPoster || null,
        totalSeasons: seriesData.seasons.length,
        totalEpisodes: seriesData.totalEpisodes,
        seriesName: seriesName
      });
    }
    // Prepend series cards to the file results
    results.results = [...seriesCards, ...results.results];
    results.total += seriesCards.length;
    results.totalPages = Math.ceil(results.total / 20);
  }

  // 5. Render or send JSON
  if (req.accepts('html')) {
    return res.render('index', {
      query: q,
      results: results.results,
      pagination: { page: results.page, totalPages: results.totalPages, total: results.total },
      trending: [],
      recent: [],
      botUsername: process.env.TELEGRAM_BOT_USERNAME
    });
  }
  res.json(results);
});

// ... rest of controller unchanged (trending, recent, etc.)


const trending = asyncWrapper(async (req, res) => {
  const cacheKey = 'trending';
  let cached = await cacheService.getCachedResults(cacheKey);
  if (!cached) {
    cached = await searchService.getTrending();
    await cacheService.setCachedResults(cacheKey, cached, 600);
  }
  res.json(cached);
});

const recent = asyncWrapper(async (req, res) => {
  const cacheKey = 'recent';
  let cached = await cacheService.getCachedResults(cacheKey);
  if (!cached) {
    cached = await searchService.getRecent();
    await cacheService.setCachedResults(cacheKey, cached, 300);
  }
  res.json(cached);
});

const filterOptions = asyncWrapper(async (req, res) => {
  const cacheKey = 'filterOptions';
  let cached = await cacheService.getCachedResults(cacheKey);
  if (!cached) {
    cached = await searchService.getFilterOptions();
    await cacheService.setCachedResults(cacheKey, cached, 3600);
  }
  res.json(cached);
});

const getSeriesList = asyncWrapper(async (req, res) => {
  const list = await searchService.getSeriesList(30);
  res.json(list);
});

const getSeriesEpisodes = asyncWrapper(async (req, res) => {
  const { name } = req.params;
  const season = req.query.season ? parseInt(req.query.season) : null;
  const data = await searchService.getSeriesEpisodes(name, season);
  res.json(data);
});

module.exports = { search, trending, recent, filterOptions, getSeriesList, getSeriesEpisodes };