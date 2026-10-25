
const mongoose = require("mongoose");
const dns = require("node:dns");

dns.setServers(["8.8.8.8"]);

async function connectDB() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from server/.env");
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });

  console.log("MongoDB Atlas connected successfully");
}

module.exports = connectDB;
