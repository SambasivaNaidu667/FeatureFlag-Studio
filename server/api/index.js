const { app, configureTrustProxy } = require("../src/server");
const connectDB = require("../src/config/db");
const { validateAuthConfig, getAuthConfig } = require("../src/auth/auth");

function resolveServerlessTrustProxy(env = process.env) {
  const explicit = env.TRUST_PROXY;
  if (explicit !== undefined && String(explicit).trim() !== "") {
    return explicit;
  }
  return env.VERCEL === "1" ? 1 : false;
}

async function handler(req, res) {
  try {
    configureTrustProxy(app, resolveServerlessTrustProxy(process.env));
    validateAuthConfig(getAuthConfig());
    await connectDB();
  } catch (error) {
    console.error("Serverless initialization error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server configuration or database connection failed",
    });
  }

  return app(req, res);
}

handler.resolveServerlessTrustProxy = resolveServerlessTrustProxy;

module.exports = handler;
