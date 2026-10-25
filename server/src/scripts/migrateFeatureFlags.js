
require("dotenv").config({
  path: require("node:path").resolve(__dirname, "../../.env"),
});

const mongoose = require("mongoose");
if (process.env.MONGODB_DNS_SERVER) {
  require("node:dns").setServers([process.env.MONGODB_DNS_SERVER]);
}

const environments = ["development", "staging", "production"];
const dryRun = process.argv.includes("--dry-run");

async function migrateFeatureFlags() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from server/.env");
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });

  try {
    const collection = mongoose.connection.collection("featureflags");
    const flags = await collection.find({}).toArray();

    console.log(`Found ${flags.length} feature flag(s).`);
    console.log(
      `Mode: ${dryRun ? "DRY RUN - no writes" : "LIVE MIGRATION"}`
    );

    const validationErrors = [];
    for (const flag of flags) {
      if (flag.environments) {
        continue;
      }

      if (!environments.includes(flag.environment)) {
        validationErrors.push(
          `${flag._id}: unsupported environment "${flag.environment}"`
        );
      }

      if (typeof flag.enabled !== "boolean") {
        validationErrors.push(`${flag._id}: enabled must be a boolean`);
      }
    }

    const pendingFlags = flags.filter((flag) => !flag.environments);
    const alreadyMigrated = flags.length - pendingFlags.length;

    if (dryRun) {
      for (const flag of pendingFlags) {
        console.log(
          `WOULD MIGRATE: ${flag.key} (${flag.environment}, enabled=${flag.enabled})`
        );
      }

      console.log(`Would migrate: ${pendingFlags.length}`);
      console.log(`Already migrated: ${alreadyMigrated}`);
      console.log(`Requires attention: ${validationErrors.length}`);
      validationErrors.forEach((error) => console.log(`ATTENTION: ${error}`));
      return;
    }

    if (validationErrors.length) {
      throw new Error(
        `Migration aborted before writes:\n${validationErrors.join("\n")}`
      );
    }

    if (pendingFlags.length === 0) {
      console.log("No legacy flags require migration.");
      return;
    }

    // Create a unique backup collection for this migration attempt.
    const backupCollectionName =
      `featureflags_backup_${new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, "")}`;

    const existingBackup = await mongoose.connection
      .listCollections({ name: backupCollectionName })
      .hasNext();
    if (existingBackup) {
      throw new Error(`Backup collection already exists: ${backupCollectionName}`);
    }
    const backupCollection = mongoose.connection.collection(backupCollectionName);

    await backupCollection.insertMany(pendingFlags);

    const backupCount = await backupCollection.countDocuments();
    const backupIds = await backupCollection
      .find({}, { projection: { _id: 1, key: 1, enabled: 1, environment: 1 } })
      .toArray();
    const backupMatches = backupIds.length === pendingFlags.length &&
      pendingFlags.every((flag) => backupIds.some((copy) =>
        copy._id.equals(flag._id) &&
        copy.key === flag.key &&
        copy.enabled === flag.enabled &&
        copy.environment === flag.environment
      ));

    if (backupCount !== pendingFlags.length || !backupMatches) {
      throw new Error(
        `Backup verification failed: expected ${pendingFlags.length} matching documents, found ${backupCount}.`
      );
    }

    console.log(`Backup verified: ${backupCount} document(s).`);

    let migratedCount = 0;

    for (const flag of pendingFlags) {
      const environmentConfigs = {};

      for (const environment of environments) {
        environmentConfigs[environment] = {
          enabled:
            environment === flag.environment ? flag.enabled : false,
          rolloutPercentage: 0,
          allowlist: [],
          denylist: [],
        };
      }

      const result = await collection.updateOne(
        {
          _id: flag._id,
          environments: { $exists: false },
          environment: flag.environment,
          enabled: flag.enabled,
        },
        {
          $set: { environments: environmentConfigs },
          $unset: {
            enabled: "",
            environment: "",
          },
        }
      );

      if (result.modifiedCount !== 1) {
        throw new Error(
          `Migration stopped at "${flag.key}". Check the backup before retrying.`
        );
      }

      migratedCount++;
      console.log(`MIGRATED: ${flag.key}`);
    }

    console.log(`Migration completed: ${migratedCount} document(s).`);
  } finally {
    await mongoose.disconnect();
  }
}

migrateFeatureFlags().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
});
