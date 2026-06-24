-- Add email verification flag; backfill existing accounts as verified so they keep working.
ALTER TABLE "users" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
UPDATE "users" SET "emailVerified" = true;

-- OTP store for signup email verification
CREATE TABLE "email_otps" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "otp" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'SIGNUP',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_otps_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "email_otps_email_idx" ON "email_otps"("email");
