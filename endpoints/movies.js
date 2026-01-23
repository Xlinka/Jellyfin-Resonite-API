const express = require('express');
const { getAuthenticatedAxios, getAuthData, ensureAuth } = require('../entry/middleware/auth');
const { buildImageUrl, formatDuration, formatBitrate, formatBytes, parseIntParam } = require('../utils/helpers');
const router = express.Router();

/**
 * Get movies with pagination and filtering
 * GET /api/movies
 */
router.get('/', ensureAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sortBy = 'Name',
      sortOrder = 'Ascending',
      genres,
      years,
      minRating,
      maxRating,
      includeWatched = 'true'
    } = req.query;

    const pageNum = parseIntParam(page, 1, 1, 1000);
    const limitNum = parseIntParam(limit, 20, 1, 100);
    const startIndex = (pageNum - 1) * limitNum;

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const params = {
      IncludeItemTypes: 'Movie',
      Recursive: true,
      Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview,Genres,RunTimeTicks,UserData,CommunityRating,MediaSources',
      SortBy: sortBy,
      SortOrder: sortOrder,
      StartIndex: startIndex,
      Limit: limitNum,
      UserId: auth.userId
    };

    if (genres) params.Genres = genres;
    if (years) params.Years = years;
    if (minRating) params.MinCommunityRating = parseFloat(minRating);
    if (maxRating) params.MaxCommunityRating = parseFloat(maxRating);
    if (includeWatched === 'false') params.IsPlayed = false;

    const response = await axios.get(`/Users/${auth.userId}/Items`, { params });

    const movies = response.data.Items.map(item => {
      const videoStream = item.MediaSources?.[0]?.MediaStreams?.find(s => s.Type === 'Video');
      const audioStream = item.MediaSources?.[0]?.MediaStreams?.find(s => s.Type === 'Audio');

      return {
        id: item.Id,
        name: item.Name,
        sortName: item.SortName,
        type: item.Type,
        year: item.ProductionYear,
        overview: item.Overview || '',
        genres: item.Genres || [],
        duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : 0,
        durationFormatted: formatDuration(item.RunTimeTicks),
        thumbnail: buildImageUrl(item, 'Primary', 300),
        backdrop: buildImageUrl(item, 'Backdrop', 1080),
        rating: item.CommunityRating,
        criticRating: item.CriticRating,
        hasVideo: item.MediaSources?.length > 0,
        isWatched: item.UserData?.Played || false,
        playCount: item.UserData?.PlayCount || 0,
        lastPlayedDate: item.UserData?.LastPlayedDate,
        dateAdded: item.DateCreated,
        resolution: videoStream ? `${videoStream.Height}p` : 'Unknown',
        codec: videoStream?.Codec?.toUpperCase() || 'Unknown',
        bitrate: videoStream?.BitRate || 0,
        bitrateFormatted: formatBitrate(videoStream?.BitRate),
        fps: videoStream?.RealFrameRate || videoStream?.AverageFrameRate || 0,
        audioCodec: audioStream?.Codec?.toUpperCase() || 'Unknown',
        audioChannels: audioStream?.Channels || 0,
        container: item.MediaSources?.[0]?.Container?.toUpperCase() || 'Unknown',
        fileSize: item.MediaSources?.[0]?.Size || 0,
        fileSizeFormatted: formatBytes(item.MediaSources?.[0]?.Size)
      };
    });

    const totalPages = Math.ceil(response.data.TotalRecordCount / limitNum);

    res.json({
      movies,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount: response.data.TotalRecordCount,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
        nextPage: pageNum < totalPages ? pageNum + 1 : null,
        prevPage: pageNum > 1 ? pageNum - 1 : null
      },
      filters: {
        sortBy,
        sortOrder,
        genres: genres || null,
        years: years || null,
        minRating: minRating || null,
        maxRating: maxRating || null,
        includeWatched: includeWatched !== 'false'
      }
    });

  } catch (error) {
    console.error('Movies endpoint error:', error.message);
    res.status(500).json({
      error: 'Failed to get movies',
      details: error.response?.data?.message || error.message
    });
  }
});

