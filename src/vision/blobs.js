/**
 * Turning a mask into boxes.
 *
 * Pure array work — no camera, no model, no browser — so it can be tested
 * directly, which matters because this is the part that decides what counts
 * as a foot and what counts as a speck of noise.
 */

/**
 * Removes specks and fills pin-holes, by eroding then dilating.
 *
 * A segmentation mask is never clean at its edges: single pixels flicker on
 * and off along a boundary, and a blob cut in half by one bad row would be
 * reported as two feet. One pass of each costs little and settles both.
 *
 * @param {Uint8Array} mask 0 or 1 per pixel
 * @returns {Uint8Array} a new mask
 */
export function openMask(mask, width, height, radius = 1) {
  return dilate(erode(mask, width, height, radius), width, height, radius);
}

function erode(mask, width, height, r) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let keep = 1;
      for (let dy = -r; dy <= r && keep; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          // Outside the frame counts as set, so a foot running off the edge is
          // not eaten away along the edge it runs off.
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (!mask[ny * width + nx]) { keep = 0; break; }
        }
      }
      out[y * width + x] = keep;
    }
  }
  return out;
}

function dilate(mask, width, height, r) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          out[ny * width + nx] = 1;
        }
      }
    }
  }
  return out;
}

/**
 * Finds the connected regions of a mask and measures each one.
 *
 * Eight-connected rather than four: a foot photographed at an angle has parts
 * that meet only at a corner — a toe against the ball of the foot — and
 * four-connectivity reports those as separate feet.
 *
 * Boxes come back in normalised coordinates so nothing downstream has to know
 * what resolution the mask was, and each one says whether it runs off the edge
 * of the frame, which is the difference between "this is all of the foot" and
 * "this is as much of it as we can see".
 *
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @param {{minArea?: number}} [options] minArea as a fraction of the frame
 */
export function findBlobs(mask, width, height, { minArea = 0 } = {}) {
  const seen = new Uint8Array(mask.length);
  const total = width * height;
  const minPixels = Math.max(1, Math.floor(minArea * total));
  const blobs = [];
  const stack = new Int32Array(total);

  for (let start = 0; start < total; start++) {
    if (!mask[start] || seen[start]) continue;

    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let area = 0, minX = width, maxX = -1, minY = height, maxY = -1;
    let sumX = 0, sumY = 0;

    while (top > 0) {
      const p = stack[--top];
      const x = p % width, y = (p / width) | 0;
      area++;
      sumX += x; sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (mask[q] && !seen[q]) { seen[q] = 1; stack[top++] = q; }
        }
      }
    }

    if (area < minPixels) continue;
    blobs.push({
      area: area / total,
      pixels: area,
      x0: minX / width, y0: minY / height,
      x1: (maxX + 1) / width, y1: (maxY + 1) / height,
      cx: sumX / area / width, cy: sumY / area / height,
      clipped: {
        left: minX === 0, right: maxX === width - 1,
        top: minY === 0, bottom: maxY === height - 1,
      },
    });
  }

  return blobs.sort((a, b) => b.area - a.area);
}

/** Whether a box runs off any edge — so it is part of a foot, not all of one. */
export const isClipped = (b) =>
  !!(b.clipped.left || b.clipped.right || b.clipped.top || b.clipped.bottom);
