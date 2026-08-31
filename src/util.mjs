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
// always occupy `col` characters, so every row gets a fixed-width label+leader
// field and -- in the monospace face the card sets -- every leader run ends at
// the same x, which is what makes the dots read as one column.
//
// It does NOT align the value column, though an earlier version of this
// comment said so: card.mjs draws each value as its own <text> with
// text-anchor="end" against the panel's inner edge, so values line up because
// they are right-anchored there, entirely independently of these dots. The gap
// between a row's leader and its value therefore varies by row. That is
// deliberate and looks correct on the card; only the stated reason was wrong.
export function kv(label, value, col = 13) {
  const dots = ".".repeat(Math.max(2, col - label.length));
  return { label: escapeXml(label), dots, value: escapeXml(value) };
}

export function formatInt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
