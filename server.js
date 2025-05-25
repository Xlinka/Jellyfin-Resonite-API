require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

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

// Enhanced stats tracking for admin panel with detailed request logging
let serverStats = {
  startTime: Date.now(),
  requestCount: 0,
  streamCount: 0,
  totalBandwidth: 0, // bytes
  activeStreams: new Map(), // sessionId -> stream info
  apiStats: {
    '/api/libraries': { count: 0, avgResponse: 0, totalTime: 0 },
    '/api/stream': { count: 0, avgResponse: 0, totalTime: 0 },
    '/api/search': { count: 0, avgResponse: 0, totalTime: 0 },
    '/api/items': { count: 0, avgResponse: 0, totalTime: 0 },
    '/admin/stats': { count: 0, avgResponse: 0, totalTime: 0 }
  },
  recentRequests: [], // Track last 50 requests to show they're real
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

// Enhanced middleware to track ALL requests and response times
app.use((req, res, next) => {
  const start = Date.now();
  const timestamp = new Date().toISOString();
  const requestInfo = {
    method: req.method,
    url: req.url,
    path: req.path,
    userAgent: req.get('User-Agent') || 'Unknown',
    ip: req.ip,
    timestamp: timestamp,
    startTime: start
  };
  
  serverStats.requestCount++;
  
  // Track request breakdown for transparency
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
    requestInfo.duration = duration;
    requestInfo.statusCode = res.statusCode;
    
    // Add to recent requests (keep last 50)
    serverStats.recentRequests.unshift(requestInfo);
    if (serverStats.recentRequests.length > 50) {
      serverStats.recentRequests = serverStats.recentRequests.slice(0, 50);
    }
    
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
    
    // Log request for debugging (you can see this in server console)
    console.log(`📊 ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

// Middleware setup
app.use(express.json());
app.use(express.static('public')); // Serve static files for admin panel

// CORS setup
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS ? 
    process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()) : 
    true,
  credentials: false
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX) || 1000,
  message: {
    error: 'Too many requests, please try again later'
  }
});
app.use(limiter);

// Initialize authentication on startup
initializeAuth();

// Helper function to check Jellyfin connection status
async function checkJellyfinStatus() {
  try {
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();
    
    // Try to get system info to verify connection
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

// Enhanced Admin Panel Endpoints
app.get('/admin/stats', async (req, res) => {
  const uptime = Date.now() - serverStats.startTime;
  const uptimeHours = Math.floor(uptime / (1000 * 60 * 60));
  const uptimeMinutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
  
  // Convert active streams Map to array for JSON serialization
  const activeStreamsArray = Array.from(serverStats.activeStreams.entries()).map(([sessionId, info]) => ({
    sessionId,
    ...info
  }));
  
  // Get Jellyfin connection status
  const jellyfinStatus = await checkJellyfinStatus();
  
  res.json({
    server: {
      uptime: uptime,
      uptimeFormatted: `${uptimeHours}h ${uptimeMinutes}m`,
      startTime: new Date(serverStats.startTime).toISOString(),
      requestCount: serverStats.requestCount,
      requestsPerHour: Math.round(serverStats.requestCount / (uptime / (1000 * 60 * 60))),
      version: require('./package.json').version
    },
    jellyfin: jellyfinStatus,
    streaming: {
      totalStreams: serverStats.streamCount,
      activeStreams: activeStreamsArray.length,
      totalBandwidth: serverStats.totalBandwidth,
      bandwidthFormatted: formatBytes(serverStats.totalBandwidth),
      avgBandwidthPerStream: activeStreamsArray.length > 0 ? 
        Math.round(serverStats.totalBandwidth / serverStats.streamCount) : 0
    },
    api: serverStats.apiStats,
    activeStreams: activeStreamsArray,
    // NEW: Transparent request breakdown to prove data is real
    requestBreakdown: serverStats.requestBreakdown,
    recentRequests: serverStats.recentRequests.slice(0, 20), // Last 20 requests
    transparency: {
      note: "All request data is real-time. Every admin panel refresh creates multiple requests:",
      explanation: [
        "GET /admin.html - Loading the admin page",
        "GET /admin.css - Loading styles", 
        "GET /admin.js - Loading JavaScript",
        "GET /admin/stats - API call every 5 seconds for live updates",
        "GET /favicon.ico - Browser requesting favicon",
        "Plus any other static assets or API calls you make"
      ]
    }
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

    res.json({
      success: true,
      data: libraries,
      count: libraries.length,
      endpoint: '/api/libraries',
      responseTime: Date.now() - Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      endpoint: '/api/libraries'
    });
  }
});

app.get('/admin/test/recent', async (req, res) => {
  try {
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();
    
    const response = await axios.get(`/Users/${auth.userId}/Items/Latest`, {
      params: {
        Limit: 10,
        Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview'
      }
    });

    const items = response.data.map(item => ({
      id: item.Id,
      name: item.Name,
      type: item.Type,
      year: item.ProductionYear,
      dateAdded: item.DateCreated
    }));

    res.json({
      success: true,
      data: items,
      count: items.length,
      endpoint: '/api/items/recent'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      endpoint: '/api/items/recent'
    });
  }
});

app.get('/admin/test/search', async (req, res) => {
  try {
    const { q = 'a' } = req.query; // Default search for 'a' to get some results
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

    res.json({
      success: true,
      data: results,
      count: results.length,
      query: q,
      endpoint: `/api/search?q=${q}`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      endpoint: '/api/search'
    });
  }
});

app.get('/admin/test/system', async (req, res) => {
  try {
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();
    
    const response = await axios.get('/System/Info');
    
    res.json({
      success: true,
      data: {
        serverName: response.data.ServerName,
        version: response.data.Version,
        operatingSystem: response.data.OperatingSystem,
        architecture: response.data.SystemArchitecture,
        runtime: response.data.WebSocketPortNumber
      },
      endpoint: '/System/Info'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      endpoint: '/System/Info'
    });
  }
});

// Get streamable video content for testing
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
      .filter(item => item.MediaSources && item.MediaSources.length > 0)
      .map(item => {
        const videoStream = item.MediaSources[0]?.MediaStreams?.find(s => s.Type === 'Video');
        return {
          id: item.Id,
          name: item.Name,
          type: item.Type,
          year: item.ProductionYear,
          overview: item.Overview || '',
          duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : 0,
          thumbnail: item.ImageTags?.Primary ? 
            `${process.env.JELLYFIN_SERVER}/Items/${item.Id}/Images/Primary?height=200&tag=${item.ImageTags.Primary}` : 
            null,
          resolution: videoStream?.Height || 0,
          codec: videoStream?.Codec || 'Unknown',
          // Series info if episode
          seriesName: item.SeriesName,
          seasonNumber: item.ParentIndexNumber,
          episodeNumber: item.IndexNumber
        };
      });

    res.json({
      success: true,
      data: videos,
      count: videos.length,
      endpoint: '/admin/test/videos'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      endpoint: '/admin/test/videos'
    });
  }
});

// Get stream URL for a specific video (for testing)
app.get('/admin/test/stream/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { quality = 'auto' } = req.query;
    
    const auth = await getAuthData();
    
    // Build stream URL using our existing API
    const streamUrl = `${req.protocol}://${req.get('host')}/api/stream/${itemId}?quality=${quality}`;
    
    // Get item details for display
    const axios = await getAuthenticatedAxios();
    const itemResponse = await axios.get(`/Users/${auth.userId}/Items/${itemId}`, {
      params: {
        Fields: 'MediaSources,RunTimeTicks'
      }
    });
    
    const item = itemResponse.data;
    const videoStream = item.MediaSources?.[0]?.MediaStreams?.find(s => s.Type === 'Video');
    
    res.json({
      success: true,
      data: {
        streamUrl: streamUrl,
        itemId: itemId,
        name: item.Name,
        type: item.Type,
        duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : 0,
        resolution: videoStream?.Height || 0,
        codec: videoStream?.Codec || 'Unknown',
        bitrate: videoStream?.BitRate || 0,
        // HLS playlist URL (what the player needs)
        hlsUrl: `${streamUrl}&format=hls`,
        // Direct stream URL
        directUrl: streamUrl
      },
      endpoint: `/api/stream/${itemId}`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      endpoint: `/admin/test/stream/${req.params.itemId}`
    });
  }
});

// Detailed request log endpoint for maximum transparency
app.get('/admin/requests', (req, res) => {
  res.json({
    message: "Live request log - refresh to see new entries",
    totalRequests: serverStats.requestCount,
    recentRequests: serverStats.recentRequests,
    requestBreakdown: serverStats.requestBreakdown,
    note: "This endpoint itself will appear in the log when you refresh!"
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    server: process.env.JELLYFIN_SERVER,
    timestamp: new Date().toISOString(),
    version: require('./package.json').version
  });
});

// API Routes with stream tracking middleware
app.use('/api/stream', (req, res, next) => {
  // Track stream requests
  if (req.method === 'GET' && req.path.includes('/api/stream/') && req.path.length > 12) {
    serverStats.streamCount++;
    
    // Generate session data for tracking
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const streamInfo = {
      itemId: req.path.split('/')[3] || 'unknown',
      startTime: Date.now(),
      quality: req.query.quality || 'auto',
      bitrate: parseInt(req.query.videoBitrate) || 5000000,
      userAgent: req.get('User-Agent') || 'Unknown'
    };
    
    serverStats.activeStreams.set(sessionId, streamInfo);
    
    // Clean up old streams (older than 1 hour)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const [id, info] of serverStats.activeStreams.entries()) {
      if (info.startTime < oneHourAgo) {
        serverStats.activeStreams.delete(id);
      }
    }
  }
  next();
}, streamRoutes);

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
      testLibraries: 'GET /admin/test/libraries',
      testRecent: 'GET /admin/test/recent',
      testSearch: 'GET /admin/test/search?q=query',
      testSystem: 'GET /admin/test/system',
      testVideos: 'GET /admin/test/videos',
      testStream: 'GET /admin/test/stream/:itemId',
      libraries: 'GET /api/libraries',
      libraryItems: 'GET /api/libraries/:libraryId/items',
      stream: 'GET /api/stream/:itemId',
      itemDetails: 'GET /api/items/:itemId',
      search: 'GET /api/search?q=query',
      recent: 'GET /api/items/recent'
    },
    documentation: 'https://github.com/your-repo/jellyfin-resonite-api',
    transparency: 'Visit /admin/requests to see live request logging'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('API Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /health',
      'GET /admin.html',
      'GET /admin/stats',
      'GET /admin/requests',
      'GET /admin/test/libraries',
      'GET /admin/test/recent',
      'GET /admin/test/search',
      'GET /admin/test/system',
      'GET /admin/test/videos',
      'GET /admin/test/stream/:itemId',
      'GET /api/libraries',
      'GET /api/libraries/:libraryId/items',
      'GET /api/stream/:itemId',
      'GET /api/items/:itemId',
      'GET /api/search?q=query'
    ]
  });
});

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Start server
app.listen(PORT, () => {
  console.log(`🎬 Jellyfin-Resonite API Server started`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`📺 Jellyfin: ${process.env.JELLYFIN_SERVER}`);
  console.log(`🔒 Auth: Automatic (${process.env.JELLYFIN_USERNAME})`);
  console.log(`🌐 CORS: ${corsOptions.origin === true ? 'All origins' : corsOptions.origin}`);
  console.log(`📊 Admin Panel: http://localhost:${PORT}/admin.html`);
  console.log(`🔍 Request Log: http://localhost:${PORT}/admin/requests`);
  console.log(`🧪 API Tests: http://localhost:${PORT}/admin/test/libraries`);
  console.log(`🎥 Video Tests: http://localhost:${PORT}/admin/test/videos`);
  console.log(`\n📋 Ready for Resonite! Test with: http://localhost:${PORT}/health`);
  console.log(`\n🧾 All HTTP requests are logged with timestamps to prove data authenticity`);
});
