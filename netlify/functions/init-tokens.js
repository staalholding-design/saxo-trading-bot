exports.handler = async (event, context) => {
  const { blobs } = context;
  
  if (!blobs) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Blobs not available' })
    };
  }
  
  const store = blobs.getStore('saxo-tokens');
  
  const accessToken = process.env.SAXO_ACCESS_TOKEN;
  const refreshToken = process.env.SAXO_REFRESH_TOKEN;
  
  if (!accessToken || !refreshToken) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing tokens in environment' })
    };
  }
  
  const tokenData = {
    accessToken: accessToken,
    refreshToken: refreshToken,
    expiry: Date.now() + (1200 * 1000) - 60000
  };
  
  await store.setJSON('token-data', tokenData);
  
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, message: 'Tokens initialized' })
  };
};
