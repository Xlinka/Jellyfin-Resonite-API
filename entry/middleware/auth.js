const axios = require('axios');
const http = require('http');
const https = require('https');

// Connection pooling agents for better performance
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

// Global auth state
let authData = {
  token: null,
  userId: null,
  serverId: null,
  lastAuth: null
};

// Promise-based auth queue (replaces busy-wait)
let authPromise = null;

// Singleton axios instance for all requests
let axiosInstance = null;

const JELLYFIN_SERVER = process.env.JELLYFIN_SERVER;
const USERNAME = process.env.JELLYFIN_USERNAME;
const PASSWORD = process.env.JELLYFIN_PASSWORD;
const AUTH_CACHE_DURATION = (parseInt(process.env.AUTH_CACHE_DURATION) || 3600) * 1000;

/**
 * Initialize authentication on server startup
 */
async function initializeAuth() {
  console.log('Initializing Jellyfin authentication...');
  try {
    await authenticate();
    console.log('Authentication successful');

    // Set up periodic re-authentication
    setInterval(async () => {
      if (shouldReauthenticate()) {
        console.log('Refreshing authentication...');
        try {
          await authenticate();
        } catch (err) {
          console.error('Auth refresh failed:', err.message);
        }
      }
    }, 300000);

  } catch (error) {
    console.error('Initial authentication failed:', error.message);
    console.error('Server will continue but API calls may fail');
  }
}

/**
 * Perform authentication with Jellyfin server
 */
async function authenticate() {
  // If auth is already in progress, wait for it
  if (authPromise) {
    return authPromise;
  }

  authPromise = (async () => {
    try {
      const response = await axios.post(`${JELLYFIN_SERVER}/Users/authenticatebyname`, {
        Username: USERNAME,
        Pw: PASSWORD
      }, {
        headers: {
          'X-Emby-Authorization': `MediaBrowser Client="ResoniteAPI", Device="Server", DeviceId="resonite-api-server", Version="1.0.0"`
        },
        timeout: 10000,
        httpAgent,
        httpsAgent
      });

      authData.token = response.data.AccessToken;
      authData.userId = response.data.User.Id;
      authData.serverId = response.data.ServerId;
      authData.lastAuth = Date.now();

      // Update singleton axios instance with new token
      updateAxiosInstance();

      console.log(`Authenticated as: ${response.data.User.Name}`);
      return authData;

    } catch (error) {
      if (error.response) {
        throw new Error(`Authentication failed: ${error.response.status} - ${error.response.data?.message || 'Invalid credentials'}`);
      } else if (error.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to Jellyfin server at ${JELLYFIN_SERVER}`);
      } else {
        throw new Error(`Authentication error: ${error.message}`);
      }
    } finally {
      authPromise = null;
    }
  })();

  return authPromise;
}

/**
 * Update the singleton axios instance with current auth token
 */
function updateAxiosInstance() {
  axiosInstance = axios.create({
    baseURL: JELLYFIN_SERVER,
    headers: {
      'X-Emby-Token': authData.token,
      'Content-Type': 'application/json'
    },
    timeout: 30000,
    httpAgent,
    httpsAgent
  });
}

/**
 * Check if we need to re-authenticate
 */
function shouldReauthenticate() {
  return !authData.token ||
         !authData.lastAuth ||
         (Date.now() - authData.lastAuth) > AUTH_CACHE_DURATION;
}

/**
 * Get current authentication data, re-authenticate if needed
 */
async function getAuthData() {
  if (shouldReauthenticate()) {
    await authenticate();
  }

  if (!authData.token) {
    throw new Error('Authentication not available');
  }

  return authData;
}

/**
 * Get singleton authenticated axios instance
 */
async function getAuthenticatedAxios() {
  if (shouldReauthenticate() || !axiosInstance) {
    await authenticate();
  }
  return axiosInstance;
}

/**
 * Middleware to ensure authentication before API calls
 */
async function ensureAuth(req, res, next) {
  try {
    await getAuthData();
    next();
  } catch (error) {
    console.error('Authentication middleware error:', error.message);
    res.status(503).json({
      error: 'Authentication service unavailable',
      message: 'Unable to authenticate with Jellyfin server'
    });
  }
}

module.exports = {
  initializeAuth,
  authenticate,
  getAuthData,
  getAuthenticatedAxios,
  ensureAuth
};
