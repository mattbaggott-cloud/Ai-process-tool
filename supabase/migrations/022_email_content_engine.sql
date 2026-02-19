-- ============================================================
-- 022: Email Content Engine
-- Brand assets (templates, examples, images) + AI-generated content
-- ============================================================

-- ── Brand assets: templates, email examples, style references ──
CREATE TABLE IF NOT EXISTS email_brand_assets (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  asset_type    TEXT NOT NULL DEFAULT 'template'
                CHECK (asset_type IN ('template', 'example', 'style_guide', 'image', 'html_template')),
  content_text  TEXT,                          -- extracted text / pasted email body
  content_html  TEXT,                          -- raw HTML if uploaded
  storage_path  TEXT,                          -- Supabase Storage path for images/files
  mime_type     TEXT,
  file_size     INTEGER,
  metadata      JSONB DEFAULT '{}'::jsonb,     -- tone notes, tags, source tool (klaviyo, mailchimp, etc.)
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ── Generated email content ──
CREATE TABLE IF NOT EXISTS email_generated_content (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'approved', 'sent', 'archived')),
  email_type      TEXT NOT NULL DEFAULT 'promotional'
                  CHECK (email_type IN ('promotional', 'win_back', 'nurture', 'announcement', 'educational', 'milestone', 'custom')),

  -- Content
  subject_line    TEXT NOT NULL,
  preview_text    TEXT,
  body_html       TEXT,
  body_text       TEXT,                        -- plain text fallback

  -- AI generation context
  prompt_used     TEXT,                        -- the user's prompt / instruction
  brand_asset_ids UUID[],                      -- which brand assets were referenced
  segment_context JSONB DEFAULT '{}'::jsonb,   -- snapshot of segment profile at generation time
  generation_model TEXT DEFAULT 'claude-sonnet-4-20250514',

  -- Personalization
  personalization_fields TEXT[] DEFAULT '{}',  -- e.g. ['first_name', 'product_name', 'days_since']
  variants        JSONB DEFAULT '[]'::jsonb,   -- A/B test variants [{subject, body, ...}]

  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_email_brand_assets_org ON email_brand_assets(org_id);
CREATE INDEX IF NOT EXISTS idx_email_brand_assets_type ON email_brand_assets(org_id, asset_type);
CREATE INDEX IF NOT EXISTS idx_email_generated_org ON email_generated_content(org_id);
CREATE INDEX IF NOT EXISTS idx_email_generated_segment ON email_generated_content(segment_id);
CREATE INDEX IF NOT EXISTS idx_email_generated_status ON email_generated_content(org_id, status);

-- ── RLS ──
ALTER TABLE email_brand_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_generated_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_brand_assets_org_access" ON email_brand_assets
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "email_generated_content_org_access" ON email_generated_content
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );
