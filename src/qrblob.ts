import { encode } from 'uqr';

// A QR drawn as liquid: the three corner eyes are soft rounded squares, and every data module
// is a slightly uneven drop that the goo filter melts into its neighbours, so runs of modules
// become wobbly strands. The drops stay fat enough (and the eyes crisp enough) that phone
// cameras still read it.
let uid = 0;

export function qrBlob(text: string, ink = '#202020', paper = '#7bfb70') {
  const { data } = encode(text, { ecc: 'M', border: 0 });
  const n = data.length;
  const id = `qrgoo${uid++}`;
  const eye = (x: number, y: number) =>
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="2.3" fill="none" stroke="${ink}" stroke-width="1"/>` +
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="1.2" fill="${ink}"/>`;
  const inEye = (x: number, y: number) => (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
  let drops = '';
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (!data[y][x] || inEye(x, y)) continue;
      const j = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const f = j - Math.floor(j);
      const r = 0.56 + f * 0.1;
      drops += `<circle cx="${x + 0.5 + (f - 0.5) * 0.14}" cy="${y + 0.5 + (((f * 7) % 1) - 0.5) * 0.14}" r="${r.toFixed(2)}"/>`;
    }
  return `<span class="qr"><svg viewBox="-1 -1 ${n + 2} ${n + 2}" role="img" aria-label="QR code">
    <defs><filter id="${id}" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="0.3"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -6.2"/>
    </filter></defs>
    <rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="${paper}"/>
    <g filter="url(#${id})" fill="${ink}">${drops}</g>
    ${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}
  </svg></span>`;
}
