require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Import route modules
const libraryRoutes = require('./handling/routes/libraries');
const streamRoutes = require('./handling/routes/streams');
const searchRoutes = require('./endpoints/search');
const itemRoutes = require('./endpoints/items');
const movieRoutes = require('./endpoints/movies');

// Import middleware
const { initializeAuth, getAuthData, getAuthenticatedAxios } = require('./entry/middleware/auth');

const app = express();
const PORT = process.env.PORT || 3001;
const MAX_CONCURRENT_STREAMS = parseInt(process.env.MAX_CONCURRENT_STREAMS) || 50;
const MAX_RECENT_REQUESTS = 50;

// Stats tracking for admin panel
const serverStats = {
  startTime: Date.now(),
  requestCount: 0,
  streamCount: 0,
  totalBandwidth: 0,
  activeStreams: new Map(),
  apiStats: {
    '/api/libraries': { count: 0, avgResponse: 0, totalTime: 0 },
    '/api/stream': { count: 0, avgResponse: 0, totalTime: 0 },
    '/api/search': { count: 0, avgResponse: 0, totalTime: 0 },
    '/api/items': { count: 0, avgResponse: 0, totalTime: 0 },
    '/admin/stats': { count: 0, avgResponse: 0, totalTime: 0 }
  },
  recentRequests: [],
  requestBreakdown: {
    'GET /admin.html': 0,
    'GET /admin.css': 0,
    'GET /admin.js': 0,
    'GET /admin/stats': 0,
    'GET /health': 0,
    'GET /favicon.ico': 0,
    'GET /': 0,
    'API requests': 0,
    'Other': 0
  }
};

// Scheduled cleanup for stale streams (every 5 minutes)
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  let cleaned = 0;
  for (const [id, info] of serverStats.activeStreams.entries()) {
    if (info.startTime < oneHourAgo) {
      serverStats.activeStreams.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} stale stream sessions`);
  }
}, 300000);

// Request tracking middleware
app.use((req, res, next) => {
  const start = Date.now();
  serverStats.requestCount++;

  const requestKey = `${req.method} ${req.path}`;
  if (serverStats.requestBreakdown[requestKey] !== undefined) {
    serverStats.requestBreakdown[requestKey]++;
  } else if (req.path.startsWith('/api/')) {
    serverStats.requestBreakdown['API requests']++;
  } else {
    serverStats.requestBreakdown['Other']++;
  }

  res.on('finish', () => {
    const duration = Date.now() - start;

    // Efficient circular buffer for recent requests
    if (serverStats.recentRequests.length >= MAX_RECENT_REQUESTS) {
      serverStats.recentRequests.pop();
    }
    serverStats.recentRequests.unshift({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      timestamp: new Date().toISOString()
    });

    // Track API endpoint stats
    for (const endpoint in serverStats.apiStats) {
      if (req.path.startsWith(endpoint)) {
        const stats = serverStats.apiStats[endpoint];
        stats.count++;
        stats.totalTime += duration;
        stats.avgResponse = Math.round(stats.totalTime / stats.count);
        break;
      }
    }

    console.log(`[LOG] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });

  next();
});

// Middleware setup
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

// CORS setup
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : true,
  credentials: false
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 1000,
  message: { error: 'Too many requests, please try again later' }
});
app.use(limiter);

// Initialize authentication on startup
initializeAuth();

// Make serverStats available to routes
app.locals.serverStats = serverStats;
app.locals.maxConcurrentStreams = MAX_CONCURRENT_STREAMS;

// Helper function to check Jellyfin connection status
async function checkJellyfinStatus() {
  try {
    const axios = await getAuthenticatedAxios();
    const response = await axios.get('/System/Info', { timeout: 5000 });
    return {
      connected: true,
      server: process.env.JELLYFIN_SERVER,
      version: response.data.Version,
      serverName: response.data.ServerName,
      lastChecked: new Date().toISOString()
    };
  } catch (error) {
    return {
      connected: false,
      server: process.env.JELLYFIN_SERVER || 'Not configured',
      error: error.message,
      lastChecked: new Date().toISOString()
    };
  }
}

async function fetchJellyfinSessions() {
  try {
    const axios = await getAuthenticatedAxios();
    const response = await axios.get('/Sessions', {
      params: { ActiveWithinSeconds: 60 },
      timeout: 5000
    });
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    return [];
  }
}

