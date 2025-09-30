import * as Tone from "tone";

export async function unlockAudio(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const context = Tone.getContext();
  const rawContext = context.rawContext as AudioContext | undefined;

  try {
    let state = context.state as string;

    if (state === "running") {
      return;
    }

    try {
      await Tone.start();
    } catch (error) {
      console.warn("Tone.js failed to start during unlock:", error);
    }

    state = context.state as string;

    if (state === "interrupted" && rawContext) {
      console.warn("Audio context is 'interrupted', trying low-level resume");
      try {
        await rawContext.resume();
      } catch (resumeError) {
        console.error("Direct resume failed:", resumeError);
      }
      state = context.state as string;
    }

    const rawState = rawContext?.state as string | undefined;

    if (state !== "running" && rawState !== "running" && rawContext) {
      console.warn("Audio context still not running, playing silent buffer");
      try {
        const buffer = rawContext.createBuffer(1, 1, rawContext.sampleRate);
        const source = rawContext.createBufferSource();
        source.buffer = buffer;
        source.connect(rawContext.destination);
        source.start();
        source.onended = () => {
          source.disconnect();
        };
      } catch (bufferError) {
        console.error("Silent buffer trick failed:", bufferError);
      }
    }
  } catch (error) {
    console.error("unlockAudio error:", error);
  }
}
