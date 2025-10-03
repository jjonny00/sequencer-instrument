export function flagEnabled(key: string, fallback = false) {
  const qs = new URLSearchParams(window.location.search);
  if (qs.has(key)) return qs.get(key) !== "false";
  const ls = localStorage.getItem(`flag:${key}`);
  if (ls != null) return ls === "true";
  return fallback;
}
export function setFlag(key: string, value: boolean) {
  localStorage.setItem(`flag:${key}`, value ? "true" : "false");
}
