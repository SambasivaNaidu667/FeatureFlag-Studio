const mongoose = require("mongoose");
const net = require("node:net");

let connectionPromise = null;
let lastConnectionError = null;

mongoose.connection.on("disconnected", () => {
  connectionPromise = null;
});

function cleanEnvValue(value) {
  if (typeof value !== "string") return value;
  let cleaned = value.trim();
  if (
    cleaned.length >= 2 &&
    ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'")))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

function normalizeMongoUri(rawUri) {
  if (typeof rawUri !== "string") return "";
  let cleaned = cleanEnvValue(rawUri);
  if (/^MONGODB_URI\s*=/i.test(cleaned)) {
    cleaned = cleanEnvValue(cleaned.replace(/^MONGODB_URI\s*=/i, ""));
  }
  return cleaned;
}

function classifyInitializationError(error) {
  const message = String(error?.message || "");
  const name = String(error?.name || "");

  if (message.includes("Missing authentication configuration")) {
    return {
      status: 503,
      code: "MISSING_JWT_SECRET",
      stage: "auth_config",
      message: "Server configuration error: JWT_SECRET is not set",
    };
  }
  if (message.includes("JWT_SECRET must be at least 32 characters")) {
    return {
      status: 503,
      code: "INVALID_JWT_SECRET",
      stage: "auth_config",
      message: "Server configuration error: JWT_SECRET must be at least 32 characters long",
    };
  }
  if (message.includes("Invalid TRUST_PROXY value")) {
    return {
      status: 503,
      code: "INVALID_TRUST_PROXY",
      stage: "trust_proxy",
      message:
        'Server configuration error: TRUST_PROXY must be "false" or a positive integer hop count (such as "1")',
    };
  }
  if (message.includes("MONGODB_URI is missing")) {
    return {
      status: 503,
      code: "MISSING_MONGODB_URI",
      stage: "database_config",
      message: "Database configuration error: MONGODB_URI is not set",
    };
  }
  if (
    message.includes("Invalid MONGODB_URI scheme") ||
    message.includes("Invalid scheme") ||
    name === "MongoParseError"
  ) {
    return {
      status: 503,
      code: "INVALID_MONGODB_URI",
      stage: "database_config",
      message:
        'Database configuration error: MONGODB_URI must start with "mongodb://" or "mongodb+srv://"',
    };
  }
  if (
    /bad auth|authentication failed/i.test(message) ||
    error?.code === 18 ||
    error?.code === 8000
  ) {
    return {
      status: 503,
      code: "MONGODB_AUTH_FAILED",
      stage: "database_auth",
      message:
        "Database connection failed: MongoDB authentication failed (verify username and password in MONGODB_URI)",
    };
  }
  if (/querySrv|ENOTFOUND|EAI_AGAIN|EREFUSED/i.test(message)) {
    return {
      status: 503,
      code: "MONGODB_DNS_ERROR",
      stage: "database_dns",
      message:
        "Database connection failed: could not resolve MongoDB cluster hostname in MONGODB_URI",
    };
  }
  if (
    name === "MongooseServerSelectionError" ||
    /Could not connect to any servers in your MongoDB Atlas cluster|Server selection timed out/i.test(
      message
    )
  ) {
    return {
      status: 503,
      code: "MONGODB_ATLAS_NETWORK_ACCESS",
      stage: "database_network",
      message:
        "Database connection failed: could not reach MongoDB Atlas. Ensure Atlas Network Access allows Vercel IPs (0.0.0.0/0) and MONGODB_URI points to an active cluster.",
    };
  }

  return {
    status: 503,
    code: "SERVER_INITIALIZATION_FAILED",
    stage: "initialization",
    message: "Server configuration or database connection failed",
  };
}

async function connectDB(rawUri = process.env.MONGODB_URI) {
  if (mongoose.connection.readyState === 1) {
    lastConnectionError = null;
    return mongoose.connection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  const uri = normalizeMongoUri(rawUri);
  if (!uri) {
    const missingError = new Error("MONGODB_URI is missing from server/.env");
    lastConnectionError = missingError;
    throw missingError;
  }

  if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
    const schemeError = new Error(
      'Invalid MONGODB_URI scheme: expected connection string to start with "mongodb://" or "mongodb+srv://"'
    );
    lastConnectionError = schemeError;
    throw schemeError;
  }

  const defaultTimeout = process.env.VERCEL === "1" ? 5000 : 10000;
  const configuredTimeout = Number(process.env.MONGODB_CONNECT_TIMEOUT_MS);
  const serverSelectionTimeoutMS =
    Number.isInteger(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : defaultTimeout;

  const options = {
    serverSelectionTimeoutMS,
  };

  // Only apply custom DNS override outside Vercel serverless when a valid IP is provided.
  if (process.env.MONGODB_DNS_SERVER && process.env.VERCEL !== "1") {
    const dnsServer = cleanEnvValue(process.env.MONGODB_DNS_SERVER);
    if (net.isIP(dnsServer) !== 0) {
      const dns = require("node:dns");
      dns.setServers([dnsServer]);
    }
  }

  connectionPromise = Promise.resolve()
    .then(() => mongoose.connect(uri, options))
    .then((conn) => {
      connectionPromise = null;
      lastConnectionError = null;
      console.log("MongoDB Atlas connected successfully");
      return conn?.connection || mongoose.connection;
    })
    .catch((error) => {
      connectionPromise = null;
      lastConnectionError = error;
      throw error;
    });

  return connectionPromise;
}

function resetConnectionCache() {
  connectionPromise = null;
  lastConnectionError = null;
}

function getLastError() {
  return lastConnectionError;
}

connectDB.resetConnectionCache = resetConnectionCache;
connectDB.getLastError = getLastError;
connectDB.classifyInitializationError = classifyInitializationError;
connectDB.cleanEnvValue = cleanEnvValue;
connectDB.normalizeMongoUri = normalizeMongoUri;

module.exports = connectDB;
