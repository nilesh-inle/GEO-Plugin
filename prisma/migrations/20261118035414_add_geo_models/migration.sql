-- CreateTable
CREATE TABLE "Store" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'full',
    "status" TEXT NOT NULL DEFAULT 'running',
    "steps" TEXT NOT NULL,
    "progress" TEXT NOT NULL DEFAULT '{}',
    "scan" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "auditId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Product" (
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
    "ratingValue" REAL,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "productsCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "runId" TEXT,
    "data" TEXT NOT NULL,
    "issues" INTEGER NOT NULL,
    "warnings" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SyncRun_shop_startedAt_idx" ON "SyncRun"("shop", "startedAt");

-- CreateIndex
CREATE INDEX "Product_shop_idx" ON "Product"("shop");

-- CreateIndex
CREATE INDEX "Collection_shop_idx" ON "Collection"("shop");

-- CreateIndex
CREATE INDEX "Audit_shop_createdAt_idx" ON "Audit"("shop", "createdAt");
