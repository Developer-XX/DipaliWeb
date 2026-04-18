const { getConnections } = require('../config/db');
const searchService = require('../services/searchService');
const asyncWrapper = require('../utils/asyncWrapper');

const getFile = asyncWrapper(async (req, res) => {
  const { file_id } = req.params;
  
  const connections = getConnections();
  let file = null;
  
  for (const conn of connections) {
    const model = conn.model('VJFile');
    file = await model.findOne({ file_id }).lean();
    if (file) break;
  }
  
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Normalize file_size
  if (typeof file.file_size === 'object' && file.file_size.$numberLong) {
    file.file_size = parseInt(file.file_size.$numberLong, 10);
  } else {
    file.file_size = parseInt(file.file_size, 10) || 0;
  }
  
  await searchService.incrementClicks(file_id);
  
  res.json(file);
});

const redirectToBot = asyncWrapper(async (req, res) => {
  const { file_id } = req.params;
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  if (!botUsername) {
    return res.status(500).send('Bot username not configured');
  }
  
  await searchService.incrementClicks(file_id);
  
  const url = `https://t.me/${botUsername}?start=file_${file_id}`;
  res.redirect(url);
});

module.exports = { getFile, redirectToBot };