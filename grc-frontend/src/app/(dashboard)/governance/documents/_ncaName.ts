// The NCA catalogue's names come from its file names ("anti Malware Protection", "Cryptography Template en",
// "DCC Assessment and Compliance Tool V1.0xlsx"): the Document Templates popup shows them as names.

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

/** "anti Malware Protection" -> "Anti Malware Protection"; "Policy SSDLC Policy" -> "SSDLC Policy". */
export function ncaName(raw: string): string {
  let t = (raw || '').replace(/\s+/g, ' ').trim()
    .replace(/\s*\(\d+\)$/, '')                                  // a " (1)" copy
    .replace(/\.?(docx?|xlsx?|pdf)$/i, '')                       // a file extension, also glued to a version ("V1.0xlsx")
    .replace(/(\s+template)?(\s+(en|ar))?\s*$/i, '')             // "Template en", " en"
    .trim();
  t = t.replace(/^(\S+)\s+(.+\s\1)$/i, '$2')                      // a category word said twice ("Policy SSDLC Policy")
    .replace(/^register\s+(.+)$/i, '$1 Register');               // the file's category first ("Register Cybersecurity Audit Plan")
  return t.split(' ').map((w, i) => {
    if (/[A-Z0-9]/.test(w.slice(1)) || /\d/.test(w)) return w;  // an acronym, a mixed-case name or a version, as written
    const lower = w.toLowerCase();
    return i > 0 && SMALL.has(lower) ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}
