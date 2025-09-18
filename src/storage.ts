import type { Chunk } from "./chunks";
import type { PatternGroup, SongRow } from "./song";
import type { Track } from "./tracks";

const STORAGE_KEY = "sequencer_projects";

export interface StoredProjectData {
  packIndex: number;
  bpm: number;
  subdivision?: string;
  isPlaying: boolean;
  tracks: Track[];
  patternGroups: PatternGroup[];
  songRows: SongRow[];
  selectedGroupId: string | null;
  currentSectionIndex?: number;
}

export interface StoredProjectPayload {
  version: number;
  updatedAt: number;
  data: StoredProjectData;
}

type StoredProjectMap = Record<string, StoredProjectPayload>;

export const PROJECT_VERSION = 1;

const cloneChunk = (chunk: Chunk): Chunk => ({
  ...chunk,
  steps: chunk.steps.slice(),
  velocities: chunk.velocities ? chunk.velocities.slice() : undefined,
  pitches: chunk.pitches ? chunk.pitches.slice() : undefined,
  notes: chunk.notes ? chunk.notes.slice() : undefined,
  degrees: chunk.degrees ? chunk.degrees.slice() : undefined,
  noteEvents: chunk.noteEvents
    ? chunk.noteEvents.map((event) => ({ ...event }))
    : undefined,
});

const cloneTrack = (track: Track): Track => ({
  ...track,
  pattern: track.pattern ? cloneChunk(track.pattern) : null,
  source: track.source ? { ...track.source } : undefined,
});

const clonePatternGroup = (group: PatternGroup): PatternGroup => ({
  ...group,
  tracks: group.tracks.map((track) => cloneTrack(track)),
});

const cloneSongRow = (row: SongRow): SongRow => ({
  ...row,
  slots: row.slots.slice(),
});

export const cloneProjectData = (
  project: StoredProjectData
): StoredProjectData => ({
  ...project,
  tracks: project.tracks.map((track) => cloneTrack(track)),
  patternGroups: project.patternGroups.map((group) => clonePatternGroup(group)),
  songRows: project.songRows.map((row) => cloneSongRow(row)),
});

export const createStoredProjectPayload = (
  project: StoredProjectData,
  timestamp = Date.now()
): StoredProjectPayload => ({
  version: PROJECT_VERSION,
  updatedAt: timestamp,
  data: cloneProjectData(project),
});

const getStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch (error) {
    console.warn("Local storage unavailable", error);
    return null;
  }
};

const readAllProjects = (): StoredProjectMap => {
  const storage = getStorage();
  if (!storage) return {};
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as StoredProjectMap;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch (error) {
    console.warn("Failed to parse stored projects", error);
    return {};
  }
};

const writeAllProjects = (projects: StoredProjectMap) => {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch (error) {
    console.warn("Failed to persist projects", error);
  }
};

export const listProjects = (): string[] => {
  const projects = readAllProjects();
  return Object.keys(projects).sort((a, b) => a.localeCompare(b));
};

export const saveProject = (
  name: string,
  project?: StoredProjectData
): void => {
  if (!name) return;
  if (!project) {
    console.warn("No project data provided to save");
    return;
  }
  const trimmedName = name.trim();
  if (!trimmedName) return;
  const projects = readAllProjects();
  projects[trimmedName] = createStoredProjectPayload(project);
  writeAllProjects(projects);
};

export const loadProject = (name: string): StoredProjectData | null => {
  if (!name) return null;
  const trimmedName = name.trim();
  if (!trimmedName) return null;
  const projects = readAllProjects();
  const payload = projects[trimmedName];
  if (!payload) return null;
  if (payload.version !== PROJECT_VERSION) {
    // Future compatibility: for now, return the stored data as-is
    return cloneProjectData(payload.data);
  }
  return cloneProjectData(payload.data);
};

export const deleteProject = (name: string): void => {
  if (!name) return;
  const trimmedName = name.trim();
  if (!trimmedName) return;
  const projects = readAllProjects();
  if (projects[trimmedName]) {
    delete projects[trimmedName];
    writeAllProjects(projects);
  }
};
