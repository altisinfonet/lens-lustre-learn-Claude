/// <reference lib="webworker" />
// S5-b · sha256 of an upload's bytes, off the main thread. One message in
// ({ id, buf }), one out ({ id, hex } or { id, error }).
self.onmessage = async (e: MessageEvent<{ id: number; buf: ArrayBuffer }>) => {
  const { id, buf } = e.data;
  try {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
    let hex = "";
    for (const b of d) hex += b.toString(16).padStart(2, "0");
    (self as unknown as Worker).postMessage({ id, hex });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
