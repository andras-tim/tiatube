export const concat = (parts) => {
  let n = 0;
  for (const c of parts) n += c.length;
  const u = new Uint8Array(n);
  let o = 0;
  for (const c of parts) {
    u.set(c, o);
    o += c.length;
  }
  return u;
};
