-- AlterTable
ALTER TABLE "email_mailboxes" ADD COLUMN     "company" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "company" TEXT;
