/**
 * Which camera does which job.
 *
 * With two trackers running there has to be an answer to "and which lens is
 * that one?", and it has to survive a restart — being asked to re-pick your
 * cameras every launch would be worse than not having the feature.
 *
 * Note that `enumerateDevices` only returns real ids and labels once camera
 * permission is actually held. Without it every device comes back with an
 * empty `deviceId` and an empty `label`, which is indistinguishable from
 * having one nameless camera. `listCameras` says which of the two happened
 * rather than leaving the caller to guess.
 */
const STORE_KEY = 'wheelhouse.cameras';

/**
 * @returns {Promise<{cameras: Array<{deviceId:string,label:string}>, named: boolean}>}
 *   `named` is false when the browser is withholding identities, in which
 *   case the list cannot be used to tell one camera from another.
 */
export async function listCameras() {
  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return { cameras: [], named: false };
  }
  const cameras = devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `camera ${i + 1}` }));
  const named = cameras.every((c) => c.deviceId) && cameras.length > 0;
  return { cameras, named };
}

/** @returns {{hands: string|null, feet: string|null}} */
export function loadAssignment() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      return { hands: raw.hands ?? null, feet: raw.feet ?? null };
    }
  } catch { /* nothing stored, or storage is unavailable */ }
  return { hands: null, feet: null };
}

export function saveAssignment({ hands, feet }) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ hands: hands ?? null, feet: feet ?? null }));
  } catch { /* private window, or storage is full — the choice just will not stick */ }
}

/**
 * Settles on a camera for each job.
 *
 * A stored choice wins, but only if that camera is still attached — an id
 * that no longer exists would fail `deviceId: { exact: … }` and open nothing
 * at all. Otherwise hands take the first camera and feet the next one that is
 * free, which on a laptop with a phone alongside it is the built-in lens for
 * hands and the phone for feet.
 *
 * The two jobs are never given the same camera. One stream cannot be opened
 * twice with different constraints, and pointing both trackers at one lens
 * would mean neither sees what it is looking for.
 *
 * @param {Array<{deviceId:string}>} cameras
 * @param {{hands: string|null, feet: string|null}} saved
 */
export function resolveAssignment(cameras, saved = { hands: null, feet: null }) {
  const ids = cameras.map((c) => c.deviceId).filter(Boolean);
  const has = (id) => id && ids.includes(id);

  let hands = has(saved.hands) ? saved.hands : null;
  let feet = has(saved.feet) ? saved.feet : null;
  if (hands && feet && hands === feet) feet = null;

  if (!hands) hands = ids.find((id) => id !== feet) ?? null;
  if (!feet) feet = ids.find((id) => id !== hands) ?? null;

  return { hands, feet };
}
