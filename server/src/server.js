
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

app.disable("x-powered-by");

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

module.exports = { app, startServer };
