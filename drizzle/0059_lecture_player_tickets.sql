CREATE TABLE professor_lecture_player_tickets (
 token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, lecture_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX professor_lecture_ticket_expiry ON professor_lecture_player_tickets(expires_at);
