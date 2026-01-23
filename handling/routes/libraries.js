const express = require('express');
const { getAuthenticatedAxios, getAuthData, ensureAuth } = require('../../entry/middleware/auth');
const { buildImageUrl, parseIntParam, SimpleCache } = require('../../utils/helpers');
const router = express.Router();

// Cache with 5 minute TTL and max 50 entries
const cache = new SimpleCache(50, 300000);

/**
 * Get all media libraries
 * GET /api/libraries
 */
router.get('/', ensureAuth, async (req, res) => {
  try {
    const cached = cache.get('libraries');
    if (cached) {
      return res.json(cached);
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
        thumbnail: buildImageUrl(lib, 'Primary', 300)
      }));

    const result = { libraries };
    cache.set('libraries', result);
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

    const pageNum = parseIntParam(page, 0, 0, 1000);
    const limitNum = parseIntParam(limit, 50, 1, 100);

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const params = {
      ParentId: libraryId,
      StartIndex: pageNum * limitNum,
      Limit: limitNum,
      SearchTerm: search,
      SortBy: sortBy,
      SortOrder: sortOrder,
      Recursive: true,
      IncludeItemTypes: type,
      Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview,Genres,RunTimeTicks,MediaSources,UserData'
    };

    if (genres) params.Genres = genres;
    if (years) params.Years = years;

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
        thumbnail: buildImageUrl(item, 'Primary', 300),
        backdrop: buildImageUrl(item, 'Backdrop', 1080),
        hasVideo: item.MediaSources?.length > 0,
        resolution: videoStream?.Height || 0,
        codec: videoStream?.Codec || 'unknown',
        isWatched: item.UserData?.Played || false,
        playbackPosition: item.UserData?.PlaybackPositionTicks
          ? Math.round(item.UserData.PlaybackPositionTicks / 10000000)
          : 0,
        rating: item.CommunityRating,
        dateAdded: item.DateCreated,
        seriesName: item.SeriesName,
        seasonNumber: item.ParentIndexNumber,
        episodeNumber: item.IndexNumber
      };
    });

    res.json({
      items,
      totalCount: response.data.TotalRecordCount,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(response.data.TotalRecordCount / limitNum),
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

    const [moviesResp, seriesResp, episodesResp] = await Promise.allSettled([
      axios.get(`/Users/${auth.userId}/Items`, {
        params: { ParentId: libraryId, IncludeItemTypes: 'Movie', Recursive: true, Limit: 0 }
      }),
      axios.get(`/Users/${auth.userId}/Items`, {
        params: { ParentId: libraryId, IncludeItemTypes: 'Series', Recursive: true, Limit: 0 }
      }),
      axios.get(`/Users/${auth.userId}/Items`, {
        params: { ParentId: libraryId, IncludeItemTypes: 'Episode', Recursive: true, Limit: 0 }
      })
    ]);

    res.json({
      movies: moviesResp.status === 'fulfilled' ? moviesResp.value.data.TotalRecordCount : 0,
      series: seriesResp.status === 'fulfilled' ? seriesResp.value.data.TotalRecordCount : 0,
      episodes: episodesResp.status === 'fulfilled' ? episodesResp.value.data.TotalRecordCount : 0,
      libraryId
    });

  } catch (error) {
    console.error('Library stats error:', error.message);
    res.status(500).json({
      error: 'Failed to load library statistics',
      details: error.response?.data?.message || error.message
    });
  }
});

module.exports = router;
