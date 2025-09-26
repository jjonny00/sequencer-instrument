import type { KickLayerSpec } from "../packs";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

type ToneLike = typeof import("tone");

type ToneUnitFrequency = import("tone").Unit.Frequency;
type ToneUnitTime = import("tone").Unit.Time;

type LayerTrigger = (
  note: ToneUnitFrequency | undefined,
  duration: ToneUnitTime | undefined,
  time: ToneUnitTime | undefined,
  velocity: number
) => void;

interface LayerInstance {
  trigger: LayerTrigger;
  dispose: () => void;
}

const MASTER_ENVELOPE_SETTINGS = {
  attack: 0.005,
  decay: 0.3,
  sustain: 0.01,
  release: 0.05,
} as const;

const resolveNote = (
  tone: ToneLike,
  base: ToneUnitFrequency | undefined,
  transpose: number | undefined
) => {
  const note = base ?? "C2";
  if (transpose === undefined || transpose === 0) {
    return note;
  }
  try {
    return tone.Frequency(note).transpose(transpose).toNote();
  } catch (error) {
    console.warn("Failed to transpose kick layer note", { note, transpose, error });
    return note;
  }
};

const toSeconds = (tone: ToneLike, time: ToneUnitTime | undefined) => {
  if (time === undefined) {
    return tone.Transport.seconds;
  }
  if (typeof time === "number") {
    return time;
  }
  try {
    return tone.Time(time).toSeconds();
  } catch (error) {
    console.warn("Invalid kick trigger time", { time, error });
    return tone.Transport.seconds;
  }
};

export type LayeredKickInstrument = import("tone").Gain & {
  triggerAttackRelease: (
    note?: ToneUnitFrequency,
    duration?: ToneUnitTime,
    time?: ToneUnitTime,
    velocity?: number
  ) => void;
};

