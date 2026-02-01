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

  const text = await res.text();

  if (!res.ok) {
    console.error("Token refresh failed:", text);
    throw new Error(text);
  }

  const data = JSON.parse(text);
  console.log("Access token OK");
  return data.access_token;
}

export async function handler(event) {

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 200,
      body: "Webhook is alive. Use POST."
    };
  }

  try {
    const accessToken = await getAccessToken();

    // 🔥 HARD-CODET LIVE TEST (IDENTISK MED SIM)
    const order = {
      AccountKey: "MVe2xwDyYIP-2dzfoD|F7Q==",
      AssetType: "CfdOnIndex",
      Uic: 4910,
      BuySell: "Buy",
      OrderType: "Market",
      Amount: 0.1,
      ManualOrder: true
    };

    console.log("Sending order to Saxo LIVE:", order);

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

    const responseText = await res.text();

    console.log("Saxo status:", res.status);
    console.log("Saxo body:", responseText);

    if (!res.ok) {
      throw new Error(`Saxo error ${res.status}: ${responseText}`);
    }

    return {
      statusCode: 200,
      body: responseText
    };

  } catch (err) {
    console.error("Webhook FAILED:", err);
    return {
      statusCode: 500,
      body: err.toString()
    };
  }
}
