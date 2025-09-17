import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";

import { LoopStrip, type LoopStripHandle } from "./LoopStrip";
import type { Track, TriggerMap } from "./tracks";
import type { Chunk } from "./chunks";
import { packs } from "./packs";
import { Arpeggiator } from "./Arpeggiator";
import { Keyboard } from "./Keyboard";
import { SongView } from "./SongView";
import { PatternPlaybackManager } from "./PatternPlaybackManager";
import { filterValueToFrequency } from "./utils/audio";
import type { PatternGroup, SongRow } from "./song";
import { createPatternGroupId, createSongRow } from "./song";
import { AddTrackModal } from "./AddTrackModal";
import { getCharacterOptions } from "./addTrackOptions";

const createInitialPatternGroup = (): PatternGroup => ({
  id: createPatternGroupId(),
  name: "sequence01",
  tracks: [],
});

type Subdivision = "16n" | "8n" | "4n";

interface AddTrackModalState {
  isOpen: boolean;
  mode: "add" | "edit";
  targetTrackId: number | null;
  packId: string;
  instrumentId: string;
  characterId: string;
  presetId: string | null;
}

const createDefaultAddTrackState = (
  packIdx: number
): AddTrackModalState => {
  const pack = packs[packIdx];
  if (!pack) {
    return {
      isOpen: false,
      mode: "add",
      targetTrackId: null,
      packId: "",
      instrumentId: "",
      characterId: "",
      presetId: null,
    };
  }
  const instrumentId = Object.keys(pack.instruments)[0] ?? "";
  const characters = instrumentId
    ? getCharacterOptions(pack.id, instrumentId)
    : [];
  const characterId = characters[0]?.id ?? "";
  const preset = pack.chunks.find((chunk) => chunk.instrument === instrumentId);
  return {
    isOpen: false,
    mode: "add",
    targetTrackId: null,
    packId: pack.id,
    instrumentId,
    characterId,
    presetId: preset ? preset.id : null,
  };
};

