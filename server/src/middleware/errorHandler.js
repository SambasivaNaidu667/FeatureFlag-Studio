
function notFoundHandler(req, res, next) {
  const error = new Error(
    `Route not found: ${req.method} ${req.originalUrl}`
  );
  error.statusCode = 404;
  next(error);
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal server error";

  // MongoDB duplicate-key error
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    message = `A feature flag with this ${field} already exists`;
  }

  // Mongoose validation errors
  else if (err.name === "ValidationError") {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((item) => item.message)
      .join(", ");
  }

  // Invalid MongoDB ObjectId
  else if (err.name === "CastError") {
    statusCode = 400;
    message = "Invalid ID or field value";
  }

  if (statusCode >= 500) {
    console.error(err);
    message = "Internal server error";
  }

  res.status(statusCode).json({
    success: false,
    message,
  });
}

module.exports = { notFoundHandler, errorHandler };
