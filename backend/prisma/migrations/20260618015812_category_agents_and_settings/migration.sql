-- Drop single default-assignee on categories (replaced by many-to-many)
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_defaultAssigneeId_fkey";
ALTER TABLE "categories" DROP COLUMN IF EXISTS "defaultAssigneeId";

-- Many-to-many category <-> agents
CREATE TABLE "category_agents" (
    "categoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "category_agents_pkey" PRIMARY KEY ("categoryId","userId")
);
ALTER TABLE "category_agents" ADD CONSTRAINT "category_agents_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "category_agents" ADD CONSTRAINT "category_agents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Singleton app settings
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "requireContactPhone" BOOLEAN NOT NULL DEFAULT true,
    "requireContactEmail" BOOLEAN NOT NULL DEFAULT true,
    "requireCategory" BOOLEAN NOT NULL DEFAULT true,
    "requireSubcategory" BOOLEAN NOT NULL DEFAULT true,
    "categoryLabel" TEXT NOT NULL DEFAULT 'Category',
    "subcategoryLabel" TEXT NOT NULL DEFAULT 'Subcategory',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);
