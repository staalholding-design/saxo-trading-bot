// netlify/functions/webhook.js

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
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error("Token refresh failed: " + text);
  }

  const data = await res.json();
  return data.access_token;
}

export async function handler(event) {

  // 👉 Gør det muligt at teste i browser
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 200,
      body: "Webhook is alive. Use POST."
    };
  }

  try {
    // 1️⃣ Hent access token via refresh token
    const accessToken = await getAccessToken();

    // 2️⃣ LIVE TEST ORDER (MEGET SIKKER)
    const order = {
      AccountKey: process.env.SAXO_ACCOUNT_KEY,
      Amount: 0.1,
      AssetType: "CfdOnIndex",
      BuySell: "Buy",
      OrderType: "Limit",
      OrderPrice: 20000, // langt fra markedet → bliver IKKE eksekveret
      OrderDuration: {
        DurationType: "GoodTillCancel"
      },
      Uic: 4910, // GER40
      ManualOrder: true
    };

    // 3️⃣ Send order til Saxo
    const res = await fetch(
      "https://gateway.saxobank.com/openapi/trade/v2/orders",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
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
