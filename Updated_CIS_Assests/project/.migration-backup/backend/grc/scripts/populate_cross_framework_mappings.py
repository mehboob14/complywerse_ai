"""
Script to populate cross-framework control similarities and update control group mappings.

This script:
1. Gets existing control groups and their mapped controls
2. For each framework not in the groups, finds similar controls using AI
3. Creates similarity mappings between controls from different frameworks
4. Adds controls from all frameworks to appropriate groups
"""

import os
import sys
from datetime import datetime
from typing import List, Dict, Optional
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from openai import OpenAI

DATABASE_URL = os.environ.get("DATABASE_URL")
engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)


def get_openai_client():
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    return OpenAI(api_key=api_key, base_url=base_url)


def get_control_groups(session) -> List[Dict]:
    """Get all control groups with their existing framework controls."""
    result = session.execute(text("""
        SELECT g.id, g.name, g.code, g.description, g.category, g.domain
        FROM grc_common_control_groups g
        ORDER BY g.code
    """))
    groups = []
    for row in result:
        groups.append({
            'id': row[0],
            'name': row[1],
            'code': row[2],
            'description': row[3],
            'category': row[4],
            'domain': row[5]
        })
    return groups


def get_group_controls(session, group_id: int) -> List[Dict]:
    """Get controls already mapped to a group."""
    result = session.execute(text("""
        SELECT m.framework_control_id, pfc.title, pfc.description, pfc.control_id, f.name as framework_name
        FROM grc_common_control_group_mappings m
        JOIN grc_parsed_framework_controls pfc ON m.framework_control_id = pfc.id
        JOIN grc_uploaded_frameworks f ON pfc.uploaded_framework_id = f.id
        WHERE m.group_id = :group_id
    """), {'group_id': group_id})
    controls = []
    for row in result:
        controls.append({
            'id': row[0],
            'title': row[1],
            'description': row[2],
            'control_id': row[3],
            'framework': row[4]
        })
    return controls


def get_unmapped_framework_controls(session) -> Dict[str, List[Dict]]:
    """Get all framework controls that are not yet mapped to any group."""
    result = session.execute(text("""
        SELECT pfc.id, pfc.control_id, pfc.title, pfc.description, pfc.domain, pfc.category,
               f.id as framework_id, f.name as framework_name
        FROM grc_parsed_framework_controls pfc
        JOIN grc_uploaded_frameworks f ON pfc.uploaded_framework_id = f.id
        WHERE pfc.id NOT IN (SELECT framework_control_id FROM grc_common_control_group_mappings WHERE framework_control_id IS NOT NULL)
        ORDER BY f.name, pfc.control_id
    """))
    
    by_framework = {}
    for row in result:
        fw_name = row[7]
        if fw_name not in by_framework:
            by_framework[fw_name] = []
        by_framework[fw_name].append({
            'id': row[0],
            'control_id': row[1],
            'title': row[2],
            'description': row[3],
            'domain': row[4],
            'category': row[5],
            'framework_id': row[6],
            'framework_name': fw_name
        })
    return by_framework


def find_best_group_for_control(client: OpenAI, control: Dict, groups: List[Dict]) -> Optional[Dict]:
    """Use AI to find the best matching group for a control."""
    groups_text = "\n".join([
        f"{i+1}. {g['name']} ({g['code']}): {g['description'] or 'No description'} [Category: {g['category']}, Domain: {g['domain']}]"
        for i, g in enumerate(groups)
    ])
    
    control_text = f"""
Control ID: {control['control_id']}
Title: {control['title']}
Description: {control['description'] or 'No description'}
Domain: {control['domain']}
Category: {control['category']}
Framework: {control['framework_name']}
"""
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert in cybersecurity frameworks and compliance. Your task is to match controls to the most appropriate control group based on their purpose, domain, and requirements."
                },
                {
                    "role": "user",
                    "content": f"""Given this control:
{control_text}

And these control groups:
{groups_text}

Which group is the BEST match for this control? Consider:
1. The control's purpose and what it aims to achieve
2. The domain and category alignment
3. Semantic similarity of requirements

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{{"group_number": <1-based index or 0 if no good match>, "confidence": <0.0-1.0>, "reason": "<brief reason>"}}

If the control doesn't clearly fit any group, return group_number: 0."""
                }
            ],
            max_tokens=200,
            temperature=0.1
        )
        
        result_text = response.choices[0].message.content.strip()
        if result_text.startswith("```"):
            result_text = result_text.split("```")[1]
            if result_text.startswith("json"):
                result_text = result_text[4:]
        
        result = json.loads(result_text)
        group_num = result.get('group_number', 0)
        confidence = result.get('confidence', 0)
        
        if group_num > 0 and group_num <= len(groups) and confidence >= 0.6:
            return {
                'group': groups[group_num - 1],
                'confidence': confidence,
                'reason': result.get('reason', '')
            }
        return None
    except Exception as e:
        print(f"  Error matching control: {e}")
        return None


