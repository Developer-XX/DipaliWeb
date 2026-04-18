const sanitize = require('sanitize-filename');

const patterns = [
  /\b(1080p|720p|480p|2160p|4k|bluray|web-dl|webrip|hdtv|hdcam|x264|x265|hevc|aac|ac3|dts|yify|yts|rarbg|ettv|galaxy|tgx|mkv|mp4|avi)\b/gi,
  /\[.*?\]/g,
  /\(.*?\)/g,
  /{.*?}/g,
  /\b\d{4}\b/g, // year
  /s\d{2}e\d{2}/gi, // season/episode
  /\./g,
  /_/g,
  /-/g
];

function cleanFileName(fileName) {
  let cleaned = fileName;
  
  // Remove extension
  cleaned = cleaned.replace(/\.[^/.]+$/, '');
  
  // Apply patterns
  patterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, ' ');
  });
  
  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Sanitize
  cleaned = sanitize(cleaned);
  
  return cleaned || 'Unknown';
}

module.exports = cleanFileName;