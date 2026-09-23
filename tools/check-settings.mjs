/**
 * Tests for the settings store.
 *
 *   node tools/check-settings.mjs
 *
 * Stubs localStorage rather than needing a browser, which also lets the
 * storage-unavailable case be checked — a real one, since a private window
 * throws on write and the rig still has to run.
 */
let store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const { Settings, DEFAULTS } = await import('../src/ui/settings.js');

let failures = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('\ndefaults');
{
  store = {};
  const s = new Settings();
  ok('gear flaps start on', s.get('flaps') === true);
  ok('pedals start on', s.get('pedals') === true);
  ok('no panel starts rolled up', Object.keys(s.get('collapsed')).length === 0);
  ok('no panel starts hidden', Object.keys(s.get('hidden')).length === 0);
}

console.log('\nremembering');
{
  store = {};
  const a = new Settings();
  a.set('flaps', false);
  a.setPanel('collapsed', 'camera', true);
  a.setPanel('hidden', 'rig', true);

  const b = new Settings();
  ok('a switched-off setting survives a restart', b.get('flaps') === false);
  ok('and one left alone keeps its default', b.get('pedals') === true);
  ok('a rolled-up panel is remembered', b.isPanel('collapsed', 'camera') === true);
  ok('a hidden panel is remembered', b.isPanel('hidden', 'rig') === true);
  ok('panels not touched are neither', !b.isPanel('collapsed', 'rig') && !b.isPanel('hidden', 'camera'));

  b.setPanel('collapsed', 'camera', false);
  ok('rolling a panel back down forgets it', new Settings().isPanel('collapsed', 'camera') === false);
}

console.log('\nchange notifications');
{
  store = {};
  const s = new Settings();
  const seen = [];
  const off = s.onChange((k, v) => seen.push([k, v]));

  s.set('pedals', false);
  ok('switching something fires once', seen.length === 1 && seen[0][0] === 'pedals' && seen[0][1] === false);

  s.set('pedals', false);
  ok('setting it to what it already is fires nothing', seen.length === 1,
    `${seen.length} notifications`);

  s.setPanel('collapsed', 'foot', true);
  ok('rolling a panel up fires too', seen.length === 2 && seen[1][0] === 'collapsed');

  off();
  s.set('flaps', false);
  ok('a removed listener stops hearing', seen.length === 2);
}

console.log('\nwhen storage will not have it');
{
  store = {};
  const real = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  const s = new Settings();
  let threw = false;
  try { s.set('flaps', false); } catch { threw = true; }
  ok('a failed save does not take the rig down', threw === false);
  ok('and the setting still applies for this session', s.get('flaps') === false);
  globalThis.localStorage.setItem = real;
}

console.log('\nrubbish in storage');
{
  store = { 'wheelhouse.settings': '{ not json' };
  ok('unparseable settings fall back to the defaults', new Settings().get('flaps') === DEFAULTS.flaps);
  store = { 'wheelhouse.settings': '{"flaps":false}' };
  const s = new Settings();
  ok('a partial record keeps its own value', s.get('flaps') === false);
  ok('and fills the rest in', s.get('pedals') === true && typeof s.get('collapsed') === 'object');
}

console.log(failures === 0 ? '\nall settings checks passed\n' : `\n${failures} settings check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
