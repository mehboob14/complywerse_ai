/**
 * How tall a font's single line is, as a share of its size: CSS "normal", which is what Word calls single line spacing (about
 * 1.22 for Calibri, 1.15 for Arial). Word's "1.15 lines" is 1.15 times that, not 1.15 em. Measured once per font list in the
 * browser (the first font of the list the computer has); 1 where there is no page to measure on (tests, the server).
 */
const ratios = new Map<string, number>();

export function lineRatio(family: string): number {
  if (typeof document === 'undefined' || !document.body) return 1;
  let r = ratios.get(family);
  if (r == null) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;font-size:100px;line-height:normal;white-space:nowrap';
    probe.style.fontFamily = family;
    probe.textContent = 'Hg';
    document.body.appendChild(probe);
    r = probe.getBoundingClientRect().height / 100;                         // not offsetHeight: whole pixels lose a line a page
    probe.remove();
    r = r >= 1 && r <= 1.6 ? r : 1.15;
    ratios.set(family, r);
  }
  return r;
}
