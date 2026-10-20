import { folderName, normalize } from './format.ts';

/** Faixa como o app usa (vinda do MediaStore pelo módulo nativo). */
export type Track = {
  id: string;
  uri: string;
  title: string;
  fileName: string | null;
  artist: string | null;
  artistId: string;
  album: string | null;
  albumId: string;
  duration: number;
  path: string | null;
  folder: string | null;
  size: number;
  dateAdded: number;
  track: number;
  year: number;
  mime: string | null;
  isMusic: boolean;
  /** Capa escolhida pelo usuário (Editar informações). */
  cover?: string;
  /** Teve título/artista/álbum/capa editados no app. */
  edited?: boolean;
};

/** Edição feita no app, sem alterar o arquivo (como o "meta saving" do Lark). */
export type TrackEdit = { title?: string; artist?: string; album?: string; cover?: string };

/** Aplica as edições do usuário por cima dos dados do MediaStore. */
export function applyEdits(tracks: Track[], edits: Record<string, TrackEdit>): Track[] {
  if (Object.keys(edits).length === 0) return tracks;
  return tracks.map((t) => {
    const e = edits[t.id];
    if (!e) return t;
    return {
      ...t,
      title: e.title ?? t.title,
      artist: e.artist ?? t.artist,
      album: e.album ?? t.album,
      cover: e.cover ?? t.cover,
      edited: true,
    };
  });
}

export type Album = { id: string; name: string; artist: string | null; year: number; tracks: Track[]; cover: Track };
export type Artist = { id: string; name: string; tracks: Track[]; albums: number };
export type Folder = { path: string; name: string; tracks: Track[] };

export const UNKNOWN_ARTIST = 'Artista desconhecido';
export const UNKNOWN_ALBUM = 'Álbum desconhecido';
/** Artista de um álbum com faixas de vários artistas (traduzido na tela). */
export const VARIOUS_ARTISTS = 'Vários artistas';

export type SongSort = 'recent' | 'title' | 'artist' | 'album' | 'duration' | 'size';

export type LibraryFilter = { minDurationMs: number; hiddenFolders: string[]; hiddenTracks: string[] };

export function filterTracks(tracks: Track[], filter: LibraryFilter): Track[] {
  const folders = new Set(filter.hiddenFolders);
  const hidden = new Set(filter.hiddenTracks);
  return tracks.filter((t) => t.duration >= filter.minDurationMs && !hidden.has(t.id) && !(t.folder && folders.has(t.folder)));
}

const byTitle = (a: Track, b: Track) => a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' });

/** Ordena como o "Ordenar por" do Lark; `desc` inverte a ordem padrão de cada critério. */
export function sortTracks(tracks: Track[], sort: SongSort, desc = false): Track[] {
  const list = [...tracks];
  switch (sort) {
    case 'recent':
      list.sort((a, b) => b.dateAdded - a.dateAdded || byTitle(a, b));
      break;
    case 'artist':
      list.sort((a, b) => (a.artist ?? '￿').localeCompare(b.artist ?? '￿', 'pt-BR') || byTitle(a, b));
      break;
    case 'album':
      list.sort((a, b) => (a.album ?? '￿').localeCompare(b.album ?? '￿', 'pt-BR') || a.track - b.track);
      break;
    case 'duration':
      list.sort((a, b) => b.duration - a.duration || byTitle(a, b));
      break;
    case 'size':
      list.sort((a, b) => b.size - a.size || byTitle(a, b));
      break;
    default:
      list.sort(byTitle);
  }
  return desc ? list.reverse() : list;
}

/** Ordem natural de um álbum: número da faixa, depois título. */
export function albumOrder(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => (a.track || 999) - (b.track || 999) || byTitle(a, b));
}

export type LibraryIndex = {
  byId: Map<string, Track>;
  albums: Album[];
  albumById: Map<string, Album>;
  artists: Artist[];
  artistById: Map<string, Artist>;
  folders: Folder[];
  folderByPath: Map<string, Folder>;
  search: { track: Track; text: string }[];
};

export function buildIndex(tracks: Track[]): LibraryIndex {
  const byId = new Map<string, Track>();
  const albumMap = new Map<string, Track[]>();
  const artistMap = new Map<string, Track[]>();
  const folderMap = new Map<string, Track[]>();

  for (const t of tracks) {
    byId.set(t.id, t);
    push(albumMap, t.albumId, t);
    // Agrupa artistas pelo nome (o MediaStore às vezes cria IDs diferentes para o mesmo nome).
    push(artistMap, normalize(t.artist ?? UNKNOWN_ARTIST), t);
    if (t.folder) push(folderMap, t.folder, t);
  }

  const albums: Album[] = [...albumMap.entries()].map(([id, list]) => {
    const ordered = albumOrder(list);
    const artists = new Set(list.map((t) => t.artist ?? UNKNOWN_ARTIST));
    return {
      id,
      name: list[0].album ?? UNKNOWN_ALBUM,
      artist: artists.size === 1 ? [...artists][0] : VARIOUS_ARTISTS,
      year: Math.max(...list.map((t) => t.year || 0)),
      tracks: ordered,
      cover: ordered[0],
    };
  });
  albums.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));

  const artists: Artist[] = [...artistMap.entries()].map(([id, list]) => ({
    id,
    name: list[0].artist ?? UNKNOWN_ARTIST,
    tracks: [...list].sort(byTitle),
    albums: new Set(list.map((t) => t.albumId)).size,
  }));
  artists.sort((a, b) =>
    a.name === UNKNOWN_ARTIST ? 1 : b.name === UNKNOWN_ARTIST ? -1 : a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
  );

  const folders: Folder[] = [...folderMap.entries()].map(([path, list]) => ({
    path,
    name: folderName(path),
    tracks: [...list].sort(byTitle),
  }));
  folders.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));

  return {
    byId,
    albums,
    albumById: new Map(albums.map((a) => [a.id, a])),
    artists,
    artistById: new Map(artists.map((a) => [a.id, a])),
    folders,
    folderByPath: new Map(folders.map((f) => [f.path, f])),
    search: tracks.map((track) => ({
      track,
      text: normalize(`${track.title} ${track.artist ?? ''} ${track.album ?? ''} ${track.fileName ?? ''}`),
    })),
  };
}

