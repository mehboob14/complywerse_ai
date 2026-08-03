@echo off
REM Start a Celery worker on Windows.
REM
REM Windows note: Celery's prefork pool is not supported. We use the `solo`
REM pool by default, which gives single-threaded execution per worker process.
REM For real concurrency on Windows, run multiple workers OR run on WSL.
REM
REM Usage:
REM   scripts\start_celery_worker.bat
REM   set QUEUES=default& scripts\start_celery_worker.bat

cd /d "%~dp0\.."
if not defined QUEUES set QUEUES=default,parsing
if not defined LOGLEVEL set LOGLEVEL=info

echo [celery] queues=%QUEUES% loglevel=%LOGLEVEL% pool=solo

celery -A grc.celery_app worker ^
  --queues=%QUEUES% ^
  --pool=solo ^
  --loglevel=%LOGLEVEL% ^
  --hostname=grc-worker@%%h
