-- pg_trgm нужен для GIN-индекса поиска по адресу. Drizzle расширениями не управляет, строка добавлена вручную.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."order_event_action" AS ENUM('created', 'status_changed', 'courier_assigned', 'courier_changed', 'courier_unassigned', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('new', 'accepted', 'preparing', 'ready', 'picked_up', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TABLE "couriers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "couriers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"phone" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "operators_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	CONSTRAINT "operators_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"action" "order_event_action" NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status",
	"from_courier_id" bigint,
	"to_courier_id" bigint,
	"reason" varchar(2000),
	"actor_id" bigint,
	"order_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_events_order_version_unique" UNIQUE("order_id","order_version")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"status" "order_status" DEFAULT 'new' NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"restaurant_id" bigint NOT NULL,
	"courier_id" bigint,
	"delivery_address" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_courier_required" CHECK ("orders"."status" not in ('picked_up', 'delivered') or "orders"."courier_id" is not null),
	CONSTRAINT "orders_amount_positive" CHECK ("orders"."amount_minor" > 0),
	CONSTRAINT "orders_version_positive" CHECK ("orders"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "restaurants" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "restaurants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_from_courier_id_couriers_id_fk" FOREIGN KEY ("from_courier_id") REFERENCES "public"."couriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_to_courier_id_couriers_id_fk" FOREIGN KEY ("to_courier_id") REFERENCES "public"."couriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_operators_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "orders_status_created_at_idx" ON "orders" USING btree ("status","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "orders_restaurant_created_at_idx" ON "orders" USING btree ("restaurant_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "orders_courier_active_idx" ON "orders" USING btree ("courier_id") WHERE "orders"."status" in ('ready', 'picked_up');--> statement-breakpoint
CREATE INDEX "orders_delivery_address_trgm_idx" ON "orders" USING gin ("delivery_address" gin_trgm_ops);