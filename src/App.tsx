import { useState } from "react";
import * as Tone from "tone";

function App() {
  const [started, setStarted] = useState(false);

  const startAudio = async () => {
    await Tone.start();
    setStarted(true);

    Tone.Transport.bpm.value = 120;

    const synth = new Tone.MembraneSynth().toDestination();

    Tone.Transport.scheduleRepeat((time) => {
      synth.triggerAttackRelease("C2", "8n", time);
    }, "4n");

    Tone.Transport.start();
  };

  return (
    <div style={{ textAlign: "center", marginTop: "50px" }}>
      {!started ? (
        <button onClick={startAudio}>Start Jam</button>
      ) : (
        <p>Kick is playing every beat 🎵</p>
      )}
    </div>
  );
}

export default App;