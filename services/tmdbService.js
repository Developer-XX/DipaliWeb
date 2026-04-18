const axios = require('axios');
const logger = require('../utils/logger');
const cleanFileName = require('../utils/fileNameCleaner');

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w200';

async function fetchPoster(movieName) {
  if (!TMDB_API_KEY) {
    logger.warn('TMDB API key not set');
    return null;
  }
  
  try {
    const cleaned = cleanFileName(movieName);
    const response = await axios.get(`${BASE_URL}/search/movie`, {
      params: {
        api_key: TMDB_API_KEY,
        query: cleaned,
        include_adult: false,
        page: 1
      },
      timeout: 3000
    });
    
    const movie = response.data.results?.[0];
    if (movie && movie.poster_path) {
      return `${IMAGE_BASE}${movie.poster_path}`;
    }
    return null;
  } catch (err) {
    logger.error(`TMDB fetch failed for "${movieName}":`, err.message);
    return null;
  }
}

/**
 * Fetch poster using caption first, then fallback to file_name
 */
async function fetchPosterForFile(file) {
  const searchText = file.caption || file.file_name;
  return fetchPoster(searchText);
}

module.exports = { fetchPoster, fetchPosterForFile };