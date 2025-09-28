import type { Chunk } from "./chunks";
import type {
  PatternGroup,
  PerformanceTrack,
  PerformanceNote,
  SongRow,
} from "./song";
import type { Track } from "./tracks";

const STORAGE_KEY = "sequencer_projects";
const LOOP_DRAFT_STORAGE_KEY = "sequencer_loop_drafts";

export interface StoredProjectData {
  packIndex: number;
  bpm: number;
  subdivision?: string;
  isPlaying: boolean;
  tracks: Track[];
  patternGroups: PatternGroup[];
  songRows: SongRow[];
  performanceTracks?: PerformanceTrack[];
  selectedGroupId: string | null;
  currentSectionIndex?: number;
}

export interface StoredLoopDraftData {
  tracks: Track[];
  patternGroups: PatternGroup[];
}

export interface StoredProjectPayload {
  version: number;
  updatedAt: number;
  data: StoredProjectData;
}

type StoredProjectMap = Record<string, StoredProjectPayload>;
type StoredLoopDraftMap = Record<
  string,
  {
    updatedAt: number;
    data: StoredLoopDraftData;
  }
>;

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
  harmoniaStepDegrees: chunk.harmoniaStepDegrees
    ? chunk.harmoniaStepDegrees.slice()
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

const clonePerformanceNote = (note: PerformanceNote): PerformanceNote => ({
  ...note,
});

const clonePerformanceTrack = (
  track: PerformanceTrack
): PerformanceTrack => ({
  ...track,
  notes: Array.isArray(track.notes)
    ? track.notes.map((note) => clonePerformanceNote(note))
    : [],
});

const cloneProjectData = (project: StoredProjectData): StoredProjectData => ({
  ...project,
  tracks: project.tracks.map((track) => cloneTrack(track)),
  patternGroups: project.patternGroups.map((group) => clonePatternGroup(group)),
  songRows: project.songRows.map((row) => cloneSongRow(row)),
  performanceTracks: Array.isArray(project.performanceTracks)
    ? project.performanceTracks.map((track) => clonePerformanceTrack(track))
    : [],
});

export const cloneStoredProjectData = (
  project: StoredProjectData
): StoredProjectData => cloneProjectData(project);

const cloneLoopDraftData = (draft: StoredLoopDraftData): StoredLoopDraftData => ({
  tracks: draft.tracks.map((track) => cloneTrack(track)),
  patternGroups: draft.patternGroups.map((group) => clonePatternGroup(group)),
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

const readAllLoopDrafts = (): StoredLoopDraftMap => {
  const storage = getStorage();
  if (!storage) return {};
  const raw = storage.getItem(LOOP_DRAFT_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as StoredLoopDraftMap;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch (error) {
    console.warn("Failed to parse loop drafts", error);
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

const writeAllLoopDrafts = (drafts: StoredLoopDraftMap) => {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(LOOP_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch (error) {
    console.warn("Failed to persist loop drafts", error);
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

export const saveLoopDraft = (name: string, draft: StoredLoopDraftData): void => {
  if (!name) return;
  const trimmedName = name.trim();
  if (!trimmedName) return;
  const drafts = readAllLoopDrafts();
  drafts[trimmedName] = {
    updatedAt: Date.now(),
    data: cloneLoopDraftData(draft),
  };
  writeAllLoopDrafts(drafts);
};

export const loadLoopDraft = (name: string): StoredLoopDraftData | null => {
  if (!name) return null;
  const trimmedName = name.trim();
  if (!trimmedName) return null;
  const drafts = readAllLoopDrafts();
  const payload = drafts[trimmedName];
  if (!payload) return null;
  return cloneLoopDraftData(payload.data);
};

export const deleteLoopDraft = (name: string): void => {
  if (!name) return;
  const trimmedName = name.trim();
  if (!trimmedName) return;
  const drafts = readAllLoopDrafts();
  if (!drafts[trimmedName]) return;
  delete drafts[trimmedName];
  writeAllLoopDrafts(drafts);
};

export const createStoredProjectPayload = (
  project: StoredProjectData
): StoredProjectPayload => ({
  version: PROJECT_VERSION,
  updatedAt: Date.now(),
  data: cloneProjectData(project),
});

export const deserializeStoredProjectPayload = (
  payload: StoredProjectPayload
): StoredProjectData => cloneProjectData(payload.data);