/** Todas as palavras precisam aparecer; título que começa com a busca vem primeiro. */
export function searchTracks(index: LibraryIndex, query: string, limit = 200): Track[] {
  const q = normalize(query).trim();
  if (!q) return [];
  const words = q.split(/\s+/);
  const hits: { track: Track; score: number }[] = [];
  for (const entry of index.search) {
    if (!words.every((w) => entry.text.includes(w))) continue;
    const title = normalize(entry.track.title);
    const score = title === q ? 3 : title.startsWith(q) ? 2 : title.includes(q) ? 1 : 0;
    hits.push({ track: entry.track, score });
  }
  hits.sort((a, b) => b.score - a.score || byTitle(a.track, b.track));
  return hits.slice(0, limit).map((h) => h.track);
}

/** Embaralha (Fisher–Yates) mantendo `first` no começo, se informado. */
export function shuffled<T>(items: T[], first?: T, random: () => number = Math.random): T[] {
  const rest = first === undefined ? [...items] : items.filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first === undefined ? rest : [first, ...rest];
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Todas as palavras da busca aparecem no texto (sem acento, sem maiúsculas). */
export function matchesQuery(text: string, query: string): boolean {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const haystack = normalize(text);
  return words.every((w) => haystack.includes(w));
}

export type SearchGroups = { tracks: Track[]; artists: Artist[]; albums: Album[]; folders: Folder[] };

/** Busca da tela de busca, em seções como no Lark. */
export function searchGroups(index: LibraryIndex, query: string, limit = 5): SearchGroups {
  if (!normalize(query).trim()) return { tracks: [], artists: [], albums: [], folders: [] };
  return {
    tracks: searchTracks(index, query),
    artists: index.artists.filter((a) => matchesQuery(a.name, query)).slice(0, limit),
    albums: index.albums.filter((a) => matchesQuery(`${a.name} ${a.artist ?? ''}`, query)).slice(0, limit),
    folders: index.folders.filter((f) => matchesQuery(f.name, query)).slice(0, limit),
  };
}

export type SortSpec<K extends string> = { key: K; desc: boolean };
export type AlbumSort = 'name' | 'artist' | 'year' | 'count';
export type ArtistSort = 'name' | 'count';
export type FolderSort = 'name' | 'count';
export type VideoSort = 'recent' | 'name' | 'duration' | 'size';

type SortableVideo = { title: string; dateAdded: number; duration: number; size: number };

export function sortVideos<V extends SortableVideo>(videos: V[], sort: SortSpec<VideoSort>): V[] {
  const list = [...videos];
  if (sort.key === 'name') list.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' }));
  else if (sort.key === 'duration') list.sort((a, b) => b.duration - a.duration);
  else if (sort.key === 'size') list.sort((a, b) => b.size - a.size);
  else list.sort((a, b) => b.dateAdded - a.dateAdded);
  return sort.desc ? list.reverse() : list;
}

const byName = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
const maybeReverse = <T>(list: T[], desc: boolean) => (desc ? list.reverse() : list);

export function sortAlbums(albums: Album[], sort: SortSpec<AlbumSort>): Album[] {
  const list = [...albums];
  if (sort.key === 'artist') list.sort((a, b) => byName(a.artist ?? '￿', b.artist ?? '￿') || byName(a.name, b.name));
  else if (sort.key === 'year') list.sort((a, b) => b.year - a.year || byName(a.name, b.name));
  else if (sort.key === 'count') list.sort((a, b) => b.tracks.length - a.tracks.length || byName(a.name, b.name));
  else list.sort((a, b) => byName(a.name, b.name));
  return maybeReverse(list, sort.desc);
}

export function sortArtists(artists: Artist[], sort: SortSpec<ArtistSort>): Artist[] {
  const list = [...artists];
  if (sort.key === 'count') list.sort((a, b) => b.tracks.length - a.tracks.length || byName(a.name, b.name));
  else list.sort((a, b) => (a.name === UNKNOWN_ARTIST ? 1 : b.name === UNKNOWN_ARTIST ? -1 : byName(a.name, b.name)));
  return maybeReverse(list, sort.desc);
}

export function sortFolders(folders: Folder[], sort: SortSpec<FolderSort>): Folder[] {
  const list = [...folders];
  if (sort.key === 'count') list.sort((a, b) => b.tracks.length - a.tracks.length || byName(a.name, b.name));
  else list.sort((a, b) => byName(a.name, b.name));
  return maybeReverse(list, sort.desc);
}
