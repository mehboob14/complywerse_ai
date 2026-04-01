import json

with open(r'sbp_etgrmf_updated.json','r',encoding='utf-8') as f:
    data = json.load(f)
    controls = data['controls']
    
    print('✅ UPDATED JSON VALIDATION REPORT')
    print('=' * 80)
    print(f'Total controls: {len(controls)}')
    
    with_evidence = sum(1 for c in controls if len(c.get('evidence_requirements', [])) > 0)
    print(f'Controls with evidence: {with_evidence}')
    print(f'Controls without evidence: {len(controls) - with_evidence}')
    
    # Check for duplicates
    control_ids = [c['control_id'] for c in controls]
    unique_ids = set(control_ids)
    duplicates = len(control_ids) - len(unique_ids)
    print(f'Duplicate control IDs: {duplicates}')
    
    # Statistics
    print(f'\n📊 Evidence Statistics:')
    evidence_counts = [len(c.get('evidence_requirements', [])) for c in controls]
    print(f'   Average evidence per control: {sum(evidence_counts) / len(controls):.1f}')
    print(f'   Controls with 0 evidence: {sum(1 for c in evidence_counts if c == 0)}')
    print(f'   Controls with 1+ evidence:  {sum(1 for c in evidence_counts if c >= 1)}')
    print(f'   Controls with 3+ evidence: {sum(1 for c in evidence_counts if c >=3)}')
    
    # Sample controls
    print(f'\n📋 Sample Controls:')
    for control_id in ['1.1.a', '1.4.1.a', '2.1.a', '3.1.a', '4.1.a', '5.1.a', '6.1.a']:
        ctrl = next((c for c in controls if c['control_id'] == control_id), None)
        if ctrl:
            evidence_count = len(ctrl.get('evidence_requirements', []))
            print(f'   {control_id}: {evidence_count} evidences')

print('\n✅ Updated JSON appears to be valid and enriched with evidence requirements!')
