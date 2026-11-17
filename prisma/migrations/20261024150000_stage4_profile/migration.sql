-- DropForeignKey
ALTER TABLE "Observation" DROP CONSTRAINT "Observation_userId_fkey";

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "seedKey" TEXT;

-- AlterTable
ALTER TABLE "Animal" ADD COLUMN     "healthManual" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "HealthReport" ADD COLUMN     "seedKey" TEXT;

-- AlterTable
ALTER TABLE "Observation" ADD COLUMN     "authorName" TEXT,
ADD COLUMN     "seedKey" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Alert_seedKey_key" ON "Alert"("seedKey");

-- CreateIndex
CREATE UNIQUE INDEX "HealthReport_seedKey_key" ON "HealthReport"("seedKey");

-- CreateIndex
CREATE UNIQUE INDEX "Observation_seedKey_key" ON "Observation"("seedKey");

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 回填：本次迁移前已落库的种子数据挂上 seedKey，使 seed 改成 upsert 后不会重复插入。
-- 用户产生的数据 seedKey 恒为 NULL，不在回填范围内（一条都不删）。
UPDATE "Observation" SET "seedKey" = 'SEED:OBS:No.001:0' WHERE "seedKey" IS NULL AND "content" = '晚 7 点在图书馆北侧花坛投喂，吃了大概半碗猫粮，喝了不少水。左耳耳标看得很清楚。';
UPDATE "Observation" SET "seedKey" = 'SEED:OBS:No.001:1' WHERE "seedKey" IS NULL AND "content" = '主动蹭人，愿意被摸头但不让抱。旁边有同学拍照时它也没跑。';
UPDATE "Observation" SET "seedKey" = 'SEED:OBS:No.001:2' WHERE "seedKey" IS NULL AND "content" = '精神好，毛色顺滑，眼睛鼻子干净，没有打喷嚏或流泪。';
UPDATE "Observation" SET "seedKey" = 'SEED:OBS:No.002:3' WHERE "seedKey" IS NULL AND "content" = '三食堂后巷投喂，平时一口气吃完的量今天只吃了三分之一就走了。';
UPDATE "Observation" SET "seedKey" = 'SEED:OBS:No.002:4' WHERE "seedKey" IS NULL AND "content" = '看起来比上个月瘦了一圈，趴着的时间变长，叫它也不怎么抬头。';
UPDATE "Observation" SET "seedKey" = 'SEED:OBS:No.002:5' WHERE "seedKey" IS NULL AND "content" = '还是占据垃圾桶旁的位置，驱赶附近另一只猫，攻击性比之前强一点。';
UPDATE "Observation" SET "seedKey" = 'SEED:OBS:No.002:6' WHERE "seedKey" IS NULL AND "content" = '已把食欲下降的情况发到社团群，等有经验的同学一起判断要不要诱捕就医。';
UPDATE "Observation" SET "seedKey" = 'SEED:OBS:No.003:7' WHERE "seedKey" IS NULL AND "content" = '晚上 11 点在研究生公寓 C 座绿化带看到它，靠近两米就跑，只拍到一张模糊的照片。';
UPDATE "Observation" SET "seedKey" = 'SEED:OBS:No.003:8' WHERE "seedKey" IS NULL AND "content" = '在绿化带边缘放了猫粮和水，早上看碗空了，但没见到本体。';
UPDATE "Observation" SET "seedKey" = 'SEED:OBS:No.003:9' WHERE "seedKey" IS NULL AND "content" = '远远看毛色干净，走路姿态正常，没有跛行，异瞳很显眼。';
UPDATE "Observation" SET "seedKey" = 'SEED:OBS:No.004:10' WHERE "seedKey" IS NULL AND "content" = '操场东侧喂了狗粮加水，吃完后在旁边趴了半小时，有几位同学在旁边坐着它也不介意。';
UPDATE "Observation" SET "seedKey" = 'SEED:OBS:No.004:11' WHERE "seedKey" IS NULL AND "content" = '左后腿还是有点跛，跑起来看得出来，但不影响走路。项圈有点旧了，考虑换一条。';
UPDATE "Observation" SET "seedKey" = 'SEED:OBS:No.004:12' WHERE "seedKey" IS NULL AND "content" = '已在社团登记接种记录（去年秋季），下次驱虫时间待补。';
UPDATE "Observation" SET "seedKey" = 'SEED:OBS:No.005:13' WHERE "seedKey" IS NULL AND "content" = '工程训练中心北侧车棚发现的，右后腿有一道伤口，周围毛被血黏住了，走路不敢着地。已经上报，等社团来处理。';
UPDATE "Observation" SET "seedKey" = 'SEED:OBS:No.005:14' WHERE "seedKey" IS NULL AND "content" = '放了狗粮和温水，它只吃了几口就缩回车棚角落。精神比昨天更差。';
UPDATE "HealthReport" SET "seedKey" = 'SEED:REPORT:No.005' WHERE "seedKey" IS NULL AND "assessment" = '照片与描述显示右后腿存在开放性外伤，周围被毛污染，行走时避用患肢。属需要尽快线下核实并送医的情况。';
UPDATE "Alert" SET "seedKey" = 'SEED:ALERT:No.005' WHERE "seedKey" IS NULL AND "reason" = '右后腿外伤且连续 2 天精神变差、进食减少，需尽快医疗介入';
