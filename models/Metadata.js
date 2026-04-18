const mongoose = require('mongoose');

const MetadataSchema = new mongoose.Schema({
  type: { type: String, required: true, enum: ['category', 'language', 'tag', 'series', 'cartoon'] },
  value: { type: String, required: true },
  label: { type: String },
  image: { type: String, default: null }, // series poster URL
  created_at: { type: Date, default: Date.now }
});

// Compound unique index
MetadataSchema.index({ type: 1, value: 1 }, { unique: true });

module.exports = MetadataSchema;