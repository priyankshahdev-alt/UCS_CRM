import db from '../config/db.js';

// Idempotent bootstrap for the "Sir ka Incentive" (special day incentive)
// tables. Ensures both tables exist on server start so the special-incentive
// flow (announce -> live leaderboard -> first-past-the-post winner) never
// fails on a fresh DB.
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS special_incentives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT,
  ngo_id UUID REFERENCES ngos(id) ON DELETE SET NULL,
  target_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  incentive_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  winner_worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  winner_claimed_at TIMESTAMPTZ,
  created_by UUID REFERENCES workers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS special_incentive_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  special_incentive_id UUID NOT NULL REFERENCES special_incentives(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  collected_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  hit_target_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(special_incentive_id, worker_id)
);

CREATE INDEX IF NOT EXISTS idx_special_incentives_status ON special_incentives(status);
CREATE INDEX IF NOT EXISTS idx_special_incentive_progress_inc ON special_incentive_progress(special_incentive_id);

ALTER TABLE special_incentives ADD COLUMN IF NOT EXISTS winner_name TEXT;
-- NGO-scoped incentives: pick one NGO (BSCT/AFLF/MANN) and only that NGO's
-- station FROs see & compete. NULL = org-wide race (all FROs).
ALTER TABLE special_incentives ADD COLUMN IF NOT EXISTS ngo_id UUID REFERENCES ngos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_special_incentives_ngo_id ON special_incentives(ngo_id);

-- Winner photo celebration ("Photo" tab): Super Admin posts the winner's photo
-- with an (optional AI-generated) congratulation, which pops up on every panel.
ALTER TABLE special_incentives ADD COLUMN IF NOT EXISTS winner_photo_url TEXT;
ALTER TABLE special_incentives ADD COLUMN IF NOT EXISTS congrats_message TEXT;
ALTER TABLE special_incentives ADD COLUMN IF NOT EXISTS celebrated_at TIMESTAMPTZ;

-- Archive: admins can archive a resolved incentive so its winner/photo popups
-- stop being delivered to panels entirely.
ALTER TABLE special_incentives ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE special_incentives ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES workers(id) ON DELETE SET NULL;
`;

const LEAD_INCENTIVE_SQL = `
CREATE TABLE IF NOT EXISTS incentive_slabs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  incentive_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_lead_amount NUMERIC(12,2) NOT NULL DEFAULT 300,
  lead_rate NUMERIC(12,2) NOT NULL DEFAULT 20,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Self-heal for older DBs: add per-slab columns (ADD COLUMN ... DEFAULT fills
-- existing rows with the sane baseline; migration 124 copies the then-current
-- global values across once).
ALTER TABLE incentive_slabs ADD COLUMN IF NOT EXISTS min_lead_amount NUMERIC(12,2) NOT NULL DEFAULT 300;
ALTER TABLE incentive_slabs ADD COLUMN IF NOT EXISTS lead_rate NUMERIC(12,2) NOT NULL DEFAULT 20;

CREATE TABLE IF NOT EXISTS incentive_settings (
  id SERIAL PRIMARY KEY,
  setting_key TEXT UNIQUE NOT NULL,
  setting_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_incentive_slabs_range ON incentive_slabs(min_amount, max_amount);
CREATE INDEX IF NOT EXISTS idx_incentive_slabs_active ON incentive_slabs(is_active);
CREATE INDEX IF NOT EXISTS idx_incentive_settings_key ON incentive_settings(setting_key);

INSERT INTO incentive_settings (setting_key, setting_value) VALUES
  ('lead_rate', 20),
  ('min_lead_amount', 300),
  ('champion_bonus', 250)
ON CONFLICT (setting_key) DO NOTHING;

-- Only seed slabs if table is empty (prevents duplicates on restart)
INSERT INTO incentive_slabs (min_amount, max_amount, incentive_amount)
SELECT * FROM (VALUES
  (0, 20000, 0),
  (20000, 50000, 500),
  (50000, 80000, 1000),
  (80000, 135000, 2000),
  (135000, 200000, 3500),
  (200000, 350000, 5000)
) AS v(min_amount, max_amount, incentive_amount)
WHERE NOT EXISTS (SELECT 1 FROM incentive_slabs LIMIT 1);
`;

const CHAMPION_ANNOUNCEMENT_SQL = `
CREATE TABLE IF NOT EXISTS lead_champion_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_date DATE NOT NULL UNIQUE,
  fro_worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  fro_name TEXT,
  total_leads INT DEFAULT 0,
  qualified_leads INT DEFAULT 0,
  total_amount NUMERIC(12,2) DEFAULT 0,
  lead_incentive NUMERIC(12,2) DEFAULT 0,
  slab_bonus NUMERIC(12,2) DEFAULT 0,
  champion_bonus NUMERIC(12,2) DEFAULT 0,
  total_incentive NUMERIC(12,2) DEFAULT 0,
  message TEXT,
  announced_by UUID REFERENCES workers(id) ON DELETE SET NULL,
  announced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_champion_date ON lead_champion_announcements(announcement_date);
`;

export async function ensureSpecialIncentiveSchema() {
  try {
    await db._pool.query(CREATE_TABLE_SQL);
    console.log('special_incentives tables ready');
  } catch (e) {
    console.warn('[special incentive schema] skip:', e?.message || String(e));
  }
  try {
    await db._pool.query(LEAD_INCENTIVE_SQL);
    console.log('incentive_slabs + incentive_settings tables ready');
  } catch (e) {
    console.warn('[lead incentive schema] skip:', e?.message || String(e));
  }
  try {
    await db._pool.query(CHAMPION_ANNOUNCEMENT_SQL);
    console.log('lead_champion_announcements table ready');
  } catch (e) {
    console.warn('[lead champion schema] skip:', e?.message || String(e));
  }
}