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

const resolveLayerDuration = (
  tone: ToneLike,
  requested: ToneUnitTime | undefined,
  fallback: ToneUnitTime
) => {
  if (requested === undefined) return fallback;
  if (typeof requested === "number") return requested;
  try {
    return tone.Time(requested).toSeconds();
  } catch (error) {
    console.warn("Invalid kick layer duration", { requested, error });
    return fallback;
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
  const output = new tone.Gain(1) as LayeredKickInstrument;
  const validLayers = layers.filter((layer) => Boolean(layer?.type));
  if (validLayers.length === 0) {
    return output;
  }

  const normalizationDb = tone.gainToDb(1 / validLayers.length);
  const layerInstances: LayerInstance[] = [];

  validLayers.forEach((layer) => {
    const layerGain = new tone.Gain(1);
    const layerDb = (layer.volume ?? 0) + normalizationDb;
    const normalizedGain = tone.dbToGain(layerDb);
    layerGain.gain.value = Number.isFinite(normalizedGain) ? normalizedGain : 1;
    layerGain.connect(output);

    const velocityScale = layer.velocity ?? 1;
    const durationOverride = layer.duration as ToneUnitTime | undefined;
    const transpose = layer.transpose ?? 0;

    if (layer.type === "Oscillator") {
      const oscillator = new tone.Oscillator(layer.options ?? {});
      const envelope = new tone.AmplitudeEnvelope({
        attack: layer.envelope?.attack ?? 0.005,
        decay: layer.envelope?.decay ?? 0.1,
        sustain: layer.envelope?.sustain ?? 0,
        release: layer.envelope?.release ?? 0.05,
      });
      oscillator.connect(envelope);
      envelope.connect(layerGain);
      oscillator.start();
      layerInstances.push({
        trigger: (note, duration, time, velocity) => {
          const when = time ?? tone.Transport.seconds;
          const whenSeconds = toSeconds(tone, when);
          const resolvedFrequency = tone
            .Frequency(resolveNote(tone, layer.note ?? note, transpose))
            .toFrequency();
          oscillator.frequency.setValueAtTime(resolvedFrequency, whenSeconds);
          const targetDuration = resolveLayerDuration(
            tone,
            durationOverride ?? duration,
            typeof duration === "number" ? duration : tone.Time("8n").toSeconds()
          );
          const velocityValue = clamp(velocity * velocityScale, 0, 1);
          envelope.triggerAttackRelease(targetDuration, when, velocityValue);
        },
        dispose: () => {
          oscillator.dispose();
          envelope.dispose();
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

    const settable = instance as { set?: (values: Record<string, unknown>) => void };

    if (
      typeof tone.MembraneSynth !== "undefined" &&
      instance instanceof tone.MembraneSynth
    ) {
      const current = instance.get();
      const envelope = (current as { envelope?: Record<string, number> }).envelope ?? {};
      instance.set?.({
        envelope: {
          ...envelope,
          attack: 0.005,
          release: Math.max(0.05, envelope.release ?? 0.05),
        },
      });
    }

    if (instance instanceof tone.Player) {
      instance.set({
        fadeIn: layer.fadeIn ?? 0.005,
        fadeOut: layer.fadeOut ?? 0.01,
      });
    }

    layerInstances.push({
      trigger: (note, duration, time, velocity) => {
        const when = time ?? tone.Transport.seconds;
        const targetDuration = durationOverride ?? duration ?? "8n";
        const velocityValue = clamp(velocity * velocityScale, 0, 1);

        if (instance instanceof tone.Player) {
          instance.start(when, layer.startOffset ?? 0, targetDuration, velocityValue);
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
          ).triggerAttackRelease(resolvedNote, targetDuration, when, velocityValue);
          return;
        }

        if (
          typeof (instance as { start?: (time?: ToneUnitTime) => void }).start ===
          "function"
        ) {
          (instance as { start: (time?: ToneUnitTime) => void }).start(when);
          if (
            typeof (instance as { stop?: (time?: ToneUnitTime) => void }).stop ===
            "function"
          ) {
            const stopTime = tone.Time(when).add(targetDuration).toSeconds();
            (instance as { stop: (time?: ToneUnitTime) => void }).stop(stopTime);
          }
        }
      },
      dispose: disposeInstance,
    });

    if (settable.set && layer.envelope) {
      settable.set({ envelope: layer.envelope });
    }
  });

  output.triggerAttackRelease = (
    note = "C2",
    duration: ToneUnitTime = "8n",
    time?: ToneUnitTime,
    velocity = 1
  ) => {
    const when = time ?? tone.Transport.seconds;
    const clampedVelocity = clamp(velocity, 0, 1);
    layerInstances.forEach((layer) =>
      layer.trigger(note, duration, when, clampedVelocity)
    );
  };

  const originalDispose = output.dispose.bind(output);
  output.dispose = () => {
    layerInstances.splice(0, layerInstances.length).forEach((layer) =>
      layer.dispose()
    );
    return originalDispose();
  };

  return output;
};
