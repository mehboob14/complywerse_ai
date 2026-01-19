#!/usr/bin/env python3
"""
Export all framework controls to a structured CSV file.
"""

import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)

def export_frameworks_to_csv():
    db = SessionLocal()
    
    try:
        query = """
        SELECT 
            f.id as framework_id,
            f.short_code as framework_code,
            f.name as framework_name,
            f.version as framework_version,
            f.regulator as framework_regulator,
            f.jurisdiction as framework_jurisdiction,
            fd.id as domain_id,
            fd.code as domain_code,
            fd.name as domain_name,
            fd.description as domain_description,
            co.id as objective_id,
            co.code as objective_code,
            co.name as objective_name,
            co.description as objective_description,
            fc.id as control_id,
            fc.code as control_code,
            fc.name as control_name,
            fc.statement as control_statement,
            fc.control_objective as control_objective_text,
            fc.is_mandatory as control_is_mandatory,
            fc.risk_category as control_risk_category,
            fc.evidence_type as control_evidence_type,
            fc.implementation_guidance as control_implementation_guidance,
            fc.testing_guidance as control_testing_guidance,
            fsc.id as subcontrol_id,
            fsc.code as subcontrol_code,
            fsc.name as subcontrol_name,
            fsc.statement as subcontrol_statement,
            fsc.description as subcontrol_description
        FROM grc_frameworks f
        LEFT JOIN grc_framework_domains fd ON f.id = fd.framework_id
        LEFT JOIN grc_control_objectives co ON fd.id = co.domain_id
        LEFT JOIN grc_framework_controls fc ON co.id = fc.objective_id
        LEFT JOIN grc_framework_sub_controls fsc ON fc.id = fsc.control_id
        WHERE f.is_active = true
        ORDER BY 
            f.name,
            fd."order" NULLS LAST,
            fd.code,
            co."order" NULLS LAST,
            co.code,
            fc."order" NULLS LAST,
            fc.code,
            fsc."order" NULLS LAST,
            fsc.code
        """
        
        result = db.execute(text(query))
        rows = result.fetchall()
        columns = result.keys()
        
        output_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'exports')
        os.makedirs(output_path, exist_ok=True)
        
        csv_file = os.path.join(output_path, 'framework_controls_export.csv')
        
        with open(csv_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            
            headers = [
                'Framework_ID',
                'Framework_Code', 
                'Framework_Name',
                'Framework_Version',
                'Framework_Regulator',
                'Framework_Jurisdiction',
                'Domain_ID',
                'Domain_Code',
                'Domain_Name',
                'Domain_Description',
                'Objective_ID',
                'Objective_Code',
                'Objective_Name',
                'Objective_Description',
                'Control_ID',
                'Control_Code',
                'Control_Name',
                'Control_Statement',
                'Control_Objective',
                'Control_Is_Mandatory',
                'Control_Risk_Category',
                'Control_Evidence_Type',
                'Control_Implementation_Guidance',
                'Control_Testing_Guidance',
                'SubControl_ID',
                'SubControl_Code',
                'SubControl_Name',
                'SubControl_Statement',
                'SubControl_Description'
            ]
            writer.writerow(headers)
            
            for row in rows:
                row_data = []
                for val in row:
                    if val is None:
                        row_data.append('')
                    elif isinstance(val, bool):
                        row_data.append('Yes' if val else 'No')
                    else:
                        cleaned = str(val).replace('\n', ' ').replace('\r', ' ')
                        row_data.append(cleaned)
                writer.writerow(row_data)
        
        print(f"Exported {len(rows)} rows to {csv_file}")
        return csv_file
        
    finally:
        db.close()

if __name__ == "__main__":
    export_frameworks_to_csv()