function extractTranscodingInfo(session) {
  const info = session?.TranscodingInfo;
  if (!info) return null;
  const rawCompletion = info.CompletionPercentage ?? info.CompletionPercent ?? info.Progress;
  let completionPercent = null;
  if (rawCompletion !== undefined && rawCompletion !== null && !Number.isNaN(Number(rawCompletion))) {
    const numericCompletion = Number(rawCompletion);
    completionPercent = numericCompletion <= 1
      ? Math.round(numericCompletion * 1000) / 10
      : Math.round(numericCompletion * 10) / 10;
  }

  return {
    isTranscoding: !(info.IsVideoDirect && info.IsAudioDirect),
    completionPercent,
    bitrate: info.Bitrate || null,
    framerate: info.Framerate || info.TranscodeFramerate || null,
    width: info.Width || null,
    height: info.Height || null,
    videoCodec: info.VideoCodec || null,
    audioCodec: info.AudioCodec || null,
    container: info.Container || null,
    reasons: info.TranscodeReasons || []
  };
}

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Admin Panel Endpoints
app.get('/admin/stats', async (req, res) => {
  const uptime = Date.now() - serverStats.startTime;
  const uptimeHours = Math.floor(uptime / 3600000);
  const uptimeMinutes = Math.floor((uptime % 3600000) / 60000);

  const jellyfinStatus = await checkJellyfinStatus();
  const sessions = await fetchJellyfinSessions();
  const sessionsByPlaySessionId = new Map();
  const sessionsByItemId = new Map();

  sessions.forEach(session => {
    if (session?.PlaySessionId) {
      sessionsByPlaySessionId.set(session.PlaySessionId, session);
    }
    const itemId = session?.NowPlayingItem?.Id;
    if (itemId) {
      sessionsByItemId.set(itemId, session);
    }
  });

  const activeStreamsArray = Array.from(serverStats.activeStreams.entries()).map(([sessionId, info]) => {
    const session = info.playSessionId
      ? sessionsByPlaySessionId.get(info.playSessionId)
      : sessionsByItemId.get(info.itemId);
    const transcoding = session ? extractTranscodingInfo(session) : null;
    const playback = session?.PlayState
      ? {
          positionTicks: session.PlayState.PositionTicks || 0,
          isPaused: !!session.PlayState.IsPaused
        }
      : null;

    return {
      sessionId,
      ...info,
      transcoding,
      playback
    };
  });

  res.json({
    server: {
      uptime,
      uptimeFormatted: `${uptimeHours}h ${uptimeMinutes}m`,
      startTime: new Date(serverStats.startTime).toISOString(),
      requestCount: serverStats.requestCount,
      requestsPerHour: uptime > 0 ? Math.round(serverStats.requestCount / (uptime / 3600000)) : 0,
      version: require('./package.json').version,
      maxConcurrentStreams: MAX_CONCURRENT_STREAMS
    },
    jellyfin: jellyfinStatus,
    streaming: {
      totalStreams: serverStats.streamCount,
      activeStreams: activeStreamsArray.length,
      totalBandwidth: serverStats.totalBandwidth,
      bandwidthFormatted: formatBytes(serverStats.totalBandwidth),
      avgBandwidthPerStream: serverStats.streamCount > 0
        ? Math.round(serverStats.totalBandwidth / serverStats.streamCount)
        : 0
    },
    api: serverStats.apiStats,
    activeStreams: activeStreamsArray,
    requestBreakdown: serverStats.requestBreakdown,
    recentRequests: serverStats.recentRequests.slice(0, 20)
  });
});

// API Testing endpoints
app.get('/admin/test/libraries', async (req, res) => {
  try {
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();
    const response = await axios.get(`/Users/${auth.userId}/Views`);
    const libraries = response.data.Items
      .filter(item => ['movies', 'tvshows', 'music'].includes(item.CollectionType))
      .map(lib => ({
        id: lib.Id,
        name: lib.Name,
        type: lib.CollectionType,
        itemCount: lib.ChildCount || 0
      }));

    res.json({ success: true, data: libraries, count: libraries.length, endpoint: '/api/libraries' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, endpoint: '/api/libraries' });
  }
});

