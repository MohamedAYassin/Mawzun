-- Company isolation enforced by the database.
--
-- Every company-scoped table gets a row-level security policy keyed on
-- app.company_id, set with set_config() at the start of each request. This is
-- defence in depth: the application also scopes every query, but a bug there
-- can no longer expose another company's rows.
--
-- When app.company_id is unset the comparison yields NULL and nothing is
-- visible, so the policy fails closed.
--
-- Genuinely global tables (billing_plans, countries) are left open for reads.
--
-- The runtime credential is whatever the operator points DATABASE_URL at. The
-- table owner (the user migrations run as) bypasses RLS, so privileged paths
-- (login, signup, platform administration, seeding) resolve identity freely:
-- that has to happen before any company context exists. Any *other* role the
-- operator grants for the app gets the policies below and nothing more.

-- The restricted runtime role only exists where a superuser (or a role with
-- CREATEROLE) can provision it — a local postgres server. Managed hosts such
-- as Heroku Postgres hand out a single non-superuser credential that owns the
-- database, so CREATE ROLE and ALTER DEFAULT PRIVILEGES are not available
-- there. On those hosts the owner IS the runtime credential and, as table
-- owner, it bypasses RLS anyway; the policies below still apply to any
-- non-owner role a host might grant.
-- Role provisioning is deliberately out of scope. Creating roles here would
-- hard-code a password into the repository and fail on managed hosts where
-- the deployment credential may not CREATE ROLE. Operators own their
-- credentials: point DATABASE_URL at the user you want, grant it table
-- privileges yourself if it is not the owner, and the policies enforce
-- company isolation for it automatically.

-- ---------------------------------------------------------------
-- Directly scoped tables (own companyId column)
-- ---------------------------------------------------------------
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "api_keys";
CREATE POLICY company_isolation ON "api_keys"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

-- Company-less rows are platform-level events, visible only to platform staff.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "audit_logs";
CREATE POLICY company_isolation ON "audit_logs"
  USING (("companyId" = current_setting('app.company_id', true) OR ("companyId" IS NULL AND current_setting('app.is_platform_admin', true) = 'true')))
  WITH CHECK (("companyId" = current_setting('app.company_id', true) OR ("companyId" IS NULL AND current_setting('app.is_platform_admin', true) = 'true')));

ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brands" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "brands";
CREATE POLICY company_isolation ON "brands"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "cancel_reasons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cancel_reasons" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "cancel_reasons";
CREATE POLICY company_isolation ON "cancel_reasons"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "carriers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "carriers" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "carriers";
CREATE POLICY company_isolation ON "carriers"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "categories";
CREATE POLICY company_isolation ON "categories"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "cities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cities" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "cities";
CREATE POLICY company_isolation ON "cities"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "company_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "company_settings";
CREATE POLICY company_isolation ON "company_settings"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "customers";
CREATE POLICY company_isolation ON "customers"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "fulfillment_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fulfillment_batches" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "fulfillment_batches";
CREATE POLICY company_isolation ON "fulfillment_batches"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "governorates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "governorates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "governorates";
CREATE POLICY company_isolation ON "governorates"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "inventory_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_transactions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "inventory_transactions";
CREATE POLICY company_isolation ON "inventory_transactions"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "ledger_entries";
CREATE POLICY company_isolation ON "ledger_entries"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "notifications";
CREATE POLICY company_isolation ON "notifications"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "operation_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "operation_types" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "operation_types";
CREATE POLICY company_isolation ON "operation_types"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "order_items";
CREATE POLICY company_isolation ON "order_items"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "order_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_sources" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "order_sources";
CREATE POLICY company_isolation ON "order_sources"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "orders";
CREATE POLICY company_isolation ON "orders"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_methods" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "payment_methods";
CREATE POLICY company_isolation ON "payment_methods"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "payout_methods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payout_methods" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "payout_methods";
CREATE POLICY company_isolation ON "payout_methods"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "product_attribute_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_attribute_values" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "product_attribute_values";
CREATE POLICY company_isolation ON "product_attribute_values"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "product_attributes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_attributes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "product_attributes";
CREATE POLICY company_isolation ON "product_attributes"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_images" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "product_images";
CREATE POLICY company_isolation ON "product_images"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "product_merges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_merges" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "product_merges";
CREATE POLICY company_isolation ON "product_merges"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "product_variant_attributes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_variant_attributes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "product_variant_attributes";
CREATE POLICY company_isolation ON "product_variant_attributes"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_variants" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "product_variants";
CREATE POLICY company_isolation ON "product_variants"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "production_batch_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "production_batch_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "production_batch_items";
CREATE POLICY company_isolation ON "production_batch_items"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "production_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "production_batches" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "production_batches";
CREATE POLICY company_isolation ON "production_batches"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "products";
CREATE POLICY company_isolation ON "products"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "purchase_order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "purchase_order_items";
CREATE POLICY company_isolation ON "purchase_order_items"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "purchase_orders";
CREATE POLICY company_isolation ON "purchase_orders"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "reorder_points" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reorder_points" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "reorder_points";
CREATE POLICY company_isolation ON "reorder_points"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "roles";
CREATE POLICY company_isolation ON "roles"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "shipping_returns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipping_returns" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "shipping_returns";
CREATE POLICY company_isolation ON "shipping_returns"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "stock_count_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_count_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "stock_count_items";
CREATE POLICY company_isolation ON "stock_count_items"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "stock_counts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_counts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "stock_counts";
CREATE POLICY company_isolation ON "stock_counts"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "stock_levels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_levels" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "stock_levels";
CREATE POLICY company_isolation ON "stock_levels"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "stock_operation_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_operation_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "stock_operation_items";
CREATE POLICY company_isolation ON "stock_operation_items"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "stock_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_operations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "stock_operations";
CREATE POLICY company_isolation ON "stock_operations"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "storage_locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "storage_locations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "storage_locations";
CREATE POLICY company_isolation ON "storage_locations"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stores" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "stores";
CREATE POLICY company_isolation ON "stores"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "subscriptions";
CREATE POLICY company_isolation ON "subscriptions"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "sync_errors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_errors" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "sync_errors";
CREATE POLICY company_isolation ON "sync_errors"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "tax_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_rates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "tax_rates";
CREATE POLICY company_isolation ON "tax_rates"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "uoms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uoms" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "uoms";
CREATE POLICY company_isolation ON "uoms"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

