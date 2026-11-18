-- 2026-11-18：预警回指证据照片
-- 管理端「预警照片」原先只能显示动物档案头像，管理员看不到「这次到底拍了什么」。
-- 本迁移给 Alert 加两个可空外键，指向触发这条预警的那条目击记录或那份健康报告，
-- 由规则引擎在命中时写入（两条链路本来就带着 id，只是此前没有落库）。
-- 老数据两个字段留空，前端按「证据图 → 档案头像 → 归档照片」逐级回落。
--
-- 由 `prisma migrate diff` 生成，逐字未改（本次 diff 不含任何 DROP）。
-- 注意：Observation / HealthReport 上新增的 `alerts Alert[]` 是反向关系字段，
-- 只存在于 Prisma 的数据模型里，不产生任何 DDL。

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "observationId" TEXT,
ADD COLUMN     "reportId" TEXT;

-- CreateIndex
CREATE INDEX "Alert_observationId_idx" ON "Alert"("observationId");

-- CreateIndex
CREATE INDEX "Alert_reportId_idx" ON "Alert"("reportId");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "HealthReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
