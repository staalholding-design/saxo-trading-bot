const https = require('https');

const ACCOUNT_SLUG = 'staalholding';

// Scheduled function handler
exports.handler = async (event, context) => {
  console.log('Refresh token triggered:', event.headers?.['x-nf-event'] || 'manual');
  
  const CLIENT_ID = process.env.SAXO_CLIENT_ID;
  const CLIENT_SECRET = process.env.SAXO_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.SAXO_REFRESH_TOKEN;
  const NETLIFY_API_TOKEN = process.env.NETLIFY_API_TOKEN;
  const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID;

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.error('Missing Saxo credentials');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Saxo credentials' }) };
  }

  if (!NETLIFY_API_TOKEN || !NETLIFY_SITE_ID) {
    console.error('Missing Netlify credentials');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Netlify credentials' }) };
  }

  try {
    console.log('Refreshing Saxo token...');
    const tokenData = await refreshToken(CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN);
    console.log('Got new tokens from Saxo');

    await setEnvVar('SAXO_ACCESS_TOKEN', tokenData.access_token, NETLIFY_API_TOKEN, NETLIFY_SITE_ID);
    await setEnvVar('SAXO_REFRESH_TOKEN', tokenData.refresh_token, NETLIFY_API_TOKEN, NETLIFY_SITE_ID);
    console.log('Saved tokens to Netlify');

    await netlifyRequest('POST', `/api/v1/sites/${NETLIFY_SITE_ID}/builds`, {}, NETLIFY_API_TOKEN);
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

function netlifyRequest(method, path, body, apiToken) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    
    const options = {
      hostname: 'api.netlify.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    };
    
    if (postData && method !== 'GET') {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : {});
        } else {
          reject(new Error(`Netlify ${method} ${path}: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (postData && method !== 'GET') req.write(postData);
    req.end();
  });
}

async function setEnvVar(key, value, apiToken, siteId) {
  const patchPath = `/api/v1/accounts/${ACCOUNT_SLUG}/env/${key}?site_id=${siteId}`;
  const patchBody = { context: 'all', value: value };
  
  try {
    await netlifyRequest('PATCH', patchPath, patchBody, apiToken);
    console.log(`Updated ${key} via PATCH`);
    return;
  } catch (e) {
    console.log(`PATCH failed for ${key}, trying DELETE + POST...`);
  }
  
  try {
    await netlifyRequest('DELETE', `/api/v1/accounts/${ACCOUNT_SLUG}/env/${key}?site_id=${siteId}`, null, apiToken);
  } catch (e) {}
  
  const postPath = `/api/v1/accounts/${ACCOUNT_SLUG}/env?site_id=${siteId}`;
  const postBody = [{ key: key, values: [{ value: value, context: 'all' }] }];
  await netlifyRequest('POST', postPath, postBody, apiToken);
  console.log(`Created ${key} via POST`);
}
