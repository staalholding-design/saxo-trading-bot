const https = require('https');

let cachedToken = null;
let tokenExpiry = 0;

exports.handler = async (event) => {
  console.log('Incoming request:', event.httpMethod, event.body);
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
    console.log('Parsed data:', data);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON', raw: event.body }) };
  }

  // Hent gyldigt token (refresher automatisk hvis udløbet)
  let ACCESS_TOKEN;
  try {
    ACCESS_TOKEN = await getValidToken();
  } catch (tokenError) {
    console.error('Token error:', tokenError.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Token refresh failed', details: tokenError.message }) };
  }

  const ACCOUNT_KEY = process.env.SAXO_ACCOUNT_KEY;
  
  if (!ACCESS_TOKEN || !ACCOUNT_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variables' }) };
  }

  const { action, symbol, qty, sl, tp } = data;

  if (!action || !symbol) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing action or symbol', received: data }) };
  }

  const symbolMap = {
    'GER40': 4910,
    'GER40.I': 4910,
    'DAX': 4910,
  };

  const uic = symbolMap[symbol.toUpperCase()];
  if (!uic) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown symbol', symbol: symbol }) };
  }

  try {
    let result;
    
    if (action.toLowerCase() === 'close') {
      result = await closePosition(uic, ACCESS_TOKEN, ACCOUNT_KEY);
    } else {
      const order = {
        AccountKey: ACCOUNT_KEY,
        Amount: Math.max(0.1, parseFloat(qty) || 0.1),
        AssetType: 'CfdOnIndex',
        BuySell: action.toLowerCase() === 'buy' ? 'Buy' : 'Sell',
        OrderType: 'Market',
        Uic: uic,
        ManualOrder: true
      };

      console.log('Placing order:', order);
      result = await placeOrder(order, ACCESS_TOKEN);
      console.log('Order result:', result);
      
      if (result.OrderId && (sl || tp)) {
        const oppositeSide = action.toLowerCase() === 'buy' ? 'Sell' : 'Buy';
        const amount = Math.max(0.1, parseFloat(qty) || 0.1);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (sl) {
          try {
            const slOrder = {
              AccountKey: ACCOUNT_KEY,
              Amount: amount,
              AssetType: 'CfdOnIndex',
              BuySell: oppositeSide,
              OrderType: 'Stop',
              OrderPrice: parseFloat(sl),
              Uic: uic,
              ManualOrder: true
            };
            console.log('Placing SL:', slOrder);
            await placeOrder(slOrder, ACCESS_TOKEN);
          } catch (slError) {
            console.log('SL error (continuing):', slError.message);
          }
        }
        
        if (tp) {
          try {
            const tpOrder = {
              AccountKey: ACCOUNT_KEY,
              Amount: amount,
              AssetType: 'CfdOnIndex',
              BuySell: oppositeSide,
              OrderType: 'Limit',
              OrderPrice: parseFloat(tp),
              Uic: uic,
              ManualOrder: true
            };
            console.log('Placing TP:', tpOrder);
            await placeOrder(tpOrder, ACCESS_TOKEN);
          } catch (tpError) {
            console.log('TP error (continuing):', tpError.message);
          }
        }
      }
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, result })
    };
  } catch (error) {
    console.error('Main error:', error.message);
    
    // Hvis 401, prøv at refreshe token og forsøg igen
    if (error.message.includes('401')) {
      console.log('Got 401, forcing token refresh...');
      cachedToken = null;
      tokenExpiry = 0;
    }
    
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

async function getValidToken() {
  const now = Date.now();
  
  // Brug cached token hvis det stadig er gyldigt (med 60 sekunders buffer)
  if (cachedToken && tokenExpiry > now + 60000) {
    console.log('Using cached token');
    return cachedToken;
  }
  
  // Prøv at bruge environment token først
  const envToken = process.env.SAXO_ACCESS_TOKEN;
  if (envToken && !cachedToken) {
    console.log('Using environment token');
    cachedToken = envToken;
    tokenExpiry = now + 1200000; // Antag 20 min
    return cachedToken;
  }
  
  // Refresh token
  console.log('Refreshing token...');
  const CLIENT_ID = process.env.SAXO_CLIENT_ID;
  const CLIENT_SECRET = process.env.SAXO_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.SAXO_REFRESH_TOKEN;
  
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error('Missing refresh token credentials');
  }
  
  const tokenData = await refreshToken(CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN);
  cachedToken = tokenData.access_token;
  tokenExpiry = now + (tokenData.expires_in * 1000);
  
  console.log('Token refreshed, expires in:', tokenData.expires_in, 'seconds');
  return cachedToken;
}

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

function placeOrder(order, token) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(order);
    
    const options = {
      hostname: 'gateway.saxobank.com',
      port: 443,
      path: '/openapi/trade/v2/orders',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log('Saxo response:', res.statusCode, data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data || '{}'));
        } else {
          reject(new Error(`Saxo ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function closePosition(uic, token, accountKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'gateway.saxobank.com',
      port: 443,
      path: `/openapi/port/v1/positions/me?FieldGroups=PositionBase`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', async () => {
        console.log('Positions response:', res.statusCode, data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const positions = JSON.parse(data || '{}');
          const pos = positions.Data?.find(p => p.PositionBase?.Uic === uic);
          
          if (pos) {
            const closeOrder = {
              AccountKey: accountKey,
              Amount: Math.abs(pos.PositionBase.Amount),
              AssetType: 'CfdOnIndex',
              BuySell: pos.PositionBase.Amount > 0 ? 'Sell' : 'Buy',
              OrderType: 'Market',
              Uic: uic,
              ManualOrder: true
            };
            resolve(await placeOrder(closeOrder, token));
          } else {
            resolve({ message: 'No position to close' });
          }
        } else {
          reject(new Error(`Saxo ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}
