const https = require('https');

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

  let ACCESS_TOKEN;
  try {
    ACCESS_TOKEN = await getValidToken();
  } catch (tokenError) {
    console.error('Token error:', tokenError.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Token error', details: tokenError.message }) };
  }

  const ACCOUNT_KEY = process.env.SAXO_ACCOUNT_KEY;
  
  if (!ACCESS_TOKEN || !ACCOUNT_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing credentials' }) };
  }

  const { action, symbol, qty } = data;

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
      const closeResult = await closePosition(uic, ACCESS_TOKEN, ACCOUNT_KEY);
      const cancelResult = await cancelOrders(uic, ACCESS_TOKEN, ACCOUNT_KEY);
      result = { positions: closeResult, orders: cancelResult };
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
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, result })
    };
  } catch (error) {
    console.error('Main error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

async function getValidToken() {
  const currentToken = process.env.SAXO_ACCESS_TOKEN;
  const refreshToken = process.env.SAXO_REFRESH_TOKEN;
  
  // Prøv nuværende token først
  const isValid = await testToken(currentToken);
  if (isValid) {
    console.log('Current token is valid');
    return currentToken;
  }
  
  // Token udløbet - refresh det
  console.log('Token expired, refreshing...');
  
  const CLIENT_ID = process.env.SAXO_CLIENT_ID;
  const CLIENT_SECRET = process.env.SAXO_CLIENT_SECRET;
  
  if (!CLIENT_ID || !CLIENT_SECRET || !refreshToken) {
    throw new Error('Missing refresh credentials');
  }
  
  const newTokens = await refreshSaxoToken(CLIENT_ID, CLIENT_SECRET, refreshToken);
  console.log('Got new tokens, saving to Netlify...');
  
  // Gem nye tokens i Netlify environment variables
  await updateNetlifyEnvVar('SAXO_ACCESS_TOKEN', newTokens.access_token);
  await updateNetlifyEnvVar('SAXO_REFRESH_TOKEN', newTokens.refresh_token);
  
  console.log('Tokens updated successfully');
  return newTokens.access_token;
}

async function testToken(token) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'gateway.saxobank.com',
      port: 443,
      path: '/openapi/port/v1/accounts/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const req = https.request(options, (res) => {
      resolve(res.statusCode === 200);
    });

    req.on('error', () => resolve(false));
    req.end();
  });
}

function refreshSaxoToken(clientId, clientSecret, refreshToken) {
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
          reject(new Error(`Refresh failed: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function updateNetlifyEnvVar(key, value) {
  return new Promise((resolve, reject) => {
    const NETLIFY_API_TOKEN = process.env.NETLIFY_API_TOKEN;
    const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID;
    
    if (!NETLIFY_API_TOKEN || !NETLIFY_SITE_ID) {
      reject(new Error('Missing Netlify credentials'));
      return;
    }

    const postData = JSON.stringify({
      key: key,
      values: [{ value: value, context: 'all' }]
    });

    const options = {
      hostname: 'api.netlify.com',
      port: 443,
      path: `/api/v1/sites/${NETLIFY_SITE_ID}/env/${key}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NETLIFY_API_TOKEN}`,
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
          reject(new Error(`Netlify update failed: ${res.statusCode} - ${data}`));
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

function cancelOrders(uic, token, accountKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'gateway.saxobank.com',
      port: 443,
      path: `/openapi/port/v1/orders/me`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', async () => {
        console.log('Orders response:', res.statusCode, data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const orders = JSON.parse(data || '{}');
          const matchingOrders = orders.Data?.filter(o => o.Uic === uic) || [];
          
          if (matchingOrders.length > 0) {
            const deleteResults = [];
            for (const order of matchingOrders) {
              try {
                const result = await deleteOrder(order.OrderId, accountKey, token);
                deleteResults.push({ orderId: order.OrderId, result });
              } catch (err) {
                deleteResults.push({ orderId: order.OrderId, error: err.message });
              }
            }
            resolve({ deleted: deleteResults });
          } else {
            resolve({ message: 'No orders to cancel' });
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

function deleteOrder(orderId, accountKey, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'gateway.saxobank.com',
      port: 443,
      path: `/openapi/trade/v2/orders/${orderId}?AccountKey=${encodeURIComponent(accountKey)}`,
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log('Delete order response:', res.statusCode, data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true });
        } else {
          reject(new Error(`Delete failed: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}
