require("dotenv").config({
  path: require("node:path").resolve(__dirname, "../../.env"),
});

const mongoose = require("mongoose");
const {
  ENVIRONMENTS,
  buildEnvironmentConfigs,
  deepEqual,
  validateLegacyDocument,
  validateMigratedDocument,
} = require("./migrationHelpers");

function parseArguments(args) {
  const supported = new Set(["--dry-run", "--apply"]);
  const unknown = args.filter((arg) => !supported.has(arg));
  if (unknown.length || (args.includes("--dry-run") && args.includes("--apply"))) {
    throw new Error("Usage: node src/scripts/migrateFeatureFlags.js [--dry-run|--apply]");
  }
  return { apply: args.includes("--apply"), dryRun: args.includes("--dry-run") };
}

async function migrateFeatureFlags({ db, apply = false, logger = console } = {}) {
  if (!db) throw new Error("A database connection is required");
  const collections = await db.listCollections({ name: "featureflags" }).toArray();
  if (!collections.length) throw new Error("The featureflags collection does not exist");

  const collection = db.collection("featureflags");
  const flags = await collection.find({}).toArray();
  const pending = [];
  const validationErrors = [];

  for (const flag of flags) {
    if (Object.prototype.hasOwnProperty.call(flag, "environments")) {
      const error = validateMigratedDocument(flag);
      if (error) validationErrors.push(`${flag._id}: ${error}`);
    } else {
      const error = validateLegacyDocument(flag);
      if (error) validationErrors.push(`${flag._id}: ${error}`);
      else pending.push(flag);
    }
  }

  logger.log(`Found ${flags.length} feature flag(s).`);
  logger.log(`Would migrate: ${pending.length}`);
  logger.log(`Already migrated: ${flags.length - pending.length - validationErrors.length}`);
  logger.log(`Requires attention: ${validationErrors.length}`);
  validationErrors.forEach((error) => logger.log(`ATTENTION: ${error}`));
  if (!apply) return { pending, validationErrors, migratedCount: 0 };
  if (validationErrors.length) {
    throw new Error(`Migration aborted before writes:\n${validationErrors.join("\n")}`);
  }
  if (!pending.length) return { pending, validationErrors, migratedCount: 0 };

  const backupName = `featureflags_backup_${new Date().toISOString().replace(/[-:.TZ]/g, "")}`;
  if (await db.listCollections({ name: backupName }).hasNext()) {
    throw new Error(`Backup collection already exists: ${backupName}`);
  }
  const backup = db.collection(backupName);
  await backup.insertMany(pending);
  const copies = await backup.find({}).toArray();
  if (
    copies.length !== pending.length ||
    !pending.every((flag) => copies.some((copy) => deepEqual(flag, copy)))
  ) {
    throw new Error(`Backup verification failed for ${backupName}`);
  }
  logger.log(`Backup verified: ${backupName}`);

  let migratedCount = 0;
  for (const flag of pending) {
    const result = await collection.updateOne(
      {
        _id: flag._id,
        name: flag.name,
        key: flag.key,
        environment: flag.environment,
        enabled: flag.enabled,
        environments: { $exists: false },
      },
      {
        $set: { environments: buildEnvironmentConfigs(flag) },
        $unset: { enabled: "", environment: "" },
      }
    );
    if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
      throw new Error(`Migration conflict for "${flag.key}" after ${migratedCount} successful update(s)`);
    }
    migratedCount += 1;
  }
  logger.log(`Migration completed: ${migratedCount} document(s).`);
  return { pending, validationErrors, migratedCount, backupName };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.apply && !options.dryRun) {
    console.log("No migration performed. Use --dry-run to validate or --apply to write.");
    return;
  }
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing from server/.env");
  if (process.env.MONGODB_DNS_SERVER) {
    require("node:dns").setServers([process.env.MONGODB_DNS_SERVER]);
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await migrateFeatureFlags({
      db: mongoose.connection.db,
      apply: options.apply,
      logger: console,
    });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, migrateFeatureFlags, parseArguments };
