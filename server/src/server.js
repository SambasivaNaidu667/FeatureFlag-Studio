
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("node:path");

// Load environment variables before importing routes and middleware.
dotenv.config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

const featureFlagRoutes = require("./routes/featureFlagRoutes");
const authRoutes = require("./routes/authRoutes");
const { userRouter, auditRouter } = require("./routes/userRoutes");
const { validateAuthConfig, getAuthConfig } = require("./auth/auth");
const securityHeaders = require("./middleware/securityHeaders");

const connectDB = require("./config/db");
const {
  notFoundHandler,
  errorHandler,
} = require("./middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 5000;

const NAMED_TRUST_PROXY_SUBNETS = new Set([
  "loopback",
  "linklocal",
  "uniquelocal",
]);

function resolveTrustProxy(value = process.env.TRUST_PROXY) {
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (typeof value === "number") {
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
    throw new Error(
      'Invalid TRUST_PROXY value. Use "false" (default), a positive integer hop count (such as "1"), or "loopback", "linklocal", or "uniquelocal".'
    );
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "" || normalized === "false" || normalized === "0") {
      return false;
    }
    if (/^[1-9]\d*$/.test(normalized)) {
      return Number(normalized);
    }
    if (NAMED_TRUST_PROXY_SUBNETS.has(normalized)) {
      return normalized;
    }
  }
  throw new Error(
    'Invalid TRUST_PROXY value. Use "false" (default), a positive integer hop count (such as "1"), or "loopback", "linklocal", or "uniquelocal". Do not use "true" or "*".'
  );
}

function configureTrustProxy(targetApp = app, value = process.env.TRUST_PROXY) {
  const resolved = resolveTrustProxy(value);
  targetApp.set("trust proxy", resolved);
  return resolved;
}

app.disable("x-powered-by");
try {
  configureTrustProxy(app, process.env.TRUST_PROXY);
} catch {
  app.set("trust proxy", false);
}

const DEFAULT_CLIENT_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://feature-flag-studio-kappa.vercel.app",
];

function getAllowedOrigins(value = process.env.CLIENT_ORIGIN) {
  const rawList = value
    ? `${value},${DEFAULT_CLIENT_ORIGINS.join(",")}`
    : DEFAULT_CLIENT_ORIGINS.join(",");
  return Array.from(
    new Set(
      rawList
        .split(",")
        .map((origin) =>
          origin
            .trim()
            .replace(/^(['"])(.*)\1$/, "$2")
            .trim()
            .replace(/\/+$/, "")
        )
        .filter(Boolean)
    )
  );
}

app.use(securityHeaders);
// Bearer tokens only: no cookies are used, so credentials stay disabled.
app.use(
  cors({
    origin(requestOrigin, callback) {
      if (!requestOrigin) return callback(null, true);
      const allowed = getAllowedOrigins();
      const normalizedOrigin = requestOrigin.trim().replace(/\/+$/, "");
      return callback(null, allowed.includes(normalizedOrigin));
    },
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "100kb" }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRouter);
app.use("/api/audit", auditRouter);
app.use("/api/flags", featureFlagRoutes);

function buildHealthReport(req) {
  const mongoose = require("mongoose");
  const environment = process.env.NODE_ENV || "development";
  const timestamp = new Date().toISOString();
  const isConnected = mongoose.connection.readyState === 1;

  let diagnostic = req?.initDiagnostic || null;
  if (!diagnostic) {
    try {
      validateAuthConfig(getAuthConfig());
    } catch (error) {
      diagnostic = connectDB.classifyInitializationError(error);
    }
  }
  if (!diagnostic && !isConnected) {
    const lastError = connectDB.getLastError();
    diagnostic = lastError
      ? connectDB.classifyInitializationError(lastError)
      : {
          status: 503,
          code: "DATABASE_DISCONNECTED",
          stage: "database_connection",
          message: "Database is disconnected",
        };
  }

  if (diagnostic || !isConnected) {
    return {
      statusCode: diagnostic?.status || 503,
      body: {
        success: false,
        code: diagnostic.code,
        stage: diagnostic.stage,
        message: diagnostic.message,
        environment,
        database: isConnected ? "connected" : "disconnected",
        timestamp,
      },
    };
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "FeatureFlag Studio API is running",
      environment,
      database: "connected",
      timestamp,
    },
  };
}

app.get("/", (req, res) => {
  const report = buildHealthReport(req);
  return res.status(report.statusCode).json(report.body);
});

app.get("/api/health", (req, res) => {
  const report = buildHealthReport(req);
  return res.status(report.statusCode).json(report.body);
});

app.use(notFoundHandler);
app.use(errorHandler);

async function startServer() {
  try {
    configureTrustProxy(app, process.env.TRUST_PROXY);
    validateAuthConfig(getAuthConfig());
    await connectDB();

    const server = app.listen(PORT, () => {
      console.log(
        `FeatureFlag Studio API running at http://localhost:${PORT}`
      );
    });
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(
          `Port ${PORT} is already in use. Another backend instance is probably running; stop it or set PORT in server/.env.`
        );
      } else {
        console.error("Server error:", error.message);
      }
      process.exit(1);
    });
  } catch (error) {
    console.error("Failed to start the server:", error.message);
    process.exit(1);
  }
}

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

async function serverlessHandler(req, res) {
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

if (require.main === module) {
  startServer();
}

serverlessHandler.app = app;
serverlessHandler.startServer = startServer;
serverlessHandler.resolveTrustProxy = resolveTrustProxy;
serverlessHandler.configureTrustProxy = configureTrustProxy;
serverlessHandler.getAllowedOrigins = getAllowedOrigins;
serverlessHandler.resolveServerlessTrustProxy = resolveServerlessTrustProxy;

module.exports = serverlessHandler;
