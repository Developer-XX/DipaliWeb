const express = require('express');
const router = express.Router();
const searchService = require('../services/searchService');
const fileController = require('../controllers/fileController');
const cacheService = require('../services/cacheService');
const { getConnections } = require('../config/db');
const axios = require('axios');

// Image proxy
router.get('/img', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.redirect('/placeholder.jpg');
  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    res.set('Content-Type', response.headers['content-type']);
    response.data.pipe(res);
  } catch (err) {
    res.redirect('/placeholder.jpg');
  }
});

// Home page
router.get('/', async (req, res) => {
  const [trending, recent] = await Promise.all([
    searchService.getTrending(12),
    searchService.getRecent(12)
  ]);
  res.render('index', { 
    trending, 
    recent, 
    query: '',
    botUsername: process.env.TELEGRAM_BOT_USERNAME 
  });
});

// View all trending
router.get('/trending', async (req, res) => {
  const trending = await searchService.getTrending(100);
  res.render('all-items', { 
    title: '🔥 Trending Now',
    items: trending,
    botUsername: process.env.TELEGRAM_BOT_USERNAME
  });
});

// View all recent
router.get('/recent', async (req, res) => {
  const recent = await searchService.getRecent(100);
  res.render('all-items', { 
    title: '🆕 Recently Added',
    items: recent,
    botUsername: process.env.TELEGRAM_BOT_USERNAME
  });
});

// All series list page
router.get('/series', async (req, res) => {
  const seriesList = await searchService.getSeriesList(100);
  res.render('all-series', { 
    title: '📺 All Series',
    series: seriesList,
    botUsername: process.env.TELEGRAM_BOT_USERNAME
  });
});

// Series detail page (must come after /series to avoid conflict)
router.get('/series/:name', async (req, res) => {
  const { name } = req.params;
  const season = req.query.season ? parseInt(req.query.season) : null;
  const data = await searchService.getSeriesEpisodes(name, season);
  res.render('series-detail', { 
    series: data,
    botUsername: process.env.TELEGRAM_BOT_USERNAME,
    selectedSeason: season
  });
});

// Search page with series detection and results filtering
router.get('/search', async (req, res) => {
  const { q = '', page = 1 } = req.query;
  const pageNum = parseInt(page, 10) || 1;

  let matchedSeries = null;
  let seriesData = null;
  if (q) {
    matchedSeries = await searchService.findSeriesMatch(q);
    if (matchedSeries) {
      seriesData = await searchService.getSeriesEpisodes(matchedSeries);
    }
  }

  let results = { results: [], total: 0, page: pageNum, totalPages: 0 };
  if (q) {
    results = await searchService.searchAllDatabases(q, { page: pageNum, seriesName: matchedSeries });
  }

  if (matchedSeries && seriesData && pageNum === 1) {
    const seriesCard = {
      _id: `series-${matchedSeries}`,
      isSeries: true,
      name: matchedSeries,
      poster: seriesData.seriesPoster,
      totalSeasons: seriesData.seasons.length,
      totalEpisodes: seriesData.totalEpisodes,
      seriesName: matchedSeries
    };
    results.results = [seriesCard, ...results.results];
    results.total = Math.max(1, results.total + 1);
    results.totalPages = Math.ceil(results.total / 20);
  }

  res.render('index', { 
    trending: [], 
    recent: [], 
    query: q,
    results: results.results,
    pagination: {
      page: results.page,
      totalPages: results.totalPages,
      total: results.total
    },
    botUsername: process.env.TELEGRAM_BOT_USERNAME
  });
});

// API filters endpoint
router.get('/api/filters', async (req, res) => {
  const cacheKey = 'frontend:filters';
  let cached = await cacheService.getCachedResults(cacheKey);
  if (!cached) {
    const connections = getConnections();
    const conn = connections[0];
    const metadataModel = conn.model('Metadata');
    const fileModel = conn.model('VJFile');
    
    const [categories, languages, qualities] = await Promise.all([
      metadataModel.find({ type: 'category' }).sort({ value: 1 }).lean(),
      metadataModel.find({ type: 'language' }).sort({ value: 1 }).lean(),
      fileModel.distinct('quality')
    ]);
    
    cached = {
      categories: categories.map(c => c.value),
      languages: languages.map(l => l.value),
      qualities: qualities.filter(Boolean).sort(),
      types: ['movie', 'series']
    };
    await cacheService.setCachedResults(cacheKey, cached, 3600);
  }
  res.json(cached);
});

// Telegram redirect
router.get('/get/:file_id', fileController.redirectToBot);

// Placeholder image
router.get('/placeholder.jpg', (req, res) => {
  res.set('Content-Type', 'image/svg+xml');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300"><rect width="200" height="300" fill="#1e1e1e"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#555" font-family="Arial" font-size="14">🎬 No Poster</text></svg>`);
});

module.exports = router;