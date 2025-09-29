import { describe, expect, it } from "vitest";

import chiptunePack from "./packs/chiptune.json";
import type { Chunk } from "./chunks";
import type { StoredProjectData } from "./storage";
import type { PatternGroup, PerformanceTrack, SongRow } from "./song";
import type { Track } from "./tracks";
import { createStoredProjectPayload } from "./storage";

describe("renderProjectAudioBuffer", () => {
  it("renders loop and performance tracks together", async () => {
    const kickPattern: Chunk = {
      id: "kick-pattern",
      name: "Kick Pattern",
      instrument: "kick",
      steps: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      velocities: [1, 0, 0, 0, 0.9, 0, 0, 0, 0.85, 0, 0, 0, 0.9, 0, 0, 0],
      note: "C2",
      sustain: 0.5,
      timingMode: "sync",
    };

    const kickCharacterId =
      chiptunePack.instruments.kick.defaultCharacterId ??
      chiptunePack.instruments.kick.characters[0]?.id ??
      "chip_square_thump";

    const kickTrack: Track = {
      id: 1,
      name: "Kick",
      instrument: "kick",
      pattern: kickPattern,
      muted: false,
      source: {
        packId: chiptunePack.id,
        instrumentId: "kick",
        characterId: kickCharacterId,
      },
    };

    const patternGroup: PatternGroup = {
      id: "pg-test",
      name: "Test Group",
      tracks: [kickTrack],
    };

    const performanceTrack: PerformanceTrack = {
      id: "perf-test",
      instrument: "keyboard",
      color: "#ffffff",
      notes: [
        { time: "0:0:0", note: "C4", duration: "4n", velocity: 1 },
        { time: "0:2:0", note: "E4", duration: "4n", velocity: 0.9 },
      ],
    };

    const loopRow: SongRow = {
      slots: [patternGroup.id],
      muted: false,
      velocity: 1,
      solo: false,
      performanceTrackId: null,
    };

    const performanceRow: SongRow = {
      slots: [null],
      muted: false,
      velocity: 1,
      solo: false,
      performanceTrackId: performanceTrack.id,
    };

    const project: StoredProjectData = {
      packIndex: 0,
      bpm: 120,
      subdivision: "16n",
      isPlaying: false,
      tracks: [kickTrack],
      patternGroups: [patternGroup],
      songRows: [loopRow, performanceRow],
      performanceTracks: [performanceTrack],
      selectedGroupId: patternGroup.id,
      currentSectionIndex: 0,
    };

    const { resolvePlaybackSchedules } = await import("./exporter");

    const { schedules, duration } = resolvePlaybackSchedules(project, "song");

    const patternSchedule = schedules.find(
      (schedule) => schedule.kind === "pattern"
    );
    const performanceSchedule = schedules.find(
      (schedule) => schedule.kind === "performance"
    );

    expect(patternSchedule).toBeDefined();
    expect(performanceSchedule).toBeDefined();
    expect(duration).toBeGreaterThan(1);

    const performanceEvents =
      performanceSchedule?.kind === "performance"
        ? performanceSchedule.events
        : [];
    expect(performanceEvents.length).toBeGreaterThan(0);
    const notes = performanceEvents.map((event) => event.note);
    expect(notes).toContain("C4");
    expect(notes).toContain("E4");
  });
});

describe("createStoredProjectPayload", () => {
  it("serializes performance tracks with their notes", () => {
    const performanceTrack: PerformanceTrack = {
      id: "perf-json",
      instrument: "keyboard",
      color: "#123456",
      notes: [
        { time: "0:0:0", note: "C4", duration: "8n", velocity: 0.8 },
        { time: "1:0:0", note: "G4", duration: "4n", velocity: 1 },
      ],
    };

    const loopRow: SongRow = {
      slots: [null],
      muted: false,
      velocity: 1,
      solo: false,
      performanceTrackId: null,
    };

    const performanceRow: SongRow = {
      slots: [null],
      muted: false,
      velocity: 1,
      solo: false,
      performanceTrackId: performanceTrack.id,
    };

    const project: StoredProjectData = {
      packIndex: 0,
      bpm: 120,
      subdivision: "16n",
      isPlaying: false,
      tracks: [],
      patternGroups: [],
      songRows: [loopRow, performanceRow],
      performanceTracks: [performanceTrack],
      selectedGroupId: null,
      currentSectionIndex: 0,
    };

    const payload = createStoredProjectPayload(project);

    expect(payload.data.performanceTracks).toHaveLength(1);
    expect(payload.data.performanceTracks[0]).toEqual(performanceTrack);
    expect(payload.data.performanceTracks[0]).not.toBe(performanceTrack);
    expect(payload.data.performanceTracks[0].notes).not.toBe(
      performanceTrack.notes
    );
    expect(payload.data.songRows[1]?.performanceTrackId).toBe(
      performanceTrack.id
    );
  });
});

describe("resolvePlaybackSchedules", () => {
  it("includes performance tracks even when no loop slots are active", async () => {
    const performanceTrack: PerformanceTrack = {
      id: "perf-only",
      instrument: "keyboard",
      color: "#abcdef",
      notes: [
        { time: "0:0:0", note: "C4", duration: "4n", velocity: 1 },
        { time: "2:0:0", note: "E4", duration: "4n", velocity: 0.7 },
      ],
    };

    const performanceRow: SongRow = {
      slots: [null, null, null],
      muted: false,
      velocity: 1,
      solo: false,
      performanceTrackId: performanceTrack.id,
    };

    const project: StoredProjectData = {
      packIndex: 0,
      bpm: 100,
      subdivision: "16n",
      isPlaying: false,
      tracks: [],
      patternGroups: [],
      songRows: [performanceRow],
      performanceTracks: [performanceTrack],
      selectedGroupId: null,
      currentSectionIndex: 0,
    };

    const { resolvePlaybackSchedules } = await import("./exporter");

    const { schedules, duration } = resolvePlaybackSchedules(project, "song");

    expect(duration).toBeGreaterThan(0);
    expect(schedules.some((schedule) => schedule.kind === "performance")).toBe(
      true
    );
    expect(
      schedules.filter((schedule) => schedule.kind === "pattern").length
    ).toBe(0);
  });
});
