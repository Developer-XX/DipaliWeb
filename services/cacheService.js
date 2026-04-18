const { client } = require('../config/redis');
const logger = require('../utils/logger');

const CACHE_TTL = 300; // 5 minutes

async function getCachedResults(key) {
  try {
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error('Redis get error:', err);
    return null;
  }
}

async function setCachedResults(key, value, ttl = CACHE_TTL) {
  try {
    await client.setEx(key, ttl, JSON.stringify(value));
  } catch (err) {
    logger.error('Redis set error:', err);
  }
}

async function invalidateCache(pattern) {
  try {
    const keys = await client.keys(pattern);
    if (keys.length) {
      await client.del(keys);
    }
  } catch (err) {
    logger.error('Redis invalidate error:', err);
  }
}

module.exports = { getCachedResults, setCachedResults, invalidateCache };