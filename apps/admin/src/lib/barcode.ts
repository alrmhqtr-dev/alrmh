import qrcode from 'qrcode-generator';

/** Code 128 bar widths for symbol values 0–106 (each string is bar/space widths). */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

/** A Code 128 (set B) barcode as an SVG string, scaled to the given size in mm. Product codes are plain ASCII. */
export function code128Svg(text: string, widthMm: number, heightMm: number) {
  const chars = [...text].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
  const codes = [104, ...chars.map((c) => c.charCodeAt(0) - 32)];
  const check = codes.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  const all = [...codes, check, 106];
  const widths = all.flatMap((v) => PATTERNS[v].split('').map(Number));
  const quiet = 10;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  const rects: string[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="100"/>`);
    x += w;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 100" preserveAspectRatio="none" width="${widthMm}mm" height="${heightMm}mm" fill="#000">${rects.join('')}</svg>`;
}

/** A QR code as an SVG string (for the online receipt link). */
export function qrSvg(text: string, sizeMm: number) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const cells: string[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) cells.push(`M${c + 2} ${r + 2}h1v1h-1z`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 4} ${n + 4}" width="${sizeMm}mm" height="${sizeMm}mm" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${cells.join('')}" fill="#000"/></svg>`;
}