-- Platform staff belong to no company and must see across all of them.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "users";
CREATE POLICY company_isolation ON "users"
  USING (("companyId" = current_setting('app.company_id', true) OR current_setting('app.is_platform_admin', true) = 'true'))
  WITH CHECK (("companyId" = current_setting('app.company_id', true) OR current_setting('app.is_platform_admin', true) = 'true'));

ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vendors" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "vendors";
CREATE POLICY company_isolation ON "vendors"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouses" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "warehouses";
CREATE POLICY company_isolation ON "warehouses"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "withdrawal_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "withdrawal_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "withdrawal_requests";
CREATE POLICY company_isolation ON "withdrawal_requests"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

-- ---------------------------------------------------------------
-- Indirectly scoped tables (reach a company through a parent row)
-- ---------------------------------------------------------------
-- A company sees itself. Platform staff see all.
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "companies";
CREATE POLICY company_isolation ON "companies"
  USING (("id" = current_setting('app.company_id', true) OR current_setting('app.is_platform_admin', true) = 'true'))
  WITH CHECK (("id" = current_setting('app.company_id', true) OR current_setting('app.is_platform_admin', true) = 'true'));

-- Scoped through role -> company.
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "role_permissions";
CREATE POLICY company_isolation ON "role_permissions"
  USING (EXISTS (SELECT 1 FROM "roles" r WHERE r."id" = "role_permissions"."roleId" AND r."companyId" = current_setting('app.company_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "roles" r WHERE r."id" = "role_permissions"."roleId" AND r."companyId" = current_setting('app.company_id', true)));

-- Scoped through user -> company.
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "user_roles";
CREATE POLICY company_isolation ON "user_roles"
  USING (EXISTS (SELECT 1 FROM "users" u WHERE u."id" = "user_roles"."userId" AND u."companyId" = current_setting('app.company_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "users" u WHERE u."id" = "user_roles"."userId" AND u."companyId" = current_setting('app.company_id', true)));

-- Scoped through user -> company. Refresh runs on the privileged connection.
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "sessions";
CREATE POLICY company_isolation ON "sessions"
  USING ((EXISTS (SELECT 1 FROM "users" u WHERE u."id" = "sessions"."userId" AND u."companyId" = current_setting('app.company_id', true)) OR current_setting('app.is_platform_admin', true) = 'true'))
  WITH CHECK ((EXISTS (SELECT 1 FROM "users" u WHERE u."id" = "sessions"."userId" AND u."companyId" = current_setting('app.company_id', true)) OR current_setting('app.is_platform_admin', true) = 'true'));

-- ---------------------------------------------------------------
-- Global reference data: readable by the app role, never written by it.
-- ---------------------------------------------------------------
-- Global tables: platform-owned, so non-owner roles keep read-only access via
-- the SELECT they were granted; the owner manages them freely.
