/**
 * Utility functions for the Jellyfin-Resonite API
 */

const JELLYFIN_SERVER = process.env.JELLYFIN_SERVER;

/**
 * Build an image URL for a Jellyfin item
 * @param {Object} item - The Jellyfin item
 * @param {string} type - Image type: 'Primary', 'Backdrop', 'Thumb', etc.
 * @param {number} height - Image height in pixels
 * @returns {string|null} The image URL or null if not available
 */
function buildImageUrl(item, type = 'Primary', height = 300) {
  if (!item) return null;

  const tag = item.ImageTags?.[type];
  if (tag) {
    return `${JELLYFIN_SERVER}/Items/${item.Id}/Images/${type}?height=${height}&tag=${tag}`;
  }

  // Fallback for backdrop
  if (type === 'Backdrop' && item.BackdropImageTags?.length > 0) {
    return `${JELLYFIN_SERVER}/Items/${item.Id}/Images/Backdrop/0?height=${height}&tag=${item.BackdropImageTags[0]}`;
  }

  // For series items, try parent images
  if (item.ParentPrimaryImageTag && type === 'Primary') {
    return `${JELLYFIN_SERVER}/Items/${item.ParentId || item.SeriesId}/Images/Primary?height=${height}&tag=${item.ParentPrimaryImageTag}`;
  }

  if (item.ParentBackdropImageTags?.length > 0 && type === 'Backdrop') {
    return `${JELLYFIN_SERVER}/Items/${item.ParentBackdropItemId || item.SeriesId}/Images/Backdrop/0?height=${height}&tag=${item.ParentBackdropImageTags[0]}`;
  }

  return null;
}

/**
 * Format bytes to human readable string
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string (e.g., "1.5 GB")
 */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format duration from ticks to human readable string
 * @param {number} ticks - Duration in Jellyfin ticks (10,000,000 ticks = 1 second)
 * @returns {string} Formatted string (e.g., "1h 30m")
 */
function formatDuration(ticks) {
  if (!ticks) return '0m';
  const totalSeconds = Math.round(ticks / 10000000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Format bitrate to human readable string
 * @param {number} bitrate - Bitrate in bits per second
 * @returns {string} Formatted string (e.g., "5.2 Mbps")
 */
function formatBitrate(bitrate) {
  if (!bitrate) return 'Unknown';
  if (bitrate >= 1000000) {
    return `${(bitrate / 1000000).toFixed(1)} Mbps`;
  }
  return `${Math.round(bitrate / 1000)} Kbps`;
}

/**
 * Validate and parse integer query parameter
 * @param {string} value - The string value to parse
 * @param {number} defaultValue - Default value if parsing fails
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @returns {number} Parsed and clamped integer
 */
function parseIntParam(value, defaultValue, min = 1, max = 1000) {
  const parsed = parseInt(value);
  if (isNaN(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, parsed));
}

/**
 * Create a standardized item response object
 * @param {Object} item - The Jellyfin item
 * @param {Object} options - Options for the response
 * @returns {Object} Standardized item object
 */
function mapItemResponse(item, options = {}) {
  const { includeOverview = true, imageHeight = 300 } = options;

  const base = {
    id: item.Id,
    name: item.Name,
    type: item.Type,
    year: item.ProductionYear,
    thumbnail: buildImageUrl(item, 'Primary', imageHeight)
  };

  if (includeOverview && item.Overview) {
    base.overview = item.Overview;
  }

  if (item.Type === 'Episode') {
    base.seriesName = item.SeriesName;
    base.seriesId = item.SeriesId;
    base.seasonNumber = item.ParentIndexNumber;
    base.episodeNumber = item.IndexNumber;
  }

  if (item.RunTimeTicks) {
    base.duration = Math.round(item.RunTimeTicks / 10000000);
    base.durationFormatted = formatDuration(item.RunTimeTicks);
  }

  if (item.CommunityRating) {
    base.rating = Math.round(item.CommunityRating * 10) / 10;
  }

  if (item.Genres?.length > 0) {
    base.genres = item.Genres;
  }

  return base;
}

/**
 * Create a cache with TTL and max size
 */
class SimpleCache {
  constructor(maxSize = 100, ttlMs = 300000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key, data) {
    // Evict oldest if at max size
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }
}

module.exports = {
  buildImageUrl,
  formatBytes,
  formatDuration,
  formatBitrate,
  parseIntParam,
  mapItemResponse,
  SimpleCache
};
