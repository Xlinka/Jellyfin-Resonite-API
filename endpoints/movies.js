const express = require('express');
const { getAuthenticatedAxios, getAuthData, ensureAuth } = require('../entry/middleware/auth');
const router = express.Router();

/**
 * Get movies with pagination and filtering
 * GET /api/movies?page=1&limit=20&sortBy=Name&sortOrder=Ascending&genres=Action
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
      includeWatched = true
    } = req.query;

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    // Calculate offset for pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startIndex = (pageNum - 1) * limitNum;

    const params = {
      IncludeItemTypes: 'Movie',
      Recursive: true,
      Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview,Genres,RunTimeTicks,UserData,CommunityRating,CriticRating,MediaSources,MediaStreams',
      SortBy: sortBy,
      SortOrder: sortOrder,
      StartIndex: startIndex,
      Limit: limitNum,
      UserId: auth.userId
    };

    // Add optional filters
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
        thumbnail: item.ImageTags?.Primary ? 
          `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Primary?height=300&tag=${item.ImageTags.Primary}` : 
          null,
        backdrop: item.BackdropImageTags?.[0] ? 
          `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Backdrop?width=1920&tag=${item.BackdropImageTags[0]}` : 
          null,
        logo: item.ImageTags?.Logo ? 
          `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Logo?height=200&tag=${item.ImageTags.Logo}` : 
          null,
        rating: item.CommunityRating,
        criticRating: item.CriticRating,
        hasVideo: item.MediaSources && item.MediaSources.length > 0,
        isWatched: item.UserData?.Played || false,
        playCount: item.UserData?.PlayCount || 0,
        lastPlayedDate: item.UserData?.LastPlayedDate,
        dateCreated: item.DateCreated,
        dateAdded: item.DateCreated,
        // Video info
        resolution: videoStream ? `${videoStream.Height}p` : 'Unknown',
        codec: videoStream?.Codec?.toUpperCase() || 'Unknown',
        bitrate: videoStream?.BitRate || 0,
        bitrateFormatted: formatBitrate(videoStream?.BitRate),
        fps: videoStream?.RealFrameRate || videoStream?.AverageFrameRate || 0,
        // Audio info
        audioCodec: audioStream?.Codec?.toUpperCase() || 'Unknown',
        audioChannels: audioStream?.Channels || 0,
        // File info
        container: item.MediaSources?.[0]?.Container?.toUpperCase() || 'Unknown',
        fileSize: item.MediaSources?.[0]?.Size || 0,
        fileSizeFormatted: formatFileSize(item.MediaSources?.[0]?.Size)
      };
    });

    const totalPages = Math.ceil(response.data.TotalRecordCount / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    res.json({
      movies,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount: response.data.TotalRecordCount,
        limit: limitNum,
        hasNextPage,
        hasPrevPage,
        nextPage: hasNextPage ? pageNum + 1 : null,
        prevPage: hasPrevPage ? pageNum - 1 : null
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
 * GET /api/movies/series?page=1&limit=20&sortBy=Name&sortOrder=Ascending
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
      includeWatched = true
    } = req.query;

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startIndex = (pageNum - 1) * limitNum;

    const params = {
      IncludeItemTypes: 'Series',
      Recursive: true,
      Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview,Genres,RunTimeTicks,UserData,CommunityRating,CriticRating',
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
      thumbnail: item.ImageTags?.Primary ? 
        `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Primary?height=300&tag=${item.ImageTags.Primary}` : 
        null,
      backdrop: item.BackdropImageTags?.[0] ? 
        `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Backdrop?width=1920&tag=${item.BackdropImageTags[0]}` : 
        null,
      rating: item.CommunityRating,
      criticRating: item.CriticRating,
      isWatched: item.UserData?.Played || false,
      playCount: item.UserData?.PlayCount || 0,
      dateCreated: item.DateCreated,
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
 * GET /api/movies/recent?limit=20
 */
router.get('/recent', ensureAuth, async (req, res) => {
  try {
    const { limit = 20, type = 'Movie' } = req.query;

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const response = await axios.get(`/Users/${auth.userId}/Items/Latest`, {
      params: {
        Limit: parseInt(limit),
        Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview,Genres,RunTimeTicks,UserData,CommunityRating,MediaSources,MediaStreams',
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
        thumbnail: item.ImageTags?.Primary ? 
          `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Primary?height=300&tag=${item.ImageTags.Primary}` : 
          null,
        backdrop: item.BackdropImageTags?.[0] ? 
          `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Backdrop?width=1920&tag=${item.BackdropImageTags[0]}` : 
          null,
        rating: item.CommunityRating,
        isWatched: item.UserData?.Played || false,
        dateCreated: item.DateCreated,
        resolution: videoStream ? `${videoStream.Height}p` : 'Unknown',
        codec: videoStream?.Codec?.toUpperCase() || 'Unknown',
        bitrate: formatBitrate(videoStream?.BitRate)
      };
    });

    res.json({
      items,
      type,
      limit: parseInt(limit),
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

// Utility functions
function formatDuration(ticks) {
  if (!ticks) return '0m';
  
  const seconds = Math.round(ticks / 10000000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

function formatBitrate(bitrate) {
  if (!bitrate || bitrate === 0) return 'Unknown';
  
  if (bitrate >= 1000000) {
    return (bitrate / 1000000).toFixed(1) + ' Mbps';
  } else if (bitrate >= 1000) {
    return (bitrate / 1000).toFixed(0) + ' Kbps';
  }
  return bitrate + ' bps';
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return 'Unknown';
  
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

module.exports = router;
