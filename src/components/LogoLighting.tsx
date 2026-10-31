import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useSiteLogo } from "@/hooks/core/useSiteLogo";

interface LogoLightingProps {
  sizeClassName?: string;
  pulse?: boolean;
}

const LogoLighting = ({ sizeClassName = "h-40 w-40 md:h-56 md:w-56", pulse = true }: LogoLightingProps) => {
  const [isLogoReady, setIsLogoReady] = useState(false);
  const LOGO_SRC = useSiteLogo();

  useEffect(() => {
    setIsLogoReady(false);
    const logo = new Image();
    logo.src = LOGO_SRC;

    if (logo.complete) {
      setIsLogoReady(true);
      return;
    }

    const handleLoad = () => setIsLogoReady(true);
    logo.addEventListener("load", handleLoad, { once: true });

    return () => {
      logo.removeEventListener("load", handleLoad);
    };
  }, [LOGO_SRC]);

  return (
    <div className={`relative ${sizeClassName}`}>
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle, hsl(var(--primary) / 0.34) 0%, hsl(var(--primary) / 0.14) 42%, transparent 72%)",
        }}
        animate={
          pulse
            ? { opacity: [0.5, 1, 0.5], scale: [0.9, 1.1, 0.9] }
            : { opacity: [0.5, 1, 0.65], scale: [0.9, 1.06, 1] }
        }
        transition={{
          duration: pulse ? 1.4 : 1.2,
          ease: "easeInOut",
          repeat: pulse ? Infinity : 0,
        }}
      />

      <motion.img
        src={LOGO_SRC}
        alt="50mm Retina World"
        fetchPriority="high"
        loading="eager"
        decoding="async"
        className="relative h-full w-full object-contain"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{
          opacity: isLogoReady ? [0.75, 1, 0.85] : 0,
          scale: isLogoReady ? [1, 1.03, 1] : 0.9,
          filter: isLogoReady
            ? [
                "brightness(0.8) drop-shadow(0 0 8px hsl(var(--primary) / 0.35))",
                "brightness(1.25) drop-shadow(0 0 28px hsl(var(--primary) / 0.78))",
                "brightness(0.85) drop-shadow(0 0 10px hsl(var(--primary) / 0.4))",
              ]
            : "brightness(0.7)",
        }}
        transition={{
          duration: pulse ? 1.5 : 1.3,
          ease: "easeInOut",
          repeat: pulse ? Infinity : 0,
        }}
        style={{ willChange: "transform, opacity, filter" }}
      />
    </div>
  );
};

export default LogoLighting;
