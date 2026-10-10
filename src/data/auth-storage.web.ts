// In a browser the login is kept in localStorage, so it doesn't need a second
// SQLite database next to the shop's.
export const authStorage = globalThis.localStorage;
