const express = require('express');
const { getAuthenticatedAxios, getAuthData, ensureAuth } = require('../entry/middleware/auth');
const { buildImageUrl, parseIntParam, SimpleCache } = require('../utils/helpers');
const router = express.Router();

// Cache for item details (5 minute TTL)
const itemCache = new SimpleCache(100, 300000);

/**
 * Get detailed item information
 * GET /api/items/:itemId
 */
router.get('/:itemId', ensureAuth, async (req, res) => {
  try {
    const { itemId } = req.params;

    // Check cache
    const cached = itemCache.get(itemId);
    if (cached) {
      return res.json(cached);
    }

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    // Fetch item details and similar items in parallel
    const [itemResponse, similarResponse] = await Promise.all([
      axios.get(`/Users/${auth.userId}/Items/${itemId}`, {
        params: {
          Fields: 'ItemCounts,PrimaryImageAspectRatio,Overview,Genres,People,Studios,Tags,Taglines,MediaSources,Chapters'
        }
      }),
      axios.get(`/Items/${itemId}/Similar`, {
        params: { UserId: auth.userId, Limit: 12, Fields: 'PrimaryImageAspectRatio,ProductionYear' }
      }).catch(() => ({ data: { Items: [] } }))
    ]);

    const item = itemResponse.data;

    // Fetch seasons if it's a series
    let seasons = null;
    if (item.Type === 'Series') {
      try {
        const seasonsResponse = await axios.get(`/Shows/${itemId}/Seasons`, {
          params: { UserId: auth.userId, Fields: 'ItemCounts,PrimaryImageAspectRatio' }
        });
        seasons = seasonsResponse.data.Items.map(season => ({
          id: season.Id,
          name: season.Name,
          seasonNumber: season.IndexNumber,
          episodeCount: season.ChildCount,
          thumbnail: buildImageUrl(season, 'Primary', 300)
        }));
      } catch (err) {
        console.warn('Failed to get seasons:', err.message);
      }
    }

    const similar = similarResponse.data.Items.map(s => ({
      id: s.Id,
      name: s.Name,
      year: s.ProductionYear,
      type: s.Type,
      thumbnail: buildImageUrl(s, 'Primary', 300)
    }));

    const videoStream = item.MediaSources?.[0]?.MediaStreams?.find(s => s.Type === 'Video');
    const audioStreams = item.MediaSources?.[0]?.MediaStreams?.filter(s => s.Type === 'Audio') || [];

    const result = {
      id: item.Id,
      name: item.Name,
      originalTitle: item.OriginalTitle,
      sortName: item.SortName,
      overview: item.Overview || '',
      tagline: item.Taglines?.[0],
      type: item.Type,
      year: item.ProductionYear,
      premiereDate: item.PremiereDate,
      status: item.Status,
      rating: item.CommunityRating,
      criticRating: item.CriticRating,
      officialRating: item.OfficialRating,
      genres: item.Genres || [],
      tags: item.Tags || [],
      studios: item.Studios || [],
      duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : 0,
      hasVideo: item.MediaSources?.length > 0,
      resolution: videoStream?.Height || 0,
      aspectRatio: videoStream?.AspectRatio,
      videoCodec: videoStream?.Codec,
      audioChannels: audioStreams.length > 0 ? Math.max(...audioStreams.map(a => a.Channels || 0)) : 0,
      thumbnail: buildImageUrl(item, 'Primary', 600),
      backdrop: buildImageUrl(item, 'Backdrop', 1080),
      logo: item.ImageTags?.Logo
        ? `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Logo?width=800&tag=${item.ImageTags.Logo}`
        : null,
      seriesName: item.SeriesName,
      seasonName: item.SeasonName,
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber,
      isWatched: item.UserData?.Played || false,
      isFavorite: item.UserData?.IsFavorite || false,
      playbackPosition: item.UserData?.PlaybackPositionTicks
        ? Math.round(item.UserData.PlaybackPositionTicks / 10000000)
        : 0,
      playCount: item.UserData?.PlayCount || 0,
      lastPlayedDate: item.UserData?.LastPlayedDate,
      people: (item.People || []).slice(0, 20).map(person => ({
        id: person.Id,
        name: person.Name,
        role: person.Role,
        type: person.Type,
        thumbnail: person.PrimaryImageTag
          ? `${process.env.JELLYFIN_SERVER}/Items/${person.Id}/Images/Primary?height=200&tag=${person.PrimaryImageTag}`
          : null
      })),
      chapters: (item.Chapters || []).map(chapter => ({
        name: chapter.Name,
        startTime: Math.round(chapter.StartPositionTicks / 10000000)
      })),
      dateAdded: item.DateCreated,
      seasons,
      similar
    };

    // Cache the result
    itemCache.set(itemId, result);
    res.json(result);

  } catch (error) {
    console.error('Item details error:', error.message);
    if (error.response?.status === 404) {
      res.status(404).json({ error: 'Item not found' });
    } else {
      res.status(500).json({
        error: 'Failed to get item details',
        details: error.response?.data?.message || error.message
      });
    }
  }
});

