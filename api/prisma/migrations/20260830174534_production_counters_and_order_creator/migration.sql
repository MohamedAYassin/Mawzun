-- AlterTable
ALTER TABLE "api_keys" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "brands" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "cancel_reasons" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "carriers" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "categories" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "cities" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "productionBatchPrefix" VARCHAR(20) NOT NULL DEFAULT 'BATCH',
ADD COLUMN     "productionNextNumber" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "customers" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "fulfillment_batches" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "governorates" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "inventory_transactions" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "ledger_entries" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "operation_types" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "order_items" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "order_sources" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "createdById" TEXT,
ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "payment_methods" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "payout_methods" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "product_attribute_values" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "product_attributes" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "product_images" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "product_merges" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "product_variant_attributes" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "product_variants" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "production_batch_items" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "production_batches" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "purchase_order_items" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "purchase_orders" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "reorder_points" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "roles" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "shipping_returns" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "stock_count_items" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "stock_counts" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "stock_levels" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "stock_operation_items" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "stock_operations" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "storage_locations" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "stores" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "subscriptions" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "sync_errors" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "tax_rates" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "uoms" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "vendors" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "warehouses" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- AlterTable
ALTER TABLE "withdrawal_requests" ALTER COLUMN "companyId" SET DEFAULT current_setting('app.company_id', true)::uuid;

-- CreateIndex
CREATE INDEX "orders_companyId_createdById_idx" ON "orders"("companyId", "createdById");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
