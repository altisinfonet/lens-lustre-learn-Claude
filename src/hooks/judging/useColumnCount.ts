import { useState, useEffect } from "react";

function computeColumns(): number {
  if (typeof window === "undefined") return 6;
  const w = window.innerWidth;
  if (w < 640) return 2;
  if (w < 768) return 3;
  if (w < 1024) return 4;
  if (w < 1280) return 5;
  if (w < 1536) return 6;
  return 8;
}

export function useColumnCount(): number {
  const [cols, setCols] = useState(computeColumns);

  useEffect(() => {
    const handler = () => setCols(computeColumns());
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return cols;
}
