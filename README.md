# 🎬 Jellyfin-Resonite API Bridge

A professional API bridge that connects Jellyfin media server to Resonite VR, enabling seamless video streaming in virtual reality environments.

## ✨ Features

- **🎥 Video Streaming**: HLS and direct streaming with quality adaptation
- **📚 Library Management**: Browse movies, TV shows, and music libraries
- **🔍 Content Search**: Fast search across your entire media collection
- **📊 Admin Dashboard**: Professional monitoring and testing interface
- **🛡️ Secure Authentication**: Automatic Jellyfin authentication handling
- **🚀 Performance Optimized**: Built for VR streaming requirements
- **📱 Responsive UI**: Works on desktop, tablet, and mobile

## 🚀 Quick Start

### Prerequisites

- **Node.js** 16+ and npm
- **Jellyfin Server** 10.8+ running and accessible
- **Jellyfin API Key** or user credentials

### Installation

1. **Clone and install:**
   ```bash
   git clone <repository-url>
   cd jellyfin-resonite-api
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Jellyfin server details
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Access admin panel:**
   ```
   http://localhost:3001/admin.html
   ```

## ⚙️ Configuration

### Environment Variables

```env
# Jellyfin Server Configuration
JELLYFIN_SERVER=http://your-jellyfin-server:8096
JELLYFIN_USERNAME=your-username
JELLYFIN_PASSWORD=your-password

# API Server Configuration
PORT=3001
NODE_ENV=production

# Rate Limiting (requests per 15 minutes)
RATE_LIMIT_MAX=1000

# Optional: HTTPS Configuration (leave empty for HTTP)
SSL_CERT_PATH=
SSL_KEY_PATH=

# Optional: Allowed Origins (comma-separated, leave empty for all)
ALLOWED_ORIGINS=http://localhost:3000,https://your-app.com

