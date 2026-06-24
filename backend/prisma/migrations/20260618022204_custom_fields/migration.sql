ALTER TABLE "app_settings" ADD COLUMN "requireContactName" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tickets" ADD COLUMN "customData" JSONB;
CREATE TABLE "custom_fields" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);
