// Admin Panel JavaScript
class AdminDashboard {
    constructor() {
        this.refreshInterval = null;
        this.isLoading = false;
        this.currentVideo = null;
        this.hls = null;
        this.videos = [];
        this.init();
    }

    init() {
        this.showLoading();
        this.loadData();
        this.startAutoRefresh();
        
        // Event listeners
        window.addEventListener('beforeunload', () => {
            this.stopAutoRefresh();
        });
    }

    async loadData() {
        if (this.isLoading) return;
        
        this.isLoading = true;
        
        try {
            const response = await fetch('/admin/stats');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            this.updateUI(data);
            this.updateStatus('online');
            
        } catch (error) {
            console.error('Failed to load admin data:', error);
            this.updateStatus('offline');
            this.showError(error.message);
        } finally {
            this.isLoading = false;
            this.hideLoading();
        }
    }

    updateUI(data) {
        // Update server stats
        this.updateElement('uptime', data.server.uptimeFormatted);
        this.updateElement('startTime', this.formatDate(data.server.startTime));
        this.updateElement('totalRequests', this.formatNumber(data.server.requestCount));
        this.updateElement('requestsPerHour', this.formatNumber(data.server.requestsPerHour));
        this.updateElement('apiVersion', data.server.version);
        this.updateElement('serverStart', this.formatDate(data.server.startTime));

        // Update streaming stats
        this.updateElement('activeStreams', data.streaming.activeStreams);
        this.updateElement('totalStreams', data.streaming.totalStreams);
        this.updateElement('bandwidth', data.streaming.bandwidthFormatted);

        // Update Jellyfin status
        this.updateJellyfinStatus(data.jellyfin);

        // Update API performance stats
        this.updateAPIStats(data.api);

        // Update active streams list
        this.updateActiveStreams(data.activeStreams);

        // Update last updated time
        this.updateElement('lastUpdated', this.formatTime(new Date()));
    }

    updateJellyfinStatus(jellyfinData) {
        // Update header status indicator
        const headerStatus = document.getElementById('jellyfinStatus');
        if (headerStatus) {
            const statusClass = jellyfinData.connected ? 'jellyfin-connected' : 'jellyfin-disconnected';
            const statusText = jellyfinData.connected ? 'Connected' : 'Disconnected';
            
            headerStatus.className = `status-indicator ${statusClass}`;
            headerStatus.innerHTML = `
                <span class="status-dot"></span>
                <span>Jellyfin: ${statusText}</span>
            `;
        }

        // Update Jellyfin status card
        this.updateElement('jellyfinConnected', jellyfinData.connected ? 'Connected' : 'Disconnected');
        
        if (jellyfinData.connected) {
            this.updateElement('jellyfinVersion', `v${jellyfinData.version}`);
            this.updateElement('jellyfinServer', jellyfinData.server || 'Unknown');
            this.updateElement('jellyfinVersionSystem', jellyfinData.version || 'Unknown');
        } else {
            this.updateElement('jellyfinVersion', jellyfinData.error || 'Connection failed');
            this.updateElement('jellyfinServer', jellyfinData.server || 'Not configured');
            this.updateElement('jellyfinVersionSystem', 'N/A');
        }
    }

    updateAPIStats(apiData) {
        const container = document.getElementById('apiStats');
        if (!container) return;

        container.innerHTML = '';

        Object.entries(apiData).forEach(([endpoint, stats]) => {
            const item = document.createElement('div');
            item.className = 'api-stat-item';
            
            const endpointName = this.getEndpointName(endpoint);
            const responseTime = stats.avgResponse || 0;
            const responseColor = this.getResponseTimeColor(responseTime);
            
            item.innerHTML = `
                <div class="api-stat-info">
                    <h4>${endpointName}</h4>
                    <span>${endpoint}</span>
                </div>
                <div class="api-stat-values">
                    <div class="api-stat-count">${this.formatNumber(stats.count)}</div>
                    <div class="api-stat-response" style="color: ${responseColor}">
                        ${responseTime}ms avg
                    </div>
                </div>
            `;
            
            container.appendChild(item);
        });
    }

