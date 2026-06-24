-- Rename role enum values: ADMIN -> MANAGER, then SUPER_ADMIN -> ADMIN.
-- Order matters to avoid a naming collision. Existing rows are migrated automatically.
ALTER TYPE "UserRole" RENAME VALUE 'ADMIN' TO 'MANAGER';
ALTER TYPE "UserRole" RENAME VALUE 'SUPER_ADMIN' TO 'ADMIN';
