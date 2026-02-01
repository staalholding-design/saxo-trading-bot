// netlify/functions/webhook.js

import fetch from "node-fetch";

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
  console.log("New access token received");
  return data.access_token;
}

export async function handler(event) {

  // Browser test
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 200,
      body: "Webhook is alive. Use POST."
    };
  }

  try {
    // 1️⃣ Parse TradingView payload
    const payload = JSON.parse(event.body || "{}");
    console.log("Incoming TradingView payload:", payload);

    // 2️⃣ Get access token
    const accessToken = await getAccessToken();

    // 3️⃣ Build MARKET order (SIKKER TEST)
    const order = {
      AccountKey: process.env.SAXO_ACCOUNT_KEY,
      AssetType: "CfdOnIndex",
      Uic: 4910,                 // GER40
      BuySell: payload.action === "sell" ? "Sell" : "Buy",
      OrderType: "Market",
      Amount: Number(payload.qty || 0.1),
      ManualOrder: true
    };

    console.log("Order sent to Saxo:", order);

    // 4️⃣ Send order
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
    console.log("Saxo response status:", res.status);
    console.log("Saxo response body:", responseText);

    return {
      statusCode: res.status,
      body: responseText
    };

  } catch (err) {
    console.error("Webhook error:", err);
    return {
      statusCode: 500,
      body: err.toString()
    };
  }
}
