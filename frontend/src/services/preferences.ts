export const stored = (key: string, fallback = "") => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};
export const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* App stays usable when storage is disabled. */
  }
};
