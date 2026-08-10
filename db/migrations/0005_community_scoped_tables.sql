ALTER TABLE "activity_log" ADD COLUMN "community_id" uuid;--> statement-breakpoint
ALTER TABLE "daily_roasts" ADD COLUMN "community_id" uuid;--> statement-breakpoint
ALTER TABLE "interview_prep" ADD COLUMN "community_id" uuid;--> statement-breakpoint
ALTER TABLE "jobboard" ADD COLUMN "community_id" uuid;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "community_id" uuid;--> statement-breakpoint

-- Seed the first community from existing users and backfill all rows.
-- Runs only when there are real users (safe to skip on a fresh empty DB).
DO $$
DECLARE
  seed_id uuid := gen_random_uuid();
  first_user_id uuid;
BEGIN
  SELECT id INTO first_user_id
  FROM users
  WHERE NOT is_admin AND email != 'system@jobless.local'
  LIMIT 1;

  IF first_user_id IS NULL THEN
    RETURN; -- empty DB, nothing to backfill
  END IF;

  INSERT INTO communities (community_id, name, invite_code, created_by)
  VALUES (seed_id, 'J2J', 'j2j-og', first_user_id);

  -- Add every non-admin user as a member (first user becomes owner)
  INSERT INTO community_members (community_id, user_id, role)
  SELECT seed_id, id,
    CASE WHEN id = first_user_id THEN 'owner' ELSE 'member' END
  FROM users
  WHERE NOT is_admin AND email != 'system@jobless.local'
  ON CONFLICT DO NOTHING;

  -- Backfill existing rows
  UPDATE activity_log   SET community_id = seed_id WHERE community_id IS NULL;
  UPDATE daily_roasts   SET community_id = seed_id WHERE community_id IS NULL;
  UPDATE interview_prep SET community_id = seed_id WHERE community_id IS NULL;
  UPDATE jobboard       SET community_id = seed_id WHERE community_id IS NULL;
  UPDATE resumes        SET community_id = seed_id WHERE community_id IS NULL;
END $$;