-- ══════════════════════════════════════════════════════════════
-- Migration 038: Data Connector Tables
-- Gmail messages, Calendar events, Drive files, Outreach data
-- ══════════════════════════════════════════════════════════════

-- ── Gmail Messages ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gmail_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  thread_id TEXT,
  from_email TEXT,
  from_name TEXT,
  to_emails TEXT[] DEFAULT '{}',
  cc_emails TEXT[] DEFAULT '{}',
  subject TEXT,
  snippet TEXT,
  body_text TEXT,
  labels TEXT[] DEFAULT '{}',
  is_read BOOLEAN DEFAULT false,
  is_starred BOOLEAN DEFAULT false,
  has_attachments BOOLEAN DEFAULT false,
  internal_date TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_gmail_messages_org_date
  ON gmail_messages(org_id, internal_date DESC);
CREATE INDEX IF NOT EXISTS idx_gmail_messages_from
  ON gmail_messages(org_id, from_email);
CREATE INDEX IF NOT EXISTS idx_gmail_messages_thread
  ON gmail_messages(org_id, thread_id);

ALTER TABLE gmail_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gmail_messages_select" ON gmail_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.org_id = gmail_messages.org_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "gmail_messages_insert" ON gmail_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "gmail_messages_update" ON gmail_messages FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "gmail_messages_delete" ON gmail_messages FOR DELETE
  USING (auth.uid() = user_id);

-- ── Calendar Events ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  summary TEXT,
  description TEXT,
  location TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  all_day BOOLEAN DEFAULT false,
  status TEXT,
  organizer_email TEXT,
  attendees JSONB DEFAULT '[]'::jsonb,
  recurrence TEXT[] DEFAULT '{}',
  html_link TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, external_id, calendar_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_org_time
  ON calendar_events(org_id, start_time);
CREATE INDEX IF NOT EXISTS idx_calendar_events_organizer
  ON calendar_events(org_id, organizer_email);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calendar_events_select" ON calendar_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.org_id = calendar_events.org_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "calendar_events_insert" ON calendar_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "calendar_events_update" ON calendar_events FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "calendar_events_delete" ON calendar_events FOR DELETE
  USING (auth.uid() = user_id);

-- ── Drive Files ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS drive_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  web_view_link TEXT,
  icon_link TEXT,
  parent_folder_id TEXT,
  parent_folder_name TEXT,
  owners JSONB DEFAULT '[]'::jsonb,
  shared_with JSONB DEFAULT '[]'::jsonb,
  modified_time TIMESTAMPTZ,
  created_time TIMESTAMPTZ,
  is_indexed BOOLEAN NOT NULL DEFAULT false,
  library_item_id UUID REFERENCES library_items(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_drive_files_org_modified
  ON drive_files(org_id, modified_time DESC);
CREATE INDEX IF NOT EXISTS idx_drive_files_mime
  ON drive_files(org_id, mime_type);

ALTER TABLE drive_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drive_files_select" ON drive_files FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.org_id = drive_files.org_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "drive_files_insert" ON drive_files FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "drive_files_update" ON drive_files FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "drive_files_delete" ON drive_files FOR DELETE
  USING (auth.uid() = user_id);

-- ── Outreach Prospects ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS outreach_prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  title TEXT,
  company_name TEXT,
  phone TEXT,
  tags TEXT[] DEFAULT '{}',
  stage TEXT,
  owner_email TEXT,
  engaged_at TIMESTAMPTZ,
  contacted_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_outreach_prospects_org
  ON outreach_prospects(org_id, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_prospects_email
  ON outreach_prospects(org_id, email);

ALTER TABLE outreach_prospects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outreach_prospects_select" ON outreach_prospects FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.org_id = outreach_prospects.org_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "outreach_prospects_insert" ON outreach_prospects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "outreach_prospects_update" ON outreach_prospects FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "outreach_prospects_delete" ON outreach_prospects FOR DELETE
  USING (auth.uid() = user_id);

-- ── Outreach Sequences ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS outreach_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT true,
  sequence_type TEXT,
  step_count INTEGER DEFAULT 0,
  prospect_count INTEGER DEFAULT 0,
  open_rate NUMERIC(5,2),
  click_rate NUMERIC(5,2),
  reply_rate NUMERIC(5,2),
  bounce_rate NUMERIC(5,2),
  owner_email TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_outreach_sequences_org
  ON outreach_sequences(org_id, synced_at DESC);

ALTER TABLE outreach_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outreach_sequences_select" ON outreach_sequences FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.org_id = outreach_sequences.org_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "outreach_sequences_insert" ON outreach_sequences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "outreach_sequences_update" ON outreach_sequences FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "outreach_sequences_delete" ON outreach_sequences FOR DELETE
  USING (auth.uid() = user_id);

-- ── Outreach Tasks ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS outreach_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  subject TEXT,
  task_type TEXT,
  status TEXT,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  prospect_external_id TEXT,
  sequence_external_id TEXT,
  owner_email TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_outreach_tasks_org
  ON outreach_tasks(org_id, due_at);

ALTER TABLE outreach_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outreach_tasks_select" ON outreach_tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.org_id = outreach_tasks.org_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "outreach_tasks_insert" ON outreach_tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "outreach_tasks_update" ON outreach_tasks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "outreach_tasks_delete" ON outreach_tasks FOR DELETE
  USING (auth.uid() = user_id);
