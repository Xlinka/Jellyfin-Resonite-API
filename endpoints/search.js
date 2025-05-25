const express = require('express');
const { getAuthenticatedAxios, getAuthData, ensureAuth } = require('../entry/middleware/auth');
const router = express.Router();

/**
 * Search across all libraries
 * GET /api/search?q=query&type=Movie,Series&limit=20
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

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const params = {
      SearchTerm: q.trim(),
      Limit: parseInt(limit),
      IncludeItemTypes: includeItemTypes || type,
      Recursive: true,
      Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview,Genres,RunTimeTicks,UserData',
      SortBy: sortBy,
      SortOrder: sortOrder
    };

    // Add optional filters
    if (excludeItemTypes) params.ExcludeItemTypes = excludeItemTypes;
    if (genres) params.Genres = genres;
    if (years) params.Years = years;

    const response = await axios.get(`/Users/${auth.userId}/Items`, { params });

    const results = response.data.Items.map(item => {
      const videoStream = item.MediaSources?.[0]?.MediaStreams?.find(s => s.Type === 'Video');
      
      return {
        id: item.Id,
        name: item.Name,
        sortName: item.SortName,
        type: item.Type,
        year: item.ProductionYear,
        overview: item.Overview || '',
        genres: item.Genres || [],
        duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : 0,
        thumbnail: item.ImageTags?.Primary ? 
          `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Primary?height=300&tag=${item.ImageTags.Primary}` : 
          null,
        backdrop: item.BackdropImageTags?.[0] ? 
          `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Backdrop?width=1920&tag=${item.BackdropImageTags[0]}` : 
          null,
        rating: item.CommunityRating,
        criticRating: item.CriticRating,
        hasVideo: item.MediaSources && item.MediaSources.length > 0,
        resolution: videoStream?.Height || 0,
        isWatched: item.UserData?.Played || false,
        // Additional context for episodes/series
        seriesName: item.SeriesName,
        seasonNumber: item.ParentIndexNumber,
        episodeNumber: item.IndexNumber,
        // Match relevance score (simple implementation)
        relevanceScore: calculateRelevanceScore(item.Name, q)
      };
    });

    // Sort by relevance if searching
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    res.json({
      results,
      query: q,
      totalCount: response.data.TotalRecordCount,
      limit: parseInt(limit),
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

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    // Get quick results for suggestions
    const response = await axios.get(`/Users/${auth.userId}/Items`, {
      params: {
        SearchTerm: q.trim(),
        Limit: parseInt(limit),
        IncludeItemTypes: 'Movie,Series,Person,Genre',
        Recursive: true,
        Fields: 'PrimaryImageAspectRatio'
      }
    });

    const suggestions = response.data.Items.map(item => ({
      id: item.Id,
      name: item.Name,
      type: item.Type,
      thumbnail: item.ImageTags?.Primary ? 
        `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Primary?height=150&tag=${item.ImageTags.Primary}` : 
        null
    }));

    res.json({ 
      suggestions,
      query: q 
    });

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

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const response = await axios.get(`/Users/${auth.userId}/Items`, {
      params: {
        Genres: genreName,
        Limit: parseInt(limit),
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
      thumbnail: item.ImageTags?.Primary ? 
        `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Primary?height=300&tag=${item.ImageTags.Primary}` : 
        null,
      rating: item.CommunityRating
    }));

    res.json({
      items,
      genre: genreName,
      totalCount: response.data.TotalRecordCount,
      limit: parseInt(limit)
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

    const response = await axios.get(`/Genres`, {
      params: {
        UserId: auth.userId,
        Fields: 'ItemCounts'
      }
    });

    const genres = response.data.Items.map(genre => ({
      id: genre.Id,
      name: genre.Name,
      itemCount: genre.ItemCounts?.MovieCount + genre.ItemCounts?.SeriesCount + genre.ItemCounts?.EpisodeCount || 0
    })).filter(genre => genre.itemCount > 0);

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
  
  // Exact match gets highest score
  if (name === query) return 100;
  
  // Starts with query gets high score
  if (name.startsWith(query)) return 80;
  
  // Contains query gets medium score
  if (name.includes(query)) return 60;
  
  // Word boundary matches get some score
  const words = query.split(' ');
  let wordScore = 0;
  words.forEach(word => {
    if (name.includes(word)) wordScore += 10;
  });
  
  return wordScore;
}

module.exports = router;
