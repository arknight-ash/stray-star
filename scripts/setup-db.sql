-- 数据库初始化脚本（Windows 本机 PostgreSQL + pgvector 路线，无需 Docker）
--
-- 用法（在 PowerShell / cmd 里，一行搞定）：
--   & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -f scripts\setup-db.sql
--
-- 会提示输入 postgres 超级用户密码（安装 PostgreSQL 时设定的那个）。
-- 脚本做两件事：建库 straystar → 在该库里启用 pgvector 扩展。
-- 若 straystar 库已存在，第一条会报错，忽略即可，扩展仍会装上。

CREATE DATABASE straystar;

\c straystar

CREATE EXTENSION IF NOT EXISTS vector;

-- 验证：应返回一行 vector
SELECT extname, default_version FROM pg_available_extensions WHERE extname = 'vector';
SELECT extname FROM pg_extension WHERE extname = 'vector';
