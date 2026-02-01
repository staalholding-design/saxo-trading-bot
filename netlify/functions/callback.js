export async function handler(event) {
  const code = event.queryStringParameters?.code;

  if (!code) {
    return {
      statusCode: 400,
      body: "Missing authorization code"
    };
  }

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: "https://precious-medovik-232c3d.netlify.app/.netlify/functions/callback"
  });

  const clientId = process.env.SAXO_CLIENT_ID;
  const clientSecret = process.env.SAXO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Missing env vars",
        clientIdPresent: !!clientId,
        clientSecretPresent: !!clientSecret
      })
    };
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch("https://live.logonvalidation.net/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  const text = await response.text();

  return {
    statusCode: response.status,
    headers: { "Content-Type": "text/plain" },
    body: text
  };
}
