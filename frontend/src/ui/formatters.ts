export function formatMaterials(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`;
  if (value >= 1000) return `${value >= 100_000 ? Math.round(value / 1000) : Math.round(value / 100) / 10}k`;
  return String(Math.floor(value));
}
