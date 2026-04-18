function parseSeasonEpisode(text) {
  const seasonPatterns = [
    /[Ss](\d{1,2})/,
    /[Ss]eason\s*(\d{1,2})/i,
    /[Сс]езон\s*(\d{1,2})/i
  ];
  const episodePatterns = [
    /[Ee](\d{1,3})/,
    /[Ee]pisode\s*(\d{1,3})/i,
    /[Ээ]пизод\s*(\d{1,3})/i
  ];
  
  let season = null;
  let episode = null;
  
  for (const pattern of seasonPatterns) {
    const match = text.match(pattern);
    if (match) {
      season = parseInt(match[1], 10);
      break;
    }
  }
  
  for (const pattern of episodePatterns) {
    const match = text.match(pattern);
    if (match) {
      episode = parseInt(match[1], 10);
      break;
    }
  }
  
  return { season, episode };
}

function parseQuality(text) {
  const qualityPatterns = [
    /\b(2160p|4k|UHD)\b/i,
    /\b(1080p|FHD|FullHD)\b/i,
    /\b(720p|HD)\b/i,
    /\b(480p|SD)\b/i,
    /\b(HDRip|WEB-DL|BluRay|BRRip|HDTV|HDR|DVDRip)\b/i
  ];
  
  for (const pattern of qualityPatterns) {
    const match = text.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return '';
}

module.exports = { parseSeasonEpisode, parseQuality };