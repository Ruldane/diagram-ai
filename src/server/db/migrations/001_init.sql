-- Diagram storage. The whole document lives in `diagrams.doc`; the other columns are what
-- listings need, so `list()` never has to read (or de-TOAST) every document.

CREATE TABLE diagrams (
  id            text        PRIMARY KEY,
  name          text        NOT NULL,
  type          text        NOT NULL,
  description   text,
  doc           jsonb       NOT NULL,
  version       integer     NOT NULL CHECK (version >= 0),
  -- Denormalised from `doc` on every write, for summaries.
  node_count    integer     NOT NULL DEFAULT 0,
  edge_count    integer     NOT NULL DEFAULT 0,
  open_comments integer     NOT NULL DEFAULT 0,
  -- Reserved for accounts: who owns the diagram. Null while the app has no users.
  owner_id      text,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL
);

CREATE INDEX diagrams_updated_at_idx ON diagrams (updated_at DESC);
CREATE INDEX diagrams_owner_idx ON diagrams (owner_id, updated_at DESC);

-- Named checkpoints. Ids are only unique per diagram, as with the file layout.
CREATE TABLE diagram_snapshots (
  diagram_id text        NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  id         text        NOT NULL,
  name       text        NOT NULL,
  author     jsonb       NOT NULL,
  node_count integer     NOT NULL,
  edge_count integer     NOT NULL,
  doc        jsonb       NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (diagram_id, id)
);

CREATE INDEX diagram_snapshots_recent_idx ON diagram_snapshots (diagram_id, created_at DESC);

-- The state a person last accepted, which the review diff is computed against.
CREATE TABLE diagram_review_bases (
  diagram_id text        PRIMARY KEY REFERENCES diagrams (id) ON DELETE CASCADE,
  doc        jsonb       NOT NULL,
  by_actor   jsonb,
  since      timestamptz NOT NULL
);

-- Append-only change log: one row per saved version. `patch` is exactly what was applied.
CREATE TABLE diagram_ops (
  id         bigserial   PRIMARY KEY,
  diagram_id text        NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  version    integer     NOT NULL,
  actor      jsonb       NOT NULL,
  patch      jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Makes a retried write idempotent, and serves lookups and trimming by version.
  UNIQUE (diagram_id, version)
);
