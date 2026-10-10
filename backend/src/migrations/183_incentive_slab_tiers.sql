-- 183: Bronze/Silver/Gold milestone tiers for Lead Incentive ranges.
--
-- A range (incentive_slabs) can now define up to three manual milestone tiers.
-- When a range has at least one active tier it runs in "tier mode":
--   * the race does NOT stop when someone reaches a tier (no STOP-AFTER-WIN),
--   * it settles at the range's competition window end,
--   * each tier has exactly one winner = the FRO with the highest collected
--     amount whose total crossed that tier's target; ties go to whoever
--     crossed that tier's target first.
-- Ranges with no active tiers keep the legacy single-winner behaviour.
--
-- lead_champion_announcements gains a tier snapshot so one range can announce
-- one winner PER TIER per day. The old (date, slab) unique index is replaced by
-- two partial indexes: legacy rows (tier_key IS NULL) stay one-per-(date, slab),
-- tier rows are unique per (date, slab, tier_key).
--
-- Applied on boot by backend/src/bootstrap/ensureSpecialIncentiveSchema.js,
-- which is idempotent, because migrations are not auto-run in this deployment.

CREATE TABLE IF NOT EXISTS public.incentive_slab_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slab_id UUID NOT NULL REFERENCES public.incentive_slabs(id) ON DELETE CASCADE,
  tier_key TEXT NOT NULL,
  label TEXT,
  order_index INT NOT NULL DEFAULT 0,
  target_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  prize_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (slab_id, tier_key)
);

CREATE INDEX IF NOT EXISTS idx_incentive_slab_tiers_slab ON public.incentive_slab_tiers(slab_id);

ALTER TABLE public.lead_champion_announcements ADD COLUMN IF NOT EXISTS tier_key TEXT;
ALTER TABLE public.lead_champion_announcements ADD COLUMN IF NOT EXISTS tier_label TEXT;
ALTER TABLE public.lead_champion_announcements ADD COLUMN IF NOT EXISTS tier_target NUMERIC(12,2);

DROP INDEX IF EXISTS public.idx_lead_champion_date_slab;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_champion_date_slab_legacy
  ON public.lead_champion_announcements(announcement_date, slab_id) WHERE tier_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_champion_date_slab_tier
  ON public.lead_champion_announcements(announcement_date, slab_id, tier_key) WHERE tier_key IS NOT NULL;
