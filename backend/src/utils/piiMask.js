// PII masking helpers for Aadhaar/PAN (DB-008).
// Mask by default; reveal only to authorised roles.

export const maskAadhaar = (value) => {
  if (!value) return value;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return 'XXXX-XXXX-' + digits.slice(-4);
};

export const maskPan = (value) => {
  if (!value) return value;
  const v = String(value).trim();
  if (v.length <= 4) return '****';
  return v.slice(0, 2) + '****' + v.slice(-2);
};

export const canRevealPii = (role) => {
  const r = String(role || '').toLowerCase();
  return r === 'super_admin' || r === 'admin' || r === 'accounts' || r === 'hr';
};