/**
 * Get TV series with pagination and filtering
 * GET /api/movies/series
 */
router.get('/series', ensureAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sortBy = 'Name',
      sortOrder = 'Ascending',
      genres,
      years,
      minRating,
      maxRating,
      includeWatched = 'true'
    } = req.query;

    const pageNum = parseIntParam(page, 1, 1, 1000);
    const limitNum = parseIntParam(limit, 20, 1, 100);
    const startIndex = (pageNum - 1) * limitNum;

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const params = {
      IncludeItemTypes: 'Series',
      Recursive: true,
      Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview,Genres,UserData,CommunityRating',
      SortBy: sortBy,
      SortOrder: sortOrder,
      StartIndex: startIndex,
      Limit: limitNum,
      UserId: auth.userId
    };

    if (genres) params.Genres = genres;
    if (years) params.Years = years;
    if (minRating) params.MinCommunityRating = parseFloat(minRating);
    if (maxRating) params.MaxCommunityRating = parseFloat(maxRating);
    if (includeWatched === 'false') params.IsPlayed = false;

    const response = await axios.get(`/Users/${auth.userId}/Items`, { params });

    const series = response.data.Items.map(item => ({
      id: item.Id,
      name: item.Name,
      sortName: item.SortName,
      type: item.Type,
      year: item.ProductionYear,
      overview: item.Overview || '',
      genres: item.Genres || [],
      episodeCount: item.ChildCount || 0,
      seasonCount: item.RecursiveItemCount || 0,
      thumbnail: buildImageUrl(item, 'Primary', 300),
      backdrop: buildImageUrl(item, 'Backdrop', 1080),
      rating: item.CommunityRating,
      criticRating: item.CriticRating,
      isWatched: item.UserData?.Played || false,
      playCount: item.UserData?.PlayCount || 0,
      dateAdded: item.DateCreated
    }));

    const totalPages = Math.ceil(response.data.TotalRecordCount / limitNum);

    res.json({
      series,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount: response.data.TotalRecordCount,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      },
      filters: {
        sortBy,
        sortOrder,
        genres: genres || null,
        years: years || null,
        minRating: minRating || null,
        maxRating: maxRating || null,
        includeWatched: includeWatched !== 'false'
      }
    });

  } catch (error) {
    console.error('Series endpoint error:', error.message);
    res.status(500).json({
      error: 'Failed to get series',
      details: error.response?.data?.message || error.message
    });
  }
});

/**
 * Get recently added movies
 * GET /api/movies/recent
 */
router.get('/recent', ensureAuth, async (req, res) => {
  try {
    const { limit = 20, type = 'Movie' } = req.query;
    const limitNum = parseIntParam(limit, 20, 1, 100);

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const response = await axios.get(`/Users/${auth.userId}/Items/Latest`, {
      params: {
        Limit: limitNum,
        Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview,Genres,RunTimeTicks,UserData,CommunityRating,MediaSources',
        IncludeItemTypes: type
      }
    });

    const items = response.data.map(item => {
      const videoStream = item.MediaSources?.[0]?.MediaStreams?.find(s => s.Type === 'Video');

      return {
        id: item.Id,
        name: item.Name,
        type: item.Type,
        year: item.ProductionYear,
        overview: item.Overview || '',
        genres: item.Genres || [],
        duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : 0,
        durationFormatted: formatDuration(item.RunTimeTicks),
        thumbnail: buildImageUrl(item, 'Primary', 300),
        backdrop: buildImageUrl(item, 'Backdrop', 1080),
        rating: item.CommunityRating,
        isWatched: item.UserData?.Played || false,
        dateAdded: item.DateCreated,
        resolution: videoStream ? `${videoStream.Height}p` : 'Unknown',
        codec: videoStream?.Codec?.toUpperCase() || 'Unknown',
        bitrate: formatBitrate(videoStream?.BitRate)
      };
    });

    res.json({
      items,
      type,
      limit: limitNum,
      totalCount: items.length
    });

  } catch (error) {
    console.error('Recent movies error:', error.message);
    res.status(500).json({
      error: 'Failed to get recent items',
      details: error.response?.data?.message || error.message
    });
  }
});

module.exports = router;
