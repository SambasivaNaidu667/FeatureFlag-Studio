function positiveInteger(value, fallback) {
  const isInteger =
    (typeof value === "number" &&
      Number.isFinite(value) &&
      Number.isInteger(value)) ||
    (typeof value === "string" && /^\d+$/.test(value));
  const parsed = Number(value);
  return isInteger && parsed > 0 ? parsed : fallback;
}

function createRateLimiter({
  max = 10,
  windowMs = 15 * 60 * 1000,
  fallbackMax = 10,
  fallbackWindowMs = 15 * 60 * 1000,
  message = "Too many requests, please try again later",
  keyGenerator = (req) => req.ip,
} = {}) {
  const limit = positiveInteger(max, fallbackMax);
  const window = positiveInteger(windowMs, fallbackWindowMs);
  const requests = new Map();

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    for (const [storedKey, storedEntry] of requests) {
      if (storedEntry.expiresAt <= now) requests.delete(storedKey);
    }
    const key = keyGenerator(req);
    const current = requests.get(key);
    const entry =
      current && current.expiresAt > now
        ? current
        : { count: 0, expiresAt: now + window };

    entry.count += 1;
    requests.set(key, entry);

    const remaining = Math.max(0, limit - entry.count);
    res.set("RateLimit-Limit", String(limit));
    res.set("RateLimit-Remaining", String(remaining));
    res.set("RateLimit-Reset", String(Math.ceil(entry.expiresAt / 1000)));

    if (entry.count > limit) {
      return res.status(429).json({
        success: false,
        message,
      });
    }

    return next();
  };
}

function rateLimitFromEnv({
  maxEnv,
  windowEnv,
  defaultMax,
  defaultWindowMs,
  message,
} = {}) {
  return createRateLimiter({
    max: process.env[maxEnv] || defaultMax,
    windowMs: process.env[windowEnv] || defaultWindowMs,
    fallbackMax: defaultMax,
    fallbackWindowMs: defaultWindowMs,
    message,
  });
}

module.exports = { createRateLimiter, rateLimitFromEnv };
