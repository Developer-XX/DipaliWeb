const { getConnections } = require('../config/db');
const tmdbService = require('./tmdbService');
const cacheService = require('./cacheService');
const logger = require('../utils/logger');

/**
 * Find a file by its file_id across all DB connections
 */
async function findFileById(fileId) {
  const connections = getConnections();
  for (const conn of connections) {
    try {
      const model = conn.model('File');
      const file = await model.findOne({ file_id: fileId }).lean();
      if (file) return file;
    } catch (err) {
      logger.warn(`Error searching for file ${fileId} in DB:`, err.message);
    }
  }
  return null;
}

/**
 * Ensure a file has a poster image, fetching from TMDb if missing
 */
async function ensurePosterImage(file) {
  if (file.image) return file.image;
  
  const poster = await tmdbService.fetchPoster(file.file_name);
  if (poster) {
    // Update all DBs that contain this file
    const connections = getConnections();
    for (const conn of connections) {
      try {
        await conn.model('File').updateOne(
          { file_id: file.file_id },
          { $set: { image: poster } }
        );
      } catch (err) {
        // ignore individual DB failures
      }
    }
    file.image = poster;
  }
  return file.image;
}

/**
 * Increment click count for trending
 */
async function incrementClickCount(fileId) {
  const connections = getConnections();
  for (const conn of connections) {
    try {
      await conn.model('File').updateOne(
        { file_id: fileId },
        { $inc: { clicks: 1 } }
      );
    } catch (err) {
      // ignore
    }
  }
}

/**
 * Format file size for display
 */
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
  findFileById,
  ensurePosterImage,
  incrementClickCount,
  formatFileSize
};