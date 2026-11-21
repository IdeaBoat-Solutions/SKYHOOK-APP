/** Shared phone helpers for the call / WhatsApp actions used across directories. */

/**
 * Return the dialable E.164 digits for a phone number entered in any common
 * Indian format (+91..., 91..., 0..., spaces/dashes). Numbers with another
 * country code are kept as typed (digits only).
 */
export function phoneDigits(raw: string): string {
  let digits = String(raw ?? '').replace(/\D/g, '');
  // Indian numbers are often written with a trunk prefix 0 or a leading 91.
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits;
}

/** WhatsApp deep link — opens a chat with the number when WhatsApp is installed. */
export function whatsappLink(raw: string): string {
  const digits = phoneDigits(raw);
  return digits ? `https://wa.me/${digits}` : '';
}

/** Native phone dialer link. */
export function callLink(raw: string): string {
  const digits = phoneDigits(raw);
  return digits ? `tel:+${digits}` : '';
}

/** Contact actions for a number — used by both registered operators and contractors. */
export function contactActions(mobile: string) {
  return {
    call: callLink(mobile),
    whatsapp: whatsappLink(mobile),
    enabled: Boolean(phoneDigits(mobile)),
  };
}
