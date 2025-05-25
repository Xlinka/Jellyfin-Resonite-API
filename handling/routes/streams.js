const express = require('express');
const { getAuthenticatedAxios, getAuthData, ensureAuth } = require('../../entry/middleware/auth');
const router = express.Router();

/**
 * Get stream URL for a video item
 * GET /api/stream/:itemId
 */
router.get('/:itemId', ensureAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const {
      maxWidth = 1920,
      maxHeight = 1080,
      videoBitrate = 5000000,
      audioCodec = 'aac',
      videoCodec = 'h264',
      container = 'ts',
      audioChannels = 2,
      quality = 'auto', // auto, high, medium, low
      format // hls, direct, or undefined for metadata
    } = req.query;

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    // Get item details first
    const itemResponse = await axios.get(`/Users/${auth.userId}/Items/${itemId}`);
    const item = itemResponse.data;

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Get playback info to determine best streaming method
    const playbackInfo = await axios.post(`/Items/${itemId}/PlaybackInfo`, {
      UserId: auth.userId,
      MaxStreamingBitrate: parseInt(videoBitrate),
      MaxStaticBitrate: parseInt(videoBitrate),
      MusicStreamingTranscodingBitrate: 192000,
      DirectPlayProfiles: [
        {
          Container: 'mp4,m4v,mkv,avi,mov,wmv,asf,webm',
          AudioCodec: 'aac,mp3,ac3,eac3,flac,alac,vorbis,opus',
          VideoCodec: 'h264,hevc,vp8,vp9,av1',
          Type: 'Video'
        }
      ],
      TranscodingProfiles: [
        {
          Container: container,
          Type: 'Video',
          AudioCodec: audioCodec,
          VideoCodec: videoCodec,
          Context: 'Streaming',
          MaxAudioChannels: parseInt(audioChannels)
        }
      ]
    });

    const mediaSource = playbackInfo.data.MediaSources?.[0];
    if (!mediaSource) {
      return res.status(400).json({ error: 'No media source available' });
    }

    let streamUrl;
    let hlsUrl;
    let directUrl;
    let isDirectPlay = false;
    let transcodeReasons = [];

    // Determine streaming method
    if (mediaSource.SupportsDirectPlay && quality === 'auto') {
      // Direct play - best quality, no transcoding
      directUrl = `${process.env.JELLYFIN_SERVER}/Videos/${itemId}/stream?static=true&api_key=${auth.token}`;
      hlsUrl = `${process.env.JELLYFIN_SERVER}/Videos/${itemId}/master.m3u8?api_key=${auth.token}`;
      streamUrl = directUrl;
      isDirectPlay = true;
    } else if (mediaSource.SupportsDirectStream) {
      // Direct stream - remux container only
      directUrl = `${process.env.JELLYFIN_SERVER}/Videos/${itemId}/stream?` +
        `Container=${container}&api_key=${auth.token}`;
      hlsUrl = `${process.env.JELLYFIN_SERVER}/Videos/${itemId}/master.m3u8?Container=${container}&api_key=${auth.token}`;
      streamUrl = directUrl;
      transcodeReasons.push('Container remux');
    } else {
      // Full transcode required
      const transcodeParams = new URLSearchParams({
        VideoCodec: videoCodec,
        AudioCodec: audioCodec,
        Container: container,
        MaxWidth: maxWidth,
        MaxHeight: maxHeight,
        VideoBitrate: videoBitrate,
        AudioChannels: audioChannels,
        api_key: auth.token
      });

      // Adjust quality preset
      switch (quality) {
        case 'low':
          transcodeParams.set('MaxWidth', '720');
          transcodeParams.set('MaxHeight', '480');
          transcodeParams.set('VideoBitrate', '1000000');
          break;
        case 'medium':
          transcodeParams.set('MaxWidth', '1280');
          transcodeParams.set('MaxHeight', '720');
          transcodeParams.set('VideoBitrate', '2500000');
          break;
        case 'high':
          transcodeParams.set('MaxWidth', '1920');
          transcodeParams.set('MaxHeight', '1080');
          transcodeParams.set('VideoBitrate', '8000000');
          break;
      }

      hlsUrl = `${process.env.JELLYFIN_SERVER}/Videos/${itemId}/master.m3u8?${transcodeParams.toString()}`;
      directUrl = `${process.env.JELLYFIN_SERVER}/Videos/${itemId}/stream?${transcodeParams.toString()}`;
      streamUrl = hlsUrl;
      transcodeReasons = mediaSource.TranscodingInfo?.TranscodeReasons || ['Full transcode required'];
    }

    // If HLS format is requested, proxy the actual HLS manifest
    if (format === 'hls') {
      try {
        const hlsResponse = await axios.get(hlsUrl, {
          responseType: 'text',
          timeout: 10000
        });
        
        // Set appropriate headers for HLS
        res.set({
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Range'
        });
        
        return res.send(hlsResponse.data);
      } catch (hlsError) {
        console.error('HLS streaming error:', hlsError.message);
        return res.status(500).json({ 
          error: 'Failed to fetch HLS manifest',
          details: hlsError.message,
          fallbackUrl: directUrl
        });
      }
    }

    // If direct format is requested, redirect to the direct stream
    if (format === 'direct') {
      return res.redirect(directUrl);
    }

    // Default: return metadata JSON
    const videoStream = mediaSource.MediaStreams?.find(s => s.Type === 'Video');
    const audioStream = mediaSource.MediaStreams?.find(s => s.Type === 'Audio');
    const subtitleStreams = mediaSource.MediaStreams?.filter(s => s.Type === 'Subtitle') || [];

    const response = {
      streamUrl,
      hlsUrl,
      directUrl,
      directPlay: isDirectPlay,
      transcodeReasons,
      item: {
        id: item.Id,
        name: item.Name,
        duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000000) : 0,
        overview: item.Overview || '',
        type: item.Type,
        year: item.ProductionYear,
        genres: item.Genres || []
      },
      video: {
        codec: videoStream?.Codec || 'unknown',
        profile: videoStream?.Profile,
        level: videoStream?.Level,
        width: videoStream?.Width || 0,
        height: videoStream?.Height || 0,
        bitrate: videoStream?.BitRate || 0,
        fps: videoStream?.RealFrameRate || videoStream?.AverageFrameRate || 0,
        aspectRatio: videoStream?.AspectRatio,
        colorSpace: videoStream?.ColorSpace,
        colorRange: videoStream?.ColorRange
      },
      audio: {
        codec: audioStream?.Codec || 'unknown',
        profile: audioStream?.Profile,
        channels: audioStream?.Channels || 0,
        sampleRate: audioStream?.SampleRate || 0,
        bitrate: audioStream?.BitRate || 0,
        language: audioStream?.Language || 'unknown',
        title: audioStream?.Title
      },
      subtitles: subtitleStreams.map(sub => ({
        index: sub.Index,
        language: sub.Language || 'unknown',
        title: sub.Title || sub.DisplayTitle,
        codec: sub.Codec,
        isDefault: sub.IsDefault,
        isForced: sub.IsForced,
        downloadUrl: sub.DeliveryUrl ? 
          `${process.env.JELLYFIN_SERVER}${sub.DeliveryUrl}` : 
          `${process.env.JELLYFIN_SERVER}/Videos/${itemId}/${mediaSource.Id}/Subtitles/${sub.Index}/Stream.${sub.Codec}?api_key=${auth.token}`
      })),
      mediaSource: {
        id: mediaSource.Id,
        container: mediaSource.Container,
        size: mediaSource.Size,
        bitrate: mediaSource.Bitrate,
        supportsDirectPlay: mediaSource.SupportsDirectPlay,
        supportsDirectStream: mediaSource.SupportsDirectStream,
        supportsTranscoding: mediaSource.SupportsTranscoding
      },
      playbackInfo: {
        playSessionId: playbackInfo.data.PlaySessionId,
        userId: auth.userId,
        itemId: itemId
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Stream error:', error.message);
    
    if (error.response?.status === 404) {
      res.status(404).json({ error: 'Video not found' });
    } else {
      res.status(500).json({ 
        error: 'Failed to get stream',
        details: error.response?.data?.message || error.message
      });
    }
  }
});