/**
 * Get recently added items
 * GET /api/items/recent
 */
router.get('/recent', ensureAuth, async (req, res) => {
  try {
    const { limit = 20, type = 'Movie,Series,Episode', libraryId } = req.query;
    const limitNum = parseIntParam(limit, 20, 1, 100);

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const params = {
      Limit: limitNum,
      Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview'
    };

    if (libraryId) params.ParentId = libraryId;
    if (type !== 'all') params.IncludeItemTypes = type;

    const response = await axios.get(`/Users/${auth.userId}/Items/Latest`, { params });

    const items = response.data.map(item => ({
      id: item.Id,
      name: item.Name,
      type: item.Type,
      year: item.ProductionYear,
      overview: item.Overview || '',
      dateAdded: item.DateCreated,
      thumbnail: buildImageUrl(item, 'Primary', 300),
      backdrop: buildImageUrl(item, 'Backdrop', 1080),
      seriesName: item.SeriesName,
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber
    }));

    res.json({ items, limit: limitNum, type: type === 'all' ? 'All types' : type });

  } catch (error) {
    console.error('Recent items error:', error.message);
    res.status(500).json({
      error: 'Failed to get recent items',
      details: error.response?.data?.message || error.message
    });
  }
});

/**
 * Get continue watching items
 * GET /api/items/resume
 */
router.get('/resume', ensureAuth, async (req, res) => {
  try {
    const { limit = 12 } = req.query;
    const limitNum = parseIntParam(limit, 12, 1, 50);

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const response = await axios.get(`/Users/${auth.userId}/Items/Resume`, {
      params: {
        Limit: limitNum,
        Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview,UserData',
        MediaTypes: 'Video'
      }
    });

    const items = response.data.Items.map(item => ({
      id: item.Id,
      name: item.Name,
      type: item.Type,
      year: item.ProductionYear,
      overview: item.Overview || '',
      duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : 0,
      playbackPosition: item.UserData?.PlaybackPositionTicks
        ? Math.round(item.UserData.PlaybackPositionTicks / 10000000)
        : 0,
      playbackPercent: item.UserData?.PlayedPercentage || 0,
      thumbnail: buildImageUrl(item, 'Primary', 300),
      seriesName: item.SeriesName,
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber
    }));

    res.json({ items, limit: limitNum });

  } catch (error) {
    console.error('Resume items error:', error.message);
    res.status(500).json({
      error: 'Failed to get resume items',
      details: error.response?.data?.message || error.message
    });
  }
});

/**
 * Get next up episodes for TV series
 * GET /api/items/nextup
 */
router.get('/nextup', ensureAuth, async (req, res) => {
  try {
    const { limit = 12, seriesId } = req.query;
    const limitNum = parseIntParam(limit, 12, 1, 50);

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const params = {
      UserId: auth.userId,
      Limit: limitNum,
      Fields: 'PrimaryImageAspectRatio,Overview,UserData'
    };

    if (seriesId) params.SeriesId = seriesId;

    const response = await axios.get('/Shows/NextUp', { params });

    const items = response.data.Items.map(item => ({
      id: item.Id,
      name: item.Name,
      seriesName: item.SeriesName,
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber,
      overview: item.Overview || '',
      duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : 0,
      premiereDate: item.PremiereDate,
      thumbnail: buildImageUrl(item, 'Primary', 300),
      seriesThumbnail: item.SeriesPrimaryImageTag
        ? `${process.env.JELLYFIN_SERVER}/Items/${item.SeriesId}/Images/Primary?height=300&tag=${item.SeriesPrimaryImageTag}`
        : null
    }));

    res.json({ items, limit: limitNum, seriesId: seriesId || null });

  } catch (error) {
    console.error('Next up error:', error.message);
    res.status(500).json({
      error: 'Failed to get next up items',
      details: error.response?.data?.message || error.message
    });
  }
});

module.exports = router;