export const createLayeredKick = (
  tone: ToneLike,
  layers: KickLayerSpec[]
): LayeredKickInstrument => {
  const output = new tone.Gain(0) as LayeredKickInstrument;
  output.gain.value = 0;

  const masterEnvelope = new tone.Envelope(MASTER_ENVELOPE_SETTINGS);
  const masterReleaseSeconds = MASTER_ENVELOPE_SETTINGS.release;
  masterEnvelope.connect(output.gain);
  const validLayers = layers.filter(
    (layer): layer is KickLayerSpec & { type: string } =>
      typeof layer?.type === "string"
  );
  if (validLayers.length === 0) {
    return output;
  }

  const normalizationDb = tone.gainToDb(1 / validLayers.length);
  const layerInstances: LayerInstance[] = [];

  validLayers.forEach((layer) => {
    const layerGain = new tone.Gain(1);
    const layerDb = (layer.volume ?? 0) + normalizationDb;
    const normalizedGain = tone.dbToGain(layerDb);
    const baseGain = Number.isFinite(normalizedGain) ? normalizedGain : 1;
    layerGain.gain.value = baseGain * (layer.velocity ?? 1);
    layerGain.connect(output);

    const durationOverride = layer.duration as ToneUnitTime | undefined;
    const transpose = layer.transpose ?? 0;
    const defaultDurationSeconds = tone.Time("8n").toSeconds();
    const toSecondsWithFallback = (
      value: ToneUnitTime | undefined,
      fallback: number
    ) => {
      if (value === undefined) {
        return fallback;
      }
      if (typeof value === "number") {
        return value;
      }
      try {
        return tone.Time(value).toSeconds();
      } catch (error) {
        console.warn("Invalid kick duration", { value, error });
        return fallback;
      }
    };

    if (layer.type === "Oscillator") {
      const oscillator = new tone.Oscillator(layer.options ?? {});
      oscillator.connect(layerGain);
      layerInstances.push({
        trigger: (note, duration, time, velocity) => {
          const when = time ?? tone.Transport.seconds;
          const whenSeconds = toSeconds(tone, when);
          const resolvedFrequency = tone
            .Frequency(resolveNote(tone, layer.note ?? note, transpose))
            .toFrequency();
          void velocity;
          oscillator.frequency.setValueAtTime(resolvedFrequency, whenSeconds);
          const requestedDuration = durationOverride ?? duration ?? "8n";
          const durationSeconds = toSecondsWithFallback(
            requestedDuration,
            defaultDurationSeconds
          );
          oscillator.start(whenSeconds);
          const stopTime = whenSeconds + durationSeconds + masterReleaseSeconds;
          oscillator.stop(stopTime);
        },
        dispose: () => {
          oscillator.dispose();
          layerGain.dispose();
        },
      });
      return;
    }

    const ctor = (
      tone as unknown as Record<string, new (opts?: Record<string, unknown>) => unknown>
    )[layer.type];

    if (!ctor) {
      console.warn("Unknown kick layer type", layer.type);
      layerGain.dispose();
      return;
    }

    const instance = new ctor(layer.options ?? {});

    if (
      instance &&
      typeof (instance as { connect?: (node: unknown) => void }).connect === "function"
    ) {
      (instance as { connect: (node: unknown) => void }).connect(layerGain);
    }

    const disposeInstance = () => {
      if (typeof (instance as { dispose?: () => void }).dispose === "function") {
        (instance as { dispose: () => void }).dispose();
      }
      layerGain.dispose();
    };

    if (instance instanceof tone.Player) {
      instance.set({
        fadeIn: 0,
        fadeOut: 0,
      });
    }

    layerInstances.push({
      trigger: (note, duration, time, velocity) => {
        const when = time ?? tone.Transport.seconds;
        const whenSeconds = toSeconds(tone, when);
        const targetDuration = durationOverride ?? duration ?? "8n";
        const durationSeconds = toSecondsWithFallback(
          targetDuration,
          defaultDurationSeconds
        );

        if (instance instanceof tone.Player) {
          instance.start(
            whenSeconds,
            layer.startOffset ?? 0,
            durationSeconds
          );
          return;
        }

        const resolvedNote = resolveNote(
          tone,
          layer.note ?? note,
          transpose
        );

        if (
          (instance as {
            triggerAttackRelease?: (
              note?: ToneUnitFrequency,
              duration?: ToneUnitTime,
              time?: ToneUnitTime,
              velocity?: number
            ) => void;
          }).triggerAttackRelease
        ) {
          (
            instance as {
              triggerAttackRelease: (
                note?: ToneUnitFrequency,
                duration?: ToneUnitTime,
                time?: ToneUnitTime,
                velocity?: number
              ) => void;
            }
          ).triggerAttackRelease(
            resolvedNote,
            targetDuration,
            whenSeconds,
            clamp(velocity, 0, 1)
          );
          return;
        }

        if (
          typeof (instance as { start?: (time?: ToneUnitTime) => void }).start ===
          "function"
        ) {
          (instance as { start: (time?: ToneUnitTime) => void }).start(whenSeconds);
          if (
            typeof (instance as { stop?: (time?: ToneUnitTime) => void }).stop ===
            "function"
          ) {
            const stopTime = whenSeconds + durationSeconds + masterReleaseSeconds;
            (instance as { stop: (time?: ToneUnitTime) => void }).stop(stopTime);
          }
        }
      },
      dispose: disposeInstance,
    });
  });

  output.triggerAttackRelease = (
    note = "C2",
    duration: ToneUnitTime = "8n",
    time?: ToneUnitTime,
    velocity = 1
  ) => {
    const when = time ?? tone.Transport.seconds;
    const clampedVelocity = clamp(velocity, 0, 1);
    const durationSeconds = (() => {
      if (typeof duration === "number") {
        return duration;
      }
      try {
        return tone.Time(duration).toSeconds();
      } catch (error) {
        console.warn("Invalid layered kick duration", { duration, error });
        return tone.Time("8n").toSeconds();
      }
    })();
    const whenSeconds = toSeconds(tone, when);
    masterEnvelope.triggerAttackRelease(
      durationSeconds,
      whenSeconds,
      clampedVelocity
    );
    layerInstances.forEach((layer) =>
      layer.trigger(note, duration, when, clampedVelocity)
    );
  };

  const originalDispose = output.dispose.bind(output);
  output.dispose = () => {
    layerInstances.splice(0, layerInstances.length).forEach((layer) =>
      layer.dispose()
    );
    masterEnvelope.dispose();
    return originalDispose();
  };

  return output;
};
