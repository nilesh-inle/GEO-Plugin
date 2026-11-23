-- CreateTable
CREATE TABLE "AiTool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TrackPrompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "basis" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TrackRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "providers" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "progress" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "TrackAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "cited" BOOLEAN NOT NULL DEFAULT false,
    "mentioned" BOOLEAN NOT NULL DEFAULT false,
    "sources" TEXT NOT NULL DEFAULT '[]',
    "text" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Store" ("appInstallationId", "baselineAuditId", "collectionCount", "contactEmail", "country", "createdAt", "currency", "description", "fixState", "llmsAutoUpdate", "llmsDirty", "llmsStatus", "llmsUpdatedAt", "name", "optimizedAt", "policies", "productCount", "robotsStatus", "schemaSettings", "schemaStatus", "shop", "syncedAt", "updatedAt", "url") SELECT "appInstallationId", "baselineAuditId", "collectionCount", "contactEmail", "country", "createdAt", "currency", "description", "fixState", "llmsAutoUpdate", "llmsDirty", "llmsStatus", "llmsUpdatedAt", "name", "optimizedAt", "policies", "productCount", "robotsStatus", "schemaSettings", "schemaStatus", "shop", "syncedAt", "updatedAt", "url" FROM "Store";
DROP TABLE "Store";
ALTER TABLE "new_Store" RENAME TO "Store";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "AiTool_shop_provider_key" ON "AiTool"("shop", "provider");

-- CreateIndex
CREATE INDEX "TrackPrompt_shop_idx" ON "TrackPrompt"("shop");

-- CreateIndex
CREATE INDEX "TrackRun_shop_startedAt_idx" ON "TrackRun"("shop", "startedAt");

-- CreateIndex
CREATE INDEX "TrackAnswer_shop_createdAt_idx" ON "TrackAnswer"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "TrackAnswer_promptId_provider_idx" ON "TrackAnswer"("promptId", "provider");
