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
      const amount = Math.max(0.1, parseFloat(qty) || 0.1);
      const buySell = action.toLowerCase() === 'buy' ? 'Buy' : 'Sell';
      const oppositeSide = buySell === 'Buy' ? 'Sell' : 'Buy';

      // Trin 1: Placer market order
      const order = {
        AccountKey: ACCOUNT_KEY,
        Amount: amount,
        AssetType: 'CfdOnIndex',
        BuySell: buySell,
        OrderType: 'Market',
        Uic: uic,
        ManualOrder: true
      };

      console.log('Placing market order:', JSON.stringify(order, null, 2));
      const entryResult = await placeOrder(order, ACCESS_TOKEN);
      console.log('Entry result:', entryResult);

      result = { entry: entryResult };

      // Trin 2: Hent fill-pris og placer trailing stop
      if (trailingStop && trailingStop.enabled) {
        // Vent lidt så positionen registreres
        await new Promise(r => setTimeout(r, 500));
        
        // Hent aktuel position for at få fill-pris
        const position = await getPosition(uic, ACCESS_TOKEN);
        console.log('Position:', position);
        
        if (position && position.PositionBase) {
          const fillPrice = position.PositionBase.OpenPrice;
          const trailDistance = parseFloat(trailingStop.trailPoints) || 25;
          const trailStep = parseFloat(trailingStop.trailOffset) || 1;
          
          // Beregn trailing stop pris baseret på fill
          const trailPrice = buySell === 'Buy' 
            ? fillPrice - trailDistance 
            : fillPrice + trailDistance;

          const trailingOrder = {
            AccountKey: ACCOUNT_KEY,
            Amount: amount,
            AssetType: 'CfdOnIndex',
            BuySell: oppositeSide,
            OrderType: 'TrailingStop',
            OrderPrice: trailPrice,
            TrailingStopDistanceToMarket: trailDistance,
            TrailingStopStep: trailStep,
            Uic: uic,
            OrderDuration: { DurationType: 'GoodTillCancel' },
            ManualOrder: true
          };

          console.log('Placing trailing stop:', JSON.stringify(trailingOrder, null, 2));
          const trailResult = await placeOrder(trailingOrder, ACCESS_TOKEN);
          console.log('Trailing stop result:', trailResult);
          result.trailingStop = trailResult;
        }
      }

      // Stop Loss (separat ordre)
      if (stopLossPrice) {
        const slOrder = {
          AccountKey: ACCOUNT_KEY,
          Amount: amount,
          AssetType: 'CfdOnIndex',
          BuySell: oppositeSide,
          OrderType: 'Stop',
          OrderPrice: parseFloat(stopLossPrice),
          Uic: uic,
          OrderDuration: { DurationType: 'GoodTillCancel' },
          ManualOrder: true
        };
        console.log('Placing stop loss:', JSON.stringify(slOrder, null, 2));
        result.stopLoss = await placeOrder(slOrder, ACCESS_TOKEN);
      }

      // Take Profit (separat ordre)
      if (takeProfitPrice) {
        const tpOrder = {
          AccountKey: ACCOUNT_KEY,
          Amount: amount,
          AssetType: 'CfdOnIndex',
          BuySell: oppositeSide,
          OrderType: 'Limit',
          OrderPrice: parseFloat(takeProfitPrice),
          Uic: uic,
          OrderDuration: { DurationType: 'GoodTillCancel' },
          ManualOrder: true
        };
        console.log('Placing take profit:', JSON.stringify(tpOrder, null, 2));
        result.takeProfit = await placeOrder(tpOrder, ACCESS_TOKEN);
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

function getPosition(uic, token) {
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
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const positions = JSON.parse(data || '{}');
          const pos = positions.Data?.find(p => p.PositionBase?.Uic === uic);
          resolve(pos || null);
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
