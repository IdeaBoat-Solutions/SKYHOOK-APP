export function formatDateDDMMYYYY(value: string | null | undefined): string {
  if (!value) return '-';
  const [y, m, d] = value.split('T')[0]!.split('-');
  return y && m && d ? `${d}/${m}/${y}` : value;
}