    updateActiveStreams(streams) {
        const container = document.getElementById('activeStreamsList');
        if (!container) return;

        if (!streams || streams.length === 0) {
            container.innerHTML = '<div class="no-streams">No active streams</div>';
            return;
        }

        container.innerHTML = '';

        streams.forEach(stream => {
            const item = document.createElement('div');
            item.className = 'stream-item';
            
            const duration = this.formatDuration(Date.now() - stream.startTime);
            const bitrate = this.formatBitrate(stream.bitrate);
            
            item.innerHTML = `
                <div class="stream-info">
                    <h4>Stream ${stream.sessionId.split('-')[1]}</h4>
                    <div class="stream-details">
                        <span>Duration: ${duration}</span>
                        <span>Bitrate: ${bitrate}</span>
                        <span>Item: ${stream.itemId.substring(0, 8)}...</span>
                    </div>
                </div>
                <div class="stream-quality">${stream.quality.toUpperCase()}</div>
            `;
            
            container.appendChild(item);
        });
    }

    updateStatus(status) {
        const statusElement = document.getElementById('status');
        if (!statusElement) return;

        statusElement.className = `status-indicator ${status}`;
        statusElement.innerHTML = `
            <span class="status-dot"></span>
            <span>${status.charAt(0).toUpperCase() + status.slice(1)}</span>
        `;
    }

    updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }

    showLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.remove('hidden');
        }
    }

    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }

    showError(message) {
        // Could implement a toast notification here
        console.error('Dashboard Error:', message);
    }

    startAutoRefresh() {
        this.refreshInterval = setInterval(() => {
            this.loadData();
        }, 5000); // Refresh every 5 seconds
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    // API Testing Functions
    async testEndpoint(endpointName) {
        const testElement = document.getElementById(`test-${endpointName}`);
        const statusElement = testElement.querySelector('.test-status');
        
        // Update status to testing
        statusElement.className = 'test-status testing';
        statusElement.textContent = 'Testing...';
        
        // Clear previous results
        const existingData = testElement.querySelector('.test-data');
        if (existingData) {
            existingData.remove();
        }

        try {
            const response = await fetch(`/admin/test/${endpointName}`);
            const data = await response.json();
            
            if (data.success) {
                statusElement.className = 'test-status success';
                statusElement.textContent = 'Success';
                
                // Add result data
                const dataDiv = document.createElement('div');
                dataDiv.className = 'test-data';
                dataDiv.innerHTML = `Found ${data.count || 0} items`;
                testElement.appendChild(dataDiv);
                
                this.logTestResult(`✓ ${endpointName}: Success (${data.count || 0} items)`, 'success');
                
                if (data.data && data.data.length > 0) {
                    this.logTestResult(`  Sample: ${data.data[0].name || 'Unknown'}`, 'info');
                }
            } else {
                throw new Error(data.error || 'Test failed');
            }
        } catch (error) {
            statusElement.className = 'test-status error';
            statusElement.textContent = 'Error';
            
            const dataDiv = document.createElement('div');
            dataDiv.className = 'test-data';
            dataDiv.innerHTML = error.message;
            testElement.appendChild(dataDiv);
            
            this.logTestResult(`✗ ${endpointName}: ${error.message}`, 'error');
        }
    }

    // Video Testing Functions
    async loadVideoList() {
        try {
            const response = await fetch('/admin/test/videos');
            const data = await response.json();
            
            if (data.success) {
                this.videos = data.data;
                this.displayVideoList();
                this.logTestResult(`✓ Videos: Loaded ${data.count} streamable videos`, 'success');
            } else {
                throw new Error(data.error || 'Failed to load videos');
            }
        } catch (error) {
            this.logTestResult(`✗ Videos: ${error.message}`, 'error');
            console.error('Failed to load videos:', error);
        }
    }

    displayVideoList() {
        const videoList = document.getElementById('videoList');
        if (!videoList) return;

        if (this.videos.length === 0) {
            videoList.innerHTML = '<p class="no-videos">No streamable videos found...</p>';
            return;
        }

        videoList.innerHTML = '';

        this.videos.forEach(video => {
            const videoItem = document.createElement('div');
            videoItem.className = 'video-item';
            videoItem.onclick = () => this.selectVideo(video);
            
            const displayName = video.seriesName ? 
                `${video.seriesName} - S${video.seasonNumber}E${video.episodeNumber} - ${video.name}` : 
                video.name;
            
            videoItem.innerHTML = `
                <div class="video-thumbnail">
                    ${video.thumbnail ? 
                        `<img src="${video.thumbnail}" alt="${video.name}" onerror="this.parentElement.innerHTML='<div class=\\'video-placeholder\\'>📺</div>'">` :
                        '<div class="video-placeholder">📺</div>'
                    }
                </div>
                <div class="video-details">
                    <h5>${displayName}</h5>
                    <div class="video-meta">
                        ${video.type} • ${video.year || 'Unknown'} • ${this.formatDuration(video.duration * 1000)}
                        ${video.resolution ? ` • ${video.resolution}p` : ''}
                    </div>
                </div>
            `;
            
            videoList.appendChild(videoItem);
        });
    }

    async selectVideo(video) {
        // Update selection in UI
        document.querySelectorAll('.video-item').forEach(item => {
            item.classList.remove('selected');
        });
        event.currentTarget.classList.add('selected');
        
        this.currentVideo = video;
        
        try {
            // Get stream URL
            const response = await fetch(`/admin/test/stream/${video.id}`);
            const data = await response.json();
            
            if (data.success) {
                this.playVideo(data.data);
                this.updateVideoInfo(data.data);
                this.logTestResult(`✓ Stream: ${video.name} - Stream URL generated`, 'success');
            } else {
                throw new Error(data.error || 'Failed to get stream URL');
            }
        } catch (error) {
            this.logTestResult(`✗ Stream: ${error.message}`, 'error');
            console.error('Failed to get stream URL:', error);
        }
    }

    playVideo(streamData) {
        const video = document.getElementById('videoPlayer');
        if (!video) return;

        // Stop existing stream
        this.clearPlayer();

        // Since our server redirects HLS to direct streams, just use direct playback
        this.logTestResult(`▶ Playing ${streamData.name} via direct stream`, 'info');
        this.playDirectVideo(streamData.directUrl);
    }

    playDirectVideo(directUrl) {
        const video = document.getElementById('videoPlayer');
        if (!video) return;
        
        // Use our API's proxied stream instead of direct Jellyfin URL
        const itemId = this.currentVideo?.id;
        if (itemId) {
            const proxiedUrl = `/api/stream/${itemId}?format=direct`;
            video.src = proxiedUrl;
            this.logTestResult(`▶ Playing via proxied direct stream`, 'info');
        } else {
            video.src = directUrl;
            this.logTestResult(`▶ Playing via direct stream (fallback)`, 'info');
        }
    }

    clearPlayer() {
        const video = document.getElementById('videoPlayer');
        if (!video) return;

        // Stop HLS if active
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

        // Clear video source
        video.src = '';
        video.load();

        // Clear video info
        this.updateVideoInfo(null);
        
        // Clear selection
        document.querySelectorAll('.video-item').forEach(item => {
            item.classList.remove('selected');
        });

        this.logTestResult('⏹ Video player stopped', 'info');
    }

    updateVideoInfo(streamData) {
        const videoInfo = document.getElementById('videoInfo');
        if (!videoInfo) return;

        if (!streamData) {
            videoInfo.className = 'video-info';
            videoInfo.innerHTML = '<p>Select a video from the list to start testing stream playback...</p>';
            return;
        }

        videoInfo.className = 'video-info active';
        videoInfo.innerHTML = `
            <div class="info-item">
                <span class="info-label">Video:</span>
                <span class="info-value">${streamData.name}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Type:</span>
                <span class="info-value">${streamData.type}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Duration:</span>
                <span class="info-value">${this.formatDuration(streamData.duration * 1000)}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Resolution:</span>
                <span class="info-value">${streamData.resolution}p</span>
            </div>
            <div class="info-item">
                <span class="info-label">Codec:</span>
                <span class="info-value">${streamData.codec}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Bitrate:</span>
                <span class="info-value">${this.formatBitrate(streamData.bitrate)}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Stream URL:</span>
                <span class="info-value" style="font-size: 0.75em; word-break: break-all;">${streamData.streamUrl}</span>
            </div>
        `;
    }

    logTestResult(message, type = 'info') {
        const testLog = document.getElementById('testLog');
        if (!testLog) return;

        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('p');
        logEntry.className = type;
        logEntry.textContent = `[${timestamp}] ${message}`;
        
        testLog.appendChild(logEntry);
        testLog.scrollTop = testLog.scrollHeight;
    }

    // Utility functions
    formatNumber(num) {
        if (typeof num !== 'number') return '0';
        
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    }

    formatDate(dateString) {
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        } catch (e) {
            return 'Invalid Date';
        }
    }

    formatTime(date) {
        return date.toLocaleTimeString();
    }

    formatDuration(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    formatBitrate(bitrate) {
        if (!bitrate || bitrate === 0) return 'Unknown';
        
        if (bitrate >= 1000000) {
            return (bitrate / 1000000).toFixed(1) + ' Mbps';
        } else if (bitrate >= 1000) {
            return (bitrate / 1000).toFixed(0) + ' Kbps';
        }
        return bitrate + ' bps';
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

    getResponseTimeColor(responseTime) {
        if (responseTime <= 100) return '#10b981'; // green
        if (responseTime <= 500) return '#f59e0b'; // yellow
        return '#ef4444'; // red
    }
}

// Global functions for buttons
function refreshData() {
    if (window.dashboard) {
        const btn = document.querySelector('.refresh-btn i');
        if (btn) {
            btn.classList.add('fa-spin');
            setTimeout(() => btn.classList.remove('fa-spin'), 1000);
        }
        window.dashboard.loadData();
    }
}

function testEndpoint(endpointName) {
    if (window.dashboard) {
        window.dashboard.testEndpoint(endpointName);
    }
}

async function testAllEndpoints() {
    if (window.dashboard) {
        const endpoints = ['libraries', 'recent', 'search', 'system', 'videos'];
        
        // Clear test log
        const testLog = document.getElementById('testLog');
        if (testLog) {
            testLog.innerHTML = '<p>Starting API tests...</p>';
        }
        
        window.dashboard.logTestResult('Running all API tests...', 'info');
        
        for (const endpoint of endpoints) {
            await window.dashboard.testEndpoint(endpoint);
            // Small delay between tests
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        window.dashboard.logTestResult('All tests completed!', 'info');
    }
}

// Video testing functions
function loadVideoList() {
    if (window.dashboard) {
        window.dashboard.loadVideoList();
    }
}

function clearPlayer() {
    if (window.dashboard) {
        window.dashboard.clearPlayer();
    }
}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new AdminDashboard();
});

// Handle visibility change to pause/resume updates
document.addEventListener('visibilitychange', () => {
    if (window.dashboard) {
        if (document.hidden) {
            window.dashboard.stopAutoRefresh();
        } else {
            window.dashboard.startAutoRefresh();
            window.dashboard.loadData(); // Immediate refresh when tab becomes visible
        }
    }
});
