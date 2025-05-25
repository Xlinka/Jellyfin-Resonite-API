const express = require('express');
const { getAuthenticatedAxios, getAuthData, ensureAuth } = require('../entry/middleware/auth');
const router = express.Router();

/**
 * Get detailed item information
 * GET /api/items/:itemId
 */
router.get('/:itemId', ensureAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const response = await axios.get(`/Users/${auth.userId}/Items/${itemId}`, {
      params: {
        Fields: 'ItemCounts,PrimaryImageAspectRatio,BasicSyncInfo,CanDelete,MediaSourceCount,Overview,Genres,People,Studios,Tags,Taglines,MediaSources,Chapters'
      }
    });

    const item = response.data;
    
    // Get additional info for series/seasons
    let additionalInfo = {};
    if (item.Type === 'Series') {
      try {
        const seasonsResponse = await axios.get(`/Shows/${itemId}/Seasons`, {
          params: { UserId: auth.userId, Fields: 'ItemCounts,PrimaryImageAspectRatio' }
        });
        additionalInfo.seasons = seasonsResponse.data.Items.map(season => ({
          id: season.Id,
          name: season.Name,
          seasonNumber: season.IndexNumber,
          episodeCount: season.ChildCount,
          thumbnail: season.ImageTags?.Primary ? 
            `${process.env.JELLYFIN_SERVER}/Items/${season.Id}/Images/Primary?height=300&tag=${season.ImageTags.Primary}` : 
            null
        }));
      } catch (err) {
        console.warn('Failed to get seasons:', err.message);
      }
    }

    // Get similar items
    try {
      const similarResponse = await axios.get(`/Items/${itemId}/Similar`, {
        params: { UserId: auth.userId, Limit: 12, Fields: 'PrimaryImageAspectRatio,ProductionYear' }
      });
      additionalInfo.similar = similarResponse.data.Items.map(similar => ({
        id: similar.Id,
        name: similar.Name,
        year: similar.ProductionYear,
        type: similar.Type,
        thumbnail: similar.ImageTags?.Primary ? 
          `${process.env.JELLYFIN_SERVER}/Items/${similar.Id}/Images/Primary?height=300&tag=${similar.ImageTags.Primary}` : 
          null
      }));
    } catch (err) {
      console.warn('Failed to get similar items:', err.message);
      additionalInfo.similar = [];
    }

    const videoStream = item.MediaSources?.[0]?.MediaStreams?.find(s => s.Type === 'Video');
    const audioStreams = item.MediaSources?.[0]?.MediaStreams?.filter(s => s.Type === 'Audio') || [];

    const result = {
      id: item.Id,
      name: item.Name,
      originalTitle: item.OriginalTitle,
      sortName: item.SortName,
      overview: item.Overview || '',
      shortOverview: item.ShortOverview,
      tagline: item.Taglines?.[0],
      type: item.Type,
      year: item.ProductionYear,
      premiereDate: item.PremiereDate,
      endDate: item.EndDate,
      status: item.Status,
      
      // Ratings and reviews
      rating: item.CommunityRating,
      criticRating: item.CriticRating,
      officialRating: item.OfficialRating,
      
      // Categories and classification
      genres: item.Genres || [],
      tags: item.Tags || [],
      studios: item.Studios || [],
      
      // Media information
      duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : 0,
      hasVideo: item.MediaSources && item.MediaSources.length > 0,
      resolution: videoStream?.Height || 0,
      aspectRatio: videoStream?.AspectRatio,
      videoCodec: videoStream?.Codec,
      audioChannels: Math.max(...audioStreams.map(a => a.Channels || 0)),
      
      // Images
      thumbnail: item.ImageTags?.Primary ? 
        `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Primary?height=600&tag=${item.ImageTags.Primary}` : 
        null,
      backdrop: item.BackdropImageTags?.[0] ? 
        `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Backdrop?width=1920&tag=${item.BackdropImageTags[0]}` : 
        null,
      logo: item.ImageTags?.Logo ? 
        `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Logo?width=800&tag=${item.ImageTags.Logo}` : 
        null,
      banner: item.ImageTags?.Banner ? 
        `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Banner?width=1000&tag=${item.ImageTags.Banner}` : 
        null,
      
      // Series/Episode specific fields
      seriesName: item.SeriesName,
      seasonName: item.SeasonName,
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber,
      
      // User data
      isWatched: item.UserData?.Played || false,
      isFavorite: item.UserData?.IsFavorite || false,
      playbackPosition: item.UserData?.PlaybackPositionTicks ? 
        Math.round(item.UserData.PlaybackPositionTicks / 10000000) : 0,
      playCount: item.UserData?.PlayCount || 0,
      lastPlayedDate: item.UserData?.LastPlayedDate,
      
      // People (cast and crew)
      people: (item.People || []).map(person => ({
        id: person.Id,
        name: person.Name,
        role: person.Role,
        type: person.Type,
        primaryImageTag: person.PrimaryImageTag,
        thumbnail: person.PrimaryImageTag ? 
          `${process.env.JELLYFIN_SERVER}/Items/${person.Id}/Images/Primary?height=200&tag=${person.PrimaryImageTag}` : 
          null
      })),
      
      // Chapters
      chapters: (item.Chapters || []).map(chapter => ({
        name: chapter.Name,
        startTime: Math.round(chapter.StartPositionTicks / 10000000),
        thumbnail: chapter.ImageTag ? 
          `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Chapter${chapter.StartPositionTicks}?width=320&tag=${chapter.ImageTag}` : 
          null
      })),
      
      // Additional computed fields
      dateAdded: item.DateCreated,
      dateModified: item.DateLastMediaAdded || item.DateLastSaved,
      path: item.Path,
      
      // Additional info (seasons, similar items, etc.)
      ...additionalInfo
    };

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
 * GET /api/items/recent?limit=20&type=Movie,Series
 */
router.get('/recent', ensureAuth, async (req, res) => {
  try {
    const { 
      limit = 20, 
      type = 'Movie,Series,Episode',
      libraryId 
    } = req.query;

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const params = {
      Limit: parseInt(limit),
      Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview'
    };

    if (libraryId) {
      params.ParentId = libraryId;
    }

    if (type !== 'all') {
      params.IncludeItemTypes = type;
    }

    const response = await axios.get(`/Users/${auth.userId}/Items/Latest`, { params });

    const items = response.data.map(item => ({
      id: item.Id,
      name: item.Name,
      type: item.Type,
      year: item.ProductionYear,
      overview: item.Overview || '',
      dateAdded: item.DateCreated,
      thumbnail: item.ImageTags?.Primary ? 
        `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Primary?height=300&tag=${item.ImageTags.Primary}` : 
        null,
      backdrop: item.BackdropImageTags?.[0] ? 
        `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Backdrop?width=1920&tag=${item.BackdropImageTags[0]}` : 
        null,
      // Series/Episode info
      seriesName: item.SeriesName,
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber
    }));

    res.json({ 
      items,
      limit: parseInt(limit),
      type: type === 'all' ? 'All types' : type
    });

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
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const response = await axios.get(`/Users/${auth.userId}/Items/Resume`, {
      params: {
        Limit: parseInt(limit),
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
      playbackPosition: item.UserData?.PlaybackPositionTicks ? 
        Math.round(item.UserData.PlaybackPositionTicks / 10000000) : 0,
      playbackPercent: item.UserData?.PlayedPercentage || 0,
      thumbnail: item.ImageTags?.Primary ? 
        `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Primary?height=300&tag=${item.ImageTags.Primary}` : 
        null,
      // Series/Episode info
      seriesName: item.SeriesName,
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber
    }));

    res.json({ 
      items,
      limit: parseInt(limit)
    });

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
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const params = {
      UserId: auth.userId,
      Limit: parseInt(limit),
      Fields: 'PrimaryImageAspectRatio,Overview,UserData'
    };

    if (seriesId) {
      params.SeriesId = seriesId;
    }

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
      thumbnail: item.ImageTags?.Primary ? 
        `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Primary?height=300&tag=${item.ImageTags.Primary}` : 
        null,
      seriesThumbnail: item.SeriesPrimaryImageTag ? 
        `${process.env.JELLYFIN_SERVER}/Items/${item.SeriesId}/Images/Primary?height=300&tag=${item.SeriesPrimaryImageTag}` : 
        null
    }));

    res.json({ 
      items,
      limit: parseInt(limit),
      seriesId: seriesId || null
    });

  } catch (error) {
    console.error('Next up error:', error.message);
    res.status(500).json({ 
      error: 'Failed to get next up items',
      details: error.response?.data?.message || error.message
    });
  }
});

module.exports = router;
