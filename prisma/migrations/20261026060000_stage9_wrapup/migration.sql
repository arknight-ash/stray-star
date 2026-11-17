-- 阶段 9：报告审核从 boolean 升级为三态。
-- 三步法：ADD 带默认 → 无需回填（默认值即存量语义 APPROVED）→ 不 DROP DEFAULT（保留兜底）。
-- hnsw 索引是 S6 用 raw SQL 建的，diff 不感知，手工维护，这里不动它们。

ALTER TABLE "HealthReport" ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "HealthReport" ADD COLUMN "reviewNote" TEXT;

-- reviewedByAdmin 与 reviewStatus 双轨期约定：reviewedByAdmin = (reviewStatus = 'APPROVED')
CREATE INDEX "HealthReport_reviewStatus_idx" ON "HealthReport"("reviewStatus");
