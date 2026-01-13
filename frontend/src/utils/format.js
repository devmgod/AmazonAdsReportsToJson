export function fmt(num, digits = 2) {
  const n = Number(num);
  return Number.isFinite(n) ? n.toFixed(digits) : "0.00";
}

