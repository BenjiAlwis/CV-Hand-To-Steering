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
  ok('the controls list starts rolled up', s.isPanel('collapsed', 'controls') === true);
  ok('and nothing else does', ['steering', 'rig', 'wheel', 'camera', 'foot', 'rim', 'pedalset']
    .every((id) => !s.isPanel('collapsed', id)));
  ok('the car readout starts hidden', s.isPanel('hidden', 'car') === true);
  ok('and every other panel starts shown', ['steering', 'rig', 'wheel', 'controls', 'camera', 'foot', 'rim', 'pedalset']
    .every((id) => !s.isPanel('hidden', id)));
  ok('only the car readout starts hidden', Object.entries(s.get('hidden')).filter(([, v]) => v).map(([k]) => k).join() === 'car');

  s.setPanel('hidden', 'car', false);
  ok('showing it is remembered', new Settings().isPanel('hidden', 'car') === false);
  store = { 'wheelhouse.settings': JSON.stringify({ hidden: { rig: true } }) };
  const older = new Settings();
  ok('a driver with older settings gets it hidden too, and keeps their own choices',
    older.isPanel('hidden', 'car') === true && older.isPanel('hidden', 'rig') === true);
  store = {};
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

  b.setPanel('collapsed', 'controls', false);
  ok('opening the controls list is remembered over its default', new Settings().isPanel('collapsed', 'controls') === false);

  store = { 'wheelhouse.settings': JSON.stringify({ flaps: false, collapsed: {} }) };
  ok('a driver with older stored settings gets it rolled up too', new Settings().isPanel('collapsed', 'controls') === true);
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

console.log('\ndriving aids');
{
  store = {};
  const a = new Settings();
  ok('the automatic gearbox starts off', a.get('autoGears') === false);
  ok('auto acceleration starts off', a.get('autoThrottle') === false);
  ok('auto braking starts off', a.get('autoBrake') === false);
  ok('remembering refused downshifts starts off', a.get('queueDown') === false);
  ok('traction control starts off', a.get('traction') === false);
  ok('ABS starts off', a.get('abs') === false);
  a.set('queueDown', true);
  a.set('traction', true);
  a.set('abs', true);
  a.set('autoGears', true);
  a.set('autoThrottle', true);
  a.set('autoBrake', true);
  a.set('flaps', false);
  ok('they can be switched on for this session', a.get('autoThrottle') === true);
  const b = new Settings();
  ok('but every launch starts with them off again',
    b.get('autoGears') === false && b.get('autoThrottle') === false && b.get('autoBrake') === false
    && b.get('queueDown') === false && b.get('traction') === false && b.get('abs') === false);
  ok('while ordinary settings are still remembered', b.get('flaps') === false);
}

console.log('\nthe gearbox');
{
  store = {};
  const a = new Settings();
  ok('starts standard', a.get('gearRatios') === null);
  a.set('gearRatios', [70, 110, 150, 190, 225, 260, 295, 335]);
  ok('a driver\'s own gearbox is remembered', new Settings().get('gearRatios')?.[0] === 70);
  a.set('gearRatios', null);
  ok('and reset goes back to standard', new Settings().get('gearRatios') === null);
  store = {};
}

console.log('\nthe dash');
{
  store = {};
  const { dashShown } = await import('../src/ui/dash.js');
  const s = new Settings();
  ok('starts on auto, at the bottom', s.get('dash') === 'auto' && s.get('dashPosition') === 'bottom');
  ok('on auto it shows for a wheel with no screen', dashShown('auto', { screen: null }) === true);
  ok('and stays away for one with a screen', dashShown('auto', { screen: { width: 0.09 } }) === false);
  ok('always shown overrides a wheel with a screen', dashShown('on', { screen: { width: 0.09 } }) === true);
  ok('never shown overrides a wheel without one', dashShown('off', { screen: null }) === false);
  s.set('dash', 'off');
  ok('a choice is remembered', new Settings().get('dash') === 'off');
  store = {};
}

console.log('\nthe wheel-fitted check');
{
  store = {};
  const a = new Settings();
  ok('starts on', a.get('rimGuard') === true);
  a.set('rimGuard', false);
  ok('can be turned off for this session', a.get('rimGuard') === false);
  ok('but is on again at the next launch', new Settings().get('rimGuard') === true);
  store = { 'wheelhouse.settings': JSON.stringify({ rimGuard: false }) };
  ok('even if an old record says off', new Settings().get('rimGuard') === true);
  store = {};
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
