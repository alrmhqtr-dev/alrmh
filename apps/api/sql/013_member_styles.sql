/*
 * A person's collar, cuff and detail remarks, saved from the counter's Measurements screen
 * (28 Nov 2026) without waiting for a sale. Their next thobe starts from these when they're
 * newer than their last thobe's remarks.
 */
alter table family_members add column if not exists style_notes jsonb;
alter table family_members add column if not exists style_notes_at timestamptz;
