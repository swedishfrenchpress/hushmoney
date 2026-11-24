// A tune drawn as steps up and down the scale: faint rungs, the E rungs a little
// stronger, one dot per note, the last (home) larger and open. Returns the inside
// of an <svg viewBox="0 0 w h">. Shared by How it works and the caught screen.

export function ladder(degrees: number[], w: number, h: number, lit = -1): string {
  const rows = 12;
  const pad = h * 0.08;
  const y = (d: number) => h - pad - (d / (rows - 1)) * (h - pad * 2);
  const x = (i: number) => w * 0.07 + (i * (w * 0.86)) / Math.max(1, degrees.length - 1);
  const rungs = Array.from({ length: rows }, (_, d) => `<line x1="0" x2="${w}" y1="${y(d)}" y2="${y(d)}" class="${d % 5 === 0 ? 'home' : ''}" />`).join('');
  const dots = degrees
    .map((d, i) => {
      const last = i === degrees.length - 1;
      return `<circle class="tdot${i === lit ? ' on' : ''}${last ? ' last' : ''}" cx="${x(i).toFixed(1)}" cy="${y(d).toFixed(1)}" r="${(h * (last ? 0.065 : 0.05)).toFixed(1)}" />`;
    })
    .join('');
  return rungs + dots;
}
