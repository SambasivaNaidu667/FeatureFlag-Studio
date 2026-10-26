/*
 * Local administrator password reset.
 *
 * Usage (from the server directory):
 *   npm run set-admin-password
 *
 * Prompts for a new password (input hidden), generates a bcrypt hash locally
 * and writes it to ADMIN_PASSWORD_HASH in server/.env. The previous file is
 * backed up to server/.env.bak (git-ignored). Neither the password nor the
 * hash is printed. Restart the backend afterwards.
 */
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const bcrypt = require("bcryptjs");

const ENV_PATH = path.resolve(__dirname, "..", "..", ".env");
const MIN_LENGTH = 8;

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    // Suppress echo of typed characters.
    rl._writeToOutput = (text) => {
      if (text.includes(question)) rl.output.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function upsertEnvValue(content, key, value) {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index === -1) lines.push(`${key}=${value}`);
  else lines[index] = `${key}=${value}`;
  return lines.join("\n");
}

async function main() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error("server/.env not found. Copy server/.env.example to server/.env first.");
    process.exit(1);
  }

  const password = await promptHidden("New admin password: ");
  if (password.length < MIN_LENGTH) {
    console.error(`Password must be at least ${MIN_LENGTH} characters. Nothing changed.`);
    process.exit(1);
  }
  const confirmation = await promptHidden("Confirm password: ");
  if (password !== confirmation) {
    console.error("Passwords do not match. Nothing changed.");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const original = fs.readFileSync(ENV_PATH, "utf8");
  fs.writeFileSync(`${ENV_PATH}.bak`, original);
  fs.writeFileSync(ENV_PATH, upsertEnvValue(original, "ADMIN_PASSWORD_HASH", hash));

  console.log("ADMIN_PASSWORD_HASH updated in server/.env (backup: server/.env.bak).");
  console.log("Restart the backend for the change to take effect.");
}

main().catch((error) => {
  console.error("Failed to update password:", error.message);
  process.exit(1);
});
