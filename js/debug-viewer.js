const plot = document.getElementById("plot");
const preview = document.getElementById("preview");
const label = document.getElementById("label");

if (!(plot instanceof HTMLCanvasElement) || !preview || !label) {
  throw new Error("debug-viewer DOM missing");
}

const ctx = plot.getContext("2d");
const pad = 28;
const scale = (plot.width - 2 * pad) / 2;

function toCanvas(gx, gy) {
  const x = pad + (gx + 1) * scale;
  const y = pad + (1 - gy) * scale;
  return { x, y };
}

function fromCanvas(px, py) {
  const gx = (px - pad) / scale - 1;
  const gy = 1 - (py - pad) / scale;
  return { gx, gy };
}

async function main() {
  const res = await fetch(new URL("../frames-index.json", import.meta.url));
  const data = await res.json();
  const frames = data.frames;
  const base = new URL("../", import.meta.url);

  ctx.fillStyle = "#1a1a1e";
  ctx.fillRect(0, 0, plot.width, plot.height);
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1;
  const c0 = toCanvas(0, 0);
  ctx.beginPath();
  ctx.moveTo(c0.x, pad);
  ctx.lineTo(c0.x, plot.height - pad);
  ctx.moveTo(pad, c0.y);
  ctx.lineTo(plot.width - pad, c0.y);
  ctx.stroke();

  ctx.fillStyle = "#6a9";
  for (const f of frames) {
    const p = toCanvas(f.gx, f.gy);
    ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  }

  function updateHover(clientX, clientY) {
    const r = plot.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * plot.width;
    const sy = ((clientY - r.top) / r.height) * plot.height;
    const { gx, gy } = fromCanvas(sx, sy);
    let best = frames[0];
    let bestD = Infinity;
    for (const f of frames) {
      const d = (f.gx - gx) ** 2 + (f.gy - gy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    preview.src = new URL(best.path, base).href;
    label.textContent = `${best.path}  gx=${best.gx.toFixed(3)} gy=${best.gy.toFixed(3)}  clip=${best.clip ?? ""}`;
  }

  plot.addEventListener("mousemove", (e) => updateHover(e.clientX, e.clientY));
  plot.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    if (t) updateHover(t.clientX, t.clientY);
  });
  updateHover(
    plot.getBoundingClientRect().left + plot.width / 2,
    plot.getBoundingClientRect().top + plot.height / 2
  );
}

main().catch((e) => {
  label.textContent = String(e);
  console.error(e);
});
