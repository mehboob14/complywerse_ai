"""Smart asset import — accept ANY client spreadsheet (isolated module).

Self-contained so it can be developed and pushed on its own:
  mapping.py  — pure column-mapping intelligence (no DB), self-tested
  service.py  — parse the file, commit rows to ITAsset (dedupe), undo a batch
  schema.py   — request/response models
  router.py   — /asset-import endpoints (registered with one line in main.py)
"""
