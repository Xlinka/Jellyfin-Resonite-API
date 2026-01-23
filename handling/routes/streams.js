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
      container: requestedContainer,
      audioChannels = 2,
      quality = 'auto',
      format,
      client
    } = req.query;
    const isBrowserClient = client === 'browser';
    const container = requestedContainer || (isBrowserClient ? 'mp4' : 'ts');

    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const itemResponse = await axios.get(`/Users/${auth.userId}/Items/${itemId}`);
    const item = itemResponse.data;

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const directPlayProfiles = isBrowserClient
      ? [{
          Container: 'mp4,webm',
          AudioCodec: 'aac,mp3,opus,vorbis',
          VideoCodec: 'h264,vp9,av1',
          Type: 'Video'
        }]
      : [{
          Container: 'mp4,m4v,mkv,avi,mov,wmv,asf,webm',
          AudioCodec: 'aac,mp3,ac3,eac3,flac,alac,vorbis,opus',
          VideoCodec: 'h264,hevc,vp8,vp9,av1',
          Type: 'Video'
        }];

    const playbackInfo = await axios.post(`/Items/${itemId}/PlaybackInfo`, {
      UserId: auth.userId,
      MaxStreamingBitrate: parseInt(videoBitrate),
      MaxStaticBitrate: parseInt(videoBitrate),
      MusicStreamingTranscodingBitrate: 192000,
      DirectPlayProfiles: directPlayProfiles,
      TranscodingProfiles: [{
        Container: container,
        Type: 'Video',
        AudioCodec: audioCodec,
        VideoCodec: videoCodec,
        Context: 'Streaming',
        MaxAudioChannels: parseInt(audioChannels)
      }]
    });

    const mediaSource = playbackInfo.data.MediaSources?.[0];
    if (!mediaSource) {
      return res.status(400).json({ error: 'No media source available' });
    }
    const playSessionId = playbackInfo.data.PlaySessionId;
    const mediaSourceId = mediaSource.Id;

    let streamUrl, hlsUrl, directUrl;
    let isDirectPlay = false;
    let transcodeReasons = [];
    const videoStreamInfo = mediaSource.MediaStreams?.find(s => s.Type === 'Video');
    const audioStreamInfo = mediaSource.MediaStreams?.find(s => s.Type === 'Audio');
    const browserPlayable = !isBrowserClient ? true : (() => {
      const containerName = (mediaSource.Container || '').toLowerCase();
      const videoCodecName = (videoStreamInfo?.Codec || '').toLowerCase();
      const audioCodecName = (audioStreamInfo?.Codec || 'aac').toLowerCase();
      const allowedContainers = new Set(['mp4', 'webm']);
      const allowedVideoCodecs = new Set(['h264', 'vp9', 'av1']);
      const allowedAudioCodecs = new Set(['aac', 'mp3', 'opus', 'vorbis']);
      return allowedContainers.has(containerName) &&
        allowedVideoCodecs.has(videoCodecName) &&
        allowedAudioCodecs.has(audioCodecName);
    })();
    const shouldForceTranscode = (isBrowserClient && !browserPlayable) || quality !== 'auto';

    const baseParams = {
      UserId: auth.userId,
      DeviceId: 'jellyfin-resonite-api',
      api_key: auth.token,
      PlaySessionId: playSessionId,
      MediaSourceId: mediaSourceId
    };

    if (mediaSource.SupportsDirectPlay && quality === 'auto' && !shouldForceTranscode) {
      const directParams = new URLSearchParams({ ...baseParams, Static: 'true' });
      directUrl = `${process.env.JELLYFIN_SERVER}/Videos/${itemId}/stream?${directParams.toString()}`;
      hlsUrl = `${process.env.JELLYFIN_SERVER}/Videos/${itemId}/master.m3u8?${directParams.toString()}`;
      streamUrl = directUrl;
      isDirectPlay = true;
    } else if (mediaSource.SupportsDirectStream && !shouldForceTranscode) {
      const streamParams = new URLSearchParams({ ...baseParams, Container: container });
      directUrl = `${process.env.JELLYFIN_SERVER}/Videos/${itemId}/stream?${streamParams.toString()}`;
      hlsUrl = `${process.env.JELLYFIN_SERVER}/Videos/${itemId}/master.m3u8?${streamParams.toString()}`;
      streamUrl = directUrl;
      transcodeReasons.push('Container remux');
    } else {
      const transcodeParams = {
        ...baseParams,
        VideoCodec: videoCodec,
        AudioCodec: audioCodec,
        Container: container,
        MaxWidth: maxWidth,
        MaxHeight: maxHeight,
        VideoBitrate: videoBitrate,
        AudioChannels: audioChannels
      };

      switch (quality) {
        case 'low':
          transcodeParams.MaxWidth = '720';
          transcodeParams.MaxHeight = '480';
          transcodeParams.VideoBitrate = '1000000';
          break;
        case 'medium':
          transcodeParams.MaxWidth = '1280';
          transcodeParams.MaxHeight = '720';
          transcodeParams.VideoBitrate = '2500000';
          break;
        case 'high':
          transcodeParams.MaxWidth = '1920';
          transcodeParams.MaxHeight = '1080';
          transcodeParams.VideoBitrate = '8000000';
          break;
      }

      const paramString = new URLSearchParams(transcodeParams).toString();
      hlsUrl = `${process.env.JELLYFIN_SERVER}/Videos/${itemId}/master.m3u8?${paramString}`;
      directUrl = `${process.env.JELLYFIN_SERVER}/Videos/${itemId}/stream?${paramString}`;
      streamUrl = hlsUrl;
      transcodeReasons = mediaSource.TranscodingInfo?.TranscodeReasons || ['Full transcode required'];
      if (quality !== 'auto') {
        transcodeReasons = [...transcodeReasons, `Quality override: ${quality}`];
      }
    }

    if (format === 'hls') {
      console.log(`HLS requested for ${itemId}, redirecting to direct stream`);
      return res.redirect(directUrl);
    }

    if (format === 'direct') {
      const sessionId = `stream-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      const streamInfo = {
        itemId,
        itemName: item.Name,
        startTime: Date.now(),
        quality,
        bitrate: parseInt(videoBitrate),
        userAgent: req.get('User-Agent') || 'Unknown',
        clientIP: req.ip || req.socket?.remoteAddress,
        isDirectPlay,
        transcodeReasons,
        playSessionId,
        mediaSourceId
      };

      const stats = req.app.locals.serverStats;
      if (stats) {
        stats.streamCount++;
        stats.activeStreams.set(sessionId, streamInfo);
      }

      console.log(`Stream session ${sessionId} started for ${item.Name}`);

      // Set up cleanup BEFORE starting the stream
      const cleanup = () => {
        if (stats?.activeStreams.has(sessionId)) {
          const duration = Date.now() - streamInfo.startTime;
          console.log(`Stream session ${sessionId} ended after ${Math.round(duration / 1000)}s`);
          stats.activeStreams.delete(sessionId);
        }
      };

      req.on('close', cleanup);
      req.on('error', cleanup);

      try {
        const range = req.headers.range;
        const streamResponse = await axios.get(directUrl.replace(process.env.JELLYFIN_SERVER, ''), {
          responseType: 'stream',
          timeout: 0,
          headers: range ? { Range: range } : undefined,
          validateStatus: status => status >= 200 && status < 400
        });

        const responseHeaders = {
          'Content-Type': streamResponse.headers['content-type'] || 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Range',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range'
        };

        if (streamResponse.headers['content-length']) {
          responseHeaders['Content-Length'] = streamResponse.headers['content-length'];
        }
        if (streamResponse.headers['content-range']) {
          responseHeaders['Content-Range'] = streamResponse.headers['content-range'];
        }

        res.status(streamResponse.status).set(responseHeaders);

        const abortUpstream = () => {
          if (!streamResponse.data.destroyed) {
            streamResponse.data.destroy();
          }
        };

        req.on('aborted', abortUpstream);
        res.on('close', abortUpstream);

        let bytesTransferred = 0;
        streamResponse.data.on('data', (chunk) => {
          bytesTransferred += chunk.length;
          if (stats) {
            stats.totalBandwidth += chunk.length;
          }
          if (stats?.activeStreams.has(sessionId)) {
            streamInfo.bytesTransferred = bytesTransferred;
          }
        });

        // Handle stream errors
        streamResponse.data.on('error', (err) => {
          if (!res.headersSent) {
            console.error(`Stream error for ${itemId}:`, err.message);
          }
          cleanup();
        });

        streamResponse.data.pipe(res);
        return;

      } catch (streamError) {
        cleanup();
        console.error('Direct stream proxy error:', streamError.message);
        return res.status(500).json({
          error: 'Failed to proxy video stream',
          details: streamError.message
        });
      }
    }

    // Default: return metadata JSON
    const videoStream = mediaSource.MediaStreams?.find(s => s.Type === 'Video');
    const audioStream = mediaSource.MediaStreams?.find(s => s.Type === 'Audio');
    const subtitleStreams = mediaSource.MediaStreams?.filter(s => s.Type === 'Subtitle') || [];

    res.json({
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
        downloadUrl: sub.DeliveryUrl
          ? `${process.env.JELLYFIN_SERVER}${sub.DeliveryUrl}`
          : `${process.env.JELLYFIN_SERVER}/Videos/${itemId}/${mediaSource.Id}/Subtitles/${sub.Index}/Stream.${sub.Codec}?api_key=${auth.token}`
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
        itemId
      }
    });

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
    const segmentPath = req.params[0];

    const stats = req.app.locals.serverStats;
    const auth = await getAuthData();
    const axios = await getAuthenticatedAxios();

    const segmentResponse = await axios.get(`/Videos/${itemId}/${segmentPath}`, {
      params: { api_key: auth.token },
      responseType: 'stream',
      timeout: 30000
    });

    res.set({
      'Content-Type': segmentResponse.headers['content-type'] || 'video/mp2t',
      'Content-Length': segmentResponse.headers['content-length'],
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*'
    });

    segmentResponse.data.on('data', (chunk) => {
      if (stats) {
        stats.totalBandwidth += chunk.length;
      }
    });

    segmentResponse.data.on('error', (err) => {
      console.error(`Segment stream error for ${itemId}:`, err.message);
    });

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
    const { position, isPaused = false, playMethod = 'Transcode', playSessionId } = req.body;

    if (typeof position !== 'number' || position < 0) {
      return res.status(400).json({ error: 'Invalid position value' });
    }

    const axios = await getAuthenticatedAxios();

    const progressData = {
      ItemId: itemId,
      PositionTicks: Math.round(position * 10000000),
      IsPaused: isPaused,
      PlayMethod: playMethod
    };

    if (playSessionId) {
      progressData.PlaySessionId = playSessionId;
    }

    await axios.post('/Sessions/Playing/Progress', progressData);
    res.json({ success: true, position, isPaused });

  } catch (error) {
    console.error('Progress report error:', error.message);
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

    const axios = await getAuthenticatedAxios();

    await axios.post('/Sessions/Playing', {
      ItemId: itemId,
      PlaySessionId: playSessionId,
      MediaSourceId: itemId,
      AudioStreamIndex: audioStreamIndex,
      SubtitleStreamIndex: subtitleStreamIndex
    });

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

    const axios = await getAuthenticatedAxios();

    await axios.post('/Sessions/Playing/Stopped', {
      ItemId: itemId,
      PositionTicks: position ? Math.round(position * 10000000) : 0,
      PlaySessionId: playSessionId
    });

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
