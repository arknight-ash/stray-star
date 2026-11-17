-- 第 7 阶段：健康预警与主动提醒
-- 由 `prisma migrate diff` 生成后改写（原因同第 5 阶段）：
--   1. 只保留本次真正需要的 ALTER —— diff 还会顺手 DROP 四个 hnsw 索引
--      （它们是第 6 阶段用 raw SQL 建的，不在 schema 的视野里），那些索引必须留下；
--   2. 加列按「带默认 ADD → UPDATE 回填 → DROP DEFAULT」三步，禁止 deleteMany。

-- Alert：触发来源 + 关闭时间
ALTER TABLE "Alert" ADD COLUMN "source" TEXT;
ALTER TABLE "Alert" ADD COLUMN "resolvedAt" TIMESTAMP(3);

-- 历史预警回填：现有的每一条都由健康评估链路产生（种子那条与规则引擎那条都不例外），
-- 第 7 阶段之前不存在观察侧的触发路径。
UPDATE "Alert" SET "source" = 'HEALTH_REPORT' WHERE "source" IS NULL;

-- Observation：同学手动标记「情况紧急」
ALTER TABLE "Observation" ADD COLUMN "manualSevere" BOOLEAN NOT NULL DEFAULT false;
-- false 本身就是历史行的正确值（那时还没有这个勾选项），无需回填；
-- 默认由 Prisma 侧提供即可，去掉库级 DEFAULT，避免以后误插时不显式赋值也通过。
ALTER TABLE "Observation" ALTER COLUMN "manualSevere" DROP DEFAULT;
