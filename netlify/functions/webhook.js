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

  const ACCESS_TOKEN = process.env.SAXO_ACCESS_TOKEN;
  const ACCOUNT_KEY = process.env.SAXO_ACCOUNT_KEY;
  
  if (!ACCESS_TOKEN || !ACCOUNT_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variables', hasToken: !!ACCESS_TOKEN, hasAccount: !!ACCOUNT_KEY }) };
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
