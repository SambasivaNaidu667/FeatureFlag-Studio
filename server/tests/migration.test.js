const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const {
  buildEnvironmentConfigs,
  deepEqual,
  validateLegacyDocument,
  validateMigratedDocument,
} = require("../src/scripts/migrationHelpers");
const {
  migrateFeatureFlags,
  parseArguments,
} = require("../src/scripts/migrateFeatureFlags");

function legacy(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    name: "Checkout",
    key: "checkout_v1",
    description: "Test flag",
    environment: "production",
    enabled: true,
    ...overrides,
  };
}

function migrated(overrides = {}) {
  const flag = legacy();
  delete flag.enabled;
  delete flag.environment;
  flag.environments = buildEnvironmentConfigs({
    environment: "production",
    enabled: true,
  });
  return { ...flag, ...overrides };
}

function fakeDb(flags, { backupCopy } = {}) {
  const collections = new Map([["featureflags", { documents: flags }]]);
  const updates = [];
  const writes = {
    insertMany: 0,
    insertOne: 0,
    updateOne: 0,
    updateMany: 0,
    replaceOne: 0,
    deleteOne: 0,
    deleteMany: 0,
    createCollection: 0,
  };
  const handles = new Map();
  const db = {
    updates,
    writes,
    listCollections(filter) {
      const exists = collections.has(filter.name);
      return {
        toArray: async () => (exists ? [{ name: filter.name }] : []),
        hasNext: async () => exists,
      };
    },
    collection(name) {
      if (!collections.has(name)) {
        collections.set(name, { documents: backupCopy || [], backup: true });
      }
      const item = collections.get(name);
      if (handles.has(name)) return handles.get(name);
      const handle = {
        find: () => ({ toArray: async () => item.documents }),
        insertMany: async (documents) => {
          writes.insertMany += 1;
          item.documents = backupCopy || documents.map((document) => ({ ...document }));
        },
        insertOne: async () => { writes.insertOne += 1; },
        updateOne: async (filter) => {
          writes.updateOne += 1;
          updates.push(filter);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        updateMany: async () => { writes.updateMany += 1; },
        replaceOne: async () => { writes.replaceOne += 1; },
        deleteOne: async () => { writes.deleteOne += 1; },
        deleteMany: async () => { writes.deleteMany += 1; },
      };
      handles.set(name, handle);
      return handle;
    },
  };
  return db;
}

function assertNoWrites(db) {
  assert.deepEqual(db.writes, {
    insertMany: 0,
    insertOne: 0,
    updateOne: 0,
    updateMany: 0,
    replaceOne: 0,
    deleteOne: 0,
    deleteMany: 0,
    createCollection: 0,
  });
}

test("enabled legacy environments receive 100 percent rollout", () => {
  for (const environment of ["development", "staging", "production"]) {
    const configs = buildEnvironmentConfigs({ environment, enabled: true });
    for (const name of Object.keys(configs)) {
      assert.equal(configs[name].enabled, name === environment);
      assert.equal(configs[name].rolloutPercentage, name === environment ? 100 : 0);
      assert.deepEqual(configs[name].allowlist, []);
      assert.deepEqual(configs[name].denylist, []);
    }
  }
});

test("disabled legacy flags remain disabled with zero rollout", () => {
  const configs = buildEnvironmentConfigs({ environment: "production", enabled: false });
  for (const config of Object.values(configs)) {
    assert.equal(config.enabled, false);
    assert.equal(config.rolloutPercentage, 0);
  }
});

test("legacy and migrated document validation rejects malformed shapes", () => {
  assert.equal(validateLegacyDocument(legacy({ name: "x" })), "name is invalid");
  assert.equal(validateLegacyDocument(legacy({ enabled: "true" })), "enabled must be a boolean");
  assert.match(validateLegacyDocument(legacy({ legacyTargeting: [] })), /unexpected field/);
  for (const environments of [null, {}, { production: null }]) {
    assert.match(
      validateMigratedDocument({ ...legacy(), environments }),
      /environments|configuration|unexpected|legacy/
    );
  }
  assert.match(
    validateMigratedDocument({
      ...migrated(),
      environments: { ...migrated().environments, qa: {} },
    }),
    /unsupported environment/
  );
  assert.match(
    validateMigratedDocument({
      ...migrated(),
      environments: {
        ...migrated().environments,
        production: {
          ...migrated().environments.production,
          rolloutPercentage: "50",
        },
      },
    }),
    /rolloutPercentage/
  );
  assert.match(
    validateMigratedDocument({
      ...migrated(),
      enabled: false,
    }),
    /legacy field/
  );
  assert.match(
    validateMigratedDocument({ ...migrated(), legacyTargeting: [] }),
    /unexpected field/
  );
});

test("migrated validation rejects unknown nested environment fields", () => {
  for (const environment of ["production", "development", "staging"]) {
    const flag = migrated();
    flag.environments[environment].debug = true;
    assert.equal(
      validateMigratedDocument(flag),
      `${environment} has unexpected field "debug"`
    );
  }

  const valid = migrated();
  assert.equal(validateMigratedDocument(valid), null);

  const missingRequired = migrated();
  delete missingRequired.environments.production.denylist;
  assert.equal(
    validateMigratedDocument(missingRequired),
    "production.denylist is required"
  );
});

test("targeting validation rejects malformed rollout and lists", () => {
  for (const value of [150, -1, "50", NaN, Infinity, -Infinity, undefined, null]) {
    const config = {
      ...migrated().environments.production,
      rolloutPercentage: value,
    };
    assert.match(
      validateMigratedDocument({
        ...migrated(),
        environments: { ...migrated().environments, production: config },
      }),
      /rolloutPercentage/
    );
  }
  for (const allowlist of ["user", ["user", "user"], [""], [" user"], [1], Array(1001).fill("u")]) {
    const config = { ...migrated().environments.production, allowlist };
    assert.match(
      validateMigratedDocument({
        ...migrated(),
        environments: { ...migrated().environments, production: config },
      }),
      /allowlist/
    );
  }
  assert.equal(
    validateMigratedDocument({
      ...migrated(),
      environments: {
        ...migrated().environments,
        production: { ...migrated().environments.production, rolloutPercentage: 0 },
      },
    }),
    null
  );
  assert.equal(
    validateMigratedDocument({
      ...migrated(),
      environments: {
        ...migrated().environments,
        production: { ...migrated().environments.production, rolloutPercentage: 100 },
      },
    }),
    null
  );
});

test("deep equality handles nested values, dates, and ObjectIds", () => {
  const id = new mongoose.Types.ObjectId();
  assert.equal(deepEqual({ id, date: new Date(1), values: [1, { ok: true }] }, {
    id: new mongoose.Types.ObjectId(id.toString()),
    date: new Date(1),
    values: [1, { ok: true }],
  }), true);
  assert.equal(deepEqual({ value: null }, {}), false);
  assert.equal(deepEqual({ values: [1] }, { values: [2] }), false);
});

test("migration validates before updates and verifies the backup", async () => {
  const invalidDb = fakeDb([legacy({ enabled: "yes" })]);
  await assert.rejects(
    migrateFeatureFlags({ db: invalidDb, apply: true, logger: { log() {} } }),
    /aborted before writes/
  );
  assert.equal(invalidDb.updates.length, 0);

  const mismatchDb = fakeDb([legacy()], { backupCopy: [legacy({ key: "other_key" })] });
  await assert.rejects(
    migrateFeatureFlags({ db: mismatchDb, apply: true, logger: { log() {} } }),
    /Backup verification failed/
  );
  assert.equal(mismatchDb.updates.length, 0);
});

test("migration detects conflicts, supports dry-run, and skips valid migrated records", async () => {
  const dryRunDb = fakeDb([legacy()]);
  const dryRun = await migrateFeatureFlags({ db: dryRunDb, logger: { log() {} } });
  assert.equal(dryRun.migratedCount, 0);
  assert.equal(dryRunDb.updates.length, 0);
  assertNoWrites(dryRunDb);

  const migratedDb = fakeDb([migrated()]);
  const result = await migrateFeatureFlags({ db: migratedDb, apply: true, logger: { log() {} } });
  assert.equal(result.migratedCount, 0);
  assert.equal(migratedDb.updates.length, 0);

  const conflictDb = fakeDb([legacy()]);
  conflictDb.collection("featureflags").updateOne = async () => ({
    matchedCount: 0,
    modifiedCount: 0,
  });
  await assert.rejects(
    migrateFeatureFlags({ db: conflictDb, apply: true, logger: { log() {} } }),
    /Migration conflict/
  );
});

test("CLI requires explicit apply and rejects conflicting flags", () => {
  assert.deepEqual(parseArguments([]), { apply: false, dryRun: false });
  assert.deepEqual(parseArguments(["--dry-run"]), { apply: false, dryRun: true });
  assert.deepEqual(parseArguments(["--apply"]), { apply: true, dryRun: false });
  assert.throws(() => parseArguments(["--dry-run", "--apply"]), /Usage/);
  assert.throws(() => parseArguments(["--unknown"]), /Usage/);
});

test("missing featureflags collection is reported", async () => {
  const db = fakeDb([]);
  db.listCollections = () => ({
    toArray: async () => [],
    hasNext: async () => false,
  });
  await assert.rejects(
    migrateFeatureFlags({ db, apply: true, logger: { log() {} } }),
    /does not exist/
  );
});