def add_control_to_group(session, group_id: int, control_id: int, confidence: float):
    """Add a framework control to a group."""
    session.execute(text("""
        INSERT INTO grc_common_control_group_mappings 
        (group_id, framework_control_id, mapping_confidence, mapping_source, created_at)
        VALUES (:group_id, :control_id, :confidence, 'ai_batch', :created_at)
        ON CONFLICT DO NOTHING
    """), {
        'group_id': group_id,
        'control_id': control_id,
        'confidence': confidence,
        'created_at': datetime.utcnow()
    })


def create_similarity_mapping(session, source_id: int, target_id: int, score: float, reasoning: str, tenant_id: int = 1):
    """Create a similarity mapping between two controls."""
    session.execute(text("""
        INSERT INTO grc_control_similarity_mappings
        (tenant_id, source_type, source_control_id, target_type, target_control_id, 
         similarity_score, similarity_type, ai_reasoning, verified, created_at)
        VALUES (:tenant_id, 'framework', :source_id, 'framework', :target_id,
                :score, :sim_type, :reasoning, false, :created_at)
        ON CONFLICT DO NOTHING
    """), {
        'tenant_id': tenant_id,
        'source_id': source_id,
        'target_id': target_id,
        'score': score,
        'sim_type': 'equivalent' if score >= 0.8 else 'related' if score >= 0.6 else 'partial',
        'reasoning': reasoning,
        'created_at': datetime.utcnow()
    })


def main():
    session = Session()
    client = get_openai_client()
    
    print("=" * 60)
    print("Cross-Framework Control Mapping Script")
    print("=" * 60)
    
    groups = get_control_groups(session)
    print(f"\nFound {len(groups)} control groups")
    
    unmapped = get_unmapped_framework_controls(session)
    total_unmapped = sum(len(controls) for controls in unmapped.values())
    print(f"Found {total_unmapped} unmapped controls across {len(unmapped)} frameworks")
    
    for fw_name, controls in unmapped.items():
        print(f"  - {fw_name}: {len(controls)} controls")
    
    print("\n" + "-" * 60)
    print("Processing unmapped controls...")
    print("-" * 60)
    
    mapped_count = 0
    similarity_count = 0
    
    for fw_name, controls in unmapped.items():
        print(f"\nProcessing {fw_name} ({len(controls)} controls)...")
        
        for i, control in enumerate(controls):
            if i % 10 == 0:
                print(f"  Progress: {i}/{len(controls)}")
            
            match = find_best_group_for_control(client, control, groups)
            
            if match:
                add_control_to_group(
                    session,
                    match['group']['id'],
                    control['id'],
                    match['confidence']
                )
                mapped_count += 1
                
                existing_controls = get_group_controls(session, match['group']['id'])
                for existing in existing_controls[:3]:
                    if existing['framework'] != control['framework_name']:
                        create_similarity_mapping(
                            session,
                            control['id'],
                            existing['id'],
                            match['confidence'],
                            f"Both controls belong to group '{match['group']['name']}': {match['reason']}"
                        )
                        similarity_count += 1
        
        session.commit()
        print(f"  Committed {fw_name} mappings")
    
    print("\n" + "=" * 60)
    print(f"COMPLETE!")
    print(f"  Controls mapped to groups: {mapped_count}")
    print(f"  Similarity mappings created: {similarity_count}")
    print("=" * 60)
    
    session.close()


if __name__ == "__main__":
    main()
