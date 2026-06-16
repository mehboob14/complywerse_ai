"""Manual entrypoint for the workflow engine default seeder."""

import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(__file__))
load_dotenv()

from grc.seed_workflow_engine_defaults import seed_workflow_engine_defaults


if __name__ == "__main__":
    seed_workflow_engine_defaults()
    print("Workflow engine defaults checked and seeded where needed.")
