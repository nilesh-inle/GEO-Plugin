-- CreateTable
CREATE TABLE "CitationWeek" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "weekStart" DATETIME NOT NULL,
    "provider" TEXT NOT NULL,
    "answers" INTEGER NOT NULL DEFAULT 0,
    "cited" INTEGER NOT NULL DEFAULT 0,
    "mentioned" INTEGER NOT NULL DEFAULT 0,
    "links" INTEGER NOT NULL DEFAULT 0,
    "competitors" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "CitationWeek_shop_weekStart_idx" ON "CitationWeek"("shop", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "CitationWeek_shop_weekStart_provider_key" ON "CitationWeek"("shop", "weekStart", "provider");

