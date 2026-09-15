export function normalizeTaiwanMobile(value) {
  const digits = String(value || "").replace(/\D+/g, "");

  if (digits.startsWith("886") && digits.length === 12) {
    return `0${digits.slice(3)}`;
  }

  return digits.slice(0, 10);
}
