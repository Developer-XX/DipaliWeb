const { getConnections } = require('../config/db');
const cacheService = require('../services/cacheService');
const asyncWrapper = require('../utils/asyncWrapper');
const logger = require('../utils/logger');
const { parseSeasonEpisode, parseQuality } = require('../utils/parseMetadata');

// Helper to extract series name from text
function extractSeriesNameFromText(text) {
  if (!text) return '';
  return text
    .replace(/\bS\d{1,2}\b/gi, '')
    .replace(/\bE\d{1,3}\b/gi, '')
    .replace(/\b(Season|Episode)\s*\d+/gi, '')
    .replace(/\b(1080p|720p|480p|HD|WEB-DL|BluRay|HDRip|Hindi|English|Tamil|Telugu)\b/gi, '')
    .replace(/[\(\[].*?[\)\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const verifySecret = (req, res, next) => {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// List files for admin panel with pagination
const listFiles = asyncWrapper(async (req, res) => {
  const { page = 1, limit = 50, search } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  const connections = getConnections();
  const conn = connections[0];
  const model = conn.model('VJFile');
  
  let filter = {};
  if (search) {
    filter.$or = [
      { file_name: { $regex: search, $options: 'i' } },
      { caption: { $regex: search, $options: 'i' } },
      { title: { $regex: search, $options: 'i' } }
    ];
  }
  
  const [files, total] = await Promise.all([
    model.find(filter).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit)).lean(),
    model.countDocuments(filter)
  ]);
  
  res.json({
    files,
    total,
    page: parseInt(page),
    totalPages: Math.ceil(total / parseInt(limit))
  });
});

// Get single file for editing
const getFileForEdit = asyncWrapper(async (req, res) => {
  const { file_id } = req.params;
  const connections = getConnections();
  for (const conn of connections) {
    const model = conn.model('VJFile');
    const file = await model.findOne({ file_id }).lean();
    if (file) {
      // Convert tags array to comma-separated string for form
      file.tags = (file.tags || []).join(', ');
      return res.json(file);
    }
  }
  res.status(404).json({ error: 'File not found' });
});

// Add new file
const addFile = asyncWrapper(async (req, res) => {
  const { 
    file_id, file_name, file_size, caption, image, title,
    lang, category, type, season, episode, tags, quality, series_name
  } = req.body;
  
  if (!file_id || !file_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Auto-parse season, episode, quality from caption
  const { season: parsedSeason, episode: parsedEpisode } = parseSeasonEpisode(caption || '');
  const parsedQuality = parseQuality(caption || '');
  
  // Determine final values
  const finalSeason = season !== undefined ? parseInt(season) : parsedSeason;
  const finalEpisode = episode !== undefined ? parseInt(episode) : parsedEpisode;
  const finalQuality = quality || parsedQuality || '';
  
  // Build file data
  const fileData = {
    file_id,
    file_name,
    file_size: file_size || 0,
    caption: caption || '',
    image: image || null,
    title: title || '',
    lang: lang || '',
    category: category || '',
    type: type || '',
    season: finalSeason,
    episode: finalEpisode,
    quality: finalQuality,
    tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : []),
    created_at: new Date(),
    updated_at: new Date()
  };
  
  // Auto-set series_name if type is series
  if (type === 'series' && !series_name) {
    fileData.series_name = extractSeriesNameFromText(title || caption || file_name);
  } else {
    fileData.series_name = series_name || '';
  }
  
  const connections = getConnections();
  const conn = connections[0];
  const model = conn.model('VJFile');
  
  await model.updateOne(
    { file_id },
    { $set: fileData },
    { upsert: true }
  );
  
  await cacheService.invalidateCache('search:*');
  await cacheService.invalidateCache('trending');
  await cacheService.invalidateCache('recent');
  
  res.json({ success: true, file: fileData });
});

// Update file metadata (all fields except file_id)
const updateFile = asyncWrapper(async (req, res) => {
  const { file_id } = req.params;
  const updates = { ...req.body };
  
  // Prevent updating immutable fields
  delete updates.file_id;
  delete updates._id;
  delete updates.created_at;
  delete updates.__v;
  
  // Normalize field names
  if (updates.language !== undefined) {
    updates.lang = updates.language;
    delete updates.language;
  }
  
  // Process tags
  if (updates.tags && typeof updates.tags === 'string') {
    updates.tags = updates.tags.split(',').map(t => t.trim()).filter(Boolean);
  }
  
  // Convert numeric fields
  if (updates.season !== undefined) updates.season = parseInt(updates.season, 10) || null;
  if (updates.episode !== undefined) updates.episode = parseInt(updates.episode, 10) || null;
  
  // Auto-set series_name if type is series and not provided
  if (updates.type === 'series' && !updates.series_name) {
    const title = updates.title || '';
    const caption = updates.caption || '';
    const file_name = updates.file_name || '';
    updates.series_name = extractSeriesNameFromText(title || caption || file_name);
  }
  
  updates.updated_at = new Date();
  
  logger.info(`Updating file ${file_id} with:`, updates);
  
  const connections = getConnections();
  let updated = false;
  
  for (const conn of connections) {
    try {
      const model = conn.model('VJFile');
      const result = await model.updateOne(
        { file_id },
        { $set: updates }
      );
      if (result.modifiedCount > 0) updated = true;
    } catch (err) {
      logger.error(`Update failed on a DB connection: ${err.message}`);
    }
  }
  
  if (updated) {
    await cacheService.invalidateCache('search:*');
    await cacheService.invalidateCache('trending');
    await cacheService.invalidateCache('recent');
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Update failed - no changes or file not found' });
  }
});

// Delete file
const deleteFile = asyncWrapper(async (req, res) => {
  const { file_id } = req.params;
  
  const connections = getConnections();
  let deleted = false;
  for (const conn of connections) {
    const result = await conn.model('VJFile').deleteOne({ file_id });
    if (result.deletedCount > 0) deleted = true;
  }
  
  if (deleted) {
    await cacheService.invalidateCache('search:*');
    await cacheService.invalidateCache('trending');
    await cacheService.invalidateCache('recent');
  }
  
  res.json({ success: deleted });
});

// Admin dashboard view
const dashboard = asyncWrapper(async (req, res) => {
  const { secret } = req.query;
  if (secret !== process.env.ADMIN_SECRET) {
    return res.render('admin/login');
  }
  
  const connections = getConnections();
  const conn = connections[0];
  const model = conn.model('VJFile');
  
  const totalFiles = await model.estimatedDocumentCount();
  const recentFiles = await model.find().sort({ created_at: -1 }).limit(10).lean();
  
  res.render('admin/dashboard', { 
    totalFiles, 
    recentFiles,
    secret,
    botUsername: process.env.TELEGRAM_BOT_USERNAME 
  });
});

// Metadata management
const getMetadata = asyncWrapper(async (req, res) => {
  const { type } = req.params;
  const connections = getConnections();
  const conn = connections[0];
  const model = conn.model('Metadata');
  const items = await model.find({ type }).sort({ value: 1 }).lean();
  res.json(items);
});

const addMetadata = asyncWrapper(async (req, res) => {
  const { type, value, label, image } = req.body;
  if (!type || !value) {
    return res.status(400).json({ error: 'Type and value required' });
  }
  const connections = getConnections();
  const conn = connections[0];
  const model = conn.model('Metadata');
  const item = await model.findOneAndUpdate(
    { type, value },
    { type, value, label: label || value, image: image || null },
    { upsert: true, new: true }
  );
  res.json(item);
});

const updateMetadata = asyncWrapper(async (req, res) => {
  const { id } = req.params;
  const { value, image, label } = req.body;
  
  if (!value) {
    return res.status(400).json({ error: 'Value is required' });
  }
  
  const connections = getConnections();
  const conn = connections[0];
  const model = conn.model('Metadata');
  
  const updated = await model.findByIdAndUpdate(
    id,
    { 
      value, 
      image: image || null, 
      label: label || value, 
      updated_at: new Date() 
    },
    { new: true, runValidators: true }
  );
  
  if (!updated) {
    return res.status(404).json({ error: 'Metadata not found' });
  }
  
  // Clear caches that might contain old series data
  await cacheService.invalidateCache('series:*');
  await cacheService.invalidateCache('frontend:filters');
  await cacheService.invalidateCache('search:*');
  
  res.json({ success: true, data: updated });
});

const deleteMetadata = asyncWrapper(async (req, res) => {
  const { id } = req.params;
  const connections = getConnections();
  const conn = connections[0];
  const model = conn.model('Metadata');
  await model.findByIdAndDelete(id);
  res.json({ success: true });
});

module.exports = { 
  verifySecret, 
  addFile, 
  updateFile,
  deleteFile, 
  dashboard,
  listFiles,
  getFileForEdit,
  getMetadata,
  addMetadata,
  updateMetadata,
  deleteMetadata
};