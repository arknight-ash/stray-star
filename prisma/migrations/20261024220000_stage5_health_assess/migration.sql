-- 第 5 阶段：多模态健康评估
-- 由 `prisma migrate diff` 生成后再改写：
--   1. required 列按「带默认加列 → 回填 → 去默认」三步走，否则历史行会让 NOT NULL 直接失败；
--   2. 回填全用 UPDATE，禁止 deleteMany —— 用户数据与种子数据都不能动。

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN "dedupeKey" TEXT;

-- AlterTable
ALTER TABLE "HealthReport" ADD COLUMN "healthStatus" "HealthLevel" NOT NULL DEFAULT 'GREEN';
ALTER TABLE "HealthReport" ADD COLUMN "needsVet" BOOLEAN NOT NULL DEFAULT false;

-- 回填历史报告：健康档按 severity 派生（与 lib/semantic.ts 的 SEVERITY_HEALTH 一致），
-- SEVERE 一律视为需要就医。
UPDATE "HealthReport" SET "healthStatus" = CASE "severity"
  WHEN 'SEVERE' THEN 'RED'::"HealthLevel"
  WHEN 'MODERATE' THEN 'YELLOW'::"HealthLevel"
  ELSE 'GREEN'::"HealthLevel"
END;
UPDATE "HealthReport" SET "needsVet" = true WHERE "severity" = 'SEVERE';

ALTER TABLE "HealthReport" ALTER COLUMN "healthStatus" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "Alert_dedupeKey_key" ON "Alert"("dedupeKey");
