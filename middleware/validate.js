const { body, query, param, validationResult } = require('express-validator');

// Validation error handler middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Validation rules for search
const searchValidation = [
  query('q').optional().trim().isString().isLength({ max: 100 }).escape(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  handleValidationErrors
];

// Validation rules for file ID param
const fileIdValidation = [
  param('file_id').notEmpty().isString().trim().escape(),
  handleValidationErrors
];

// Validation rules for admin file creation
const createFileValidation = [
  body('file_id').notEmpty().isString().trim().escape(),
  body('file_name').notEmpty().isString().trim().escape(),
  body('file_size').optional().isInt({ min: 0 }).toInt(),
  body('caption').optional().isString().trim().escape(),
  handleValidationErrors
];

module.exports = {
  searchValidation,
  fileIdValidation,
  createFileValidation
};