import * as Tone from "tone";
import { fromContext } from "tone/build/esm/fromContext";
import type { TransportClass } from "tone/build/esm/core/clock/Transport";

import type { Chunk } from "./chunks";
import type { InstrumentCharacter, Pack } from "./packs";
import type { StoredProjectData } from "./storage";
import { createStoredProjectPayload } from "./storage";
import type { TriggerMap } from "./tracks";
import { filterValueToFrequency } from "./utils/audio";
import {
  createHarmoniaNodes,
  disposeHarmoniaNodes,
  triggerHarmoniaChord,
  type HarmoniaNodes,
} from "./instruments/harmonia";
import {
  createKick,
  mergeKickDesignerState,
  normalizeKickDesignerState,
  type KickDesignerInstrument,
} from "./instruments/kickDesigner";

interface KeyboardFxNodes {
  reverb: Tone.Reverb;
  delay: Tone.FeedbackDelay;
  distortion: Tone.Distortion;
  bitCrusher: Tone.BitCrusher;
  panner: Tone.Panner;
  chorus: Tone.Chorus;
  tremolo: Tone.Tremolo;
  filter: Tone.Filter;
}

type ToneInstrument = Tone.ToneAudioNode & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerAttackRelease: (...args: any[]) => any;
  dispose?: () => void;
};

interface PatternSchedule {
  pattern: Chunk;
  startTime: number;
  stopTime: number;
  velocityScale: number;
  instrumentId: string;
  characterId?: string;
}

interface SchedulePatternOptions {
  pattern: Chunk;
  startTime: number;
  stopTime: number;
  velocityScale: number;
  onTrigger: (
    time: number,
    velocity: number,
    pitch?: number,
    note?: string,
    sustain?: number,
    chunk?: Chunk
  ) => void;
}

export interface AudioExportProgress {
  step: "preparing" | "rendering" | "encoding" | "complete";
  message: string;
}

