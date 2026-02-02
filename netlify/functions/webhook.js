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

  const { action, symbol, qty, stopLossPrice, takeProfitPrice, trailingStop } = data;

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
      // Hovedordre (market entry)
      const order = {
        AccountKey: ACCOUNT_KEY,
        Amount: Math.max(0.1, parseFloat(qty) || 0.1),
        AssetType: 'CfdOnIndex',
        BuySell: action.toLowerCase() === 'buy' ? 'Buy' : 'Sell',
        OrderType: 'Market',
        Uic: uic,
        ManualOrder: true
      };

      // Tilføj relaterede ordrer (SL/TP/Trailing)
      const relatedOrders = [];

      // Stop Loss
      if (stopLossPrice) {
        relatedOrders.push({
          Amount: order.Amount,
          AssetType: 'CfdOnIndex',
          BuySell: order.BuySell === 'Buy' ? 'Sell' : 'Buy',
          OrderType: 'StopIfTraded',
          OrderPrice: parseFloat(stopLossPrice),
          Uic: uic,
          OrderDuration: { DurationType: 'GoodTillCancel' },
          ManualOrder: true
        });
      }

      // Take Profit
      if (takeProfitPrice) {
        relatedOrders.push({
          Amount: order.Amount,
          AssetType: 'CfdOnIndex',
          BuySell: order.BuySell === 'Buy' ? 'Sell' : 'Buy',
          OrderType: 'Limit',
          OrderPrice: parseFloat(takeProfitPrice),
          Uic: uic,
          OrderDuration: { DurationType: 'GoodTillCancel' },
          ManualOrder: true
        });
      }

      // Trailing Stop
      if (trailingStop && trailingStop.enabled) {
        relatedOrders.push({
          Amount: order.Amount,
          AssetType: 'CfdOnIndex',
          BuySell: order.BuySell === 'Buy' ? 'Sell' : 'Buy',
          OrderType: 'TrailingStopIfTraded',
          TrailingStopDistanceToMarket: parseFloat(trailingStop.trailPoints) || 25,
          TrailingStopStep: parseFloat(trailingStop.trailOffset) || 1,
          Uic: uic,
          OrderDuration: { DurationType: 'GoodTillCancel' },
          ManualOrder: true
        });
      }

      // Tilføj relaterede ordrer til hovedordren
      if (relatedOrders.length > 0) {
        order.Orders = relatedOrders;
      }

      console.log('Placing order:', JSON.stringify(order, null, 2));
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
  return process.env.SAXO_ACCESS_TOKEN;
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
