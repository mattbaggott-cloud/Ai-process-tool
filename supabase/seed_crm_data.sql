-- ============================================================
-- CRM Seed Data
-- Run AFTER 003_crm_tables.sql migration
-- Replace YOUR_USER_ID with your actual auth.users id
-- (Find it: SELECT id FROM auth.users LIMIT 1;)
-- ============================================================

-- Step 1: Get your user ID (run this first, copy the result)
-- SELECT id FROM auth.users LIMIT 1;

-- Step 2: Set it here (replace the UUID below)
DO $$
DECLARE
  uid UUID;
BEGIN
  -- Auto-detect the first user
  SELECT id INTO uid FROM auth.users LIMIT 1;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'No user found in auth.users. Sign in first.';
  END IF;

  -- ── Companies ──────────────────────────────────────────

  INSERT INTO crm_companies (id, user_id, name, domain, industry, size, description, website, phone, address) VALUES
  ('c0000001-0000-0000-0000-000000000001', uid, 'Acme Corp', 'acme.com', 'SaaS', 'medium',
   'Enterprise collaboration platform for distributed teams. Series B, 150 employees.',
   'https://acme.com', '(415) 555-0100', '100 Market St, San Francisco, CA 94105'),

  ('c0000001-0000-0000-0000-000000000002', uid, 'Globex Industries', 'globex.io', 'Manufacturing', 'large',
   'Global manufacturer of industrial automation equipment. Public company, 2000+ employees.',
   'https://globex.io', '(312) 555-0200', '200 Wacker Dr, Chicago, IL 60606'),

  ('c0000001-0000-0000-0000-000000000003', uid, 'Initech Solutions', 'initech.dev', 'Consulting', 'small',
   'Boutique tech consulting firm specializing in AI/ML implementations. 25 employees.',
   'https://initech.dev', '(512) 555-0300', '500 Congress Ave, Austin, TX 78701'),

  ('c0000001-0000-0000-0000-000000000004', uid, 'Stark Ventures', 'starkvc.com', 'Finance', 'startup',
   'Early-stage VC fund focused on AI-first startups. $50M fund.',
   'https://starkvc.com', '(646) 555-0400', '350 5th Ave, New York, NY 10118'),

  ('c0000001-0000-0000-0000-000000000005', uid, 'Umbrella Health', 'umbrellahealth.com', 'Healthcare', 'enterprise',
   'National healthcare provider network. 10,000+ employees across 50 states.',
   'https://umbrellahealth.com', '(617) 555-0500', '1 Beacon St, Boston, MA 02108');

  -- ── Contacts ───────────────────────────────────────────

  INSERT INTO crm_contacts (id, user_id, company_id, first_name, last_name, email, phone, title, status, source, notes, tags) VALUES

  -- Acme Corp contacts
  ('d0000001-0000-0000-0000-000000000001', uid, 'c0000001-0000-0000-0000-000000000001',
   'Sarah', 'Chen', 'sarah.chen@acme.com', '(415) 555-0101', 'VP of Engineering', 'active', 'referral',
   'Met at AI Summit 2025. Very interested in our platform for her 40-person eng team. Decision maker for tools budget.',
   ARRAY['decision-maker', 'enterprise', 'engineering']),

  ('d0000001-0000-0000-0000-000000000002', uid, 'c0000001-0000-0000-0000-000000000001',
   'Marcus', 'Williams', 'marcus.w@acme.com', '(415) 555-0102', 'Head of Product', 'active', 'manual',
   'Sarah''s colleague. Evaluating our product alongside 2 competitors. Wants a pilot program.',
   ARRAY['evaluator', 'product']),

  -- Globex contacts
  ('d0000001-0000-0000-0000-000000000003', uid, 'c0000001-0000-0000-0000-000000000002',
   'James', 'Morrison', 'j.morrison@globex.io', '(312) 555-0201', 'CTO', 'active', 'manual',
   'Long sales cycle. Needs enterprise security review before proceeding. Budget approved for Q2.',
   ARRAY['decision-maker', 'enterprise', 'security-conscious']),

  ('d0000001-0000-0000-0000-000000000004', uid, 'c0000001-0000-0000-0000-000000000002',
   'Priya', 'Patel', 'priya@globex.io', '(312) 555-0202', 'Director of Innovation', 'lead', 'ai',
   'AI found her LinkedIn post about digital transformation. Could be a champion internally.',
   ARRAY['champion', 'innovation']),

  -- Initech contacts
  ('d0000001-0000-0000-0000-000000000005', uid, 'c0000001-0000-0000-0000-000000000003',
   'Tom', 'Nguyen', 'tom@initech.dev', '(512) 555-0301', 'Managing Partner', 'active', 'referral',
   'Referred by Sarah Chen. Wants to resell our platform to his consulting clients. Potential channel partner.',
   ARRAY['partner', 'channel', 'decision-maker']),

  -- Stark Ventures contacts
  ('d0000001-0000-0000-0000-000000000006', uid, 'c0000001-0000-0000-0000-000000000004',
   'Lisa', 'Park', 'lisa@starkvc.com', '(646) 555-0401', 'General Partner', 'lead', 'manual',
   'Interested in potentially investing. Asked for metrics and traction data.',
   ARRAY['investor', 'decision-maker']),

  -- Umbrella Health contacts
  ('d0000001-0000-0000-0000-000000000007', uid, 'c0000001-0000-0000-0000-000000000005',
   'Dr. Rachel', 'Kim', 'rkim@umbrellahealth.com', '(617) 555-0501', 'Chief Digital Officer', 'active', 'manual',
   'Needs HIPAA-compliant deployment. Interested in AI workflow automation for clinical operations.',
   ARRAY['decision-maker', 'healthcare', 'compliance']),

  ('d0000001-0000-0000-0000-000000000008', uid, 'c0000001-0000-0000-0000-000000000005',
   'David', 'Torres', 'dtorres@umbrellahealth.com', '(617) 555-0502', 'IT Director', 'active', 'manual',
   'Technical evaluator. Running security assessment. Concerned about data residency.',
   ARRAY['technical', 'evaluator', 'security']),

  -- Unattached contacts
  ('d0000001-0000-0000-0000-000000000009', uid, NULL,
   'Alex', 'Rivera', 'alex.rivera@gmail.com', '(213) 555-0601', 'Freelance Consultant', 'lead', 'import',
   'Downloaded our whitepaper. Could be a solo user or bring enterprise clients.',
   ARRAY['freelance', 'inbound']),

  ('d0000001-0000-0000-0000-000000000010', uid, NULL,
   'Jordan', 'Blake', 'jordan.blake@outlook.com', NULL, 'Startup Founder', 'churned', 'referral',
   'Was interested but chose a competitor. Follow up in 6 months when their contract renews.',
   ARRAY['startup', 'lost-deal', 'follow-up']);

  -- ── Deals ──────────────────────────────────────────────

  INSERT INTO crm_deals (id, user_id, contact_id, company_id, title, value, stage, probability, expected_close_date, notes) VALUES

  ('e0000001-0000-0000-0000-000000000001', uid,
   'd0000001-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001',
   'Acme Corp - Enterprise License', 48000.00, 'proposal', 50, '2026-04-15',
   'Proposal sent for 40-seat annual license. Competing with Notion and Coda. Key differentiator: AI tools integration.'),

  ('e0000001-0000-0000-0000-000000000002', uid,
   'd0000001-0000-0000-0000-000000000003', 'c0000001-0000-0000-0000-000000000002',
   'Globex - Pilot Program', 15000.00, 'qualified', 25, '2026-06-01',
   'Waiting on security review. If pilot succeeds, could expand to full 200-seat deployment ($150K ARR).'),

  ('e0000001-0000-0000-0000-000000000003', uid,
   'd0000001-0000-0000-0000-000000000005', 'c0000001-0000-0000-0000-000000000003',
   'Initech - Channel Partnership', 24000.00, 'negotiation', 75, '2026-03-15',
   'Revenue share model: they resell to their clients, we get 70%. Negotiating minimum commit of 10 seats/quarter.'),

  ('e0000001-0000-0000-0000-000000000004', uid,
   'd0000001-0000-0000-0000-000000000007', 'c0000001-0000-0000-0000-000000000005',
   'Umbrella Health - Clinical Ops', 120000.00, 'lead', 10, '2026-09-01',
   'Massive opportunity. Need HIPAA BAA, SOC2, data residency. 6+ month sales cycle expected.'),

  ('e0000001-0000-0000-0000-000000000005', uid,
   'd0000001-0000-0000-0000-000000000010', NULL,
   'Blake Startup - Team License', 3600.00, 'lost', 0, '2026-01-15',
   'Lost to competitor on price. Jordan chose a $99/mo plan. Follow up when their annual renews.'),

  ('e0000001-0000-0000-0000-000000000006', uid,
   'd0000001-0000-0000-0000-000000000002', 'c0000001-0000-0000-0000-000000000001',
   'Acme Corp - Product Team Add-on', 12000.00, 'lead', 10, '2026-05-01',
   'Marcus wants separate workspace for product team. Contingent on main deal closing first.');

  -- ── Activities ─────────────────────────────────────────

  INSERT INTO crm_activities (id, user_id, contact_id, company_id, deal_id, type, subject, description, scheduled_at, completed_at) VALUES

  -- Recent past activities (completed)
  ('f0000001-0000-0000-0000-000000000001', uid,
   'd0000001-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001', 'e0000001-0000-0000-0000-000000000001',
   'meeting', 'Discovery Call with Sarah Chen',
   'Discussed Acme''s current tech stack and pain points. They use Notion + Slack + Jira. Main pain: context switching between tools. Sarah wants AI-powered workflows.',
   NOW() - INTERVAL '14 days', NOW() - INTERVAL '14 days'),

  ('f0000001-0000-0000-0000-000000000002', uid,
   'd0000001-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001', 'e0000001-0000-0000-0000-000000000001',
   'email', 'Sent proposal to Sarah',
   'Sent 40-seat enterprise proposal at $100/seat/month ($48K/yr). Includes dedicated onboarding and priority support.',
   NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days'),

  ('f0000001-0000-0000-0000-000000000003', uid,
   'd0000001-0000-0000-0000-000000000002', 'c0000001-0000-0000-0000-000000000001', NULL,
   'call', 'Product Demo for Marcus',
   'Showed Marcus the AI chat tools and flow builder. He was impressed by the automation capabilities. Wants to test with his 8-person product team.',
   NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days'),

  ('f0000001-0000-0000-0000-000000000004', uid,
   'd0000001-0000-0000-0000-000000000003', 'c0000001-0000-0000-0000-000000000002', 'e0000001-0000-0000-0000-000000000002',
   'meeting', 'Security Review Kickoff - Globex',
   'Met with James and their security team. They need SSO (SAML), SOC2 report, and penetration test results. Sent our security whitepaper.',
   NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days'),

  ('f0000001-0000-0000-0000-000000000005', uid,
   'd0000001-0000-0000-0000-000000000005', 'c0000001-0000-0000-0000-000000000003', 'e0000001-0000-0000-0000-000000000003',
   'meeting', 'Partnership Terms Discussion',
   'Negotiated revenue share with Tom. Agreed on 70/30 split. Discussing minimum quarterly commitment. He has 3 clients ready to onboard.',
   NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),

  ('f0000001-0000-0000-0000-000000000006', uid,
   'd0000001-0000-0000-0000-000000000006', 'c0000001-0000-0000-0000-000000000004', NULL,
   'email', 'Investor Deck to Lisa Park',
   'Sent pitch deck and metrics to Lisa at Stark Ventures. ARR: $180K, MoM growth: 15%, 47 paying customers.',
   NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),

  ('f0000001-0000-0000-0000-000000000007', uid,
   'd0000001-0000-0000-0000-000000000007', 'c0000001-0000-0000-0000-000000000005', 'e0000001-0000-0000-0000-000000000004',
   'note', 'Umbrella Health Research',
   'Researched HIPAA compliance requirements. Need BAA template, encryption at rest + transit, audit logs, minimum necessary access controls. Will need 2-3 months of compliance work.',
   NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),

  -- Upcoming scheduled activities (not completed)
  ('f0000001-0000-0000-0000-000000000008', uid,
   'd0000001-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001', 'e0000001-0000-0000-0000-000000000001',
   'meeting', 'Follow-up: Proposal Review with Sarah',
   'Sarah wants to review proposal details and discuss implementation timeline. Need to prepare ROI analysis.',
   NOW() + INTERVAL '2 days', NULL),

  ('f0000001-0000-0000-0000-000000000009', uid,
   'd0000001-0000-0000-0000-000000000003', 'c0000001-0000-0000-0000-000000000002', 'e0000001-0000-0000-0000-000000000002',
   'call', 'Globex Security Follow-up',
   'Check on security review progress. Need to send SOC2 report and schedule pen test demo.',
   NOW() + INTERVAL '5 days', NULL),

  ('f0000001-0000-0000-0000-000000000010', uid,
   'd0000001-0000-0000-0000-000000000008', 'c0000001-0000-0000-0000-000000000005', 'e0000001-0000-0000-0000-000000000004',
   'meeting', 'Umbrella Health - Technical Deep Dive',
   'David Torres wants to see our infrastructure. Prepare: architecture diagram, data flow, encryption specs, deployment options.',
   NOW() + INTERVAL '8 days', NULL),

  ('f0000001-0000-0000-0000-000000000011', uid,
   'd0000001-0000-0000-0000-000000000004', 'c0000001-0000-0000-0000-000000000002', NULL,
   'task', 'Follow up with Priya Patel',
   'Send her a personalized demo based on her LinkedIn post about digital transformation. Could be internal champion at Globex.',
   NOW() + INTERVAL '3 days', NULL);

END $$;
