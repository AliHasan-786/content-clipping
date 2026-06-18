"""SQLite layer. One file, no migrations framework — just `init_db()` on boot."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable

DB_PATH = Path(__file__).parent / "clips.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS candidates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type     TEXT    NOT NULL,
    source_id       TEXT    NOT NULL,
    video_id        TEXT    NOT NULL UNIQUE,
    url             TEXT    NOT NULL,
    title           TEXT,
    channel         TEXT,
    published_at    TEXT,
    duration_s      INTEGER,
    views           INTEGER,
    velocity        REAL,
    status          TEXT    NOT NULL DEFAULT 'new',
    discovered_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    notes           TEXT
);

CREATE TABLE IF NOT EXISTS transcripts (
    video_id        TEXT    PRIMARY KEY,
    path            TEXT    NOT NULL,
    duration_s      REAL,
    language        TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES candidates(video_id)
);

CREATE TABLE IF NOT EXISTS clips (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id        TEXT    NOT NULL,
    start_s         REAL    NOT NULL,
    end_s           REAL    NOT NULL,
    format          TEXT    NOT NULL,
    hook            TEXT,
    vo_script       TEXT,
    why_it_works    TEXT,
    virality_score  INTEGER,
    rendered_path   TEXT,
    metadata_json   TEXT,
    status          TEXT    NOT NULL DEFAULT 'scouted',
    reject_reason   TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    posted_at       TEXT,
    FOREIGN KEY (video_id) REFERENCES candidates(video_id)
);

CREATE TABLE IF NOT EXISTS posts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    clip_id         INTEGER NOT NULL,
    platform        TEXT    NOT NULL,
    external_id     TEXT,
    url             TEXT,
    status          TEXT    NOT NULL,
    error           TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (clip_id) REFERENCES clips(id)
);

CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
CREATE INDEX IF NOT EXISTS idx_clips_status     ON clips(status);
CREATE INDEX IF NOT EXISTS idx_posts_clip       ON posts(clip_id);
"""


def init_db(path: Path = DB_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as conn:
        conn.executescript(SCHEMA)


@contextmanager
def connect(path: Path = DB_PATH):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def insert(conn: sqlite3.Connection, table: str, row: dict[str, Any]) -> int:
    cols = ", ".join(row.keys())
    placeholders = ", ".join("?" for _ in row)
    cur = conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({placeholders})", tuple(row.values()))
    return cur.lastrowid


def upsert_candidate(conn: sqlite3.Connection, row: dict[str, Any]) -> bool:
    """Returns True if a new row was inserted, False if it already existed."""
    cur = conn.execute("SELECT 1 FROM candidates WHERE video_id = ?", (row["video_id"],))
    if cur.fetchone():
        return False
    insert(conn, "candidates", row)
    return True


def set_status(conn: sqlite3.Connection, table: str, pk: int | str, status: str, pk_col: str = "id") -> None:
    conn.execute(f"UPDATE {table} SET status = ? WHERE {pk_col} = ?", (status, pk))


def jdumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


def jloads(text: str | None) -> Any:
    return json.loads(text) if text else None


def rows_to_dicts(rows: Iterable[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(r) for r in rows]
