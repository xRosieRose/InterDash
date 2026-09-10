/**
 * InterDash — Create Admin User Script
 *
 * Usage:
 *   npx tsx server/scripts/create-admin.ts <discord_user_id>
 *
 * This script sets a Discord user as the owner/admin in the database.
 * The user must have already logged in at least once via Discord OAuth.
 * If the user hasn't logged in yet, set DISCORD_ADMIN_USER_ID in .env
 * and they will be assigned owner role on first login.
 */

import { initDatabase, getDb, saveToDisk, closeDatabase } from "../db/index.js";

async function main() {
  const discordId = process.argv[2];

  if (!discordId) {
    console.error("Usage: npx tsx server/scripts/create-admin.ts <discord_user_id>");
    console.error("");
    console.error("Example: npx tsx server/scripts/create-admin.ts 123456789012345678");
    console.error("");
    console.error("The Discord User ID can be found by:");
    console.error("  1. Open Discord Settings > Advanced > Developer Mode ON");
    console.error("  2. Right-click your username > Copy User ID");
    process.exit(1);
  }

  await initDatabase();
  const db = getDb();

  // Check if user exists
  const existing = db.exec(
    "SELECT id, username, role FROM users WHERE discord_id = ? LIMIT 1",
    [discordId]
  );

  if (existing.length && existing[0].values.length) {
    const [userId, username, currentRole] = existing[0].values[0];
    console.log(`Found user: ${username} (ID: ${userId})`);
    console.log(`Current role: ${currentRole}`);

    if (currentRole === "owner") {
      console.log("User is already an owner. No changes needed.");
    } else {
      db.run(
        "UPDATE users SET role = 'owner', updated_at = datetime('now') WHERE discord_id = ?",
        [discordId]
      );
      saveToDisk();
      console.log(`✓ Role updated from '${currentRole}' to 'owner'.`);
    }
  } else {
    console.log(`No user with Discord ID ${discordId} has logged in yet.`);
    console.log("");
    console.log("To assign this user as owner on first login, set in your .env:");
    console.log(`  DISCORD_ADMIN_USER_ID=${discordId}`);
    console.log("");
    console.log("They will be assigned the 'owner' role when they first log in via Discord.");
  }

  closeDatabase();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
