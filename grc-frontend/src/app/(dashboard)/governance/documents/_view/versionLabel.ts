/** A framework's version as people read it: "v8.0" for a bare number ("8.0", "2"), else as it is given ("v8.0",
 *  "Regulation (EU) 2022/2554", "First edition 2023-12"), never "vv8.0". */
export function versionLabel(version: string | number | null | undefined): string {
  const v = String(version ?? '').trim();
  return /^\d+(\.\d+)*$/.test(v) ? `v${v}` : v;
}
