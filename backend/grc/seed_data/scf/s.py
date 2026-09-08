import json,re
c=json.load(open('controls.json',encoding='utf-8'))['controls']
def s(*terms, dom=None, n=25):
    out=[]
    for x in c:
        if dom and x['domain_identifier'] not in dom: continue
        blob=(x['name']+' '+x['description']).lower()
        if all(re.search(t,blob) for t in terms):
            out.append(f"{x['scf_id']} | {x['name']} | {x['description'][:200]}")
    print('\n'.join(out[:n]) or 'NONE'); print('---')
