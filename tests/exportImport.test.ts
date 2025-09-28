import { test } from "node:test";
import assert from "node:assert/strict";

import type { Chunk } from "../src/chunks";
import type { PerformanceTrack } from "../src/song";
import type { StoredProjectData, StoredProjectPayload } from "../src/storage";
import { createStoredProjectPayload, deserializeStoredProjectPayload } from "../src/storage";

const createSampleProject = (): StoredProjectData => {
  const chunk: Chunk = {
    id: "chunk-1",
    name: "Bass Loop",
    instrument: "bass",
    steps: [1, 0, 0, 0, 1, 0, 0, 0],
    velocities: [1, 0, 0, 0, 0.9, 0, 0, 0],
  };

  const performanceTracks: PerformanceTrack[] = [
    {
      id: "perf-1",
      instrument: "keyboard",
      channel: 1,
      muted: false,
      solo: false,
      notes: [
        { time: "0:0:0", note: "C4", duration: "4n", velocity: 0.8 },
        { time: "0:2:0", note: "E4", duration: "8n", velocity: 0.7 },
      ],
    },
  ];

  return {
    packIndex: 0,
    bpm: 120,
    subdivision: "16n",
    isPlaying: false,
    tracks: [
      {
        id: 1,
        name: "Bass",
        instrument: "bass",
        muted: false,
        pattern: chunk,
        source: {
          packId: "demo-pack",
          instrumentId: "bass",
          characterId: "default",
        },
      },
    ],
    patternGroups: [
      {
        id: "pg-1",
        name: "Group 1",
        tracks: [
          {
            id: 1,
            name: "Bass",
            instrument: "bass",
            muted: false,
            pattern: chunk,
            source: {
              packId: "demo-pack",
              instrumentId: "bass",
              characterId: "default",
            },
          },
        ],
      },
    ],
    songRows: [
      {
        slots: ["pg-1"],
        muted: false,
        velocity: 1,
      },
    ],
    performanceTracks,
    selectedGroupId: "pg-1",
    currentSectionIndex: 0,
  };
};

test("project export/import preserves loops and performance tracks", () => {
  const project = createSampleProject();
  const payload = createStoredProjectPayload(project);

  assert.equal(payload.data.performanceTracks?.length, 1);
  assert.notStrictEqual(
    payload.data.performanceTracks,
    project.performanceTracks,
    "performance track array should be cloned"
  );
  assert.notStrictEqual(
    payload.data.performanceTracks?.[0].notes,
    project.performanceTracks[0].notes,
    "performance notes should be cloned"
  );

  const serialized = JSON.stringify(payload);
  const parsed = JSON.parse(serialized) as StoredProjectPayload;
  const restored = deserializeStoredProjectPayload(parsed);

  assert.deepEqual(restored.performanceTracks, project.performanceTracks);
  assert.equal(restored.patternGroups.length, project.patternGroups.length);
  assert.deepEqual(restored.patternGroups[0].tracks.length, project.patternGroups[0].tracks.length);
  assert.deepEqual(restored.patternGroups[0].tracks[0].pattern?.steps, project.patternGroups[0].tracks[0].pattern?.steps);
  assert.deepEqual(restored.songRows, project.songRows);
  assert.deepEqual(restored.tracks.map((track) => track.pattern?.steps), project.tracks.map((track) => track.pattern?.steps));
});
