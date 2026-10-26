
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("node:path");

// Load environment variables before importing routes and middleware.
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

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

const allowedOrigins = (
  process.env.CLIENT_ORIGIN ||
  "http://localhost:5173,http://127.0.0.1:5173"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(securityHeaders);
// Bearer tokens only: no cookies are used, so credentials stay disabled.
app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "100kb" }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRouter);
app.use("/api/audit", auditRouter);
app.use("/api/flags", featureFlagRoutes);

app.get("/api/health", (req, res) => {
  const mongoose = require("mongoose");

  res.status(200).json({
    success: true,
    message: "FeatureFlag Studio API is running",
    environment: process.env.NODE_ENV || "development",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
    timestamp: new Date().toISOString(),
  });
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

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, resolveTrustProxy, configureTrustProxy };
