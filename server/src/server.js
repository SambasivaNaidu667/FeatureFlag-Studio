const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

const {
  notFoundHandler,
  errorHandler,
} = require("./middleware/errorHandler");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: "http://localhost:5173",
  })
);

app.use(express.json());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "FeatureFlag Studio API is running",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(
    `FeatureFlag Studio API running at http://localhost:${PORT}`
  );
});
