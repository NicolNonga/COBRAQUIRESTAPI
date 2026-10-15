/** Mascara dados pessoais para logs (Lei 22/11, art. 8.º: minimização). */
export const maskEmail = (v: string | null | undefined): string => {
  if (!v) return '—';
  const [user, domain] = v.split('@');
  return domain ? `${user.slice(0, 1)}***@${domain}` : '***';
};

export const maskPhone = (v: string | null | undefined): string => {
  if (!v) return '—';
  const d = v.replace(/\s+/g, '');
  return d.length <= 4 ? '***' : `${d.slice(0, 4)}***${d.slice(-2)}`;
};
