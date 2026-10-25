
const mongoose = require("mongoose");
async function connectDB() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from server/.env");
  }

  const options = {
    serverSelectionTimeoutMS: 10000,
  };
  if (process.env.MONGODB_DNS_SERVER) {
    const dns = require("node:dns");
    dns.setServers([process.env.MONGODB_DNS_SERVER]);
  }
  await mongoose.connect(process.env.MONGODB_URI, options);

  console.log("MongoDB Atlas connected successfully");
}

module.exports = connectDB;
