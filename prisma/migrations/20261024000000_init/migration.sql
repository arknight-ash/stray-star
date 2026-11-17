-- 智护流浪星 · 初始迁移
-- 依赖：pgvector 扩展（docker-compose 使用 pgvector/pgvector:pg16）

CREATE EXTENSION IF NOT EXISTS vector;

-- 枚举
CREATE TYPE "Role" AS ENUM ('STUDENT', 'ADMIN');
CREATE TYPE "Species" AS ENUM ('CAT', 'DOG');
CREATE TYPE "HealthLevel" AS ENUM ('GREEN', 'YELLOW', 'RED');
CREATE TYPE "ObservationType" AS ENUM ('FEEDING', 'HEALTH', 'BEHAVIOR', 'OTHER');
CREATE TYPE "Severity" AS ENUM ('MILD', 'MODERATE', 'SEVERE');
CREATE TYPE "AlertLevel" AS ENUM ('INFO', 'WARN', 'CRITICAL');
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACK', 'RESOLVED');

-- 用户
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "email" TEXT,
    "password" TEXT,
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_studentId_key" ON "User"("studentId");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- 个体（一颗星）
CREATE TABLE "Animal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "species" "Species" NOT NULL,
    "avatarUrl" TEXT,
    "embedding" vector(1536),
    "healthLevel" "HealthLevel" NOT NULL DEFAULT 'GREEN',
    "mapLat" DOUBLE PRECISION,
    "mapLng" DOUBLE PRECISION,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Animal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Animal_code_key" ON "Animal"("code");
CREATE INDEX "Animal_healthLevel_idx" ON "Animal"("healthLevel");
CREATE INDEX "Animal_species_idx" ON "Animal"("species");

-- 照片
CREATE TABLE "AnimalPhoto" (
    "id" TEXT NOT NULL,
    "animalId" TEXT,
    "url" TEXT NOT NULL,
    "embedding" vector(1536),
    "confidence" DOUBLE PRECISION,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnimalPhoto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnimalPhoto_animalId_idx" ON "AnimalPhoto"("animalId");

-- 众包观察
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ObservationType" NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "severity" "Severity" NOT NULL DEFAULT 'MILD',
    "imageUrl" TEXT,
    "mapLat" DOUBLE PRECISION,
    "mapLng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Observation_animalId_createdAt_idx" ON "Observation"("animalId", "createdAt");

-- 健康评估
CREATE TABLE "HealthReport" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "observationId" TEXT,
    "imageUrl" TEXT NOT NULL,
    "assessment" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "advice" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL,
    "disclaimer" TEXT NOT NULL,
    "reviewedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HealthReport_observationId_key" ON "HealthReport"("observationId");
CREATE INDEX "HealthReport_animalId_createdAt_idx" ON "HealthReport"("animalId", "createdAt");

-- 预警
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "level" "AlertLevel" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Alert_status_level_idx" ON "Alert"("status", "level");
CREATE INDEX "Alert_animalId_idx" ON "Alert"("animalId");

-- 知识库
CREATE TABLE "KnowledgeDoc" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeDoc_pkey" PRIMARY KEY ("id")
);

-- 审计
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- 外键
ALTER TABLE "AnimalPhoto" ADD CONSTRAINT "AnimalPhoto_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnimalPhoto" ADD CONSTRAINT "AnimalPhoto_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HealthReport" ADD CONSTRAINT "HealthReport_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HealthReport" ADD CONSTRAINT "HealthReport_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HealthReport" ADD CONSTRAINT "HealthReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 向量检索索引（余弦距离）
CREATE INDEX "Animal_embedding_idx" ON "Animal" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
CREATE INDEX "KnowledgeDoc_embedding_idx" ON "KnowledgeDoc" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
