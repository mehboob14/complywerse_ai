cd "c:/Users/HP/OneDrive/Desktop/GRC 1/complywerse_ai/backend"
for i in $(seq 1 8); do
  n=$(PYTHONIOENCODING=utf-8 python -c "
import os
from dotenv import load_dotenv; load_dotenv('.env')
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
base=os.environ['POSTGRES_ADMIN_URL'].rsplit('/',1)[0]
db=sessionmaker(bind=create_engine(base+'/grc_complyverse'))()
from grc.models import NormalizedControl
print(db.query(NormalizedControl).filter(NormalizedControl.run_id==18, NormalizedControl.recommended_evidence.is_(None)).count())
db.close()")
  echo "pass $i: $n controls still missing evidence"
  if [ "$n" = "0" ]; then echo "EVLOOPDONE"; break; fi
  PYTHONIOENCODING=utf-8 python evidence_13.py > /tmp/ev18_$i.log 2>&1
done
