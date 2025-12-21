const { CognitoJwtVerifier } = require("aws-jwt-verify");
require('dotenv').config();

// --- Cognito Verifier ---
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  tokenUse: "id",
  clientId: process.env.COGNITO_CLIENT_ID,
  httpOptions: {
    responseTimeout: 10000 // Wait 10 seconds instead of 3
  }
});

// Warm up the verifier (fetch JWKS) at startup
verifier.hydrate()
  .then(() => console.log("✅ Cognito JWKS loaded successfully"))
  .catch(err => console.error("❌ Failed to load Cognito JWKS (Check Internet/VPN):", err.message));

const verifyAuth = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const payload = await verifier.verify(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    console.error("Token verification failed:", err);
    return res.status(401).json({ error: "Invalid token" });
  }
};

module.exports = verifyAuth;