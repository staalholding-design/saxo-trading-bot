const https = require('https');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const ACCESS_TOKEN = process.env.SAXO_ACCESS_TOKEN;
  const ACCOUNT_KEY = process.env.SAXO_ACCOUNT_KEY;
  
  if (!ACCESS_TOKEN || !ACCOUNT_KEY) {
    return { statusCode: 500, body: 'Missing environment variables' };
  }

  const { action, symbol, qty, price, sl, tp } = data;

  if (!action || !symbol) {
    return { statusCode: 400, body: 'Missing action or symbol' };
  }

  // Germany 40 CFD på Saxo
  const symbolMap = {
    'GER40': 3302,
    'DAX': 3302,
  };

  const uic = symbolMap[symbol.toUpperCase()];
  if (!uic) {
    return { statusCode: 400, body: 'Unknown symbol' };
  }

  try {
    let result;
    
    if (action.toLowerCase() === 'close') {
      // Luk alle positioner på dette instrument
      result = await closePosition(uic, ACCESS_TOKEN, ACCOUNT_KEY);
    } else {
      // Åbn ny position med SL og TP
      const order = {
        AccountKey: ACCOUNT_KEY,
        Amount: qty || 1,
        AssetType: 'CfdOnIndex',
        BuySell: action.toLowerCase() === 'buy' ? 'Buy' : 'Sell',
        OrderType: 'Market',
        Uic: uic,
        ManualOrder: false,
        Orders: []
      };

      // Tilføj Stop Loss hvis angivet
      if (sl) {
        order.Orders.push({
          OrderType: 'StopIfTraded',
          OrderPrice: parseFloat(sl),
          BuySell: action.toLowerCase() === 'buy' ? 'Sell' : 'Buy',
          Amount: qty || 1,
          AssetType: 'CfdOnIndex',
          Uic: uic
        });
      }

      // Tilføj Take Profit hvis angivet
      if (tp) {
        order.Orders.push({
          OrderType: 'LimitIfTraded',
          OrderPrice: parseFloat(tp),
          BuySell: action.toLowerCase() === 'buy' ? 'Sell' : 'Buy',
          Amount: qty || 1,
          AssetType: 'CfdOnIndex',
          Uic: uic
        });
      }

      result = await placeOrder(order, ACCESS_TOKEN);
    }
    
    console.log('Result:', result);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, result })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

function placeOrder(order, token) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(order);
    
    const options = {
      hostname: 'gateway.saxobank.com',
      port: 443,
      path: '/sim/openapi/trade/v2/orders',
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
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data || '{}'));
        } else {
          reject(new Error(`Saxo API: ${res.statusCode} - ${data}`));
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
    // Først hent åbne positioner
    const options = {
      hostname: 'gateway.saxobank.com',
      port: 443,
      path: `/sim/openapi/port/v1/positions?ClientKey=${accountKey}&FieldGroups=PositionBase`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', async () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const positions = JSON.parse(data || '{}');
          const pos = positions.Data?.find(p => p.PositionBase?.Uic === uic);
          
          if (pos) {
            // Luk positionen
            const closeOrder = {
              AccountKey: accountKey,
              PositionId: pos.PositionId,
              Orders: [{
                OrderType: 'Market',
                Uic: uic,
                AssetType: 'CfdOnIndex',
                Amount: pos.PositionBase.Amount,
                BuySell: pos.PositionBase.Amount > 0 ? 'Sell' : 'Buy'
              }]
            };
            resolve(await placeOrder(closeOrder, token));
          } else {
            resolve({ message: 'No position to close' });
          }
        } else {
          reject(new Error(`Saxo API: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}
