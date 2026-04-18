const logger = require('./logger');

module.exports = (err, req, res, next) => {
  logger.error(err.stack);
  
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  
  if (req.accepts('html')) {
    res.status(status).render('error', { message, status });
  } else {
    res.status(status).json({ error: message });
  }
};