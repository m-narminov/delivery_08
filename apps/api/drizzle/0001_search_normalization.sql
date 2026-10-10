DROP INDEX "orders_delivery_address_trgm_idx";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_address_search" text GENERATED ALWAYS AS (translate(lower(delivery_address), 'ё', 'е')) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "orders_delivery_address_search_trgm_idx" ON "orders" USING gin ("delivery_address_search" gin_trgm_ops);