export interface AudioExportOptions {
  project: StoredProjectData;
  projectName: string;
  pack?: Pack;
  viewMode: "track" | "song";
  onProgress?: (progress: AudioExportProgress) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const sanitizeProjectName = (name: string) => {
  const trimmed = name.trim();
  const cleaned = trimmed
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return cleaned || "untitled";
};

const formatTimestamp = (date: Date) => {
  const pad = (value: number) => value.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}${month}${day}-${hours}${minutes}`;
};

const buildFilename = (projectName: string, extension: string) => {
  const safeName = sanitizeProjectName(projectName);
  const timestamp = formatTimestamp(new Date());
  return `${safeName}-${timestamp}.${extension}`;
};

const triggerDownload = (blob: Blob, filename: string) => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("File download is only supported in a browser environment.");
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

export const exportProjectJson = (
  options: Pick<AudioExportOptions, "project" | "projectName">
) => {
  const { project, projectName } = options;
  const payload = createStoredProjectPayload(project);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, buildFilename(projectName, "json"));
};

const resolveCharacter = (
  pack: Pack,
  instrumentId: string,
  requestedId?: string
): InstrumentCharacter | undefined => {
  const definition = pack.instruments[instrumentId];
  if (!definition) return undefined;
  if (requestedId) {
    const specific = definition.characters.find(
      (character) => character.id === requestedId
    );
    if (specific) return specific;
  }
  if (definition.defaultCharacterId) {
    const preferred = definition.characters.find(
      (character) => character.id === definition.defaultCharacterId
    );
    if (preferred) return preferred;
  }
  return definition.characters[0];
};

type BoundTone = ReturnType<typeof fromContext>;

const createInstrumentInstance = (
  tone: BoundTone,
  instrumentId: string,
  character: InstrumentCharacter
): {
  instrument: ToneInstrument;
  keyboardFx?: KeyboardFxNodes;
  harmoniaNodes?: HarmoniaNodes;
} => {
  if (instrumentId === "kick") {
    const defaults = normalizeKickDesignerState(character.defaults);
    const instrument = createKick(character.id);
    instrument.setMacroState(defaults);
    instrument.toDestination();
    return { instrument: instrument as ToneInstrument };
  }

  if (character.type === "Harmonia") {
    const nodes = createHarmoniaNodes(tone, character);
    nodes.volume.connect(tone.Destination);
    return { instrument: nodes.synth as ToneInstrument, harmoniaNodes: nodes };
  }

  if (!character.type) {
    throw new Error(`Unknown instrument type for character ${character.id}`);
  }

  const ctor = (
    tone as unknown as Record<
      string,
      new (opts?: Record<string, unknown>) => ToneInstrument
    >
  )[character.type];
  if (!ctor) {
    throw new Error(`Unknown instrument type: ${character.type}`);
  }

  let instrument: ToneInstrument;
  if (character.type === "PolySynth") {
    const options = (character.options ?? {}) as {
      voice?: string;
      voiceOptions?: Record<string, unknown>;
    } & Record<string, unknown>;
    const { voice, voiceOptions, ...polyOptions } = options;
    if (voice && voice in tone) {
      const VoiceCtor = (
        tone as unknown as Record<
          string,
          new (opts?: Record<string, unknown>) => Tone.Synth
        >
      )[voice];
      const PolyCtor = tone.PolySynth as unknown as new (
        voice?: new (opts?: Record<string, unknown>) => Tone.Synth,
        options?: Record<string, unknown>
      ) => ToneInstrument;
      instrument = new PolyCtor(VoiceCtor, voiceOptions ?? {});
      (
        instrument as unknown as {
          set?: (values: Record<string, unknown>) => void;
        }
      ).set?.(polyOptions);
    } else {
      instrument = new ctor(character.options ?? {});
    }
  } else {
    instrument = new ctor(character.options ?? {});
  }

  let node: Tone.ToneAudioNode = instrument;
  (character.effects ?? []).forEach((effect) => {
    const EffectCtor = (
      tone as unknown as Record<
        string,
        new (opts?: Record<string, unknown>) => Tone.ToneAudioNode
      >
    )[effect.type];
    if (!EffectCtor) return;
    const effectNode = new EffectCtor(effect.options ?? {});
    node.connect(effectNode);
    node = effectNode;
  });

  if (instrumentId === "keyboard") {
    const distortion = new tone.Distortion(0);
    const bitCrusher = new tone.BitCrusher(4);
    bitCrusher.wet.value = 0;
    const chorus = new tone.Chorus(4, 2.5, 0.5).start();
    chorus.wet.value = 0;
    const tremolo = new tone.Tremolo(9, 0.75).start();
    tremolo.wet.value = 0;
    const filter = new tone.Filter({ type: "lowpass", frequency: 20000 });
    const reverb = new tone.Reverb(2.8);
    reverb.wet.value = 0;
    const delay = new tone.FeedbackDelay({ delayTime: 0.25, feedback: 0.2 });
    delay.wet.value = 0;
    const panner = new tone.Panner(0);
    node.connect(distortion);
    distortion.connect(bitCrusher);
    bitCrusher.connect(chorus);
    chorus.connect(tremolo);
    tremolo.connect(filter);
    filter.connect(reverb);
    reverb.connect(delay);
    delay.connect(panner);
    panner.connect(tone.Destination);
    return {
      instrument,
      keyboardFx: {
        reverb,
        delay,
        distortion,
        bitCrusher,
        panner,
        chorus,
        tremolo,
        filter,
      },
    };
  }

  node.connect(tone.Destination);
  return { instrument };
};

const createOfflineTriggerMap = (
  tone: BoundTone,
  pack: Pack
): { triggerMap: TriggerMap; dispose: () => void } => {
  const instrumentRefs: Record<string, ToneInstrument> = {};
  const keyboardFxRefs: Record<string, KeyboardFxNodes> = {};
  const harmoniaFxRefs: Record<string, HarmoniaNodes> = {};

  const triggerMap: TriggerMap = {};

  Object.keys(pack.instruments).forEach((instrumentId) => {
    triggerMap[instrumentId] = (
      time: number,
      velocity = 1,
      pitch = 0,
      noteArg?: string,
      sustainArg?: number,
      chunk?: Chunk,
      characterId?: string
    ) => {
      const character = resolveCharacter(
        pack,
        instrumentId,
        characterId ?? chunk?.characterId
      );
      if (!character) return;
      const key = `${instrumentId}:${character.id}`;
      let inst = instrumentRefs[key];
      if (!inst) {
        const created = createInstrumentInstance(tone, instrumentId, character);
        inst = created.instrument;
        instrumentRefs[key] = inst;
        if (created.keyboardFx) {
          keyboardFxRefs[key] = created.keyboardFx;
        }
        if (created.harmoniaNodes) {
          harmoniaFxRefs[key] = created.harmoniaNodes;
        }
      }

      const sustainOverride =
        sustainArg ?? (chunk?.sustain !== undefined ? chunk.sustain : undefined);

      if (instrumentId === "harmonia") {
        const nodes = harmoniaFxRefs[key];
        if (!nodes) return;
        if (chunk?.attack !== undefined || chunk?.sustain !== undefined) {
          const envelope: Record<string, unknown> = {};
          if (chunk.attack !== undefined) envelope.attack = chunk.attack;
          if (chunk.sustain !== undefined) envelope.release = chunk.sustain;
          if (Object.keys(envelope).length > 0) {
            (inst as unknown as { set?: (values: Record<string, unknown>) => void }).set?.({
              envelope,
            });
          }
        }
        triggerHarmoniaChord({
          nodes,
          time,
          velocity,
          sustain: sustainOverride,
          chunk,
          characterId: character.id,
        });
        return;
      }

      const settable = inst as unknown as {
        set?: (values: Record<string, unknown>) => void;
      };
      if (instrumentId === "kick") {
        const kick = inst as unknown as KickDesignerInstrument;
        if (kick.setMacroState) {
          const defaults = normalizeKickDesignerState(character.defaults);
          const merged = mergeKickDesignerState(defaults, {
            punch: chunk?.punch,
            clean: chunk?.clean,
            tight: chunk?.tight,
          });
          kick.setMacroState(merged);
        }
      }
      if (chunk?.attack !== undefined || chunk?.sustain !== undefined) {
        const envelope: Record<string, unknown> = {};
        if (chunk.attack !== undefined) envelope.attack = chunk.attack;
        if (chunk.sustain !== undefined) envelope.release = chunk.sustain;
        if (Object.keys(envelope).length > 0) {
          settable.set?.({ envelope });
        }
      }
      if (chunk?.glide !== undefined) {
        settable.set?.({ portamento: chunk.glide });
      }
      if (chunk?.filter !== undefined) {
        settable.set?.({
          filter: { frequency: filterValueToFrequency(chunk.filter) },
        });
      }
      if (instrumentId === "keyboard") {
        const fx = keyboardFxRefs[key];
        if (fx) {
          if (chunk?.pan !== undefined) {
            fx.panner.pan.rampTo(chunk.pan, 0.1);
          }
          if (chunk?.reverb !== undefined) {
            fx.reverb.wet.value = chunk.reverb;
          }
          if (chunk?.delay !== undefined) {
            fx.delay.wet.value = chunk.delay;
          }
          if (chunk?.distortion !== undefined) {
            fx.distortion.distortion = chunk.distortion;
          }
          if (chunk?.bitcrusher !== undefined) {
            fx.bitCrusher.wet.value = chunk.bitcrusher;
          }
          if (chunk?.chorus !== undefined) {
            fx.chorus.wet.value = chunk.chorus;
          }
          if (chunk?.filter !== undefined) {
            const frequency = filterValueToFrequency(chunk.filter);
            fx.filter.frequency.rampTo(frequency, 0.1);
          }
        }
      }
      if (inst instanceof Tone.NoiseSynth) {
        inst.triggerAttackRelease(
          sustainOverride ?? character.note ?? "8n",
          time,
          velocity
        );
        return;
      }
      const baseNote = noteArg ?? chunk?.note ?? character.note ?? "C2";
      const targetNote = Tone.Frequency(baseNote).transpose(pitch).toNote();
      const duration = sustainOverride ?? (instrumentId === "keyboard" ? 0.3 : "8n");
      inst.triggerAttackRelease(targetNote, duration, time, velocity);
    };
  });

  const dispose = () => {
    Object.values(instrumentRefs).forEach((inst) => {
      inst.dispose?.();
    });
    Object.values(keyboardFxRefs).forEach((fx) => {
      fx.reverb.dispose();
      fx.delay.dispose();
      fx.distortion.dispose();
      fx.bitCrusher.dispose();
      fx.panner.dispose();
      fx.chorus.dispose();
      fx.tremolo.dispose();
      fx.filter.dispose();
    });
    Object.values(harmoniaFxRefs).forEach((nodes) => {
      disposeHarmoniaNodes(nodes);
    });
  };

  return { triggerMap, dispose };
};

const getPatternLoopDurationSeconds = (pattern: Chunk) => {
  if (pattern.timingMode === "free" && pattern.noteEvents && pattern.noteEvents.length) {
    const events = pattern.noteEvents.slice().sort((a, b) => a.time - b.time);
    const loopLength = pattern.noteLoopLength ?? 0;
    const computed =
      loopLength > 0
        ? loopLength
        : events[events.length - 1].time + events[events.length - 1].duration;
    return computed > 0 ? computed : 0;
  }
  const stepCount = pattern.steps && pattern.steps.length ? pattern.steps.length : 16;
  return stepCount * Tone.Time("16n").toSeconds();
};

const buildTrackSchedules = (
  project: StoredProjectData
): { schedules: PatternSchedule[]; duration: number } => {
  const schedules: PatternSchedule[] = [];
  let maxDuration = 0;
  project.tracks.forEach((track) => {
    if (!track.pattern) return;
    if (!track.instrument) return;
    if (track.muted) return;
    const patternDuration = getPatternLoopDurationSeconds(track.pattern);
    maxDuration = Math.max(maxDuration, patternDuration);
    schedules.push({
      pattern: track.pattern,
      startTime: 0,
      stopTime: 0,
      velocityScale: 1,
      instrumentId: track.instrument,
      characterId: track.source?.characterId ?? track.pattern.characterId,
    });
  });
  const minDuration = Tone.Time("1m").toSeconds();
  const duration = Math.max(maxDuration, minDuration);
  return {
    schedules: schedules.map((schedule) => ({
      ...schedule,
      stopTime: duration,
    })),
    duration,
  };
};

const buildSongSchedules = (
  project: StoredProjectData
): { schedules: PatternSchedule[]; duration: number } => {
  const schedules: PatternSchedule[] = [];
  const sectionCount = project.songRows.reduce(
    (max, row) => Math.max(max, row.slots.length),
    0
  );
  if (sectionCount === 0) {
    return { schedules: [], duration: Tone.Time("1m").toSeconds() };
  }
  const patternGroupMap = new Map(
    project.patternGroups.map((group) => [group.id, group])
  );
  const measureSeconds = Tone.Time("1m").toSeconds();
  project.songRows.forEach((row) => {
    if (row.muted) return;
    const velocityScale = clamp(row.velocity ?? 1, 0, 1);
    if (velocityScale <= 0) return;
    for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
      const groupId = row.slots[sectionIndex] ?? null;
      if (!groupId) continue;
      const group = patternGroupMap.get(groupId);
      if (!group) continue;
      const sectionStart = sectionIndex * measureSeconds;
      const sectionEnd = sectionStart + measureSeconds;
      group.tracks.forEach((track) => {
        if (!track.pattern) return;
        if (!track.instrument) return;
        if (track.muted) return;
        schedules.push({
          pattern: track.pattern,
          startTime: sectionStart,
          stopTime: sectionEnd,
          velocityScale,
          instrumentId: track.instrument,
          characterId: track.source?.characterId ?? track.pattern?.characterId,
        });
      });
    }
  });
  return {
    schedules,
    duration: Math.max(sectionCount * measureSeconds, measureSeconds),
  };
};

const schedulePattern = (
  transport: TransportClass,
  options: SchedulePatternOptions
): number[] => {
  const { pattern, startTime, stopTime, velocityScale, onTrigger } = options;
  if (stopTime <= startTime) return [];
  const timingMode = pattern.timingMode === "free" ? "free" : "sync";
  const baseVelocityFactor = pattern.velocityFactor ?? 1;
  const overallVelocityFactor = clamp(
    baseVelocityFactor * Math.max(velocityScale, 0),
    0,
    1
  );
  if (overallVelocityFactor <= 0) return [];
  const pitchOffset = pattern.pitchOffset ?? 0;
  const swingAmount = pattern.swing ?? 0;
  const swingOffsetSeconds = swingAmount
    ? Tone.Time("16n").toSeconds() * 0.5 * swingAmount
    : 0;
  const humanizeAmount = pattern.humanize ?? 0;
  const humanizeRange = humanizeAmount
    ? Tone.Time("32n").toSeconds() * humanizeAmount
    : 0;

  const clampHumanizedTime = (baseTime: number) =>
    humanizeRange
      ? Math.max(startTime, baseTime + (Math.random() * 2 - 1) * humanizeRange)
      : baseTime;

  const scheduledIds: number[] = [];

  if (timingMode === "free" && pattern.noteEvents && pattern.noteEvents.length) {
    const events = pattern.noteEvents.slice().sort((a, b) => a.time - b.time);
    const loopLength = pattern.noteLoopLength ?? 0;
    const computedLoop =
      loopLength > 0
        ? loopLength
        : events[events.length - 1].time + events[events.length - 1].duration;
    if (computedLoop <= 0) return [];

    for (
      let loopStart = startTime;
      loopStart < stopTime;
      loopStart += computedLoop
    ) {
      events.forEach((event) => {
        const eventTime = loopStart + event.time;
        if (eventTime >= stopTime) return;
        const scaledVelocity = clamp(event.velocity * overallVelocityFactor, 0, 1);
        if (scaledVelocity <= 0) return;
        const scheduledTime = clampHumanizedTime(eventTime);
        const id = transport.schedule((transportTime) => {
          onTrigger(
            transportTime,
            scaledVelocity,
            undefined,
            event.note,
            event.duration,
            pattern
          );
        }, scheduledTime);
        scheduledIds.push(id);
      });
    }

    return scheduledIds;
  }

  const stepsArray =
    pattern.steps && pattern.steps.length
      ? pattern.steps.slice()
      : Array(16).fill(0);
  const stepCount = stepsArray.length || 16;
  const stepDurationSeconds = Tone.Time("16n").toSeconds();
  const loopDuration = stepCount * stepDurationSeconds;
  const releaseControl = pattern.sustain;

  const computeSustainSeconds = (index: number) => {
    let holdSteps = 0;
    for (let offset = 1; offset < stepCount; offset += 1) {
      const nextIndex = (index + offset) % stepCount;
      if (stepsArray[nextIndex]) {
        break;
      }
      holdSteps += 1;
    }
    const holdDurationSeconds = (holdSteps + 1) * stepDurationSeconds;
    if (releaseControl === undefined) {
      return holdDurationSeconds;
    }
    return Math.min(Math.max(releaseControl, 0), holdDurationSeconds);
  };

  for (let loopIndex = 0; ; loopIndex += 1) {
    const loopStart = startTime + loopIndex * loopDuration;
    if (loopStart >= stopTime) break;

    for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
      const active = stepsArray[stepIndex] ?? 0;
      if (!active) continue;
      const baseVelocity = pattern.velocities?.[stepIndex] ?? 1;
      const velocity = clamp(baseVelocity * overallVelocityFactor, 0, 1);
      if (velocity <= 0) continue;
      const basePitch = pattern.pitches?.[stepIndex] ?? 0;
      const combinedPitch = basePitch + pitchOffset;
      const rawTime = loopStart + stepIndex * stepDurationSeconds;
      if (rawTime >= stopTime) continue;
      const swungTime =
        swingOffsetSeconds && stepIndex % 2 === 1
          ? rawTime + swingOffsetSeconds
          : rawTime;
      const scheduledTime = clampHumanizedTime(swungTime);
      const sustainSeconds = computeSustainSeconds(stepIndex);
      const id = transport.schedule((transportTime) => {
        onTrigger(
          transportTime,
          velocity,
          combinedPitch,
          pattern.note,
          sustainSeconds,
          pattern
        );
      }, scheduledTime);
      scheduledIds.push(id);
    }
  }

  return scheduledIds;
};

const encodeToneBufferToWav = (buffer: Tone.ToneAudioBuffer): ArrayBuffer => {
  const channelData = buffer.toArray();
  const sampleRate = buffer.sampleRate;
  const channelArrays = Array.isArray(channelData)
    ? channelData
    : [channelData];
  const safeChannelData: Float32Array[] =
    channelArrays.length > 0
      ? channelArrays
      : [new Float32Array(buffer.length)];
  const channelCount = safeChannelData.length;
  const frameCount = safeChannelData[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataLength = frameCount * blockAlign;
  const bufferLength = 44 + dataLength;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < frameCount; i += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const channelSamples = safeChannelData[channel];
      const sample = channelSamples ? channelSamples[i] ?? 0 : 0;
      const clamped = clamp(sample, -1, 1);
      const intSample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(offset, Math.round(intSample), true);
      offset += bytesPerSample;
    }
  }

  return arrayBuffer;
};

export const exportProjectAudio = async (
  options: AudioExportOptions
): Promise<void> => {
  const { project, projectName, pack, viewMode, onProgress } = options;
  if (!pack) {
    throw new Error("Unable to export audio without a pack definition.");
  }

  onProgress?.({ step: "preparing", message: "Preparing export…" });

  const hasSongArrangement =
    viewMode === "song" &&
    project.songRows.some((row) => row.slots.some((slot) => Boolean(slot)));

  let scheduleResult = hasSongArrangement
    ? buildSongSchedules(project)
    : buildTrackSchedules(project);

  if (hasSongArrangement && scheduleResult.schedules.length === 0) {
    scheduleResult = buildTrackSchedules(project);
  }

  const { schedules, duration } = scheduleResult;
  const tailSeconds = 0.8;
  const totalRenderDuration = duration + tailSeconds;

  onProgress?.({ step: "rendering", message: "Rendering audio…" });

  let cleanup: (() => void) | undefined;
  let toneBuffer: Tone.ToneAudioBuffer;
  try {
    toneBuffer = await Tone.Offline(async (offlineContext) => {
      const tone = fromContext(offlineContext);
      const transport = offlineContext.transport;
      transport.cancel(0);
      transport.position = 0;
      transport.seconds = 0;
      transport.bpm.value = project.bpm ?? 120;
      const { triggerMap, dispose } = createOfflineTriggerMap(tone, pack);
      const scheduledEventIds: number[] = [];

      schedules.forEach((schedule) => {
        const trigger = triggerMap[schedule.instrumentId];
        if (!trigger) return;
        const ids = schedulePattern(transport, {
          pattern: schedule.pattern,
          startTime: schedule.startTime,
          stopTime: schedule.stopTime,
          velocityScale: schedule.velocityScale,
          onTrigger: (time, velocity, pitch, note, sustain, chunk) => {
            trigger(time, velocity, pitch, note, sustain, chunk, schedule.characterId);
          },
        });
        scheduledEventIds.push(...ids);
      });

      cleanup = () => {
        scheduledEventIds.forEach((id) => {
          transport.clear(id);
        });
        dispose();
      };

      transport.start(0);
      transport.stop(totalRenderDuration);
    }, totalRenderDuration);
  } finally {
    cleanup?.();
  }

  onProgress?.({ step: "encoding", message: "Encoding WAV…" });
  const wavBuffer = encodeToneBufferToWav(toneBuffer);
  const blob = new Blob([wavBuffer], { type: "audio/wav" });
  triggerDownload(blob, buildFilename(projectName, "wav"));
  onProgress?.({ step: "complete", message: "Download ready." });
};

