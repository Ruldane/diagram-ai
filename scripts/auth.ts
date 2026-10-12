/**
 * Account maintenance for accounts mode (see docs/auth.md). There is no email, so this is how an
 * operator recovers access.
 *
 *   npx tsx scripts/auth.ts list
 *   npx tsx scripts/auth.ts reset-password <email>     reads the new password from DIAGRAM_AI_NEW_PASSWORD
 *   npx tsx scripts/auth.ts make-admin <email>
 *   npx tsx scripts/auth.ts claim <email>              make that account the owner of every ownerless diagram
 *
 * Reads DATABASE_URL from the environment, `.env.local` or `.env`.
 */
import { loadEnvFiles } from "./load-env.mjs";

const USAGE = `Usage:
  tsx scripts/auth.ts list
  tsx scripts/auth.ts reset-password <email>    new password from DIAGRAM_AI_NEW_PASSWORD; ends the account's sessions
  tsx scripts/auth.ts make-admin <email>
  tsx scripts/auth.ts claim <email>             give every diagram without an owner to that account (diagrams made while accounts were off)`;

async function main(): Promise<number> {
  const [command, email] = process.argv.slice(2);
  if (!command || !["list", "reset-password", "make-admin", "claim"].includes(command) || (command !== "list" && !email)) {
    console.error(USAGE);
    return command ? 1 : 0;
  }

  loadEnvFiles();
  const url = process.env.DATABASE_URL?.trim() || `postgres://diagram_ai:diagram_ai@127.0.0.1:${process.env.DIAGRAM_AI_PG_PORT ?? "5435"}/diagram_ai`;
  const { createPool } = await import("../src/server/db/database");
  const { hashPassword } = await import("../src/server/auth/password");
  const { normalizeEmail, passwordProblem } = await import("../src/core/auth");

  const pool = createPool(url, { max: 1 });
  try {
    if (command === "list") {
      const { rows } = await pool.query<{ email: string; name: string; is_admin: boolean; disabled_at: Date | null; last_login_at: Date | null }>(
        "SELECT email, name, is_admin, disabled_at, last_login_at FROM users ORDER BY created_at",
      );
      for (const row of rows) {
        console.log(`${row.email}  ${row.name}${row.is_admin ? "  [admin]" : ""}${row.disabled_at ? "  [disabled]" : ""}  last sign-in: ${row.last_login_at?.toISOString() ?? "never"}`);
      }
      console.log(`${rows.length} account(s)`);
      return 0;
    }

    const address = normalizeEmail(email);
    if (command === "make-admin") {
      const result = await pool.query("UPDATE users SET is_admin = true WHERE email = $1", [address]);
      console.log(result.rowCount ? `${address} is an administrator.` : `No account uses ${address}.`);
      return result.rowCount ? 0 : 1;
    }

    if (command === "claim") {
      const found = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [address]);
      if (!found.rows[0]) {
        console.error(`No account uses ${address}.`);
        return 1;
      }
      const owner = found.rows[0].id;
      await pool.query("BEGIN");
      try {
        const claimed = await pool.query("UPDATE diagrams SET owner_id = $1 WHERE owner_id IS NULL OR owner_id NOT IN (SELECT id FROM users)", [owner]);
        await pool.query(
          "INSERT INTO diagram_members (diagram_id, user_id, role) SELECT id, $1, 'owner' FROM diagrams WHERE owner_id = $1 ON CONFLICT (diagram_id, user_id) DO UPDATE SET role = 'owner'",
          [owner],
        );
        await pool.query("COMMIT");
        console.log(`${address} now owns ${claimed.rowCount ?? 0} diagram(s) that had no owner.`);
      } catch (error) {
        await pool.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
      return 0;
    }

    const password = process.env.DIAGRAM_AI_NEW_PASSWORD ?? "";
    const problem = passwordProblem(password, { email: address });
    if (problem) {
      console.error(`Set DIAGRAM_AI_NEW_PASSWORD to the new password. ${problem}`);
      return 1;
    }
    const updated = await pool.query<{ id: string }>("UPDATE users SET password_hash = $2 WHERE email = $1 RETURNING id", [address, await hashPassword(password)]);
    if (!updated.rows[0]) {
      console.error(`No account uses ${address}.`);
      return 1;
    }
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [updated.rows[0].id]);
    console.log(`Password changed for ${address}; its sessions were ended.`);
    return 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
