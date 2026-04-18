const mongoose = require('mongoose');

const VJCollectionSchema = new mongoose.Schema({
  file_id: { type: String, required: true, unique: true, index: true },
  file_name: { type: String, required: true, index: true },
  file_size: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    get: function(v) {
      if (typeof v === 'object' && v.$numberLong) {
        return parseInt(v.$numberLong, 10);
      }
      return parseInt(v, 10) || 0;
    }
  },
  caption: { type: String, default: '' },
  image: { type: String, default: null },
  series_name: { type: String, default: '', index: true }, // for grouping series
  
  // Metadata
  title: { type: String, default: '' },
  lang: { type: String, default: '', index: true }, // renamed from language
  category: { type: String, default: '', index: true },
  type: { type: String, enum: ['movie', 'series', ''], default: '' },
  season: { type: Number, default: null },
  episode: { type: Number, default: null },
  tags: [{ type: String }],
  quality: { type: String, default: '' },
  
  created_at: { type: Date, default: Date.now, index: true },
  updated_at: { type: Date, default: Date.now },
  clicks: { type: Number, default: 0, index: true }
}, {
  collection: 'vjcollection',
  toJSON: { getters: true, virtuals: true },
  toObject: { getters: true, virtuals: true }
});

// Text index with explicit language_override to avoid field conflict
VJCollectionSchema.index(
  { file_name: 'text', caption: 'text', title: 'text', tags: 'text' },
  { language_override: "dummy" } // ignore any "language" field in docs
);

// Compound index for series queries
VJCollectionSchema.index({ series_name: 1, season: 1, episode: 1 });

// Compound indexes
VJCollectionSchema.index({ category: 1, lang: 1, created_at: -1 });
VJCollectionSchema.index({ type: 1, season: 1, episode: 1 });

module.exports = VJCollectionSchema;