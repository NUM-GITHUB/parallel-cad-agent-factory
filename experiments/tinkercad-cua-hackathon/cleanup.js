// Safe cleanup helper — LIST sessions; delete only when given a specific --delete <id>.
//
// ⚠ This project's KERNEL_API_KEY is shared across teammates. `browsers.list()`
// returns everyone's active sessions. Bulk-deleting from that list will kill
// other people's running agents. Always confirm a session is yours before
// passing it to --delete.
//
// Usage:
//   node cleanup.js                    # list (dry-run)
//   node cleanup.js --delete <id>      # delete one specific session
require("dotenv").config();
const Kernel = require("@onkernel/sdk").default;

(async () => {
  const k = new Kernel({ apiKey: process.env.KERNEL_API_KEY });
  const list = await k.browsers.list();
  const arr = Array.isArray(list) ? list : (list.body ?? list.data ?? []);

  console.log(`Active sessions: ${arr.length}`);
  for (const b of arr) {
    console.log(`  ${b.session_id} | created ${b.created_at} | ${b.base_url}`);
  }

  const i = process.argv.indexOf("--delete");
  const target = i >= 0 ? process.argv[i + 1] : null;

  if (!target) {
    console.log("\nDry-run. To delete a session: node cleanup.js --delete <session_id>");
    console.log("⚠ Only delete sessions YOU started — the API key is shared with teammates.");
    return;
  }

  if (!arr.find((b) => b.session_id === target)) {
    console.error(`No such active session: ${target}`);
    process.exit(1);
  }

  try {
    await k.browsers.deleteByID(target);
    console.log("✓ deleted", target);
  } catch (e) {
    console.error("✗", target, "—", e.message);
    process.exit(1);
  }
})();
