// Admin Panel JavaScript
class AdminDashboard {
    constructor() {
        this.refreshInterval = null;
        this.isLoading = false;
        this.currentVideo = null;
        this.currentStreamMeta = null;
        this.activeStreams = [];
        this.videos = [];
        this.REFRESH_RATE = 10000; // 10 seconds
        this.init();
    }

    init() {
        this.showLoading();
        this.loadData();
        this.startAutoRefresh();
        window.addEventListener('beforeunload', () => this.stopAutoRefresh());
    }

    async loadData() {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            const response = await fetch('/admin/stats');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            this.updateUI(data);
            this.updateStatus('online');
        } catch (error) {
            console.error('Failed to load admin data:', error);
            this.updateStatus('offline');
        } finally {
            this.isLoading = false;
            this.hideLoading();
        }
    }

    updateUI(data) {
        this.updateElement('uptime', data.server.uptimeFormatted);
        this.updateElement('startTime', this.formatDate(data.server.startTime));
        this.updateElement('totalRequests', this.formatNumber(data.server.requestCount));
        this.updateElement('requestsPerHour', this.formatNumber(data.server.requestsPerHour));
        this.updateElement('apiVersion', data.server.version);
        this.updateElement('serverStart', this.formatDate(data.server.startTime));
        this.updateElement('activeStreams', data.streaming.activeStreams);
        this.updateElement('totalStreams', data.streaming.totalStreams);
        this.updateElement('bandwidth', data.streaming.bandwidthFormatted);
        this.updateJellyfinStatus(data.jellyfin);
        this.updateAPIStats(data.api);
        this.activeStreams = data.activeStreams || [];
        this.updateActiveStreams(this.activeStreams);
        this.updateCurrentVideoStats();
        this.updateElement('lastUpdated', this.formatTime(new Date()));
    }

    updateJellyfinStatus(jf) {
        const headerStatus = document.getElementById('jellyfinStatus');
        if (headerStatus) {
            const statusClass = jf.connected ? 'jellyfin-connected' : 'jellyfin-disconnected';
            headerStatus.className = `status-indicator ${statusClass}`;
            headerStatus.innerHTML = `<span class="status-dot"></span><span>Jellyfin: ${jf.connected ? 'Connected' : 'Disconnected'}</span>`;
        }

        this.updateElement('jellyfinConnected', jf.connected ? 'Connected' : 'Disconnected');
        this.updateElement('jellyfinVersion', jf.connected ? `v${jf.version}` : jf.error || 'Connection failed');
        this.updateElement('jellyfinServer', jf.server || 'Not configured');
        this.updateElement('jellyfinVersionSystem', jf.connected ? jf.version : 'N/A');
    }

    updateAPIStats(apiData) {
        const container = document.getElementById('apiStats');
        if (!container) return;

        container.innerHTML = Object.entries(apiData).map(([endpoint, stats]) => {
            const name = this.getEndpointName(endpoint);
            const color = this.getResponseTimeColor(stats.avgResponse || 0);
            return `
                <div class="api-stat-item">
                    <div class="api-stat-info">
                        <h4>${name}</h4>
                        <span>${endpoint}</span>
                    </div>
                    <div class="api-stat-values">
                        <div class="api-stat-count">${this.formatNumber(stats.count)}</div>
                        <div class="api-stat-response" style="color:${color}">${stats.avgResponse || 0}ms avg</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateActiveStreams(streams) {
        const container = document.getElementById('activeStreamsList');
        if (!container) return;

        if (!streams?.length) {
            container.innerHTML = '<div class="no-streams">No active streams</div>';
            return;
        }

        container.innerHTML = streams.map(stream => {
            const duration = this.formatDuration(Date.now() - stream.startTime);
            const transcodeSummary = this.formatTranscodeSummary(stream);
            return `
                <div class="stream-item">
                    <div class="stream-info">
                        <h4>Stream ${stream.sessionId.split('-')[1]}</h4>
                        <div class="stream-details">
                            <span>Duration: ${duration}</span>
                            <span>Bitrate: ${this.formatBitrate(stream.bitrate)}</span>
                            <span>Item: ${stream.itemId.substring(0, 8)}...</span>
                            <span>${transcodeSummary}</span>
                        </div>
                    </div>
                    <div class="stream-quality">${(stream.quality || 'auto').toUpperCase()}</div>
                </div>
            `;
        }).join('');
    }

    updateStatus(status) {
        const el = document.getElementById('status');
        if (el) {
            el.className = `status-indicator ${status}`;
            el.innerHTML = `<span class="status-dot"></span><span>${status.charAt(0).toUpperCase() + status.slice(1)}</span>`;
        }
    }

    updateElement(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    showLoading() {
        document.getElementById('loadingOverlay')?.classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('loadingOverlay')?.classList.add('hidden');
    }

    startAutoRefresh() {
        this.refreshInterval = setInterval(() => this.loadData(), this.REFRESH_RATE);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    // API Testing
    async testEndpoint(name) {
        const testEl = document.getElementById(`test-${name}`);
        const statusEl = testEl?.querySelector('.test-status');
        if (!statusEl) return;

        statusEl.className = 'test-status testing';
        statusEl.textContent = 'Testing...';
        testEl.querySelector('.test-data')?.remove();

        try {
            const response = await fetch(`/admin/test/${name}`);
            const data = await response.json();

            if (data.success) {
                statusEl.className = 'test-status success';
                statusEl.textContent = 'Success';
                const dataDiv = document.createElement('div');
                dataDiv.className = 'test-data';
                dataDiv.textContent = `Found ${data.count || 0} items`;
                testEl.appendChild(dataDiv);
                this.logTestResult(`[OK] ${name}: Success (${data.count || 0} items)`, 'success');
            } else {
                throw new Error(data.error || 'Test failed');
            }
        } catch (error) {
            statusEl.className = 'test-status error';
            statusEl.textContent = 'Error';
            const dataDiv = document.createElement('div');
            dataDiv.className = 'test-data';
            dataDiv.textContent = error.message;
            testEl.appendChild(dataDiv);
            this.logTestResult(`[FAIL] ${name}: ${error.message}`, 'error');
        }
    }

    // Video Testing
    async loadVideoList() {
        try {
            const response = await fetch('/admin/test/videos');
            const data = await response.json();
            if (data.success) {
                this.videos = data.data;
                this.displayVideoList();
                this.logTestResult(`[OK] Videos: Loaded ${data.count} videos`, 'success');
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            this.logTestResult(`[FAIL] Videos: ${error.message}`, 'error');
        }
    }

    displayVideoList() {
        const list = document.getElementById('videoList');
        if (!list) return;

        if (!this.videos.length) {
            list.innerHTML = '<p class="no-videos">No streamable videos found...</p>';
            return;
        }

        list.innerHTML = this.videos.map((v, i) => {
            const name = v.seriesName ? `${v.seriesName} - S${v.seasonNumber}E${v.episodeNumber} - ${v.name}` : v.name;
            return `
                <div class="video-item" data-index="${i}">
                    <div class="video-thumbnail">
                        ${v.thumbnail ? `<img src="${v.thumbnail}" alt="" onerror="this.parentElement.innerHTML='<div class=\\'video-placeholder\\'><i class=\\'fas fa-film\\'></i></div>'">` : '<div class="video-placeholder"><i class="fas fa-film"></i></div>'}
                    </div>
                    <div class="video-details">
                        <h5>${name}</h5>
                        <div class="video-meta">${v.type} | ${v.year || 'N/A'} | ${this.formatDuration(v.duration * 1000)}${v.resolution ? ` | ${v.resolution}p` : ''}</div>
                    </div>
                </div>
            `;
        }).join('');

        list.querySelectorAll('.video-item').forEach(item => {
            item.addEventListener('click', () => this.selectVideo(parseInt(item.dataset.index)));
        });
    }

    selectVideo(index) {
        document.querySelectorAll('.video-item').forEach(el => el.classList.remove('selected'));
        document.querySelector(`.video-item[data-index="${index}"]`)?.classList.add('selected');
        this.currentVideo = this.videos[index];
        this.playVideoWithQuality();
    }

    async playVideoWithQuality() {
        if (!this.currentVideo) return;
        const quality = document.getElementById('qualitySelect')?.value || 'auto';

        try {
            const response = await fetch(`/admin/test/stream/${this.currentVideo.id}?quality=${quality}`);
            const data = await response.json();
            if (data.success) {
                this.currentStreamMeta = data.data;
                this.playVideo(data.data);
                this.updateVideoInfo(data.data, this.getTranscodeInfoForItem(this.currentVideo.id));
                this.logTestResult(`[PLAY] ${this.currentVideo.name} - Quality: ${quality}`, 'success');
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            this.logTestResult(`[FAIL] Stream: ${error.message}`, 'error');
        }
    }

    playVideo() {
        const video = document.getElementById('videoPlayer');
        if (!video || !this.currentVideo) return;
        const quality = document.getElementById('qualitySelect')?.value || 'auto';
        video.src = `/api/stream/${this.currentVideo.id}?format=direct&quality=${quality}&client=browser`;
        video.load();
        video.play().catch(() => {});
        this.logTestResult(`[STREAM] Playing via ${quality === 'auto' ? 'direct' : 'transcoded'} stream`, 'info');
    }

    clearPlayer() {
        const video = document.getElementById('videoPlayer');
        if (video) {
            video.src = '';
            video.load();
        }
        this.updateVideoInfo(null);
        document.querySelectorAll('.video-item').forEach(el => el.classList.remove('selected'));
        this.currentVideo = null;
        this.currentStreamMeta = null;
        this.logTestResult('[STOP] Video player stopped', 'info');
    }

    updateVideoInfo(data, transcode) {
        const info = document.getElementById('videoInfo');
        if (!info) return;

        if (!data) {
            info.className = 'video-info';
            info.innerHTML = '<p>Select a video from the list to start testing stream playback...</p>';
            return;
        }

        const transcodeHtml = transcode ? this.renderTranscodeInfo(transcode) : '';
        info.className = 'video-info active';
        info.innerHTML = `
            <div class="info-item"><span class="info-label">Video:</span><span class="info-value">${data.name}</span></div>
            <div class="info-item"><span class="info-label">Type:</span><span class="info-value">${data.type}</span></div>
            <div class="info-item"><span class="info-label">Duration:</span><span class="info-value">${this.formatDuration(data.duration * 1000)}</span></div>
            <div class="info-item"><span class="info-label">Resolution:</span><span class="info-value">${data.resolution}p</span></div>
            <div class="info-item"><span class="info-label">Codec:</span><span class="info-value">${data.codec}</span></div>
            <div class="info-item"><span class="info-label">Bitrate:</span><span class="info-value">${this.formatBitrate(data.bitrate)}</span></div>
            ${transcodeHtml}
        `;
    }

    logTestResult(message, type = 'info') {
        const log = document.getElementById('testLog');
        if (!log) return;
        const entry = document.createElement('p');
        entry.className = type;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }

    // Utilities
    formatNumber(num) {
        if (typeof num !== 'number') return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }

    formatDate(dateString) {
        try {
            const d = new Date(dateString);
            return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
        } catch { return 'Invalid Date'; }
    }

    formatTime(date) {
        return date.toLocaleTimeString();
    }

    formatDuration(ms) {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        if (h > 0) return `${h}h ${m % 60}m`;
        if (m > 0) return `${m}m ${s % 60}s`;
        return `${s}s`;
    }

    formatBitrate(bitrate) {
        if (!bitrate) return 'Unknown';
        if (bitrate >= 1000000) return (bitrate / 1000000).toFixed(1) + ' Mbps';
        if (bitrate >= 1000) return Math.round(bitrate / 1000) + ' Kbps';
        return bitrate + ' bps';
    }

    formatTranscodeSummary(stream) {
        const transcode = stream?.transcoding;
        if (!transcode) {
            return stream?.isDirectPlay ? 'Direct play' : 'Direct stream';
        }
        const progress = transcode.completionPercent !== null && transcode.completionPercent !== undefined
            ? `${transcode.completionPercent}%`
            : 'Active';
        const size = transcode.width && transcode.height ? `${transcode.width}x${transcode.height}` : null;
        const codecs = [transcode.videoCodec, transcode.audioCodec].filter(Boolean).join('/');
        const bitrate = transcode.bitrate ? this.formatBitrate(transcode.bitrate) : null;
        const parts = [progress, size, codecs, bitrate].filter(Boolean);
        return `Transcode: ${parts.join(' | ')}`;
    }

    getTranscodeInfoForItem(itemId) {
        if (!itemId || !this.activeStreams?.length) return null;
        const stream = this.activeStreams.find(s => s.itemId === itemId);
        return stream?.transcoding || null;
    }

    updateCurrentVideoStats() {
        if (!this.currentVideo || !this.currentStreamMeta) return;
        const transcode = this.getTranscodeInfoForItem(this.currentVideo.id);
        this.updateVideoInfo(this.currentStreamMeta, transcode);
    }

    renderTranscodeInfo(transcode) {
        const progress = transcode.completionPercent !== null && transcode.completionPercent !== undefined
            ? `${transcode.completionPercent}%`
            : (transcode.isTranscoding ? 'Active' : 'Direct');
        const size = transcode.width && transcode.height ? `${transcode.width}x${transcode.height}` : 'Unknown';
        const codecs = [transcode.videoCodec, transcode.audioCodec].filter(Boolean).join('/');
        const bitrate = transcode.bitrate ? this.formatBitrate(transcode.bitrate) : 'Unknown';
        const framerate = transcode.framerate ? `${transcode.framerate} fps` : 'Unknown';
        const reasons = transcode.reasons?.length ? transcode.reasons.join(', ') : 'N/A';
        return `
            <div class="info-heading">Transcode</div>
            <div class="info-item"><span class="info-label">Progress:</span><span class="info-value">${progress}</span></div>
            <div class="info-item"><span class="info-label">Output:</span><span class="info-value">${size}${codecs ? ` ${codecs}` : ''}</span></div>
            <div class="info-item"><span class="info-label">Bitrate:</span><span class="info-value">${bitrate}</span></div>
            <div class="info-item"><span class="info-label">Framerate:</span><span class="info-value">${framerate}</span></div>
            <div class="info-item"><span class="info-label">Reasons:</span><span class="info-value">${reasons}</span></div>
        `;
    }

    getEndpointName(endpoint) {
        const names = {
            '/api/libraries': 'Libraries',
            '/api/stream': 'Streaming',
            '/api/search': 'Search',
            '/api/items': 'Items',
            '/admin/stats': 'Admin Stats'
        };
        return names[endpoint] || endpoint;
    }

    getResponseTimeColor(ms) {
        if (ms <= 100) return '#10b981';
        if (ms <= 500) return '#f59e0b';
        return '#ef4444';
    }
}

// Global functions
function refreshData() {
    if (!window.dashboard) return;
    const btn = document.querySelector('.refresh-btn i');
    if (btn) {
        btn.classList.add('fa-spin');
        setTimeout(() => btn.classList.remove('fa-spin'), 1000);
    }
    window.dashboard.loadData();
}

function testEndpoint(name) {
    window.dashboard?.testEndpoint(name);
}

async function testAllEndpoints() {
    if (!window.dashboard) return;
    const log = document.getElementById('testLog');
    if (log) log.innerHTML = '<p>Starting API tests...</p>';

    window.dashboard.logTestResult('Running all API tests...', 'info');
    for (const ep of ['libraries', 'recent', 'search', 'system', 'videos']) {
        await window.dashboard.testEndpoint(ep);
        await new Promise(r => setTimeout(r, 300));
    }
    window.dashboard.logTestResult('All tests completed!', 'info');
}

function loadVideoList() {
    window.dashboard?.loadVideoList();
}

function clearPlayer() {
    window.dashboard?.clearPlayer();
}

function changeVideoQuality() {
    if (window.dashboard?.currentVideo) {
        window.dashboard.playVideoWithQuality();
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new AdminDashboard();
});

// Pause updates when tab is hidden
document.addEventListener('visibilitychange', () => {
    if (!window.dashboard) return;
    if (document.hidden) {
        window.dashboard.stopAutoRefresh();
    } else {
        window.dashboard.startAutoRefresh();
        window.dashboard.loadData();
    }
});
