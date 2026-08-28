export function smoothstep(edge0, edge1, v) {
  const t = Math.max(0, Math.min(1, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Dotted-leader row: `Name.........Md Amimul Ehshan`. The label plus its dots
// always occupy `col` characters so every row's value column lines up.
export function kv(label, value, col = 13) {
  const dots = ".".repeat(Math.max(2, col - label.length));
  return { label: escapeXml(label), dots, value: escapeXml(value) };
}

export function formatInt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
