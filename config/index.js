// Central configuration export
module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  tmdbApiKey: process.env.TMDB_API_KEY,
  telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME,
  adminSecret: process.env.ADMIN_SECRET,
  redisUrl: process.env.REDIS_URL,
  mongodbUris: (process.env.MONGODB_URIS || '').split(',').map(u => u.trim()).filter(Boolean),
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100
  }
};