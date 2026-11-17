-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "ackedById" TEXT,
ADD COLUMN     "ackedByRole" "Role";

-- AlterTable
ALTER TABLE "Animal" ADD COLUMN     "pendingReview" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AnimalPhoto" ADD COLUMN     "pendingReview" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Observation" ADD COLUMN     "pendingReview" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "AnimalPhoto_pendingReview_idx" ON "AnimalPhoto"("pendingReview");

-- CreateIndex
CREATE INDEX "Observation_pendingReview_idx" ON "Observation"("pendingReview");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_ackedById_fkey" FOREIGN KEY ("ackedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

