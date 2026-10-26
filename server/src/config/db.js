
const mongoose = require("mongoose");

let connectionPromise = null;

mongoose.connection.on("disconnected", () => {
  connectionPromise = null;
});

async function connectDB(uri = process.env.MONGODB_URI) {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  if (!uri) {
    throw new Error("MONGODB_URI is missing from server/.env");
  }

  const options = {
    serverSelectionTimeoutMS: 10000,
  };
  if (process.env.MONGODB_DNS_SERVER) {
    const dns = require("node:dns");
    dns.setServers([process.env.MONGODB_DNS_SERVER]);
  }

  connectionPromise = Promise.resolve()
    .then(() => mongoose.connect(uri, options))
    .then((conn) => {
      console.log("MongoDB Atlas connected successfully");
      return conn?.connection || mongoose.connection;
    })
    .catch((error) => {
      connectionPromise = null;
      throw error;
    });

  return connectionPromise;
}

function resetConnectionCache() {
  connectionPromise = null;
}

connectDB.resetConnectionCache = resetConnectionCache;

module.exports = connectDB;
