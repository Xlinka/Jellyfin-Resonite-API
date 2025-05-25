const axios = require('axios');

// Global auth state
let authData = {
  token: null,
  userId: null,
  serverId: null,
  lastAuth: null,
  isAuthenticating: false
};

const JELLYFIN_SERVER = process.env.JELLYFIN_SERVER;
const USERNAME = process.env.JELLYFIN_USERNAME;
const PASSWORD = process.env.JELLYFIN_PASSWORD;
const AUTH_CACHE_DURATION = (parseInt(process.env.AUTH_CACHE_DURATION) || 3600) * 1000;

/**
 * Initialize authentication on server startup
 */
async function initializeAuth() {
  console.log('🔐 Initializing Jellyfin authentication...');
  try {
    await authenticate();
    console.log('✅ Authentication successful');
    
    // Set up periodic re-authentication
    setInterval(async () => {
      if (shouldReauthenticate()) {
        console.log('🔄 Refreshing authentication...');
        await authenticate();
      }
    }, 300000); // Check every 5 minutes
    
  } catch (error) {
    console.error('❌ Initial authentication failed:', error.message);
    console.error('⚠️  Server will continue but API calls may fail');
  }
}

/**
 * Perform authentication with Jellyfin server
 */
async function authenticate() {
  if (authData.isAuthenticating) {
    // Wait for ongoing authentication
    while (authData.isAuthenticating) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return authData;
  }

  authData.isAuthenticating = true;

  try {
    const response = await axios.post(`${JELLYFIN_SERVER}/Users/authenticatebyname`, {
      Username: USERNAME,
      Pw: PASSWORD
    }, {
      headers: {
        'X-Emby-Authorization': `MediaBrowser Client="ResoniteAPI", Device="Server", DeviceId="resonite-${Date.now()}", Version="1.0.0"`
      },
      timeout: 10000
    });

    authData.token = response.data.AccessToken;
    authData.userId = response.data.User.Id;
    authData.serverId = response.data.ServerId;
    authData.lastAuth = Date.now();
    authData.isAuthenticating = false;

    console.log(`✅ Authenticated as: ${response.data.User.Name}`);
    return authData;

  } catch (error) {
    authData.isAuthenticating = false;
    
    if (error.response) {
      throw new Error(`Authentication failed: ${error.response.status} - ${error.response.data?.message || 'Invalid credentials'}`);
    } else if (error.code === 'ECONNREFUSED') {
      throw new Error(`Cannot connect to Jellyfin server at ${JELLYFIN_SERVER}`);
    } else {
      throw new Error(`Authentication error: ${error.message}`);
    }
  }
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
 * Create authenticated axios instance
 */
async function getAuthenticatedAxios() {
  const auth = await getAuthData();
  
  return axios.create({
    baseURL: JELLYFIN_SERVER,
    headers: {
      'X-Emby-Token': auth.token,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });
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