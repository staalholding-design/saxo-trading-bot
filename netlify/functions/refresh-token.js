const https = require('https');

exports.handler = async (event) => {
  const CLIENT_ID = process.env.SAXO_CLIENT_ID;
  const CLIENT_SECRET = process.env.SAXO_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.SAXO_REFRESH_TOKEN;
  const NETLIFY_API_TOKEN = process.env.NETLIFY_API_TOKEN;
  const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID;

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Saxo credentials' }) };
  }

  if (!NETLIFY_API_TOKEN || !NETLIFY_SITE_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Netlify credentials' }) };
  }

  try {
    // 1. Hent nye tokens fra Saxo
    const tokenData = await refreshToken(CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN);
    console.log('Got new tokens from Saxo');

    // 2. Gem i Netlify env vars
    await updateNetlifyEnvVar('SAXO_ACCESS_TOKEN', tokenData.access_token, NETLIFY_API_TOKEN, NETLIFY_SITE_ID);
    await updateNetlifyEnvVar('SAXO_REFRESH_TOKEN', tokenData.refresh_token, NETLIFY_API_TOKEN, NETLIFY_SITE_ID);
    console.log('Saved tokens to Netlify');

    // 3. Trigger redeploy så webhook får de nye tokens
    await triggerRedeploy(NETLIFY_API_TOKEN, NETLIFY_SITE_ID);
    console.log('Triggered redeploy');

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Tokens refreshed, saved, and redeploy triggered',
        expires_in: tokenData.expires_in
      })
    };
  } catch (error) {
    console.error('Refresh error:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

function refreshToken(clientId, clientSecret, refreshToken) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    }).toString();

    const options = {
      hostname: 'live.logonvalidation.net',
      port: 443,
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Token refresh failed: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function updateNetlifyEnvVar(key, value, apiToken, siteId) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      key: key,
      values: [{ value: value, context: 'all' }]
    });

    const options = {
      hostname: 'api.netlify.com',
      port: 443,
      path: `/api/v1/sites/${siteId}/env/${key}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data || '{}'));
        } else {
          reject(new Error(`Netlify update failed for ${key}: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function triggerRedeploy(apiToken, siteId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.netlify.com',
      port: 443,
      path: `/api/v1/sites/${siteId}/builds`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data || '{}'));
        } else {
          reject(new Error(`Redeploy failed: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}
