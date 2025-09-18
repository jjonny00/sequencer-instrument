import * as Tone from "tone";
import { Mp3Encoder } from "lamejs";

import type { Chunk } from "./chunks";
import type { PatternGroup, SongRow } from "./song";
import type { Track } from "./tracks";
import type { StoredProjectData } from "./storage";
import { createStoredProjectPayload } from "./storage";
import { packs, type InstrumentCharacter } from "./packs";
import { filterValueToFrequency } from "./utils/audio";

export interface ExportProgressUpdate {
  progress: number;
  message?: string;
}

export type ProgressCallback = (update: ExportProgressUpdate) => void;

type ToneInstrument = Tone.ToneAudioNode & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerAttackRelease: (...args: any[]) => void;
};

type InstrumentCacheEntry = {
  instrument: ToneInstrument;
  keyboardFx?: {
    reverb: Tone.Reverb;
    delay: Tone.FeedbackDelay;
    distortion: Tone.Distortion;
    bitCrusher: Tone.BitCrusher;
    panner: Tone.Panner;
    chorus: Tone.Chorus;
    tremolo: Tone.Tremolo;
    filter: Tone.Filter;
  };
};

type ScheduleTrigger = (
  time: number,
  velocity?: number,
  pitch?: number,
  note?: string,
  sustain?: number,
  chunk?: Chunk,
  characterId?: string
) => void;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const sanitizeProjectName = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return "untitled";
  return trimmed.replace(/[^a-z0-9-_]+/gi, "-");
};

export const createExportFilename = (
  projectName: string,
  extension: string,
  timestamp = new Date()
) => {
  const name = sanitizeProjectName(projectName);
  const year = timestamp.getFullYear();
  const month = `${timestamp.getMonth() + 1}`.padStart(2, "0");
  const day = `${timestamp.getDate()}`.padStart(2, "0");
  const hours = `${timestamp.getHours()}`.padStart(2, "0");
  const minutes = `${timestamp.getMinutes()}`.padStart(2, "0");
  return `${name}-${year}${month}${day}-${hours}${minutes}.${extension}`;
};

const downloadBlob = (filename: string, blob: Blob) => {
  if (typeof document === "undefined") {
    throw new Error("File downloads are not supported in this environment");
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const floatTo16BitPCM = (output: DataView, offset: number, input: Float32Array) => {
  for (let i = 0; i < input.length; i += 1, offset += 2) {
    const sample = clamp(input[i], -1, 1);
    output.setInt16(
      offset,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true
    );
  }
};

const interleaveChannels = (buffer: AudioBuffer) => {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length * numChannels;
  const result = new Float32Array(length);
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < numChannels; channel += 1) {
    channels[channel] = buffer.getChannelData(channel);
  }
  for (let i = 0; i < buffer.length; i += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      result[i * numChannels + channel] = channels[channel][i];
    }
  }
  return result;
};

const audioBufferToWavBlob = (buffer: AudioBuffer) => {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const interleaved = interleaveChannels(buffer);
  const dataLength = interleaved.length * 2;
  const totalLength = 44 + dataLength;
  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  floatTo16BitPCM(view, 44, interleaved);

  return new Blob([view], { type: "audio/wav" });
};

const convertFloat32ToInt16 = (input: Float32Array) => {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = clamp(input[i], -1, 1);
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
};

const audioBufferToMp3Blob = (buffer: AudioBuffer, bitRate = 192) => {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const encoder = new Mp3Encoder(numChannels, sampleRate, bitRate);
  const samples: Int16Array[] = [];
  for (let channel = 0; channel < numChannels; channel += 1) {
    samples[channel] = convertFloat32ToInt16(buffer.getChannelData(channel));
  }

  const blockSize = 1152;
  const mp3Data: Uint8Array[] = [];
  for (let i = 0; i < buffer.length; i += blockSize) {
    const left = samples[0].subarray(i, i + blockSize);
    const right = numChannels > 1 ? samples[1].subarray(i, i + blockSize) : left;
    let data: Int8Array | Uint8Array;
    if (numChannels > 1) {
      data = encoder.encodeBuffer(left, right);
    } else {
      data = encoder.encodeBuffer(left);
    }
    if (data.length > 0) {
      mp3Data.push(new Uint8Array(data));
    }
  }
  const end = encoder.flush();
  if (end.length > 0) {
    mp3Data.push(new Uint8Array(end));
  }
  return new Blob(mp3Data, { type: "audio/mpeg" });
};

