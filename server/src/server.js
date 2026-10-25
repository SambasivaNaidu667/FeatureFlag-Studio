const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const featureFlagRoutes = require("./routes/featureFlagRoutes");

dotenv.config();

const connectDB = require("./config/db");
const {
  notFoundHandler,
  errorHandler,
} = require("./middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
    ],
  })
);

app.use(express.json());
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

startServer();