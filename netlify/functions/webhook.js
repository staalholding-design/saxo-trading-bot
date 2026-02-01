export async function handler(event) {
  console.log("Webhook triggered");
  console.log("HTTP method:", event.httpMethod);

  if (event.httpMethod !== "POST") {
    return { statusCode: 200, body: "Webhook alive" };
  }

  const ACCESS_TOKEN = "eyJhbGciOiJFUzI1NiIsIng1dCI6IjY3NEM0MjFEMzZEMUE1OUNFNjFBRTIzMjMyOTVFRTAyRTc3MDMzNTkifQ.eyJvYWEiOiI3Nzc3NSIsImlzcyI6Im9hIiwiYWlkIjoiMTA5IiwidWlkIjoiTVZlMnh3RHlZSVAtMmR6Zm9EfEY3UT09IiwiY2lkIjoiTVZlMnh3RHlZSVAtMmR6Zm9EfEY3UT09IiwiaXNhIjoiRmFsc2UiLCJ0aWQiOiIyMDAyIiwic2lkIjoiZGE1YjY4ZGJkYTI1NDg5Nzg5OThkZDhmMzIwMTEwNWQiLCJkZ2kiOiI4NCIsImV4cCI6IjE3NzAwNDk2NDQiLCJvYWwiOiIxRiIsImlpZCI6IjEwNWE5MWI1NmQzOTQ3MDk0ZmFmMDhkZTVmZmFiMmVlIn0.mESmoYvrAU_ac4BcIgkUvq-Vu7N4qcuMCqaJw2CqwE4F39uSVU8bqmfqNJpZDRSOajempamUtEkHahQQwlIpZg";

  const order = {
    AccountKey: "MVe2xwDyYIP-2dzfoD|F7Q==",
    AssetType: "CfdOnIndex",
    Uic: 4910,
    BuySell: "Buy",
    OrderType: "Market",
    Amount: 0.1,
    ManualOrder: true
  };

  console.log("Order payload:", JSON.stringify(order));

  const res = await fetch(
    "https://gateway.saxobank.com/openapi/trade/v2/orders",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(order)
    }
  );

  const text = await res.text();

  console.log("Saxo HTTP status:", res.status);
  console.log("Saxo response body:", text);

  return {
    statusCode: res.status,
    body: text
  };
}