export const exportProjectAsJson = (
  project: StoredProjectData,
  projectName: string,
  timestamp = new Date()
) => {
  const payload = createStoredProjectPayload(project, timestamp.getTime());
  const filename = createExportFilename(projectName, "json", timestamp);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  downloadBlob(filename, blob);
};

const resolveCharacter = (
  pack: (typeof packs)[number],
  instrumentId: string,
  requestedId?: string
): InstrumentCharacter | undefined => {
  const definition = pack.instruments[instrumentId];
  if (!definition) return undefined;
  if (requestedId) {
    const specific = definition.characters.find((character) => character.id === requestedId);
    if (specific) {
      return specific;
    }
  }
  if (definition.defaultCharacterId) {
    const preferred = definition.characters.find(
      (character) => character.id === definition.defaultCharacterId
    );
    if (preferred) {
      return preferred;
    }
  }
  return definition.characters[0];
};

const createInstrumentInstance = (
  pack: (typeof packs)[number],
  instrumentId: string,
  character: InstrumentCharacter
): InstrumentCacheEntry => {
  const ctor = (
    Tone as unknown as Record<string, new (opts?: Record<string, unknown>) => ToneInstrument>
  )[character.type];
  if (!ctor) {
    throw new Error(`Unsupported instrument type: ${character.type}`);
  }
  let instrument: ToneInstrument;
  if (character.type === "PolySynth") {
    const options = (character.options ?? {}) as {
      voice?: string;
      voiceOptions?: Record<string, unknown>;
    } & Record<string, unknown>;
    const { voice, voiceOptions, ...polyOptions } = options;
    if (voice && voice in Tone) {
      const VoiceCtor = (
        Tone as unknown as Record<string, new (opts?: Record<string, unknown>) => Tone.Synth>
      )[voice];
      const PolyCtor = Tone.PolySynth as unknown as new (
        voice?: new (opts?: Record<string, unknown>) => Tone.Synth,
        options?: Record<string, unknown>
      ) => ToneInstrument;
      instrument = new PolyCtor(VoiceCtor, voiceOptions ?? {});
      (instrument as unknown as { set?: (values: Record<string, unknown>) => void }).set?.(
        polyOptions
      );
    } else {
      instrument = new ctor(character.options ?? {});
    }
  } else {
    instrument = new ctor(character.options ?? {});
  }

  let node: Tone.ToneAudioNode = instrument;
  (character.effects ?? []).forEach((effect) => {
    const EffectCtor = (
      Tone as unknown as Record<string, new (opts?: Record<string, unknown>) => Tone.ToneAudioNode>
    )[effect.type];
    if (!EffectCtor) return;
    const eff = new EffectCtor(effect.options ?? {});
    node.connect(eff);
    node = eff;
  });

  if (instrumentId === "keyboard") {
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
    node.connect(distortion);
    distortion.connect(bitCrusher);
    bitCrusher.connect(chorus);
    chorus.connect(tremolo);
    tremolo.connect(filter);
    filter.connect(reverb);
    reverb.connect(delay);
    delay.connect(panner);
    panner.connect(Tone.Destination);
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

  node.toDestination();
  return { instrument };
};

const createTriggerMap = (
  pack: (typeof packs)[number],
  cache: Map<string, InstrumentCacheEntry>
): Record<string, ScheduleTrigger> => {
  const triggers: Record<string, ScheduleTrigger> = {};
  Object.keys(pack.instruments).forEach((instrumentId) => {
    triggers[instrumentId] = (
      time,
      velocity = 1,
      pitch = 0,
      noteArg,
      sustainArg,
      chunk,
      characterId
    ) => {
      const character = resolveCharacter(pack, instrumentId, characterId);
      if (!character) return;
      const key = `${instrumentId}:${character.id}`;
      let entry = cache.get(key);
      if (!entry) {
        entry = createInstrumentInstance(pack, instrumentId, character);
        cache.set(key, entry);
      }
      const inst = entry.instrument;
      const sustainOverride =
        sustainArg ?? (chunk?.sustain !== undefined ? chunk.sustain : undefined);
      const settable = inst as unknown as { set?: (values: Record<string, unknown>) => void };
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
        settable.set?.({ filter: { frequency: filterValueToFrequency(chunk.filter) } });
      }
      if (instrumentId === "keyboard" && entry.keyboardFx) {
        const fx = entry.keyboardFx;
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
  return triggers;
};

const computeSectionCount = (songRows: SongRow[]): number => {
  let maxIndex = -1;
  songRows.forEach((row) => {
    for (let i = row.slots.length - 1; i >= 0; i -= 1) {
      if (row.slots[i]) {
        if (i > maxIndex) {
          maxIndex = i;
        }
        break;
      }
    }
  });
  return maxIndex + 1;
};

const computePatternLoopDuration = (pattern: Chunk, sixteenthSeconds: number): number => {
  if (pattern.timingMode === "free" && pattern.noteEvents?.length) {
    const events = pattern.noteEvents.slice().sort((a, b) => a.time - b.time);
    const loopLength = pattern.noteLoopLength ?? 0;
    if (loopLength > 0) {
      return loopLength;
    }
    const lastEvent = events[events.length - 1];
    return lastEvent.time + lastEvent.duration;
  }
  const stepsArray =
    pattern.steps && pattern.steps.length ? pattern.steps.slice() : Array(16).fill(0);
  const stepCount = stepsArray.length || 16;
  return stepCount * sixteenthSeconds;
};

const scheduleStepPattern = (
  pattern: Chunk,
  startTime: number,
  lengthSeconds: number,
  sixteenthSeconds: number,
  velocityScale: number,
  trigger: ScheduleTrigger,
  characterId?: string
) => {
  const stepsArray =
    pattern.steps && pattern.steps.length ? pattern.steps.slice() : Array(16).fill(0);
  const stepCount = stepsArray.length || 16;
  if (stepCount === 0) return;

  const loopDuration = stepCount * sixteenthSeconds;
  if (loopDuration <= 0) return;

  const velocityFactor = (pattern.velocityFactor ?? 1) * velocityScale;
  const pitchOffset = pattern.pitchOffset ?? 0;
  const swingAmount = pattern.swing ?? 0;
  const swingOffset = swingAmount ? sixteenthSeconds * 0.5 * swingAmount : 0;
  const humanizeAmount = pattern.humanize ?? 0;
  const humanizeWindow = humanizeAmount ? (sixteenthSeconds / 2) * humanizeAmount : 0;

  const loops = Math.max(1, Math.ceil(lengthSeconds / loopDuration));
  for (let loopIndex = 0; loopIndex < loops; loopIndex += 1) {
    const loopStart = startTime + loopIndex * loopDuration;
    if (loopStart >= startTime + lengthSeconds + 0.0001) break;
    for (let step = 0; step < stepCount; step += 1) {
      const active = stepsArray[step] ?? 0;
      if (!active) continue;
      const baseVelocity = pattern.velocities?.[step] ?? 1;
      const velocity = clamp(baseVelocity * velocityFactor, 0, 1);
      if (velocity <= 0) continue;
      const basePitch = pattern.pitches?.[step] ?? 0;
      const pitch = basePitch + pitchOffset;
      let eventTime = loopStart + step * sixteenthSeconds;
      if (swingOffset && step % 2 === 1) {
        eventTime += swingOffset;
      }
      if (humanizeWindow) {
        const randomOffset = (Math.random() * 2 - 1) * humanizeWindow;
        eventTime = Math.max(startTime, eventTime + randomOffset);
      }
      let holdSteps = 0;
      for (let offset = 1; offset < stepCount; offset += 1) {
        const nextIndex = (step + offset) % stepCount;
        if (stepsArray[nextIndex]) {
          break;
        }
        holdSteps += 1;
      }
      const holdDuration = (holdSteps + 1) * sixteenthSeconds;
      const sustainControl = pattern.sustain;
      const sustainSeconds =
        sustainControl === undefined
          ? holdDuration
          : Math.min(Math.max(sustainControl, 0), holdDuration);
      trigger(eventTime, velocity, pitch, pattern.note, sustainSeconds, pattern, characterId);
    }
  }
};

const scheduleFreePattern = (
  pattern: Chunk,
  startTime: number,
  lengthSeconds: number,
  velocityScale: number,
  trigger: ScheduleTrigger,
  characterId?: string
) => {
  if (!pattern.noteEvents?.length) return;
  const events = pattern.noteEvents.slice().sort((a, b) => a.time - b.time);
  const velocityFactor = (pattern.velocityFactor ?? 1) * velocityScale;
  const loopLength = pattern.noteLoopLength && pattern.noteLoopLength > 0
    ? pattern.noteLoopLength
    : events[events.length - 1].time + events[events.length - 1].duration;
  if (loopLength <= 0) return;
  const loops = Math.max(1, Math.ceil(lengthSeconds / loopLength));
  for (let loopIndex = 0; loopIndex < loops; loopIndex += 1) {
    const loopStart = startTime + loopIndex * loopLength;
    if (loopStart >= startTime + lengthSeconds + 0.0001) break;
    events.forEach((event) => {
      const velocity = clamp(event.velocity * velocityFactor, 0, 1);
      if (velocity <= 0) return;
      const eventTime = loopStart + event.time;
      trigger(eventTime, velocity, undefined, event.note, event.duration, pattern, characterId);
    });
  }
};

const schedulePattern = (
  pattern: Chunk,
  startTime: number,
  lengthSeconds: number,
  sixteenthSeconds: number,
  velocityScale: number,
  trigger: ScheduleTrigger,
  characterId?: string
) => {
  if (pattern.timingMode === "free" && pattern.noteEvents?.length) {
    scheduleFreePattern(pattern, startTime, lengthSeconds, velocityScale, trigger, characterId);
    return;
  }
  scheduleStepPattern(
    pattern,
    startTime,
    lengthSeconds,
    sixteenthSeconds,
    velocityScale,
    trigger,
    characterId
  );
};

const collectActiveTracks = (tracks: Track[]) =>
  tracks.filter((track) => track.pattern && track.instrument && !track.muted);

const computeTrackLoopDuration = (
  tracks: Track[],
  sixteenthSeconds: number
): number => {
  let maxDuration = 0;
  tracks.forEach((track) => {
    if (!track.pattern) return;
    const duration = computePatternLoopDuration(track.pattern, sixteenthSeconds);
    if (duration > maxDuration) {
      maxDuration = duration;
    }
  });
  return maxDuration;
};

const getCharacterForTrack = (track: Track): string | undefined =>
  track.source?.characterId ?? track.pattern?.characterId;

export interface AudioExportOptions {
  projectName: string;
  format: "wav" | "mp3";
  onProgress?: ProgressCallback;
  timestamp?: Date;
}

export const exportProjectAudio = async (
  project: StoredProjectData,
  options: AudioExportOptions
) => {
  const { format, projectName, onProgress, timestamp = new Date() } = options;
  const pack = packs[project.packIndex] ?? packs[0];
  if (!pack) {
    throw new Error("Unable to resolve sound pack for this project");
  }

  const bpm = project.bpm ?? 120;
  const secondsPerBeat = 60 / bpm;
  const sixteenthSeconds = secondsPerBeat / 4;
  const measureSeconds = secondsPerBeat * 4;

  const sectionCount = computeSectionCount(project.songRows);
  const hasArrangement = sectionCount > 0;
  const activeTracks = collectActiveTracks(project.tracks);
  const trackLoopDuration = computeTrackLoopDuration(activeTracks, sixteenthSeconds);

  let renderDuration = 0;
  if (hasArrangement) {
    renderDuration = sectionCount * measureSeconds;
  } else if (trackLoopDuration > 0) {
    renderDuration = trackLoopDuration;
  } else {
    renderDuration = measureSeconds;
  }

  const tailSeconds = 1.5;
  const offlineDuration = Math.max(renderDuration + tailSeconds, measureSeconds);

  onProgress?.({ progress: 0.1, message: "Preparing instruments" });

  const cache = new Map<string, InstrumentCacheEntry>();
  const triggers = createTriggerMap(pack, cache);
  const groupMap = new Map<string, PatternGroup>(
    project.patternGroups.map((group) => [group.id, group])
  );

  onProgress?.({ progress: 0.25, message: "Rendering arrangement" });

  const buffer = await Tone.Offline(async () => {
    Tone.Transport.cancel(0);
    Tone.Transport.bpm.value = bpm;

    const scheduleRowSection = (
      row: SongRow,
      group: PatternGroup,
      sectionStart: number
    ) => {
      const rowVelocity = clamp(row.velocity ?? 1, 0, 1);
      group.tracks.forEach((groupTrack) => {
        if (!groupTrack.pattern) return;
        if (!groupTrack.instrument) return;
        if (groupTrack.muted) return;
        const trigger = triggers[groupTrack.instrument];
        if (!trigger) return;
        const characterId =
          groupTrack.source?.characterId ?? groupTrack.pattern?.characterId;
        schedulePattern(
          groupTrack.pattern,
          sectionStart,
          measureSeconds,
          sixteenthSeconds,
          row.muted ? 0 : rowVelocity,
          trigger,
          characterId
        );
      });
    };

    if (hasArrangement) {
      for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
        const sectionStart = sectionIndex * measureSeconds;
        project.songRows.forEach((row) => {
          const groupId = row.slots[sectionIndex];
          if (!groupId) return;
          const group = groupMap.get(groupId);
          if (!group) return;
          scheduleRowSection(row, group, sectionStart);
        });
      }
    } else {
      activeTracks.forEach((track) => {
        if (!track.pattern) return;
        const trigger = triggers[track.instrument];
        if (!trigger) return;
        const characterId = getCharacterForTrack(track);
        schedulePattern(
          track.pattern,
          0,
          renderDuration,
          sixteenthSeconds,
          1,
          trigger,
          characterId
        );
      });
    }

    Tone.Transport.start(0);
  }, offlineDuration);

  onProgress?.({
    progress: 0.75,
    message: format === "mp3" ? "Encoding MP3" : "Encoding WAV",
  });

  cache.forEach((entry) => {
    entry.instrument.dispose();
    if (entry.keyboardFx) {
      entry.keyboardFx.reverb.dispose();
      entry.keyboardFx.delay.dispose();
      entry.keyboardFx.distortion.dispose();
      entry.keyboardFx.bitCrusher.dispose();
      entry.keyboardFx.panner.dispose();
      entry.keyboardFx.chorus.dispose();
      entry.keyboardFx.tremolo.dispose();
      entry.keyboardFx.filter.dispose();
    }
  });
  cache.clear();

  const filename = createExportFilename(projectName, format, timestamp);
  const blob =
    format === "mp3" ? audioBufferToMp3Blob(buffer) : audioBufferToWavBlob(buffer);

  downloadBlob(filename, blob);
  onProgress?.({ progress: 1, message: "Export complete" });
};
