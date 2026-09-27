-- Row-level security stays on; FORCE goes.
--
-- FORCE makes the table's policies apply even to the table owner. That is the
-- right call on a developer machine, where the owner (postgres) is a
-- superuser and superusers bypass RLS regardless: FORCE changes nothing.
--
-- Managed hosts such as Heroku Postgres hand out a single credential that
-- owns every table but is not a superuser. With FORCE still set, that
-- deployment owner cannot read its own identity tables unless a session
-- pretends to belong to a company, which no login path can do: resolving who
-- is calling is the one thing that must happen before company context exists.
--
-- The company_isolation policies themselves are untouched. The credential the
-- operator points the app at keeps full isolation unless it is the owner; the
-- owner bypasses RLS, which is exactly the behaviour the identity paths
-- (login, signup, refresh, platform administration) are written against.
ALTER TABLE "api_keys" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "brands" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "cancel_reasons" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "carriers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "categories" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "cities" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "company_settings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "customers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "fulfillment_batches" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "governorates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventory_transactions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entries" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "notifications" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "operation_types" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "order_items" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "order_sources" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "orders" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_methods" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "payout_methods" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_attribute_values" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_attributes" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_images" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_merges" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_variant_attributes" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_variants" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "production_batch_items" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "production_batches" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "products" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order_items" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "reorder_points" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "shipping_returns" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_count_items" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_counts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_levels" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_operation_items" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_operations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "storage_locations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "stores" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "sync_errors" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tax_rates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "uoms" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "vendors" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "warehouses" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "withdrawal_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "companies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "sessions" NO FORCE ROW LEVEL SECURITY;
