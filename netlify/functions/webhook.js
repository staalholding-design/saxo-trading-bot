const https = require('https');

exports.handler = async (event) => {
  // Kun tillad POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Parse webhook data fra TradingView
  let data;
  try {
    data = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Hent environment variables
  const ACCESS_TOKEN = process.env.SAXO_ACCESS_TOKEN;
  const ACCOUNT_KEY = process.env.SAXO_ACCOUNT_KEY;
  
  if (!ACCESS_TOKEN || !ACCOUNT_KEY) {
    return { statusCode: 500, body: 'Missing environment variables' };
  }

  // Forventet data fra TradingView:
  // { "action": "buy" eller "sell", "symbol": "GER40", "qty": 1 }
  const { action, symbol, qty } = data;

  if (!action || !symbol) {
    return { statusCode: 400, body: 'Missing action or symbol' };
  }

  // Map symbol til Saxo UIC (instrument ID)
  const symbolMap = {
    'GER40': 3302, // DAX40 CFD
    'DAX': 3302,
  };

  const uic = symbolMap[symbol.toUpperCase()];
  if (!uic) {
    return { statusCode: 400, body: 'Unknown symbol' };
  }

  // Byg ordre
  const order = {
    AccountKey: ACCOUNT_KEY,
    Amount: qty || 1,
    AssetType: 'CfdOnIndex',
    BuySell: action.toLowerCase() === 'buy' ? 'Buy' : 'Sell',
    OrderType: 'Market',
    Uic: uic,
    ManualOrder: false,
  };

  // Send til Saxo API
  try {
    const result = await placeOrder(order, ACCESS_TOKEN);
    console.log('Order result:', result);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, order: result })
    };
  } catch (error) {
    console.error('Order error:', error);
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
      hostname: 'gateway.saxobank.com',  // Live: gateway.saxobank.com, Sim: gateway.saxobank.com/sim
      port: 443,
      path: '/sim/openapi/trade/v2/orders',  // Ændre /sim/ til / for live trading
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
          reject(new Error(`Saxo API error: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}
