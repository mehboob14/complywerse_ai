"""Scheduled & emailed reports (isolated module).

  models.py   ScheduledReport  -> grc_scheduled_reports (brand-new, tenant-scoped table)
  mailer.py   SMTP transport with a file attachment (the existing email services can't attach)
  service.py  validation, spec resolution, file generation (reuses the Report Builder export
              path), email rendering, run-now, due-schedule claiming
  router.py   /report-schedules CRUD + POST /report-schedules/{id}/run
  tasks.py    Celery beat fan-out (NOT wired until celery_app.py includes it)

Nothing here is imported at package level on purpose: main.py imports router.py, which
registers the model on Base.metadata.
"""