export default function App() {
  const [started, setStarted] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [subdiv, setSubdiv] = useState<Subdivision>("16n");
  const [isPlaying, setIsPlaying] = useState(false);
  const [packIndex, setPackIndex] = useState(0);

  // Instruments (kept across renders)
  type ToneInstrument = Tone.ToneAudioNode & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    triggerAttackRelease: (...args: any[]) => any;
  };
  const instrumentRefs = useRef<Record<string, ToneInstrument>>({});
  const noteRef = useRef<Tone.PolySynth<Tone.Synth> | null>(null);
  const keyboardFxRef = useRef<{
    reverb: Tone.Reverb;
    delay: Tone.FeedbackDelay;
    distortion: Tone.Distortion;
    bitCrusher: Tone.BitCrusher;
    panner: Tone.Panner;
    chorus: Tone.Chorus;
    tremolo: Tone.Tremolo;
    filter: Tone.Filter;
  } | null>(null);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [triggers, setTriggers] = useState<TriggerMap>({});
  const [tab, setTab] = useState<"mushy" | "keyboard">("mushy");
  const [viewMode, setViewMode] = useState<"track" | "song">("track");
  const [patternGroups, setPatternGroups] = useState<PatternGroup[]>(() => [
    createInitialPatternGroup(),
  ]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [songRows, setSongRows] = useState<SongRow[]>([
    createSongRow(),
  ]);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const loopStripRef = useRef<LoopStripHandle | null>(null);
  const [pendingLoopStripAction, setPendingLoopStripAction] = useState<
    "openLibrary" | "addTrack" | null
  >(null);
  const [addTrackModalState, setAddTrackModalState] = useState<AddTrackModalState>(
    () => createDefaultAddTrackState(packIndex)
  );

  const openAddTrackModal = useCallback(() => {
    setAddTrackModalState(() => {
      const pack = packs[packIndex];
      if (!pack) {
        return {
          isOpen: true,
          mode: "add",
          targetTrackId: null,
          packId: "",
          instrumentId: "",
          characterId: "",
          presetId: null,
        };
      }
      const instrumentId = Object.keys(pack.instruments)[0] ?? "";
      const characters = instrumentId
        ? getCharacterOptions(pack.id, instrumentId)
        : [];
      const characterId = characters[0]?.id ?? "";
      const preset = pack.chunks.find(
        (chunk) => chunk.instrument === instrumentId
      );
      return {
        isOpen: true,
        mode: "add",
        targetTrackId: null,
        packId: pack.id,
        instrumentId,
        characterId,
        presetId: preset ? preset.id : null,
      };
    });
  }, [packIndex]);

  const closeAddTrackModal = useCallback(() => {
    setAddTrackModalState((state) => ({ ...state, isOpen: false }));
  }, []);

  const handleSelectAddTrackPack = useCallback(
    (packId: string) => {
      const index = packs.findIndex((p) => p.id === packId);
      if (index >= 0 && index !== packIndex) {
        setPackIndex(index);
      }
      setAddTrackModalState((state) => ({ ...state, packId }));
    },
    [packIndex, setPackIndex]
  );

  const handleSelectAddTrackInstrument = useCallback((instrumentId: string) => {
    setAddTrackModalState((state) => ({ ...state, instrumentId }));
  }, []);

  const handleSelectAddTrackCharacter = useCallback((characterId: string) => {
    setAddTrackModalState((state) => ({ ...state, characterId }));
  }, []);

  const handleSelectAddTrackPreset = useCallback((presetId: string | null) => {
    setAddTrackModalState((state) => ({ ...state, presetId }));
  }, []);

  const handleRequestTrackModal = useCallback(
    (track: Track) => {
      const pack = packs[packIndex];
      if (!pack) return;
      const instrumentOptions = Object.keys(pack.instruments);
      let instrumentId =
        track.source?.instrumentId ?? (track.instrument ? track.instrument : "");
      if (!instrumentOptions.includes(instrumentId) && instrumentOptions.length > 0) {
        instrumentId = instrumentOptions[0];
      }
      if (!instrumentId && instrumentOptions.length > 0) {
        instrumentId = instrumentOptions[0];
      }
      const characters = instrumentId
        ? getCharacterOptions(pack.id, instrumentId)
        : [];
      let characterId = track.source?.characterId ?? (characters[0]?.id ?? "");
      if (
        characters.length > 0 &&
        !characters.some((character) => character.id === characterId)
      ) {
        characterId = characters[0].id;
      }
      const presetOptions = pack.chunks.filter(
        (chunk) => chunk.instrument === instrumentId
      );
      let presetId = track.source?.presetId ?? null;
      if (presetId && !presetOptions.some((preset) => preset.id === presetId)) {
        presetId = presetOptions[0]?.id ?? null;
      }
      setAddTrackModalState({
        isOpen: true,
        mode: "edit",
        targetTrackId: track.id,
        packId: pack.id,
        instrumentId,
        characterId,
        presetId,
      });
    },
    [packIndex]
  );

  useEffect(() => {
    if (!addTrackModalState.isOpen) return;
    const pack = packs.find((p) => p.id === addTrackModalState.packId);
    if (!pack) return;
    const instrumentOptions = Object.keys(pack.instruments);
    if (instrumentOptions.length === 0) {
      if (
        addTrackModalState.instrumentId !== "" ||
        addTrackModalState.characterId !== "" ||
        addTrackModalState.presetId !== null
      ) {
        setAddTrackModalState((state) => ({
          ...state,
          instrumentId: "",
          characterId: "",
          presetId: null,
        }));
      }
      return;
    }
    if (!instrumentOptions.includes(addTrackModalState.instrumentId)) {
      const nextInstrument = instrumentOptions[0];
      const characters = getCharacterOptions(pack.id, nextInstrument);
      const nextCharacter = characters[0]?.id ?? "";
      const presetOptions = pack.chunks.filter(
        (chunk) => chunk.instrument === nextInstrument
      );
      setAddTrackModalState((state) => ({
        ...state,
        instrumentId: nextInstrument,
        characterId: nextCharacter,
        presetId: presetOptions[0]?.id ?? null,
      }));
      return;
    }
    const characters = getCharacterOptions(
      pack.id,
      addTrackModalState.instrumentId
    );
    if (
      characters.length > 0 &&
      !characters.some(
        (character) => character.id === addTrackModalState.characterId
      )
    ) {
      setAddTrackModalState((state) => ({
        ...state,
        characterId: characters[0].id,
      }));
      return;
    }
    const presetOptions = pack.chunks.filter(
      (chunk) => chunk.instrument === addTrackModalState.instrumentId
    );
    if (
      addTrackModalState.presetId &&
      !presetOptions.some((preset) => preset.id === addTrackModalState.presetId)
    ) {
      setAddTrackModalState((state) => ({
        ...state,
        presetId: presetOptions[0]?.id ?? null,
      }));
    }
  }, [addTrackModalState]);

  useEffect(() => {
    if (started) Tone.Transport.bpm.value = bpm;
  }, [bpm, started]);

  useEffect(() => {
    const pack = packs[packIndex];
    setTracks((prev) => {
      const allowed = new Set([
        ...Object.keys(pack.instruments),
        "chord",
        "arpeggiator",
      ]);
      const filtered = prev.filter((track) => {
        if (!track.instrument) return true;
        return allowed.has(track.instrument);
      });
      return filtered.length === prev.length ? prev : filtered;
    });
    setEditing(null);
    const initialGroup = createInitialPatternGroup();
    setPatternGroups([initialGroup]);
    setSongRows([createSongRow()]);
    setCurrentSectionIndex(0);
    if (!started) return;
    Object.values(instrumentRefs.current).forEach((inst) => inst.dispose?.());
    instrumentRefs.current = {};
    const newTriggers: TriggerMap = {};
    Object.entries(pack.instruments).forEach(([name, spec]) => {
      if (name === "chord") return;
      const Ctor = (
        Tone as unknown as Record<
          string,
          new (opts?: Record<string, unknown>) => ToneInstrument
        >
      )[spec.type];
      const inst = new Ctor(spec.options ?? {});
      let node: Tone.ToneAudioNode = inst;
      (spec.effects ?? []).forEach((e) => {
        const EffectCtor = (
          Tone as unknown as Record<
            string,
            new (opts?: Record<string, unknown>) => Tone.ToneAudioNode
          >
        )[e.type];
        const eff = new EffectCtor(e.options ?? {});
        node.connect(eff);
        node = eff;
      });
      node.toDestination();
      instrumentRefs.current[name] = inst;
      newTriggers[name] = (
        time: number,
        velocity = 1,
        pitch = 0,
        _noteArg?: string,
        _sustainArg?: number,
        _chunk?: Chunk
      ) => {
        void _noteArg;
        void _sustainArg;
        void _chunk;
        if (inst instanceof Tone.NoiseSynth) {
          inst.triggerAttackRelease(spec.note ?? "8n", time, velocity);
        } else {
          const base = spec.note ?? "C2";
          const n = Tone.Frequency(base).transpose(pitch).toNote();
          inst.triggerAttackRelease(n, "8n", time, velocity);
        }
      };
    });
    newTriggers["chord"] = (
      time: number,
      velocity = 1,
      pitch = 0,
      note = "C4",
      sustain = 0.1,
      chunk?: Chunk
    ) => {
      if (chunk) {
        if (chunk.attack !== undefined) {
          noteRef.current?.set({ envelope: { attack: chunk.attack } });
        }
        if (chunk.sustain !== undefined) {
          noteRef.current?.set({ envelope: { release: chunk.sustain } });
        }
        if (chunk.glide !== undefined) {
          noteRef.current?.set({ portamento: chunk.glide });
        }

        const fx = keyboardFxRef.current;
        if (fx) {
          if (chunk.pan !== undefined) {
            fx.panner.pan.rampTo(chunk.pan, 0.1);
          }
          if (chunk.reverb !== undefined) {
            fx.reverb.wet.value = chunk.reverb;
            fx.delay.wet.value = chunk.delay ?? chunk.reverb;
          }
          if (chunk.delay !== undefined) {
            fx.delay.wet.value = chunk.delay;
          }
          if (chunk.distortion !== undefined) {
            fx.distortion.distortion = chunk.distortion;
          }
          if (chunk.bitcrusher !== undefined) {
            fx.bitCrusher.wet.value = chunk.bitcrusher;
          }
          if (chunk.chorus !== undefined) {
            fx.chorus.wet.value = chunk.chorus;
          }
          if (chunk.filter !== undefined) {
            const frequency = filterValueToFrequency(chunk.filter);
            fx.filter.frequency.rampTo(frequency, 0.1);
          }
        }
      }
      const n = Tone.Frequency(note).transpose(pitch).toNote();
      noteRef.current?.triggerAttackRelease(n, sustain, time, velocity);
    };
    instrumentRefs.current["chord"] = noteRef.current! as ToneInstrument;
    instrumentRefs.current["arpeggiator"] = noteRef.current! as ToneInstrument;
    newTriggers["arpeggiator"] = newTriggers["chord"];
    setTriggers(newTriggers);
  }, [packIndex, started]);

  useEffect(() => {
    if (patternGroups.length === 0) {
      setSelectedGroupId(null);
      return;
    }
    setSelectedGroupId((prev) => {
      if (prev && patternGroups.some((group) => group.id === prev)) {
        return prev;
      }
      return patternGroups[0]?.id ?? null;
    });
  }, [patternGroups]);

  useEffect(() => {
    setSongRows((rows) => {
      const groupIds = new Set(patternGroups.map((group) => group.id));
      let changed = false;
      const next = rows.map((row) => {
        const updatedSlots = row.slots.map((groupId) =>
          groupId && groupIds.has(groupId) ? groupId : null
        );
        const slotsChanged = updatedSlots.some(
          (value, index) => value !== row.slots[index]
        );
        if (slotsChanged) {
          changed = true;
          return { ...row, slots: updatedSlots };
        }
        return row;
      });
      return changed ? next : rows;
    });
  }, [patternGroups]);

  useEffect(() => {
    setEditing((prev) => {
      if (prev === null) return prev;
      return tracks.some((track) => track.id === prev) ? prev : null;
    });
  }, [tracks]);

  useEffect(() => {
    setCurrentSectionIndex((prev) => {
      const maxColumns = songRows.reduce(
        (max, row) => Math.max(max, row.slots.length),
        0
      );
      if (maxColumns === 0) return 0;
      return prev >= maxColumns ? maxColumns - 1 : prev;
    });
  }, [songRows]);

  useEffect(() => {
    if (!started || viewMode !== "song") return;
    const maxColumns = songRows.reduce(
      (max, row) => Math.max(max, row.slots.length),
      0
    );
    if (maxColumns === 0) return;

    const ticksPerSection = Tone.Time("1m").toTicks();
    if (ticksPerSection === 0) return;

    const applySectionFromTicks = (ticks: number) => {
      const nextSection =
        Math.floor(ticks / ticksPerSection) % Math.max(maxColumns, 1);
      setCurrentSectionIndex((prev) =>
        prev === nextSection ? prev : nextSection
      );
    };

    applySectionFromTicks(Tone.Transport.ticks);

    const id = Tone.Transport.scheduleRepeat((time) => {
      const ticks = Tone.Transport.getTicksAtTime(time);
      Tone.Draw.schedule(() => {
        applySectionFromTicks(ticks);
      }, time);
    }, "1m");

    return () => {
      Tone.Transport.clear(id);
    };
  }, [started, viewMode, songRows]);

  useEffect(() => {
    if (viewMode === "song") {
      setCurrentSectionIndex(0);
    }
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "track") return;
    if (!pendingLoopStripAction) return;
    let frame = 0;
    const run = () => {
      const handle = loopStripRef.current;
      if (!handle) {
        frame = window.requestAnimationFrame(run);
        return;
      }
      if (pendingLoopStripAction === "openLibrary") {
        handle.openSequenceLibrary();
      } else if (pendingLoopStripAction === "addTrack") {
        openAddTrackModal();
      }
      setPendingLoopStripAction(null);
    };
    frame = window.requestAnimationFrame(run);
    return () => window.cancelAnimationFrame(frame);
  }, [pendingLoopStripAction, viewMode, openAddTrackModal]);

  const initAudioGraph = async () => {
    await Tone.start(); // iOS unlock
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.4 },
    });
    const reverb = new Tone.Reverb({ decay: 3, wet: 0 });
    const delay = new Tone.FeedbackDelay({ delayTime: 0.25, feedback: 0.3, wet: 0 });
    const distortion = new Tone.Distortion({ distortion: 0 });
    const bitCrusher = new Tone.BitCrusher(4);
    bitCrusher.wet.value = 0;
    const chorus = new Tone.Chorus(4, 2.5, 0.5).start();
    chorus.wet.value = 0;
    const tremolo = new Tone.Tremolo(9, 0.75).start();
    tremolo.wet.value = 0;
    const filter = new Tone.Filter({ type: "lowpass", frequency: 20000 });
    const panner = new Tone.Panner(0);
    synth.chain(distortion, bitCrusher, chorus, tremolo, filter, reverb, delay, panner, Tone.Destination);
    noteRef.current = synth;
    keyboardFxRef.current = { reverb, delay, distortion, bitCrusher, panner, chorus, tremolo, filter };

    Tone.Transport.bpm.value = bpm;
    Tone.Transport.start(); // start clock; we’ll schedule to it
    setStarted(true);
    setIsPlaying(true);
    setCurrentSectionIndex(0);
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      Tone.Transport.pause();
      setIsPlaying(false);
      return;
    }
    if (Tone.Transport.state === "stopped") {
      setCurrentSectionIndex(0);
    }
    Tone.Transport.start();
    setIsPlaying(true);
  };

  const handleStop = () => {
    Tone.Transport.stop();
    setIsPlaying(false);
    setCurrentSectionIndex(0);
  };

  const handleOpenSequenceLibrary = () => {
    if (viewMode !== "track") {
      setViewMode("track");
      setPendingLoopStripAction("openLibrary");
      return;
    }
    loopStripRef.current?.openSequenceLibrary();
  };

  const handleAddTrackRequest = () => {
    if (viewMode !== "track") {
      setViewMode("track");
      setPendingLoopStripAction("addTrack");
      return;
    }
    openAddTrackModal();
  };

  const handleConfirmAddTrack = useCallback(() => {
    if (!addTrackModalState.instrumentId) {
      closeAddTrackModal();
      return;
    }
    if (
      addTrackModalState.mode === "edit" &&
      addTrackModalState.targetTrackId !== null
    ) {
      loopStripRef.current?.updateTrackWithOptions(
        addTrackModalState.targetTrackId,
        {
          packId: addTrackModalState.packId,
          instrumentId: addTrackModalState.instrumentId,
          characterId: addTrackModalState.characterId,
          presetId: addTrackModalState.presetId,
        }
      );
    } else {
      loopStripRef.current?.addTrackWithOptions({
        packId: addTrackModalState.packId,
        instrumentId: addTrackModalState.instrumentId,
        characterId: addTrackModalState.characterId,
        presetId: addTrackModalState.presetId,
      });
    }
    closeAddTrackModal();
  }, [addTrackModalState, closeAddTrackModal]);

  const handleDeleteTrackFromModal = useCallback(() => {
    if (
      addTrackModalState.mode !== "edit" ||
      addTrackModalState.targetTrackId === null
    ) {
      closeAddTrackModal();
      return;
    }
    loopStripRef.current?.removeTrack(addTrackModalState.targetTrackId);
    closeAddTrackModal();
  }, [addTrackModalState, closeAddTrackModal]);

  return (
    <div
      style={{
        height: "100dvh",
        minHeight: "100dvh",
        paddingBottom: "env(safe-area-inset-bottom)",
        boxSizing: "border-box",
        background: "#0f1420",
        color: "#e6f2ff",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <AddTrackModal
        isOpen={addTrackModalState.isOpen}
        mode={addTrackModalState.mode}
        packs={packs}
        selectedPackId={addTrackModalState.packId}
        selectedInstrumentId={addTrackModalState.instrumentId}
        selectedCharacterId={addTrackModalState.characterId}
        selectedPresetId={addTrackModalState.presetId}
        onSelectPack={handleSelectAddTrackPack}
        onSelectInstrument={handleSelectAddTrackInstrument}
        onSelectCharacter={handleSelectAddTrackCharacter}
        onSelectPreset={handleSelectAddTrackPreset}
        onCancel={closeAddTrackModal}
        onConfirm={handleConfirmAddTrack}
        onDelete={
          addTrackModalState.mode === "edit"
            ? handleDeleteTrackFromModal
            : undefined
        }
      />
      {!started ? (
        <div style={{ display: "grid", placeItems: "center", flex: 1 }}>
          <button
            onClick={initAudioGraph}
            style={{
              padding: "16px 24px",
              fontSize: "1.25rem",
              borderRadius: 9999,
              border: "1px solid #333",
              background: "#27E0B0",
              color: "#1F2532"
            }}
          >
            Start Jam
          </button>
        </div>
      ) : (
        <>
          <div
            style={{
              padding: "16px 16px 0",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 8,
              }}
            >
              <button
                onClick={() => setViewMode("track")}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: viewMode === "track" ? "#27E0B0" : "#1f2532",
                  color: viewMode === "track" ? "#1F2532" : "#e6f2ff",
                }}
              >
                Tracks
              </button>
              <button
                onClick={() => {
                  setEditing(null);
                  setViewMode("song");
                }}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: viewMode === "song" ? "#27E0B0" : "#1f2532",
                  color: viewMode === "song" ? "#1F2532" : "#e6f2ff",
                }}
              >
                Song
              </button>
            </div>
          </div>
          {viewMode === "track" && (
            <LoopStrip
              ref={loopStripRef}
              started={started}
              isPlaying={isPlaying}
              tracks={tracks}
              editing={editing}
              setEditing={setEditing}
              setTracks={setTracks}
              packIndex={packIndex}
              patternGroups={patternGroups}
              setPatternGroups={setPatternGroups}
              selectedGroupId={selectedGroupId}
              setSelectedGroupId={setSelectedGroupId}
              onAddTrack={openAddTrackModal}
              onRequestTrackModal={handleRequestTrackModal}
            />
          )}
          <div
            style={{
              padding: 16,
              paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {viewMode === "track" ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      flex: 1,
                    }}
                  >
                    {editing !== null ? (
                      <button
                        onClick={() => setEditing(null)}
                        style={{
                          padding: "4px 12px",
                          borderRadius: 4,
                          border: "1px solid #333",
                          background: "#27E0B0",
                          color: "#1F2532",
                          cursor: "pointer",
                        }}
                      >
                        Done
                      </button>
                    ) : (
                      <>
                        <label>BPM</label>
                        <select
                          value={bpm}
                          onChange={(e) =>
                            setBpm(parseInt(e.target.value, 10))
                          }
                          style={{
                            padding: 8,
                            borderRadius: 8,
                            background: "#121827",
                            color: "white",
                          }}
                        >
                          {[90, 100, 110, 120, 130].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                        <label style={{ marginLeft: 12 }}>Quantize</label>
                        <select
                          value={subdiv}
                          onChange={(e) =>
                            setSubdiv(e.target.value as Subdivision)
                          }
                          style={{
                            padding: 8,
                            borderRadius: 8,
                            background: "#121827",
                            color: "white",
                          }}
                        >
                          <option value="16n">1/16</option>
                          <option value="8n">1/8</option>
                          <option value="4n">1/4</option>
                        </select>
                      </>
                    )}
                  </div>
                  <div
                    style={{
                      width: 1,
                      height: 24,
                      background: "#333",
                      margin: "0 12px",
                    }}
                  />
                  <div style={{ display: "flex", gap: 12 }}>
                    <button
                      aria-label={isPlaying ? "Pause" : "Play"}
                      onPointerDown={handlePlayPause}
                      onPointerUp={(e) => e.currentTarget.blur()}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 8,
                        border: "1px solid #333",
                        background: "#27E0B0",
                        color: "#1F2532",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 20,
                      }}
                    >
                      <span className="material-symbols-outlined">
                        {isPlaying ? "pause" : "play_arrow"}
                      </span>
                    </button>
                    <button
                      aria-label="Stop"
                      onPointerDown={handleStop}
                      onPointerUp={(e) => e.currentTarget.blur()}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 8,
                        border: "1px solid #333",
                        background: "#E02749",
                        color: "#e6f2ff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 40,
                        padding: 0,
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ lineHeight: 1, width: "100%", height: "100%" }}
                      >
                        stop
                      </span>
                    </button>
                  </div>
                </div>

                <div
                  className="scrollable"
                  style={{
                    marginTop: 16,
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    overflowY: "auto",
                    minHeight: 0,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <button
                      onClick={() => setTab("mushy")}
                      style={{
                        flex: 1,
                        padding: "8px 0",
                        borderRadius: 8,
                        border: "1px solid #333",
                        background: tab === "mushy" ? "#27E0B0" : "#1f2532",
                        color: tab === "mushy" ? "#1F2532" : "#e6f2ff",
                      }}
                    >
                      Mushy
                    </button>
                    <button
                      onClick={() => setTab("keyboard")}
                      style={{
                        flex: 1,
                        padding: "8px 0",
                        borderRadius: 8,
                        border: "1px solid #333",
                        background: tab === "keyboard" ? "#27E0B0" : "#1f2532",
                        color: tab === "keyboard" ? "#1F2532" : "#e6f2ff",
                      }}
                    >
                      Keyboard
                    </button>
                  </div>
                  {tab === "mushy" ? (
                    <Arpeggiator
                      started={started}
                      subdiv={subdiv}
                      setTracks={setTracks}
                    />
                  ) : (
                    <Keyboard
                      subdiv={subdiv}
                      noteRef={noteRef}
                      fxRef={keyboardFxRef}
                      setTracks={setTracks}
                    />
                  )}
                </div>
              </>
            ) : (
              <SongView
                patternGroups={patternGroups}
                songRows={songRows}
                setSongRows={setSongRows}
                currentSectionIndex={currentSectionIndex}
                isPlaying={isPlaying}
                bpm={bpm}
                setBpm={setBpm}
                onPlayPause={handlePlayPause}
                onStop={handleStop}
                selectedGroupId={selectedGroupId}
                onOpenSequenceLibrary={handleOpenSequenceLibrary}
                onAddTrack={handleAddTrackRequest}
              />
            )}
          </div>
          <PatternPlaybackManager
            tracks={tracks}
            triggers={triggers}
            started={started}
            viewMode={viewMode}
            patternGroups={patternGroups}
            songRows={songRows}
            currentSectionIndex={currentSectionIndex}
          />
        </>
      )}
    </div>
  );
}
