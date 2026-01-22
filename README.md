# Jellyfin-Resonite API Bridge

API bridge connecting Jellyfin media server to Resonite VR for video streaming in virtual reality.

## Features

- Video streaming with HLS and direct playback
- Library browsing and search
- Admin dashboard for monitoring
- Automatic Jellyfin authentication
- Docker support

## Requirements

- Node.js 16+
- Jellyfin Server 10.8+
- Jellyfin user credentials

## Installation

```bash
git clone <repository-url>
cd jellyfin-resonite-api
npm install
cp .env.example .env
# Edit .env with your Jellyfin details
npm start
```

Admin panel: `http://localhost:3001/admin.html`

## Configuration

```env
JELLYFIN_SERVER=http://your-jellyfin-server:8096
JELLYFIN_USERNAME=your-username
JELLYFIN_PASSWORD=your-password
PORT=3001
NODE_ENV=production
RATE_LIMIT_MAX=1000
ALLOWED_ORIGINS=
AUTH_CACHE_DURATION=3600
LIBRARY_CACHE_DURATION=300
```

## API Reference

Base URL: `http://localhost:3001/api`

### Streaming

**GET /api/stream/:itemId**

Query parameters:
- `quality`: `auto`, `high`, `medium`, `low`
- `format`: `hls`, `direct`, or omit for metadata

Response:
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

**POST /api/stream/:itemId/progress**

```json
{
  "position": 120.5,
  "isPaused": false,
  "playSessionId": "session-id"
}
```

### Libraries

**GET /api/libraries**

Returns list of media libraries.

**GET /api/libraries/:libraryId/items**

Query parameters:
- `limit`: Items per page (default: 50)
- `page`: Page number (default: 0)
- `sortBy`: `Name`, `DateCreated`, `DatePlayed`, etc.
- `sortOrder`: `Ascending`, `Descending`
- `type`: `Movie,Episode,Video,Series`
- `genres`: Filter by genre
- `years`: Filter by year

### Search

**GET /api/search**

Query parameters:
- `q`: Search query (required)
- `limit`: Results limit (default: 20)
- `type`: `Movie,Series,Episode,Video`

**GET /api/search/suggestions?q=partial**

**GET /api/search/genre/:genreName**

**GET /api/search/genres**

### Movies

**GET /api/movies**

Query parameters:
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)
- `sortBy`: `Name`, `DateCreated`, `ProductionYear`, etc.
- `sortOrder`: `Ascending`, `Descending`
- `genres`: Filter by genres
- `years`: Filter by years
- `minRating`, `maxRating`: Rating filters
- `includeWatched`: Include watched items (default: true)

**GET /api/movies/series**

Same parameters as movies endpoint.

**GET /api/movies/recent**

Query parameters:
- `limit`: Number of items (default: 20)
- `type`: `Movie` or `Series`

### Items

**GET /api/items/:itemId**

Returns detailed item information including cast, chapters, and similar items.

**GET /api/items/recent**

**GET /api/items/resume**

**GET /api/items/nextup**

### Admin

**GET /admin/stats** - Server statistics

**GET /admin/requests** - Request log

**GET /admin/test/libraries** - Test library access

**GET /admin/test/recent** - Test recent items

**GET /admin/test/search** - Test search

**GET /admin/test/system** - Test Jellyfin connection

**GET /admin/test/videos** - List streamable videos

**GET /admin/test/stream/:itemId** - Test stream URL generation

## Error Responses

```json
{
  "error": "Error description",
  "details": "Additional information"
}
```

Status codes:
- 200: Success
- 400: Bad request
- 401: Unauthorized
- 404: Not found
- 429: Rate limited
- 500: Server error

## Docker

```bash
docker build -t jellyfin-resonite-api .
docker run -p 3001:3001 --env-file .env jellyfin-resonite-api
```

Or with docker-compose:

```bash
docker-compose up -d
```

## Development

```bash
npm run dev
```

## License

GPL-3.0