/**
 * Proxy HLS segments from Jellyfin
 * GET /api/stream/:itemId/segments/*
 */
router.get('/:itemId/segments/*', ensureAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const segmentPath = req.params[0]; // Everything after /segments/
    
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();
    
    // Construct the full segment URL
    const segmentUrl = `${process.env.JELLYFIN_SERVER}/Videos/${itemId}/${segmentPath}?api_key=${auth.token}`;
    
    // Proxy the segment
    const segmentResponse = await axios.get(segmentUrl, {
      responseType: 'stream',
      timeout: 30000
    });
    
    // Copy headers
    res.set({
      'Content-Type': segmentResponse.headers['content-type'] || 'video/mp2t',
      'Content-Length': segmentResponse.headers['content-length'],
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*'
    });
    
    // Pipe the response
    segmentResponse.data.pipe(res);
    
  } catch (error) {
    console.error('Segment proxy error:', error.message);
    res.status(500).json({ 
      error: 'Failed to proxy segment',
      details: error.message
    });
  }
});

/**
 * Report playback progress
 * POST /api/stream/:itemId/progress
 */
router.post('/:itemId/progress', ensureAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { 
      position, 
      isPaused = false, 
      playMethod = 'Transcode',
      playSessionId 
    } = req.body;

    if (typeof position !== 'number' || position < 0) {
      return res.status(400).json({ error: 'Invalid position value' });
    }

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const progressData = {
      ItemId: itemId,
      PositionTicks: Math.round(position * 10000000), // Convert seconds to ticks
      IsPaused: isPaused,
      PlayMethod: playMethod
    };

    if (playSessionId) {
      progressData.PlaySessionId = playSessionId;
    }

    await axios.post('/Sessions/Playing/Progress', progressData);

    res.json({ 
      success: true,
      position: position,
      isPaused: isPaused 
    });

  } catch (error) {
    console.error('Progress report error:', error.message);
    // Don't fail the request if progress reporting fails
    res.json({ 
      success: false, 
      error: 'Progress report failed',
      details: error.response?.data?.message || error.message
    });
  }
});

