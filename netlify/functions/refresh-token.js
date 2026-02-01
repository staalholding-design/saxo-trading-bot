const https = require('https');

exports.handler = async (event) => {
  const CLIENT_ID = process.env.SAXO_CLIENT_ID;
  const CLIENT_SECRET = process.env.SAXO_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.SAXO_REFRESH_TOKEN;

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing environment variables' })
    };
  }

  try {
    const tokenData = await refreshToken(CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN);
    
    // Log det nye token (du skal manuelt opdatere det i Netlify indtil vi sætter automatisk opdatering op)
    console.log('New access token:', tokenData.access_token);
    console.log('New refresh token:', tokenData.refresh_token);
    console.log('Expires in:', tokenData.expires_in, 'seconds');

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Token refreshed - check logs for new tokens',
        expires_in: tokenData.expires_in
      })
    };
  } catch (error) {
    console.error('Refresh error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
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
```

---

**Tjek at disse environment variables er sat i Netlify:**

| Variable | Værdi |
|----------|-------|
| `SAXO_CLIENT_ID` | `1f6555bf52ab44aaba8c6573cdde0d36` |
| `SAXO_CLIENT_SECRET` | (din app secret fra Live Apps) |
| `SAXO_REFRESH_TOKEN` | `46099222-a3db-436e-89dd-14fa0a180a11` |

---

**Når det er sat op**, kan du kalde denne URL for at refreshe token:
```
https://precious-medovik-232c3d.netlify.app/.netlify/functions/refresh-token
