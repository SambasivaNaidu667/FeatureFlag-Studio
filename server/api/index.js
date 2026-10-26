const { app, configureTrustProxy } = require("../src/server");
const connectDB = require("../src/config/db");
const { validateAuthConfig, getAuthConfig } = require("../src/auth/auth");

function resolveServerlessTrustProxy(env = process.env) {
  const explicit = connectDB.cleanEnvValue(env.TRUST_PROXY);
  if (explicit !== undefined && String(explicit).trim() !== "") {
    const normalized = String(explicit).trim().toLowerCase();
    if (env.VERCEL === "1" && normalized === "true") {
      return 1;
    }
    return explicit;
  }
  return env.VERCEL === "1" ? 1 : false;
}

async function handler(req, res) {
  try {
    configureTrustProxy(app, resolveServerlessTrustProxy(process.env));
    if (req.method === "OPTIONS") {
      return app(req, res);
    }
    validateAuthConfig(getAuthConfig());
    await connectDB();
  } catch (error) {
    const diagnostic = connectDB.classifyInitializationError(error);
    console.error(
      `[serverless:init] stage=${diagnostic.stage} code=${diagnostic.code} errorName=${error?.name || "Error"} message=${diagnostic.message}`
    );
    req.initError = error;
    req.initDiagnostic = diagnostic;
    const urlPath = (req.url || "").split("?")[0];
    if (urlPath === "/api/health" || urlPath === "/") {
      return app(req, res);
    }
    return res.status(diagnostic.status || 503).json({
      success: false,
      code: diagnostic.code,
      stage: diagnostic.stage,
      message: diagnostic.message,
    });
  }

  return app(req, res);
}

handler.resolveServerlessTrustProxy = resolveServerlessTrustProxy;

module.exports = handler;
