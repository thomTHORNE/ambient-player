/**
 * Storage module for localStorage operations
 */

export interface PersistedPlaylist {
  name: string;
  urls: string[];
  /**
   * The links of the channels marked for Resume (the ones last played).
   * Missing in mixes saved before Resume existed.
   */
  resume?: string[];
}

export interface StoredData {
  playlists: PersistedPlaylist[];
  lastPlaylistName?: string;
}

const STORAGE_KEY = 'yt_audio_playlists';

/**
 * Load stored data from localStorage
 */
export function loadStoredData(): StoredData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { playlists: [] };
  try {
    return JSON.parse(raw) as StoredData;
  } catch {
    return { playlists: [] };
  }
}

/**
 * Save stored data to localStorage
 */
export function saveStoredData(data: StoredData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * Save or update a playlist
 */
export function saveOrUpdatePlaylist(name: string, urls: string[], resume: string[] = []): void {
  const data = loadStoredData();
  const existing = data.playlists.find(p => p.name === name);
  if (existing) {
    existing.urls = urls;
    existing.resume = resume;
  } else {
    data.playlists.push({ name, urls, resume });
  }
  data.lastPlaylistName = name;
  saveStoredData(data);
}

/**
 * Remember which channels of a saved mix Resume plays. Only updates a mix
 * that is saved on this device; false when there is none by that name.
 */
export function saveMixResume(name: string, resume: string[]): boolean {
  const data = loadStoredData();
  const existing = data.playlists.find(p => p.name === name);
  if (!existing) return false;
  existing.resume = resume;
  saveStoredData(data);
  return true;
}

/**
 * Delete a playlist by name
 */
export function deletePlaylist(name: string): void {
  const data = loadStoredData();
  data.playlists = data.playlists.filter(p => p.name !== name);
  if (data.lastPlaylistName === name) {
    delete data.lastPlaylistName;
  }
  saveStoredData(data);
}

/**
 * Get the last used playlist
 */
export function getLastPlaylist(): PersistedPlaylist | undefined {
  const data = loadStoredData();
  if (!data.lastPlaylistName) return;
  return data.playlists.find(p => p.name === data.lastPlaylistName);
}

/**
 * Get all saved playlists
 */
export function getAllPlaylists(): PersistedPlaylist[] {
  return loadStoredData().playlists;
}

