exports.handler = async (event) => {
  const { getStore } = await import('@netlify/blobs');
  const store = getStore('saxo-tokens');
  
  const accessToken = process.env.SAXO_ACCESS_TOKEN;
  const refreshToken = process.env.SAXO_REFRESH_TOKEN;
  
  if (!accessToken || !refreshToken) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing SAXO_ACCESS_TOKEN or SAXO_REFRESH_TOKEN in environment' })
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
    body: JSON.stringify({ success: true, message: 'Tokens initialized in blob storage' })
  };
};
