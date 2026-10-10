// Where the login is kept between app launches: on the phone, in SQLite's
// key-value store.
import Storage from 'expo-sqlite/kv-store';

export const authStorage = Storage;
