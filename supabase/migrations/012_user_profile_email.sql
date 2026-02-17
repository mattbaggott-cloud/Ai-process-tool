-- ============================================================
-- Migration 012: Add email column to user_profiles
-- ============================================================
-- The settings page member list needs to display emails.
-- user_profiles currently has no email column, so members
-- show as truncated UUIDs. This migration adds the column,
-- backfills from auth.users, and adds a trigger to keep it
-- in sync on new signups.
-- ============================================================

-- 1. Add the column (nullable first for backfill, then set NOT NULL)
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. Backfill from auth.users
UPDATE user_profiles
SET email = COALESCE(
  (SELECT u.email FROM auth.users u WHERE u.id = user_profiles.user_id),
  ''
)
WHERE email IS NULL OR email = '';

-- 3. Set NOT NULL with default
ALTER TABLE user_profiles
  ALTER COLUMN email SET DEFAULT '',
  ALTER COLUMN email SET NOT NULL;

-- 4. Trigger function to sync email on new user creation
-- This runs AFTER the existing handle_new_user_org trigger
CREATE OR REPLACE FUNCTION sync_profile_email_on_signup()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.user_profiles
  SET email = NEW.email
  WHERE user_id = NEW.id AND (email IS NULL OR email = '');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_sync_email ON auth.users;
CREATE TRIGGER on_auth_user_sync_email
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION sync_profile_email_on_signup();
