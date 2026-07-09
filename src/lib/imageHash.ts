/**
 * P4 Judge — Image hashing for duplicate detection.
 * --------------------------------------------------
 *  • SHA-256 (cryptographic, exact byte match) via Web Crypto API.
 *  • pHash (perceptual, similar-image match) via 8×8 DCT-luminance algorithm.
 *
 * Both run in the browser BEFORE upload so we hash the user's original file,
 * not a re-encoded WebP. Output is two 64-char (sha256) and 16-char (phash)
 * lowercase hex strings stored at photo_meta[i].image_hash.
 *
 * No external deps — uses Web Crypto + 2D canvas.
 */

const PHASH_SIZE = 32; // sample the image at 32×32 then DCT-compress to 8×8

/* ────────────────────────────── SHA-256 ─────────────────────────── */
async function computeSha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ────────────────────────────── pHash ───────────────────────────── */
function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

/** Naive 1-D DCT — fine for a 32-element row/column. */
function dct1d(input: Float64Array): Float64Array {
  const N = input.length;
  const out = new Float64Array(N);
  const factor = Math.PI / N;
  for (let k = 0; k < N; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) {
      sum += input[n] * Math.cos((n + 0.5) * k * factor);
    }
    out[k] = sum;
  }
  return out;
}

async function computePerceptualHash(file: File): Promise<string | null> {
  let img: HTMLImageElement;
  try {
    img = await fileToImage(file);
  } catch {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = PHASH_SIZE;
  canvas.height = PHASH_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, PHASH_SIZE, PHASH_SIZE);
  const { data } = ctx.getImageData(0, 0, PHASH_SIZE, PHASH_SIZE);

  // Luminance (Rec. 709)
  const lum = new Float64Array(PHASH_SIZE * PHASH_SIZE);
  for (let i = 0; i < PHASH_SIZE * PHASH_SIZE; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // 2-D DCT: rows then columns.
  const rowDct = new Float64Array(PHASH_SIZE * PHASH_SIZE);
  for (let y = 0; y < PHASH_SIZE; y++) {
    const row = lum.subarray(y * PHASH_SIZE, (y + 1) * PHASH_SIZE);
    const out = dct1d(row);
    rowDct.set(out, y * PHASH_SIZE);
  }
  const dct = new Float64Array(PHASH_SIZE * PHASH_SIZE);
  const col = new Float64Array(PHASH_SIZE);
  for (let x = 0; x < PHASH_SIZE; x++) {
    for (let y = 0; y < PHASH_SIZE; y++) col[y] = rowDct[y * PHASH_SIZE + x];
    const out = dct1d(col);
    for (let y = 0; y < PHASH_SIZE; y++) dct[y * PHASH_SIZE + x] = out[y];
  }

  // Take the 8×8 low-frequency block (skip DC at [0][0] when computing median).
  const block: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) continue;
      block.push(dct[y * PHASH_SIZE + x]);
    }
  }
  const sorted = [...block].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Build 64-bit hash by comparing each 8×8 cell to median.
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const v = dct[y * PHASH_SIZE + x];
      bits += v > median ? "1" : "0";
    }
  }

  // Convert 64 bits → 16 hex chars.
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/* ────────────────────────────── public ──────────────────────────── */
export interface ImageHash {
  sha256: string;
  phash: string | null;
}

/**
 * Compute both hashes from a user-supplied File.
 * Failures degrade gracefully: sha256 should always succeed; phash may be null
 * if the browser can't decode the image (HEIC, corrupt, etc.).
 */
export async function computeImageHash(file: File): Promise<ImageHash> {
  const [sha256, phash] = await Promise.all([
    computeSha256(file),
    computePerceptualHash(file).catch(() => null),
  ]);
  return { sha256, phash };
}
