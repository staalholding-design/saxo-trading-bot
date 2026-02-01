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
    redirect_uri: "https://precious-medovik-232c3d.netlify.app/callback"
  });

  const auth = Buffer.from(
    process.env.SAXO_CLIENT_ID + ":" + process.env.SAXO_CLIENT_SECRET
  ).toString("base64");

  const response = await fetch(
    "https://live.logonvalidation.net/token",
    {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    }
  );

  const data = await response.json();

  return {
    statusCode: 200,
    body: JSON.stringify(data, null, 2)
  };
}