app.get('/admin/test/recent', async (req, res) => {
  try {
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();
    const response = await axios.get(`/Users/${auth.userId}/Items/Latest`, {
      params: { Limit: 10, Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview' }
    });

    const items = response.data.map(item => ({
      id: item.Id,
      name: item.Name,
      type: item.Type,
      year: item.ProductionYear,
      dateAdded: item.DateCreated
    }));

    res.json({ success: true, data: items, count: items.length, endpoint: '/api/items/recent' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, endpoint: '/api/items/recent' });
  }
});

app.get('/admin/test/search', async (req, res) => {
  try {
    const { q = 'a' } = req.query;
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();
    const response = await axios.get(`/Users/${auth.userId}/Items`, {
      params: {
        SearchTerm: q,
        Limit: 5,
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        Fields: 'PrimaryImageAspectRatio,ProductionYear'
      }
    });

    const results = response.data.Items.map(item => ({
      id: item.Id,
      name: item.Name,
      type: item.Type,
      year: item.ProductionYear
    }));

    res.json({ success: true, data: results, count: results.length, query: q, endpoint: `/api/search?q=${q}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, endpoint: '/api/search' });
  }
});

app.get('/admin/test/system', async (req, res) => {
  try {
    const axios = await getAuthenticatedAxios();
    const response = await axios.get('/System/Info');
    res.json({
      success: true,
      data: {
        serverName: response.data.ServerName,
        version: response.data.Version,
        operatingSystem: response.data.OperatingSystem,
        architecture: response.data.SystemArchitecture
      },
      endpoint: '/System/Info'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, endpoint: '/System/Info' });
  }
});

app.get('/admin/test/videos', async (req, res) => {
  try {
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();
    const response = await axios.get(`/Users/${auth.userId}/Items`, {
      params: {
        IncludeItemTypes: 'Movie,Episode',
        Recursive: true,
        Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview,MediaSources,RunTimeTicks',
        Limit: 20,
        SortBy: 'DateCreated',
        SortOrder: 'Descending',
        HasVideoStream: true
      }
    });

    const videos = response.data.Items
      .filter(item => item.MediaSources?.length > 0)
      .map(item => {
        const videoStream = item.MediaSources[0]?.MediaStreams?.find(s => s.Type === 'Video');
        return {
          id: item.Id,
          name: item.Name,
          type: item.Type,
          year: item.ProductionYear,
          overview: item.Overview || '',
          duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : 0,
          thumbnail: item.ImageTags?.Primary
            ? `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Primary?height=200&tag=${item.ImageTags.Primary}`
            : null,
          resolution: videoStream?.Height || 0,
          codec: videoStream?.Codec || 'Unknown',
          seriesName: item.SeriesName,
          seasonNumber: item.ParentIndexNumber,
          episodeNumber: item.IndexNumber
        };
      });

    res.json({ success: true, data: videos, count: videos.length, endpoint: '/admin/test/videos' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, endpoint: '/admin/test/videos' });
  }
});

app.get('/admin/test/stream/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { quality = 'auto' } = req.query;
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const streamUrl = `${req.protocol}://${req.get('host')}/api/stream/${itemId}?quality=${quality}&client=browser`;
    const itemResponse = await axios.get(`/Users/${auth.userId}/Items/${itemId}`, {
      params: { Fields: 'MediaSources,RunTimeTicks' }
    });

    const item = itemResponse.data;
    const videoStream = item.MediaSources?.[0]?.MediaStreams?.find(s => s.Type === 'Video');

    res.json({
      success: true,
      data: {
        streamUrl,
        itemId,
        name: item.Name,
        type: item.Type,
        duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : 0,
        resolution: videoStream?.Height || 0,
        codec: videoStream?.Codec || 'Unknown',
        bitrate: videoStream?.BitRate || 0,
        hlsUrl: `${streamUrl}&format=hls`,
        directUrl: streamUrl
      },
      endpoint: `/api/stream/${itemId}`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, endpoint: `/admin/test/stream/${req.params.itemId}` });
  }
});

app.get('/admin/requests', (req, res) => {
  res.json({
    message: 'Live request log',
    totalRequests: serverStats.requestCount,
    recentRequests: serverStats.recentRequests,
    requestBreakdown: serverStats.requestBreakdown
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    server: process.env.JELLYFIN_SERVER,
    timestamp: new Date().toISOString(),
    version: require('./package.json').version,
    activeStreams: serverStats.activeStreams.size,
    maxConcurrentStreams: MAX_CONCURRENT_STREAMS
  });
});

// API Routes
app.use('/api/stream', streamRoutes);
app.use('/api/libraries', libraryRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/movies', movieRoutes);

// Root endpoint with API info
app.get('/', (req, res) => {
  res.json({
    name: 'Jellyfin-Resonite API Bridge',
    version: require('./package.json').version,
    endpoints: {
      health: 'GET /health',
      admin: 'GET /admin.html',
      adminStats: 'GET /admin/stats',
      requestLog: 'GET /admin/requests',
      libraries: 'GET /api/libraries',
      libraryItems: 'GET /api/libraries/:libraryId/items',
      stream: 'GET /api/stream/:itemId',
      itemDetails: 'GET /api/items/:itemId',
      search: 'GET /api/search?q=query',
      recent: 'GET /api/items/recent'
    }
  });
});

// Error handling middleware
app.use((err, req, res, _next) => {
  console.error('API Error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Jellyfin-Resonite API Server started`);
  console.log(`Port: ${PORT}`);
  console.log(`Jellyfin: ${process.env.JELLYFIN_SERVER}`);
  console.log(`Max concurrent streams: ${MAX_CONCURRENT_STREAMS}`);
  console.log(`Admin Panel: http://localhost:${PORT}/admin.html`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
