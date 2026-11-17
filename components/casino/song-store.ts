// A member's own jukebox songs live in this browser's IndexedDB, never on our
// servers: the files are theirs, and nothing else needs to see them. Every
// call fails soft, so a private window still plays songs for the visit.

export type StoredSong = { id: string; name: string; blob: Blob; added: number };

const DB = "cncp-casino";
const STORE = "songs";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listSongs(): Promise<StoredSong[]> {
  try {
    const db = await open();
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    const rows = await new Promise<StoredSong[]>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as StoredSong[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows.sort((a, b) => a.added - b.added);
  } catch {
    return [];
  }
}

export async function saveSong(song: StoredSong): Promise<boolean> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(song);
    await done(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function deleteSong(id: string): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await done(tx);
    db.close();
  } catch {}
}
