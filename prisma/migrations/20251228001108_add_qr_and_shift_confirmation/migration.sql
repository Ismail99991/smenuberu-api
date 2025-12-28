/*
  Warnings:

  - A unique constraint covering the columns `[performerQrToken]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingStatus" ADD VALUE 'checkin_requested';
ALTER TYPE "BookingStatus" ADD VALUE 'started';
ALTER TYPE "BookingStatus" ADD VALUE 'ended';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "endConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "endConfirmedById" TEXT,
ADD COLUMN     "endLat" DOUBLE PRECISION,
ADD COLUMN     "endLng" DOUBLE PRECISION,
ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "startConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "startConfirmedById" TEXT,
ADD COLUMN     "startLat" DOUBLE PRECISION,
ADD COLUMN     "startLng" DOUBLE PRECISION,
ADD COLUMN     "startsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Slot" ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "performerQrToken" TEXT;

-- CreateTable
CREATE TABLE "UserGeoPing" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "UserGeoPing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserGeoPing_userId_createdAt_idx" ON "UserGeoPing"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_startConfirmedById_idx" ON "Booking"("startConfirmedById");

-- CreateIndex
CREATE INDEX "Booking_endConfirmedById_idx" ON "Booking"("endConfirmedById");

-- CreateIndex
CREATE INDEX "Slot_createdById_idx" ON "Slot"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "User_performerQrToken_key" ON "User"("performerQrToken");

-- AddForeignKey
ALTER TABLE "Slot" ADD CONSTRAINT "Slot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_startConfirmedById_fkey" FOREIGN KEY ("startConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_endConfirmedById_fkey" FOREIGN KEY ("endConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGeoPing" ADD CONSTRAINT "UserGeoPing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
