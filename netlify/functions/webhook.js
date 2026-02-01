async function getAccessToken() {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: process.env.SAXO_REFRESH_TOKEN
  });

  const auth = Buffer
    .from(`${process.env.SAXO_CLIENT_ID}:${process.env.SAXO_CLIENT_SECRET}`)
    .toString("base64");

  const res = await fetch("https://live.logonvalidation.net/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  const data = await res.json();
  return data.access_token;
}

export async function handler(event) {
  try {
    const accessToken = await getAccessToken();

    const order = {
      AccountKey: process.env.SAXO_ACCOUNT_KEY,
      Amount: 0.1,
      AssetType: "CfdOnIndex",
      BuySell: "Buy",
      OrderType: "Limit",
      OrderPrice: 20000,   // <-- langt fra markedet (sikker)
      OrderDuration: { DurationType: "GoodTillCancel" },
      Uic: 4910,           // GER40
      ManualOrder: true
    };

    const res = await fetch(
      "https://gateway.saxobank.com/openapi/trade/v2/orders",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(order)
      }
    );

    const text = await res.text();

    return {
      statusCode: res.status,
      body: text
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: err.toString()
    };
  }
}
