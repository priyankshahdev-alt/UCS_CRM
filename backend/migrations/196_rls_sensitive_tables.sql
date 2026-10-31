-- 196: Row-level security on sensitive tables (defence in depth).
--
-- Policies are keyed on the session variable app.current_ngo_id. When the
-- variable is unset/empty (the default today) every row is visible, so this
-- migration is safe to apply without changing application behaviour. The
-- application must call `SET LOCAL app.current_ngo_id = <ngo_id>` inside its
-- request transaction for the policy to actually restrict rows; until that
-- wiring lands the tables are protected from cross-tenant reads only once
-- the context is populated.
--
-- Run as a role with ALTER TABLE privilege (e.g. ucs_admin).

ALTER TABLE beneficiaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS beneficiaries_ngo_isolation ON beneficiaries;
CREATE POLICY beneficiaries_ngo_isolation ON beneficiaries
  FOR ALL TO ucs_app
  USING (
    current_setting('app.current_ngo_id', true) IS NULL
    OR current_setting('app.current_ngo_id', true) = ''
    OR ngo_id::text = current_setting('app.current_ngo_id', true)
  )
  WITH CHECK (
    current_setting('app.current_ngo_id', true) IS NULL
    OR current_setting('app.current_ngo_id', true) = ''
    OR ngo_id::text = current_setting('app.current_ngo_id', true)
  );

ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workers_ngo_isolation ON workers;
CREATE POLICY workers_ngo_isolation ON workers
  FOR ALL TO ucs_app
  USING (
    current_setting('app.current_ngo_id', true) IS NULL
    OR current_setting('app.current_ngo_id', true) = ''
    OR ngo_id::text = current_setting('app.current_ngo_id', true)
  )
  WITH CHECK (
    current_setting('app.current_ngo_id', true) IS NULL
    OR current_setting('app.current_ngo_id', true) = ''
    OR ngo_id::text = current_setting('app.current_ngo_id', true)
  );
