import { useEffect } from "react";
import { EffectComposer } from "@react-three/postprocessing";
import { HalfFloatType, UnsignedByteType } from "three";
import { isIOS26 } from "../utils/isIOS26";

export function SceneEffects({ children }) {
  const ios26 = isIOS26();

  useEffect(() => {
    console[ios26 ? "warn" : "log"](
      ios26
        ? "⚠️  iOS 26 / A18 detected — disabling MSAA in composer to prevent Safari 26 artifact."
        : "✅  Full 8× MSAA composer enabled."
    );
  }, [ios26]);

  return (
    <EffectComposer
      multisampling={ios26 ? 0 : 8}
      frameBufferType={ios26 ? UnsignedByteType : HalfFloatType}
    >
      {children}
    </EffectComposer>
  );
}
