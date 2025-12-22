-- AlterTable
ALTER TABLE "Object" ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "type" TEXT;

-- CreateTable
CREATE TABLE "ObjectPhoto" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "objectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ObjectPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ObjectPhoto_objectId_idx" ON "ObjectPhoto"("objectId");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectPhoto_objectId_position_key" ON "ObjectPhoto"("objectId", "position");

-- AddForeignKey
ALTER TABLE "ObjectPhoto" ADD CONSTRAINT "ObjectPhoto_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "Object"("id") ON DELETE CASCADE ON UPDATE CASCADE;
