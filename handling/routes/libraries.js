const express = require('express');
const { getAuthenticatedAxios, getAuthData, ensureAuth } = require('../../entry/middleware/auth');
const router = express.Router();

// Simple in-memory cache
const cache = new Map();
const CACHE_DURATION = (parseInt(process.env.LIBRARY_CACHE_DURATION) || 300) * 1000;

/**
 * Get all media libraries
 * GET /api/libraries
 */
router.get('/', ensureAuth, async (req, res) => {
  try {
    const cacheKey = 'libraries';
    const cached = cache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
      return res.json(cached.data);
    }

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();
    
    const response = await axios.get(`/Users/${auth.userId}/Views`);

    const libraries = response.data.Items
      .filter(item => ['movies', 'tvshows', 'music'].includes(item.CollectionType))
      .map(lib => ({
        id: lib.Id,
        name: lib.Name,
        type: lib.CollectionType,
        itemCount: lib.ChildCount || 0,
        thumbnail: lib.ImageTags?.Primary ? 
          `${process.env.JELLYFIN_SERVER}/Items/${lib.Id}/Images/Primary?height=300&tag=${lib.ImageTags.Primary}` : 
          null
      }));

    const result = { libraries };
    
    // Cache the result
    cache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });

    res.json(result);
  } catch (error) {
    console.error('Libraries error:', error.message);
    res.status(500).json({ 
      error: 'Failed to load libraries',
      details: error.response?.data?.message || error.message
    });
  }
});

/**
 * Get items from a specific library
 * GET /api/libraries/:libraryId/items
 */
router.get('/:libraryId/items', ensureAuth, async (req, res) => {
  try {
    const { libraryId } = req.params;
    const {
      page = 0,
      limit = 50,
      search = '',
      sortBy = 'SortName',
      sortOrder = 'Ascending',
      type = 'Movie,Episode,Video,Series',
      genres = '',
      years = ''
    } = req.query;

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const params = {
      ParentId: libraryId,
      StartIndex: parseInt(page) * parseInt(limit),
      Limit: parseInt(limit),
      SearchTerm: search,
      SortBy: sortBy,
      SortOrder: sortOrder,
      Recursive: true,
      IncludeItemTypes: type,
      Fields: 'BasicSyncInfo,PrimaryImageAspectRatio,ProductionYear,Overview,Genres,RunTimeTicks,MediaSources,UserData'
    };

    // Add genre filter if specified
    if (genres) {
      params.Genres = genres;
    }

    // Add year filter if specified
    if (years) {
      params.Years = years;
    }

    const response = await axios.get(`/Users/${auth.userId}/Items`, { params });

    const items = response.data.Items.map(item => {
      const videoStream = item.MediaSources?.[0]?.MediaStreams?.find(s => s.Type === 'Video');
      
      return {
        id: item.Id,
        name: item.Name,
        sortName: item.SortName,
        overview: item.Overview || '',
        year: item.ProductionYear,
        type: item.Type,
        genres: item.Genres || [],
        duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : 0,
        thumbnail: item.ImageTags?.Primary ? 
          `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Primary?height=300&tag=${item.ImageTags.Primary}` : 
          null,
        backdrop: item.BackdropImageTags?.[0] ? 
          `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Backdrop?width=1920&tag=${item.BackdropImageTags[0]}` : 
          null,
        logo: item.ImageTags?.Logo ? 
          `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Logo?width=400&tag=${item.ImageTags.Logo}` : 
          null,
        hasVideo: item.MediaSources && item.MediaSources.length > 0,
        resolution: videoStream?.Height || 0,
        codec: videoStream?.Codec || 'unknown',
        isWatched: item.UserData?.Played || false,
        playbackPosition: item.UserData?.PlaybackPositionTicks ? 
          Math.round(item.UserData.PlaybackPositionTicks / 10000000) : 0,
        rating: item.CommunityRating,
        criticRating: item.CriticRating,
        dateAdded: item.DateCreated,
        seriesName: item.SeriesName, // For episodes
        seasonNumber: item.ParentIndexNumber, // For episodes
        episodeNumber: item.IndexNumber // For episodes
      };
    });

    res.json({
      items,
      totalCount: response.data.TotalRecordCount,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(response.data.TotalRecordCount / parseInt(limit)),
      libraryId,
      filters: {
        search: search || null,
        sortBy,
        sortOrder,
        type,
        genres: genres || null,
        years: years || null
      }
    });

  } catch (error) {
    console.error('Library items error:', error.message);
    res.status(500).json({ 
      error: 'Failed to load library items',
      details: error.response?.data?.message || error.message
    });
  }
});

/**
 * Get library statistics
 * GET /api/libraries/:libraryId/stats
 */
router.get('/:libraryId/stats', ensureAuth, async (req, res) => {
  try {
    const { libraryId } = req.params;
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    // Get total counts by type
    const [moviesResp, seriesResp, episodesResp] = await Promise.allSettled([
      axios.get(`/Users/${auth.userId}/Items`, {
        params: { ParentId: libraryId, IncludeItemTypes: 'Movie', Recursive: true, Limit: 1 }
      }),
      axios.get(`/Users/${auth.userId}/Items`, {
        params: { ParentId: libraryId, IncludeItemTypes: 'Series', Recursive: true, Limit: 1 }
      }),
      axios.get(`/Users/${auth.userId}/Items`, {
        params: { ParentId: libraryId, IncludeItemTypes: 'Episode', Recursive: true, Limit: 1 }
      })
    ]);

    const stats = {
      movies: moviesResp.status === 'fulfilled' ? moviesResp.value.data.TotalRecordCount : 0,
      series: seriesResp.status === 'fulfilled' ? seriesResp.value.data.TotalRecordCount : 0,
      episodes: episodesResp.status === 'fulfilled' ? episodesResp.value.data.TotalRecordCount : 0,
      libraryId
    };

    res.json(stats);
  } catch (error) {
    console.error('Library stats error:', error.message);
    res.status(500).json({ 
      error: 'Failed to load library statistics',
      details: error.response?.data?.message || error.message
    });
  }
});

module.exports = router;
