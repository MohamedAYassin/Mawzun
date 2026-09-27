-- Owner and membership invariants, enforced at COMMIT time.
--
-- `Company.ownerId` is a Restrict foreign key, so the database already refuses
-- to *hard delete* an owner. That is the only thing it refused: an owner could
-- still be suspended, soft-deleted, detached from their company, or moved to a
-- different one, and every one of those leaves a company whose super admin
-- cannot log in. The service layer rejects them, but a service is a convention
-- — a migration, a back-office script or a psql session ignores conventions.
--
-- These are therefore enforced in the database, as deferred constraint
-- triggers. Deferral is the whole point: signup has to create the user before
-- the company that will own them, and the company before the user can be
-- attached to it. A user row with no company is a legal *intermediate* state
-- inside that transaction. It is not a legal state to commit.
--
--   user created     (companyId = NULL)   -- would fail an immediate check
--   company created  (ownerId = user)
--   user attached    (companyId = company)
--   COMMIT -> the triggers run, the final state is checked, all good
--
-- Being deferred also means these checks are not validated against rows that
-- already exist — they constrain the future without rewriting the past.
--
-- The functions are SECURITY DEFINER on purpose. Row-level security is FORCEd
-- on both tables, and a deferred trigger runs at the point where the
-- transaction-local `app.company_id` setting is on its way out. Reading through
-- the definer (the migration role, which bypasses RLS) makes the verdict depend
-- only on the data, not on which connection or which point in the commit
-- sequence it is evaluated at. The functions read and raise; they never write.
--
-- Every id column in this schema is text, so the variables below are typed text
-- to match. They are compared with `IS DISTINCT FROM`, which treats NULL as a
-- comparable value rather than yielding NULL — the difference matters here,
-- because "no company" and "a different company" are separate violations.

-- ---------------------------------------------------------------------------
-- 1. The owner must be usable: active, present, and inside the company they own
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mawzun_assert_owner_usable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owned_company text;
  v_status        text;
  v_deleted_at    timestamp;
  v_company_id    text;
BEGIN
  -- Is this user the owner of anything? ownerId is unique, so at most one row.
  SELECT c."id" INTO v_owned_company
  FROM "companies" c
  WHERE c."ownerId" = NEW."id"
  LIMIT 1;

  -- Not an owner: the membership rules below still apply, this one does not.
  IF v_owned_company IS NULL THEN
    RETURN NULL;
  END IF;

  -- Re-read the row rather than trusting NEW. A row can be inserted and then
  -- updated or deleted inside one transaction, which queues several trigger
  -- events for it; only the state that would actually be committed matters.
  SELECT u."status"::text, u."deletedAt", u."companyId"
    INTO v_status, v_deleted_at, v_company_id
  FROM "users" u
  WHERE u."id" = NEW."id";

  -- Inserted and then deleted before commit: nothing is left to check.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'COMPANY_OWNER_PROTECTED: لا يمكن حذف مالك الشركة.'
      USING ERRCODE = '23514';
  END IF;

  IF v_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'COMPANY_OWNER_PROTECTED: لا يمكن تعطيل حساب مالك الشركة.'
      USING ERRCODE = '23514';
  END IF;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'COMPANY_OWNER_PROTECTED: مالك الشركة يجب أن يبقى منتمياً إلى شركته.'
      USING ERRCODE = '23514';
  END IF;

  IF v_company_id IS DISTINCT FROM v_owned_company THEN
    RAISE EXCEPTION 'COMPANY_OWNER_PROTECTED: لا يمكن نقل مالك الشركة إلى شركة أخرى.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The same rules, checked from the company's side
--
-- Covers what the users trigger cannot see: pointing an existing company at a
-- new owner (an ownership transfer), or attaching a company to someone who is
-- already suspended or belongs somewhere else.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mawzun_assert_company_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status     text;
  v_deleted_at timestamp;
  v_company_id text;
BEGIN
  IF NEW."ownerId" IS NULL THEN
    RAISE EXCEPTION 'COMPANY_OWNER_REQUIRED: يجب أن يكون لكل شركة مالك واحد.'
      USING ERRCODE = '23514';
  END IF;

  -- A company deleted inside the same transaction leaves no row to check.
  IF NOT EXISTS (SELECT 1 FROM "companies" c WHERE c."id" = NEW."id") THEN
    RETURN NULL;
  END IF;

  SELECT u."status"::text, u."deletedAt", u."companyId"
    INTO v_status, v_deleted_at, v_company_id
  FROM "users" u
  WHERE u."id" = NEW."ownerId";

  -- A missing owner row is the foreign key's problem, and it is not deferred.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'COMPANY_OWNER_PROTECTED: لا يمكن تعيين مالك محذوف للشركة.'
      USING ERRCODE = '23514';
  END IF;

  IF v_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'COMPANY_OWNER_PROTECTED: لا يمكن تعيين مالك غير نشط للشركة.'
      USING ERRCODE = '23514';
  END IF;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'COMPANY_OWNER_PROTECTED: مالك الشركة يجب أن يكون منتمياً إليها.'
      USING ERRCODE = '23514';
  END IF;

  IF v_company_id IS DISTINCT FROM NEW."id" THEN
    RAISE EXCEPTION 'COMPANY_OWNER_PROTECTED: مالك الشركة يجب أن يكون من مستخدميها.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Membership: business users belong to a company, platform staff to none
--
-- `companyId IS NULL` is how a platform administrator is expressed. It has to
-- mean exactly that and nothing else — otherwise the same shape doubles as "an
-- ordinary user whose company was never set", which is precisely the row a
-- mis-scoped query produces and the shape the isolation tests guard against.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mawzun_assert_user_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_platform_admin boolean;
  v_company_id        text;
BEGIN
  SELECT u."isPlatformAdmin", u."companyId"
    INTO v_is_platform_admin, v_company_id
  FROM "users" u
  WHERE u."id" = NEW."id";

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_is_platform_admin THEN
    IF v_company_id IS NOT NULL THEN
      RAISE EXCEPTION 'PLATFORM_ADMIN_SEPARATE: حساب إدارة المنصة لا ينتمي إلى شركة.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_company_id IS NULL THEN
    RAISE EXCEPTION 'COMPANY_MEMBERSHIP_REQUIRED: يجب أن ينتمي المستخدم إلى شركة.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
--
-- CONSTRAINT TRIGGER is what makes DEFERRABLE available; a plain AFTER trigger
-- cannot be deferred. FOR EACH ROW, because every one of these checks is about
-- one row's final state.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS "users_owner_usable" ON "users";
CREATE CONSTRAINT TRIGGER "users_owner_usable"
  AFTER INSERT OR UPDATE OF "status", "deletedAt", "companyId" ON "users"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION mawzun_assert_owner_usable();

DROP TRIGGER IF EXISTS "users_membership" ON "users";
CREATE CONSTRAINT TRIGGER "users_membership"
  AFTER INSERT OR UPDATE OF "companyId", "isPlatformAdmin" ON "users"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION mawzun_assert_user_membership();

DROP TRIGGER IF EXISTS "companies_owner_usable" ON "companies";
CREATE CONSTRAINT TRIGGER "companies_owner_usable"
  AFTER INSERT OR UPDATE OF "ownerId" ON "companies"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION mawzun_assert_company_owner();

-- The restricted application role has to be able to fire these. The functions
-- read through the definer, but the trigger itself still executes as the caller.
-- No role-specific grants: the functions run as their owner (the migration
-- user) inside the triggers, so EXECUTE follows ownership. Any runtime role
-- never invokes them directly.
