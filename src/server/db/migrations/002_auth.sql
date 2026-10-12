-- Accounts and sharing. Only used when the app runs in team mode (DATABASE_URL set, DIAGRAM_AI_AUTH not off);
-- in local mode the tables simply stay empty. See docs/auth.md.

CREATE TABLE users (
  id            text        PRIMARY KEY,
  -- Stored lower-case and trimmed, so equality is the uniqueness rule.
  email         text        NOT NULL UNIQUE,
  name          text        NOT NULL,
  -- scrypt$logN$r$p$salt$hash (see src/server/auth/password.ts); never leaves the server.
  password_hash text        NOT NULL,
  is_admin      boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  disabled_at   timestamptz
);

-- Browser sessions. Only the SHA-256 of the cookie value is stored, so a database leak cannot be replayed.
CREATE TABLE sessions (
  token_hash   text        PRIMARY KEY,
  user_id      text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Personal access tokens (MCP clients, scripts). Hashed like sessions; shown once when created.
CREATE TABLE api_tokens (
  id           text        PRIMARY KEY,
  user_id      text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         text        NOT NULL,
  token_hash   text        NOT NULL UNIQUE,
  prefix       text        NOT NULL,
  scope        text        NOT NULL DEFAULT 'write' CHECK (scope IN ('read', 'write')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id);

-- Who may open a diagram besides its owner (`diagrams.owner_id`, which has a row here too).
CREATE TABLE diagram_members (
  diagram_id text        NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  user_id    text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (diagram_id, user_id)
);
CREATE INDEX diagram_members_user_idx ON diagram_members (user_id);

-- Links that open a diagram without being invited. Only a hash of the token is stored.
CREATE TABLE share_links (
  id         text        PRIMARY KEY,
  token_hash text        NOT NULL UNIQUE,
  diagram_id text        NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('viewer', 'editor')),
  hint       text        NOT NULL,
  created_by text        REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX share_links_diagram_idx ON share_links (diagram_id);

-- `diagrams.owner_id` (added as a placeholder in 001) now holds the id of the owning user. It has no foreign key on
-- purpose: files imported with `db:import-files --owner <anything>` may name nobody, and the first account to
-- register claims every diagram whose owner is null or not a user.
