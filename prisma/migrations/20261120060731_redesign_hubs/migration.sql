-- AlterTable
ALTER TABLE "Audit" ADD COLUMN "readiness" INTEGER;

-- CreateTable
CREATE TABLE "IssueState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ChangeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "items" INTEGER NOT NULL DEFAULT 1,
    "actor" TEXT NOT NULL DEFAULT 'GEO',
    "status" TEXT NOT NULL DEFAULT 'published',
    "before" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" DATETIME
);

-- CreateTable
CREATE TABLE "BrandFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProductDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "current" TEXT NOT NULL DEFAULT '',
    "suggested" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "vendor" TEXT,
    "productType" TEXT,
    "description" TEXT,
    "url" TEXT,
    "imageUrl" TEXT,
    "minPrice" REAL,
    "maxPrice" REAL,
    "prices" TEXT NOT NULL DEFAULT '[]',
    "available" BOOLEAN NOT NULL DEFAULT false,
    "variantCount" INTEGER NOT NULL DEFAULT 0,
    "gtinCount" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "descriptionChars" INTEGER NOT NULL DEFAULT 0,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "imagesMissingAlt" INTEGER NOT NULL DEFAULT 0,
    "isGiftCard" BOOLEAN NOT NULL DEFAULT false,
    "ratingValue" REAL,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Product" ("available", "description", "gtinCount", "handle", "id", "imageUrl", "maxPrice", "minPrice", "prices", "productType", "ratingCount", "ratingValue", "shop", "status", "title", "updatedAt", "url", "variantCount", "vendor") SELECT "available", "description", "gtinCount", "handle", "id", "imageUrl", "maxPrice", "minPrice", "prices", "productType", "ratingCount", "ratingValue", "shop", "status", "title", "updatedAt", "url", "variantCount", "vendor" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE INDEX "Product_shop_idx" ON "Product"("shop");
CREATE TABLE "new_Store" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "url" TEXT,
    "currency" TEXT,
    "country" TEXT,
    "contactEmail" TEXT,
    "description" TEXT,
    "policies" TEXT NOT NULL DEFAULT '[]',
    "appInstallationId" TEXT,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "collectionCount" INTEGER NOT NULL DEFAULT 0,
    "schemaSettings" TEXT,
    "robotsStatus" TEXT NOT NULL DEFAULT 'none',
    "llmsStatus" TEXT NOT NULL DEFAULT 'none',
    "schemaStatus" TEXT NOT NULL DEFAULT 'none',
    "fixState" TEXT NOT NULL DEFAULT '{}',
    "llmsAutoUpdate" BOOLEAN NOT NULL DEFAULT true,
    "llmsDirty" BOOLEAN NOT NULL DEFAULT false,
    "llmsUpdatedAt" DATETIME,
    "baselineAuditId" TEXT,
    "optimizedAt" DATETIME,
    "syncedAt" DATETIME,
    "trackAnswers" INTEGER NOT NULL DEFAULT 2,
    "trackNextRunAt" DATETIME,
    "trackDomains" TEXT,
    "shopFacts" TEXT NOT NULL DEFAULT '{}',
    "accessState" TEXT NOT NULL DEFAULT '{}',
    "settings" TEXT NOT NULL DEFAULT '{}',
    "competitors" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Store" ("appInstallationId", "baselineAuditId", "collectionCount", "contactEmail", "country", "createdAt", "currency", "description", "fixState", "llmsAutoUpdate", "llmsDirty", "llmsStatus", "llmsUpdatedAt", "name", "optimizedAt", "policies", "productCount", "robotsStatus", "schemaSettings", "schemaStatus", "shop", "syncedAt", "trackAnswers", "trackDomains", "trackNextRunAt", "updatedAt", "url") SELECT "appInstallationId", "baselineAuditId", "collectionCount", "contactEmail", "country", "createdAt", "currency", "description", "fixState", "llmsAutoUpdate", "llmsDirty", "llmsStatus", "llmsUpdatedAt", "name", "optimizedAt", "policies", "productCount", "robotsStatus", "schemaSettings", "schemaStatus", "shop", "syncedAt", "trackAnswers", "trackDomains", "trackNextRunAt", "updatedAt", "url" FROM "Store";
DROP TABLE "Store";
ALTER TABLE "new_Store" RENAME TO "Store";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "IssueState_shop_key_key" ON "IssueState"("shop", "key");

-- CreateIndex
CREATE INDEX "ChangeLog_shop_createdAt_idx" ON "ChangeLog"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "BrandFact_shop_idx" ON "BrandFact"("shop");

-- CreateIndex
CREATE INDEX "ProductDraft_shop_productId_idx" ON "ProductDraft"("shop", "productId");

-- CreateIndex
CREATE INDEX "ProductDraft_shop_status_idx" ON "ProductDraft"("shop", "status");