/**
 * Report playback start
 * POST /api/stream/:itemId/start
 */
router.post('/:itemId/start', ensureAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { playSessionId, audioStreamIndex, subtitleStreamIndex } = req.body;

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const startData = {
      ItemId: itemId,
      PlaySessionId: playSessionId,
      MediaSourceId: itemId,
      AudioStreamIndex: audioStreamIndex,
      SubtitleStreamIndex: subtitleStreamIndex
    };

    await axios.post('/Sessions/Playing', startData);

    res.json({ success: true });

  } catch (error) {
    console.error('Playback start error:', error.message);
    res.json({ 
      success: false, 
      error: 'Failed to report playback start',
      details: error.response?.data?.message || error.message
    });
  }
});

/**
 * Report playback stop
 * POST /api/stream/:itemId/stop
 */
router.post('/:itemId/stop', ensureAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { position, playSessionId } = req.body;

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const stopData = {
      ItemId: itemId,
      PositionTicks: position ? Math.round(position * 10000000) : 0,
      PlaySessionId: playSessionId
    };

    await axios.post('/Sessions/Playing/Stopped', stopData);

    res.json({ success: true });

  } catch (error) {
    console.error('Playback stop error:', error.message);
    res.json({ 
      success: false, 
      error: 'Failed to report playback stop',
      details: error.response?.data?.message || error.message
    });
  }
});

module.exports = router;
