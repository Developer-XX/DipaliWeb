const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const fileController = require('../controllers/fileController');
const adminController = require('../controllers/adminController');
const rateLimit = require('../middleware/rateLimit');
const validate = require('../middleware/validate');
const { adminAuth } = require('../middleware/auth'); // Fixed import

// Search with validation
router.get('/search', rateLimit.searchLimiter, validate.searchValidation, searchController.search);
router.get('/trending', rateLimit.searchLimiter, searchController.trending);
router.get('/recent', rateLimit.searchLimiter, searchController.recent);
router.get('/series', rateLimit.searchLimiter, searchController.getSeriesList);
router.get('/series/:name', searchController.getSeriesEpisodes);


// File info with validation
router.get('/file/:file_id', validate.fileIdValidation, fileController.getFile);
router.get('/get/:file_id', validate.fileIdValidation, fileController.redirectToBot);

// Admin (protected + validation)
router.post('/admin/files', adminAuth, validate.createFileValidation, adminController.addFile);
router.put('/admin/files/:file_id', adminAuth, adminController.updateFile);
router.delete('/admin/files/:file_id', adminAuth, validate.fileIdValidation, adminController.deleteFile);
router.get('/admin/files', adminAuth, adminController.listFiles);
router.get('/admin/files/:file_id', adminAuth, adminController.getFileForEdit);
// Metadata management
router.get('/admin/metadata/:type', adminAuth, adminController.getMetadata);
router.post('/admin/metadata', adminAuth, adminController.addMetadata);
router.put('/admin/metadata/:id', adminAuth, adminController.updateMetadata);
router.delete('/admin/metadata/:id', adminAuth, adminController.deleteMetadata);
router.get('/filters', rateLimit.searchLimiter, searchController.filterOptions);

module.exports = router;