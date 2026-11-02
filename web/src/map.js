// Draws you and your suitcase on a small SVG map, scaled to fit both.
// Input is latitude/longitude (what a real GPS tracker reports), turned into metres.

const M_PER_DEG = 111_320;

export function toXY(ref, p) {
  return {
    x: (p.lon - ref.lon) * M_PER_DEG * Math.cos((ref.lat * Math.PI) / 180),
    y: (p.lat - ref.lat) * M_PER_DEG,
  };
}

export function distanceM(a, b) {
  const d = toXY(a, b);
  return Math.hypot(d.x, d.y);
}

const W = 350;
const H = 230;
const PAD = 38;
const SCALE_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
const f = (n) => n.toFixed(1);

/**
 * @param {SVGSVGElement} svg
 * @param {{ owner:{x:number,y:number}, item:{x:number,y:number}, accuracy:number, trail:{x:number,y:number}[], ringing:boolean, label:string }} m
 */
export function drawMap(svg, m) {
  const pts = [m.owner, m.item, ...m.trail];
  let minX = Math.min(...pts.map((p) => p.x));
  let maxX = Math.max(...pts.map((p) => p.x));
  let minY = Math.min(...pts.map((p) => p.y));
  let maxY = Math.max(...pts.map((p) => p.y));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const spanX = Math.max(maxX - minX, 30);
  const spanY = Math.max(maxY - minY, 30 * (H / W));
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const sx = (x) => W / 2 + (x - cx) * scale;
  const sy = (y) => H / 2 - (y - cy) * scale;

  const barM = [...SCALE_STEPS].reverse().find((n) => n * scale <= 90) ?? SCALE_STEPS[0];
  const barPx = barM * scale;

  const grid = [];
  for (let i = 1; i < 6; i++) {
    grid.push(`<line class="m-grid" x1="${f((W / 6) * i)}" y1="0" x2="${f((W / 6) * i)}" y2="${H}"/>`);
  }
  for (let i = 1; i < 4; i++) {
    grid.push(`<line class="m-grid" x1="0" y1="${f((H / 4) * i)}" x2="${W}" y2="${f((H / 4) * i)}"/>`);
  }

  const trail = m.trail.length > 1 ? `<polyline class="m-trail" points="${m.trail.map((p) => `${f(sx(p.x))},${f(sy(p.y))}`).join(' ')}"/>` : '';
  const ix = sx(m.item.x);
  const iy = sy(m.item.y);
  const ox = sx(m.owner.x);
  const oy = sy(m.owner.y);
  const accR = Math.min(36, Math.max(6, m.accuracy * scale));
  // Put each label above its dot, on the outside, so they never sit on top of each other.
  const caseOnRight = ix >= ox;
  const label = (text, x, y, outerRight) =>
    `<text class="m-text" x="${f(x + (outerRight ? 6 : -6))}" y="${f(y - 14)}" text-anchor="${outerRight ? 'start' : 'end'}">${text}</text>`;
  const ring = m.ringing ? `<circle class="m-ring" cx="${f(ix)}" cy="${f(iy)}" r="22"/><circle class="m-ring" cx="${f(ix)}" cy="${f(iy)}" r="32" stroke-opacity="0.5"/>` : '';

  svg.setAttribute('aria-label', m.label);
  svg.innerHTML = `
    <rect class="m-bg" width="${W}" height="${H}"/>
    ${grid.join('')}
    ${trail}
    <line class="m-line" x1="${f(ox)}" y1="${f(oy)}" x2="${f(ix)}" y2="${f(iy)}"/>
    <circle class="m-acc" cx="${f(ix)}" cy="${f(iy)}" r="${f(accR)}"/>
    ${ring}
    <circle class="m-case" cx="${f(ix)}" cy="${f(iy)}" r="9"/>
    <circle class="m-owner" cx="${f(ox)}" cy="${f(oy)}" r="7"/>
    ${label('Case', ix, iy, caseOnRight)}
    ${label('You', ox, oy, !caseOnRight)}
    <line class="m-scale" x1="14" y1="${H - 16}" x2="${f(14 + barPx)}" y2="${H - 16}"/>
    <text class="m-text" x="14" y="${H - 22}">${barM >= 1000 ? `${barM / 1000} km` : `${barM} m`}</text>`;
}
