import zipfile
import xml.etree.ElementTree as ET
import sys

files = [
    r"NCA_Templates\REGISTER_Vulnerability-Register_Template_en_-.xlsx",
    r"NCA_Templates\Register_Cybersecurity-Risk-Management_template_en_v0.9-.xlsx"
]

for filepath in files:
    print(f"\n{'='*70}")
    print(f"FILE: {filepath}")
    print(f"{'='*70}\n")
    
    try:
        with zipfile.ZipFile(filepath, 'r') as zf:
            # Read sheet names from workbook.xml
            wb_xml = zf.read('xl/workbook.xml').decode('utf-8')
            wb_root = ET.fromstring(wb_xml)
            sheets = wb_root.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet')
            sheet_names = [s.get('name') for s in sheets]
            print(f"Sheet names: {sheet_names}\n")
            
            # Read first worksheet
            ws_xml = zf.read('xl/worksheets/sheet1.xml').decode('utf-8')
            ws_root = ET.fromstring(ws_xml)
            
            # Read shared strings
            try:
                ss_xml = zf.read('xl/sharedStrings.xml').decode('utf-8')
                ss_root = ET.fromstring(ss_xml)
                shared_strings = []
                for si in ss_root.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si'):
                    t_elem = si.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
                    if t_elem is not None:
                        shared_strings.append(t_elem.text)
                    else:
                        # Handle rich text
                        rich_text = []
                        for r in si.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}r'):
                            t = r.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
                            if t is not None:
                                rich_text.append(t.text)
                        shared_strings.append(''.join(rich_text) if rich_text else '')
            except:
                shared_strings = []
            
            # Parse rows
            ns = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            rows = ws_root.findall('main:sheetData/main:row', ns)
            
            for i, row in enumerate(rows):
                if i >= 20:
                    break
                
                row_num = int(row.get('r'))
                cells = row.findall('main:c', ns)
                
                has_content = False
                cell_data = {}
                
                for cell in cells:
                    ref = cell.get('r')
                    val = None
                    
                    # Check for direct value
                    v_elem = cell.find('main:v', ns)
                    if v_elem is not None and v_elem.text:
                        val = v_elem.text
                        # If cell has type 's', it's a shared string index
                        if cell.get('t') == 's':
                            idx = int(val)
                            if idx < len(shared_strings):
                                val = shared_strings[idx]
                        has_content = True
                    else:
                        # Check for formula result
                        if cell.get('t') is not None or v_elem is not None:
                            pass
                    
                    cell_data[ref] = val
                
                print(f"Row {i} (Excel row {row_num}):")
                for ref in sorted(cell_data.keys(), key=lambda x: (int(''.join(filter(str.isdigit, x))), x)):
                    val = cell_data[ref]
                    if val is not None:
                        print(f"  {ref}: {repr(val)}")
                
                if not has_content and i > 3:
                    print(f"  [Empty row]")
    
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()

