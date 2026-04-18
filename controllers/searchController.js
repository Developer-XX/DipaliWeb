const searchService = require('../services/searchService');
const cacheService = require('../services/cacheService');
const asyncWrapper = require('../utils/asyncWrapper');
const { getConnections } = require('../config/db');

const search = asyncWrapper(async (req, res) => {
  const { q = '', page = 1, category, language, type, quality } = req.query;
  const pageNum = parseInt(page, 10) || 1;
  
  let matchedSeries = null;
  let seriesData = null;
  if (q) {
    matchedSeries = await searchService.findSeriesMatch(q);
    if (matchedSeries) {
      seriesData = await searchService.getSeriesEpisodes(matchedSeries);
    }
  }

  const cacheKey = `search:${q}:${pageNum}:${category}:${language}:${type}:${quality}`;
  let results = await cacheService.getCachedResults(cacheKey);
  if (!results) {
    results = await searchService.searchAllDatabases(q, {
      page: pageNum,
      category,
      language,
      type,
      quality,
      seriesName: matchedSeries
    });
    await cacheService.setCachedResults(cacheKey, results);
  }

  if (matchedSeries && seriesData && pageNum === 1) {
    const seriesCard = {
      _id: `series-${matchedSeries.value}`,
      isSeries: true,
      name: matchedSeries.value,
      poster: matchedSeries.image || seriesData.seriesPoster || null,
      totalSeasons: seriesData.seasons.length,
      totalEpisodes: seriesData.totalEpisodes,
      seriesName: matchedSeries.value
    };
    results.results = [seriesCard, ...results.results];
    results.total += 1;
  }

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

// ... rest of controller unchanged

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

// Get filter options
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