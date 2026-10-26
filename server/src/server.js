
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

// Load environment variables before importing routes and middleware.
dotenv.config();

const featureFlagRoutes = require("./routes/featureFlagRoutes");
const authRoutes = require("./routes/authRoutes");
const { validateAuthConfig, getAuthConfig } = require("./auth/auth");

const connectDB = require("./config/db");
const {
  notFoundHandler,
  errorHandler,
} = require("./middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
  })
);

app.use(express.json({ limit: "100kb" }));

app.use("/api/auth", authRoutes);
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

    app.listen(PORT, () => {
      console.log(
        `FeatureFlag Studio API running at http://localhost:${PORT}`
      );
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
