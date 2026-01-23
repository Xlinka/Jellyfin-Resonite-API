const express = require('express');
const { getAuthenticatedAxios, getAuthData, ensureAuth } = require('../entry/middleware/auth');
const { buildImageUrl, parseIntParam } = require('../utils/helpers');
const router = express.Router();

/**
 * Search across all libraries
 * GET /api/search?q=query
 */
router.get('/', ensureAuth, async (req, res) => {
  try {
    const {
      q,
      limit = 20,
      type = 'Movie,Series,Episode,Video',
      includeItemTypes,
      excludeItemTypes,
      genres,
      years,
      sortBy = 'SortName',
      sortOrder = 'Ascending'
    } = req.query;

    if (!q || q.trim().length === 0) {
      return res.json({
        results: [],
        query: '',
        totalCount: 0,
        message: 'No search query provided'
      });
    }

    const limitNum = parseIntParam(limit, 20, 1, 100);
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const params = {
      SearchTerm: q.trim(),
      Limit: limitNum,
      IncludeItemTypes: includeItemTypes || type,
      Recursive: true,
      Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview,Genres,RunTimeTicks,UserData',
      SortBy: sortBy,
      SortOrder: sortOrder
    };

    if (excludeItemTypes) params.ExcludeItemTypes = excludeItemTypes;
    if (genres) params.Genres = genres;
    if (years) params.Years = years;

    const response = await axios.get(`/Users/${auth.userId}/Items`, { params });

    const results = response.data.Items.map(item => ({
      id: item.Id,
      name: item.Name,
      sortName: item.SortName,
      type: item.Type,
      year: item.ProductionYear,
      overview: item.Overview || '',
      genres: item.Genres || [],
      duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : 0,
      thumbnail: buildImageUrl(item, 'Primary', 300),
      backdrop: buildImageUrl(item, 'Backdrop', 1080),
      rating: item.CommunityRating,
      criticRating: item.CriticRating,
      hasVideo: item.MediaSources?.length > 0,
      isWatched: item.UserData?.Played || false,
      seriesName: item.SeriesName,
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber,
      relevanceScore: calculateRelevanceScore(item.Name, q)
    }));

    // Sort by relevance
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    res.json({
      results,
      query: q,
      totalCount: response.data.TotalRecordCount,
      limit: limitNum,
      filters: {
        type: includeItemTypes || type,
        excludeTypes: excludeItemTypes || null,
        genres: genres || null,
        years: years || null,
        sortBy,
        sortOrder
      }
    });

  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({
      error: 'Search failed',
      details: error.response?.data?.message || error.message
    });
  }
});

/**
 * Get search suggestions/autocomplete
 * GET /api/search/suggestions?q=partial_query
 */
router.get('/suggestions', ensureAuth, async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.json({ suggestions: [] });
    }

    const limitNum = parseIntParam(limit, 10, 1, 20);
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const response = await axios.get(`/Users/${auth.userId}/Items`, {
      params: {
        SearchTerm: q.trim(),
        Limit: limitNum,
        IncludeItemTypes: 'Movie,Series,Person,Genre',
        Recursive: true,
        Fields: 'PrimaryImageAspectRatio'
      }
    });

    const suggestions = response.data.Items.map(item => ({
      id: item.Id,
      name: item.Name,
      type: item.Type,
      thumbnail: buildImageUrl(item, 'Primary', 150)
    }));

    res.json({ suggestions, query: q });

  } catch (error) {
    console.error('Search suggestions error:', error.message);
    res.status(500).json({
      error: 'Failed to get search suggestions',
      details: error.response?.data?.message || error.message
    });
  }
});

/**
 * Search by genre
 * GET /api/search/genre/:genreName
 */
router.get('/genre/:genreName', ensureAuth, async (req, res) => {
  try {
    const { genreName } = req.params;
    const { limit = 50, type = 'Movie,Series' } = req.query;
    const limitNum = parseIntParam(limit, 50, 1, 100);

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const response = await axios.get(`/Users/${auth.userId}/Items`, {
      params: {
        Genres: genreName,
        Limit: limitNum,
        IncludeItemTypes: type,
        Recursive: true,
        Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview,Genres,RunTimeTicks',
        SortBy: 'SortName',
        SortOrder: 'Ascending'
      }
    });

    const items = response.data.Items.map(item => ({
      id: item.Id,
      name: item.Name,
      type: item.Type,
      year: item.ProductionYear,
      overview: item.Overview || '',
      duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : 0,
      thumbnail: buildImageUrl(item, 'Primary', 300),
      rating: item.CommunityRating
    }));

    res.json({
      items,
      genre: genreName,
      totalCount: response.data.TotalRecordCount,
      limit: limitNum
    });

  } catch (error) {
    console.error('Genre search error:', error.message);
    res.status(500).json({
      error: 'Genre search failed',
      details: error.response?.data?.message || error.message
    });
  }
});

/**
 * Get all available genres
 * GET /api/search/genres
 */
router.get('/genres', ensureAuth, async (req, res) => {
  try {
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const response = await axios.get('/Genres', {
      params: {
        UserId: auth.userId,
        Fields: 'ItemCounts'
      }
    });

    const genres = response.data.Items
      .map(genre => ({
        id: genre.Id,
        name: genre.Name,
        itemCount: (genre.ItemCounts?.MovieCount || 0) +
          (genre.ItemCounts?.SeriesCount || 0) +
          (genre.ItemCounts?.EpisodeCount || 0)
      }))
      .filter(genre => genre.itemCount > 0);

    res.json({ genres });

  } catch (error) {
    console.error('Genres error:', error.message);
    res.status(500).json({
      error: 'Failed to get genres',
      details: error.response?.data?.message || error.message
    });
  }
});

/**
 * Simple relevance scoring for search results
 */
function calculateRelevanceScore(itemName, searchQuery) {
  if (!itemName || !searchQuery) return 0;

  const name = itemName.toLowerCase();
  const query = searchQuery.toLowerCase();

  if (name === query) return 100;
  if (name.startsWith(query)) return 80;
  if (name.includes(query)) return 60;

  const words = query.split(' ');
  let wordScore = 0;
  for (const word of words) {
    if (name.includes(word)) wordScore += 10;
  }

  return wordScore;
}

module.exports = router;