# Cache Settings (in seconds)
AUTH_CACHE_DURATION=3600
LIBRARY_CACHE_DURATION=300
```

## 📡 API Documentation

### Base URL
```
http://localhost:3001/api
```

### Authentication
All API endpoints require valid Jellyfin authentication. The server handles authentication automatically using your configured credentials.

---

## 🎬 Streaming Endpoints

### Get Stream Information
```http
GET /api/stream/:itemId
```

**Parameters:**
- `itemId` (string): Jellyfin item ID
- `quality` (string): `auto`, `high`, `medium`, `low`
- `format` (string): `hls`, `direct`, or omit for metadata

**Response:**
```json
{
  "streamUrl": "http://...",
  "hlsUrl": "http://...",
  "directUrl": "http://...",
  "directPlay": true,
  "transcodeReasons": [],
  "item": {
    "id": "485038f1...",
    "name": "Movie Title",
    "duration": 7200,
    "type": "Movie",
    "year": 2024
  },
  "video": {
    "codec": "hevc",
    "width": 3840,
    "height": 2160,
    "bitrate": 15000000,
    "fps": 23.976
  },
  "audio": {
    "codec": "aac",
    "channels": 6,
    "bitrate": 320000
  }
}
```

### HLS Streaming
```http
GET /api/stream/:itemId?format=hls
```
Returns actual HLS manifest (.m3u8) for video players.

### Direct Streaming  
```http
GET /api/stream/:itemId?format=direct
```
Redirects to direct video stream.

### Progress Reporting
```http
POST /api/stream/:itemId/progress
```

**Body:**
```json
{
  "position": 120.5,
  "isPaused": false,
  "playSessionId": "session-id"
}
```

---

## 📚 Library Endpoints

### Get Libraries
```http
GET /api/libraries
```

**Response:**
```json
{
  "libraries": [
    {
      "id": "library-id",
      "name": "Movies",
      "type": "movies",
      "itemCount": 150
    }
  ]
}
```

### Get Library Items
```http
GET /api/libraries/:libraryId/items
```

**Parameters:**
- `limit` (number): Items per page (default: 50)
- `offset` (number): Pagination offset (default: 0)
- `sortBy` (string): `Name`, `DateCreated`, `DatePlayed`, etc.
- `sortOrder` (string): `Ascending`, `Descending`

**Response:**
```json
{
  "items": [
    {
      "id": "item-id",
      "name": "Content Title",
      "type": "Movie",
      "year": 2024,
      "overview": "Description...",
      "duration": 7200,
      "genres": ["Action", "Adventure"],
      "thumbnail": "http://...",
      "backdrop": "http://..."
    }
  ],
  "totalCount": 150,
  "hasMore": true
}
```

---

## 🔍 Search Endpoints

### Search Content
```http
GET /api/search?q=query
```

**Parameters:**
- `q` (string): Search query
- `limit` (number): Results limit (default: 20)
- `types` (string): `Movie,Series,Episode` (default: all)

**Response:**
```json
{
  "results": [
    {
      "id": "item-id",
      "name": "Search Result",
      "type": "Movie",
      "year": 2024,
      "relevance": 0.95
    }
  ],
  "totalCount": 25
}
```

---

## 🎬 Movies Endpoints

### Get Movies
```http
GET /api/movies
```

**Parameters:**
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 20)
- `sortBy` (string): `Name`, `DateCreated`, `DatePlayed`, `ProductionYear`, etc.
- `sortOrder` (string): `Ascending`, `Descending`
- `genres` (string): Filter by genres (comma-separated)
- `years` (string): Filter by years (comma-separated)
- `minRating` (number): Minimum community rating
- `maxRating` (number): Maximum community rating
- `includeWatched` (boolean): Include watched movies (default: true)

**Response:**
```json
{
  "movies": [
    {
      "id": "item-id",
      "name": "Movie Title",
      "type": "Movie",
      "year": 2024,
      "overview": "Movie description...",
      "genres": ["Action", "Adventure"],
      "duration": 7200,
      "durationFormatted": "2h 0m",
      "thumbnail": "http://...",
      "backdrop": "http://...",
      "logo": "http://...",
      "rating": 8.5,
      "criticRating": 85,
      "hasVideo": true,
      "isWatched": false,
      "playCount": 0,
      "resolution": "1080p",
      "codec": "H264",
      "bitrate": "15.0 Mbps",
      "fps": 23.976,
      "audioCodec": "AAC",
      "audioChannels": 6,
      "container": "MKV",
      "fileSize": 2147483648,
      "fileSizeFormatted": "2.0 GB"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 10,
    "totalCount": 200,
    "limit": 20,
    "hasNextPage": true,
    "hasPrevPage": false,
    "nextPage": 2,
    "prevPage": null
  },
  "filters": {
    "sortBy": "Name",
    "sortOrder": "Ascending",
    "genres": null,
    "years": null,
    "minRating": null,
    "maxRating": null,
    "includeWatched": true
  }
}
```

### Get TV Series
```http
GET /api/movies/series
```

**Parameters:** Same as movies endpoint

**Response:**
```json
{
  "series": [
    {
      "id": "series-id",
      "name": "TV Series Title",
      "type": "Series",
      "year": 2024,
      "overview": "Series description...",
      "genres": ["Drama", "Crime"],
      "episodeCount": 24,
      "seasonCount": 3,
      "thumbnail": "http://...",
      "backdrop": "http://...",
      "rating": 9.2,
      "criticRating": 92,
      "isWatched": false,
      "playCount": 0,
      "dateCreated": "2024-01-15T00:00:00Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalCount": 95,
    "limit": 20,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

### Get Recent Movies/Series
```http
GET /api/movies/recent
```

**Parameters:**
- `limit` (number): Number of items (default: 20)
- `type` (string): `Movie` or `Series` (default: Movie)

**Response:**
```json
{
  "items": [
    {
      "id": "item-id",
      "name": "Recent Movie",
      "type": "Movie",
      "year": 2024,
      "overview": "Description...",
      "genres": ["Action"],
      "duration": 7200,
      "durationFormatted": "2h 0m",
      "thumbnail": "http://...",
      "backdrop": "http://...",
      "rating": 8.1,
      "isWatched": false,
      "dateCreated": "2024-01-20T00:00:00Z",
      "resolution": "4K",
      "codec": "HEVC",
      "bitrate": "25.0 Mbps"
    }
  ],
  "type": "Movie",
  "limit": 20,
  "totalCount": 20
}
```

---

## 📄 Item Endpoints

### Get Item Details
```http
GET /api/items/:itemId
```

**Response:**
```json
{
  "item": {
    "id": "item-id",
    "name": "Content Title",
    "overview": "Full description...",
    "type": "Movie",
    "year": 2024,
    "duration": 7200,
    "genres": ["Action"],
    "people": [
      {
        "name": "Actor Name",
        "role": "Character",
        "type": "Actor"
      }
    ],
    "images": {
      "primary": "http://...",
      "backdrop": "http://...",
      "logo": "http://..."
    }
  }
}
```

### Get Recent Items
```http
GET /api/items/recent
```

**Parameters:**
- `limit` (number): Number of items (default: 20)
- `types` (string): Content types to include

---

## 🛠️ Admin Endpoints

### Server Statistics
```http
GET /admin/stats
```

**Response:**
```json
{
  "server": {
    "uptime": 3600000,
    "uptimeFormatted": "1h 0m",
    "requestCount": 1250,
    "requestsPerHour": 500
  },
  "streaming": {
    "totalStreams": 45,
    "activeStreams": 3,
    "totalBandwidth": 50000000,
    "bandwidthFormatted": "50.0 MB"
  },
  "jellyfin": {
    "connected": true,
    "server": "http://jellyfin:8096",
    "version": "10.8.10"
  }
}
```

### Admin Test Endpoints

#### Test Libraries
```http
GET /admin/test/libraries
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "library-id",
      "name": "Movies",
      "type": "movies",
      "itemCount": 150
    }
  ],
  "count": 1,
  "endpoint": "/api/libraries"
}
```

#### Test Recent Items
```http
GET /admin/test/recent
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "item-id",
      "name": "Recent Movie",
      "type": "Movie",
      "year": 2024,
      "dateAdded": "2024-01-20T00:00:00Z"
    }
  ],
  "count": 10,
  "endpoint": "/api/items/recent"
}
```

#### Test Search Functionality
```http
GET /admin/test/search?q=query
```

**Parameters:**
- `q` (string): Search query (default: "a")

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "item-id",
      "name": "Search Result",
      "type": "Movie",
      "year": 2024
    }
  ],
  "count": 5,
  "query": "query",
  "endpoint": "/api/search?q=query"
}
```

#### Test System Information
```http
GET /admin/test/system
```

**Response:**
```json
{
  "success": true,
  "data": {
    "serverName": "My Jellyfin Server",
    "version": "10.8.10",
    "operatingSystem": "Linux",
    "architecture": "X64",
    "runtime": 8096
  },
  "endpoint": "/System/Info"
}
```

#### Get Streamable Videos
```http
GET /admin/test/videos
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "video-id",
      "name": "Movie Title",
      "type": "Movie",
      "year": 2024,
      "overview": "Description...",
      "duration": 7200,
      "thumbnail": "http://...",
      "resolution": 1080,
      "codec": "H264",
      "seriesName": null,
      "seasonNumber": null,
      "episodeNumber": null
    }
  ],
  "count": 20,
  "endpoint": "/admin/test/videos"
}
```

#### Test Stream Generation
```http
GET /admin/test/stream/:itemId
```

**Response:**
```json
{
  "success": true,
  "data": {
    "streamUrl": "http://localhost:3001/api/stream/item-id?quality=auto",
    "itemId": "item-id",
    "name": "Movie Title",
    "type": "Movie",
    "duration": 7200,
    "resolution": 1080,
    "codec": "H264",
    "bitrate": 5000000,
    "hlsUrl": "http://localhost:3001/api/stream/item-id?quality=auto&format=hls",
    "directUrl": "http://localhost:3001/api/stream/item-id?quality=auto"
  },
  "endpoint": "/api/stream/item-id"
}
```

### Transparency & Request Logging
```http
GET /admin/requests
```

**Response:**
```json
{
  "message": "Live request log - refresh to see new entries",
  "totalRequests": 1250,
  "recentRequests": [
    {
      "method": "GET",
      "url": "/admin/stats",
      "path": "/admin/stats",
      "userAgent": "Mozilla/5.0...",
      "ip": "127.0.0.1",
      "timestamp": "2024-01-20T12:30:15.123Z",
      "duration": 45,
      "statusCode": 200
    }
  ],
  "requestBreakdown": {
    "GET /admin.html": 15,
    "GET /admin.css": 15,
    "GET /admin.js": 15,
    "GET /admin/stats": 245,
    "API requests": 850,
    "Other": 110
  },
  "note": "This endpoint itself will appear in the log when you refresh!"
}
```


## 📊 Admin Dashboard Features

### Real-time Monitoring
- **Server Uptime** and performance metrics with formatted display
- **Active Streams** with bandwidth usage and session tracking
- **API Performance** with response times and endpoint statistics
- **Jellyfin Status** and connection health with version info
- **Request Breakdown** showing transparent request categorization
- **Live Request Log** with timestamp, duration, and status codes

### Testing Suite
- **Library Access Testing** with real data validation
- **Recent Items Testing** to verify content retrieval
- **Search Functionality Testing** with configurable queries
- **System Information Testing** for Jellyfin connectivity
- **Video Content Discovery** with metadata and streaming info
- **Stream Generation Testing** with HLS and direct URLs

### Video Stream Testing
- **Browse Video Library** with rich metadata display
- **Test HLS Streaming** with real-time playback validation
- **Technical Details View** (codec, resolution, bitrate, container)
- **Stream Performance Monitoring** with error tracking
- **Multi-quality Testing** (auto, high, medium, low)

### Transparency Features
- **Complete Request Logging** - Every HTTP request is tracked and timestamized
- **Request Breakdown Analytics** - Shows exactly where traffic is coming from
- **Real-time Statistics** - All metrics update live every 5 seconds
- **Bandwidth Monitoring** - Track streaming usage and active sessions
- **Error Transparency** - Full error details and debugging information

---

## 🚨 Error Handling

### Common HTTP Status Codes
- `200` - Success
- `400` - Bad Request (invalid parameters)
- `401` - Unauthorized (authentication failed)
- `404` - Not Found (item/endpoint doesn't exist)
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

### Error Response Format
```json
{
  "error": "Error description",
  "details": "Additional error information",
  "code": "ERROR_CODE"
}
```

---

## 🔧 Development

### Running in Development
```bash
npm run dev
```

### Testing
```bash
npm test
```

### Building for Production
```bash
npm run build
```
```javascript
http://localhost:3001/api/search?types=Movie&limit=1000
```

### Docker Deployment
```bash
docker build -t jellyfin-resonite-api .
docker run -p 3001:3001 --env-file .env jellyfin-resonite-api
```

---

## 📈 Performance Optimization

### Streaming Recommendations
- **Direct Play**: Best quality, no server load
- **Direct Stream**: Good quality, minimal server load  
- **Transcode**: Quality options, higher server load

### Caching Strategy
- Library metadata cached for 5 minutes
- Search results cached for 2 minutes
- Authentication tokens auto-refreshed

### Rate Limiting
- Default: 1000 requests per 15 minutes
- Configurable via `RATE_LIMIT_MAX` environment variable

---

## 🛡️ Security

### Best Practices
- **Always use HTTPS** in production
- **Restrict CORS origins** via `ALLOWED_ORIGINS`
- **Use strong Jellyfin passwords**
- **Keep API server internal** when possible

### Authentication Flow
1. Server authenticates with Jellyfin on startup
2. Authentication tokens auto-refresh
3. All client requests use server's authentication
4. No client-side credential exposure

---

## 🐛 Troubleshooting

### Common Issues

**Connection Failed**
```bash
# Check Jellyfin server accessibility
curl http://your-jellyfin-server:8096/health

# Verify credentials in .env file
# Check firewall/network settings
```

**HLS Streaming Issues**
```bash
# Test HLS manifest directly
curl "http://localhost:3001/api/stream/ITEM_ID?format=hls"

# Check transcoding capabilities
# Verify browser HLS support
```

**High CPU Usage**
```bash
# Check active transcoding sessions
# Reduce concurrent streams
# Use direct play when possible
```

### Debug Mode
```env
NODE_ENV=development
DEBUG=jellyfin-api:*
```

---

## 📝 Changelog

### v1.0.0 (Current)
- ✅ Complete API implementation
- ✅ HLS streaming support
- ✅ Professional admin dashboard
- ✅ Video testing with live playback
- ✅ Real-time monitoring
- ✅ Full documentation

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 🙏 Acknowledgments

- **Jellyfin Team** for the amazing media server
- **Resonite Community** for VR innovation
- **HLS.js** for video streaming capabilities

---

**Ready for Resonite!** 🎮✨

Your Jellyfin-Resonite API bridge is now complete with professional streaming capabilities, comprehensive monitoring, and full documentation. Perfect for building immersive VR media experiences!
