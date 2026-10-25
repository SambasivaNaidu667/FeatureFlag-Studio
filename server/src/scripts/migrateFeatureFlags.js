
require("dotenv").config({
  path: require("node:path").resolve(__dirname, "../../.env"),
});

const mongoose = require("mongoose");
const dns = require("node:dns");

dns.setServers(["8.8.8.8"]);

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

    // Validate every legacy document before writing anything.
    for (const flag of flags) {
      if (flag.environments) {
        continue;
      }

      if (!environments.includes(flag.environment)) {
        throw new Error(
          `Flag "${flag.key}" has an unsupported environment.`
        );
      }

      if (typeof flag.enabled !== "boolean") {
        throw new Error(
          `Flag "${flag.key}" has an invalid enabled value.`
        );
      }
    }

    const pendingFlags = flags.filter((flag) => !flag.environments);

    if (dryRun) {
      for (const flag of pendingFlags) {
        console.log(
          `WOULD MIGRATE: ${flag.key} (${flag.environment}, enabled=${flag.enabled})`
        );
      }

      console.log(`Would migrate: ${pendingFlags.length}`);
      console.log(
        `Already migrated: ${flags.length - pendingFlags.length}`
      );
      return;
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

    const backupCollection =
      mongoose.connection.collection(backupCollectionName);

    await backupCollection.insertMany(pendingFlags);

    const backupCount = await backupCollection.countDocuments();

    if (backupCount !== pendingFlags.length) {
      throw new Error(
        `Backup verification failed: expected ${pendingFlags.length}, found ${backupCount}.`
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
