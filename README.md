# Wheelhouse

A camera-driven steering controller. Hold your hands up as if you were gripping
a wheel, close your fists, and turn — a Formula-spec steering wheel turns with
you in a 3D scene. Open your hands and you let go; the wheel self-centres.

```bash
npm install         # once — fetches Electron, Three.js and MediaPipe
npm start           # opens the rig in its own window
```

`npm start` runs Wheelhouse as a desktop app: its own window, no browser
chrome, and a menu bar: **Camera** framing (⌘1–⌘4), **Wheel** (⌘⇧1–3),
**Vision** (⌘K camera, ⌘E re-zero) and **Rig** (⌘0 recentre, ⌘/ overlay).
Close the window or press ctrl-c in the terminal to quit.

If you would rather use a browser: `npm run web` serves it and opens a tab,
`npm run serve` serves without opening anything. Either way the page must go
over HTTP — ES modules and the import map will not load from `file://` — and if
5173 is taken the server steps to the next free port and says so.

Nothing is built. Every texture is generated at load — the only binary asset is
the 7.5 MB hand-landmark model in `assets/models/`. Three.js and MediaPipe are
served from `node_modules` through an import map rather than a CDN, so the app
starts with no network at all, which is why `npm install` is the one
prerequisite. Launching it a second time raises the window that is already open instead of
starting another, and closing the window quits the app completely — including
on macOS, where the usual convention is to stay resident. A windowless instance
would keep the single-instance lock and the port, so the next `npm start` would
be refused and exit without showing anything, which looks exactly like the app
failing to launch.

> **Launching from VS Code's terminal.** VS Code exports
> `ELECTRON_RUN_AS_NODE=1`, which makes any Electron binary run as plain Node,
> so a bare `electron .` fails with *"does not provide an export named
> BrowserWindow"*. `npm start` goes through `tools/launch.mjs`, which clears it.

## Controls

**Driving it with your hands.** The camera starts on its own a moment after the
window opens — allow access the first time and macOS will remember. Hold both
hands up about shoulder width apart, as if on a wheel, and **close both fists**
to take hold. <kbd>V</kbd> stops and starts the camera if you want it off. Rotate your arms the way you would a real
wheel. **Open either hand** to let go.

**Gear flaps.** With the wheel held, straighten the **index finger** of one
hand and curl it back: right hand shifts up, left shifts down, as the car is
laid out. The paddle on the wheel pulls to match. <kbd>Q</kbd> and <kbd>E</kbd>
do the same from the keyboard.

Reading one finger rather than the whole hand is the point of it. The grip
score averages all four fingers, so a single extended one barely moves it and
the wheel stays firmly held through the change — letting go of the wheel every
time you shift would be useless. Pulling a paddle on the real thing is a finger
movement inside a closed fist, and this is the same gesture.

**The wheel matches your hands.** The line between your knuckles is measured
against horizontal and that *is* the wheel's angle — hands level centres it,
hands at 40° put it at 40°. Let go, move, take hold again at any angle and the
wheel is there on the first frame it sees you. If you naturally rest your hands
a few degrees off level, <kbd>Z</kbd> takes your current pose as level and that
offset sticks.

The panel shows what the tracker sees: the landmarks it found, a line between
your palms (that line's angle *is* the steering), and how closed each hand is.
If a grip will not engage, that panel tells you why.

| | |
|---|---|
| drag | turn the wheel (swing around its centre) |
| `A` / `D`, `←` / `→` | steer left / right |
| `V` | camera on / off |
| `Z` | re-zero your hands |
| `T` | change wheel (Ferrari → Mercedes → Red Bull) |
| `C` | free orbit camera |
| `1` `2` `3` | driver / three-quarter / detail framing |
| `R` | recentre |
| `H` | hide the overlay |

`window.app`, `window.wheel`, `window.controller` and `window.sim` are exposed
for poking at from the console.

## The three wheels

Press <kbd>T</kbd> to cycle, or use the **Wheel** menu (⌘⇧1–3). Each is a
separate spec in `src/wheel/teams.js` — silhouette, switchgear and livery all
change together.

| | Ferrari | Mercedes | Red Bull |
|---|---|---|---|
| silhouette | an elongated rectangle: widest on the grid, flat top, square corners | rectangle with a **fold** in the top edge, one of the longest | the **Space Invader**: a stepped shoulder cutting in below a narrower top |
| width | 292 mm | 286 mm | 279 mm |
| fascia buttons | 12 | 12 | **6** |
| rotaries | 6, and all of them low | 3, with sub-menus | 4 |
| paddles | large blades set low, twin clutch | **single wishbone clutch** on the centreline | two extra **flaps** for DRS and overtake |
| livery | yellow, and plenty of it | Petronas green, bottom right only | navy with red and yellow |

None of that is invented. Ferrari runs the most switchgear on the grid and,
unlike Mercedes, does not fold it into menus — six selectors, all low, with the
entry and mid-corner differential pair under the thumbs. Mercedes consolidates
into three rotaries with sub-menus and keeps a wishbone clutch paddle with a
finger socket moulded into it. Red Bull deletes buttons for weight and to cut
the risk of hitting the wrong one, and famously has no DRS button at all: DRS
is a flap behind the wheel, next to the shifters.

## What the wheels are modelled on

Current Formula 1 wheels, not road wheels. The differences drive most of the
design decisions:

- **265–287 mm across**, roughly half a road car's — a sculpted shell with two
  moulded grips, not a continuous rim.
- **The shell is one hollow carbon moulding that forms the grips too.** Silicone
  is injected between the shell and a mould taken from the driver's hands, so
  the grip grows out of the fascia rather than being bolted to it. Nothing here
  is a rounded rectangle: the outline has narrow legs, a knee where each leg
  widens into the body, a gentle flank taper, broad shoulders carrying the
  rev-light bar, and an arched top edge.
- **About ±135° of lock**, i.e. three-quarters of a turn in total. A road car
  gives you ±450°. This is why the wheel never spins in your hands, and why
  `SPEC.lockDegrees` is the single number that maps hand angle to steering.
- **Carbon fibre, aluminium, titanium and moulded rubber**, about 1.3 kg.
- **Rev LEDs along the top edge** running green → red → blue, with marshalling
  flag LEDs at each end, all under one smoked lens.
- **A 4.3" colour LCD** centred. Teams run up to fourteen fascia buttons and as
  many as nine rotaries at sixteen positions each, only about three of them on
  the fascia — the rest sit in the spokes or under the thumbs.
- **Four paddles behind** — left downshift, right upshift, plus a clutch pair —
  and a quick-release hub.

## Layout

```
desktop/
  main.js                 Electron shell: window, menu, embedded server
src/
  main.js                 bootstrap, frame loop, the stage-2 seam
  core/app.js             renderer, camera presets, post-processing
  scene/environment.js    the bay: cove, floor, lighting rig, bench stand, IBL
  textures/procedural.js  carbon twill, Alcantara, brushed metal, knurl, concrete
  wheel/
    teams.js              ← the three wheel specs: shape, switchgear, livery
    spec.js               resolves a team into derived geometry
    shell.js              the sculpted silhouette (no Three.js — Node can sample it)
    geometry.js           extrusion, lathe profiles, plates
    faceplate.js          silkscreen: pockets, detent scales, legends, livery
    caps.js               anodised switch-cap colours
    materials.js          the PBR material library
    steeringwheel.js      assembly
    display.js            the LCD
    revlights.js          the rev-light bar
  vision/
    handmath.js           grip, steering angle, hysteresis (pure — no MediaPipe)
    handtracker.js        MediaPipe HandLandmarker + camera plumbing
  input/
    source.js             the interface every input implements
    shifter.js            gear flaps — finger-pull detection
    controller.js         arbitration, smoothing, the self-centring spring
    handsource.js         camera steering — priority 20
    pointer.js            mouse / touch — priority 10
    keyboard.js           A / D — priority 5
  sim/carsim.js           enough vehicle model to make the instruments honest
  ui/hud.js               the overlay
tools/
  launch.mjs            `npm start` — opens the desktop window
  serve.mjs             static server, used by the shell and by `npm run web`
  check-layout.mjs      spec-only collision check for the faceplate
  check-handmath.mjs    hand geometry tests, no camera needed
  check-steering.mjs    steering-source tests against a stub tracker
```

`wheel/teams.js` is the one file worth knowing. Every control's position, size,
colour and legend lives there, and both the 3D switchgear and the printed
artwork are generated from it — so a label can never drift away from its
button. `wheel/shell.js` turns a team's profile into an outline by threading a
centripetal Catmull-Rom spline through named stations (leg tip, knee, flank,
shoulder, top corner), which is why tuning a shape means moving a point rather
than balancing Bézier handles.

Every fascia is packed tight, and now that the outline is a spline rather than a
rectangle, "is this control still on the carbon?" is not a question you can
answer by eye. Check it after any change:

```bash
node tools/check-layout.mjs
```

It samples the real outline and tests, for all three wheels, that no control or
legend ends up off the carbon, behind a grip, over the bottom cut-out, under the
rev-light bar, printed on the display, or on top of a neighbour. It runs in
plain Node with no renderer, and it caught every placement bug in these three
layouts — including grips whose outer edge ran off the leg, which is invisible
in a plan view and obvious the moment you render it.

## How the hand tracking works

MediaPipe's HandLandmarker gives 21 points per hand at about 30 Hz. What turns
those into a wheel angle lives in `vision/handmath.js`, and every piece of it
exists because the naive version measurably failed:

- **Grip** — mean fingertip-to-wrist distance, divided by the hand's own
  knuckle span so it does not change as you move nearer the camera. An open
  hand reads about 2.0 hand-sizes, a fist about 1.15. The thumb is ignored: it
  stays out on a wheel grip even when the fingers are fully wrapped.
- **Anchor** — the centroid of the four MCP knuckles, *not* the palm. The wrist
  travels several millimetres as the fingers close, so any anchor including it
  moves when you make a fist, and the act of gripping registers as a turn you
  never made.
- **Pairing** — each detection is kept in the same slot from frame to frame,
  by handedness where the detector offers it and by proximity otherwise.
  Sorting the two hands by screen position is the obvious approach and it
  breaks: past about a quarter turn the hands pass through vertical and swap
  sides, the vector between them flips, and the steering angle jumps by half a
  turn — exactly where you are asking for full lock.
- **Orientation** — which way *up* that pair reads comes from the hands, not
  from a left/right label. Grip a wheel with your thumb on top and your index
  knuckle sits above your little finger's, for either hand, so the knuckle
  line points at the top of the wheel — and keeps pointing there however far
  you turn, because it turns with you. A label cannot settle this: MediaPipe
  derives handedness assuming a mirrored frame, and this feeds it a raw one,
  so relying on that convention was a single wrong assumption away from
  inverting the steering. Reading the thumbs gives the same answer whether the
  labels are right, swapped, or missing entirely — verified for all three.
  Hands rolled thumbs-under are a genuinely different pose and read as
  inverted, rather than being quietly corrected to upright.
- **Unwrapping** — `atan2` only reports −π…π, so the measurement is
  accumulated as a continuous signal rather than read absolutely. Without it
  the wheel snaps at the seam.
- **Smoothing** — a One-Euro filter, whose cutoff opens up in proportion to how
  fast the signal is moving. A fixed smoothing factor has to choose between
  jitter and lag; this one filters a still hand hard and a moving one barely.
- **Hysteresis** — grip engages at 0.55 and releases at 0.32 over two
  consecutive frames. A single threshold chatters.
- **Rate limiting** — a change faster than 35 rad/s is a pairing flip, not an
  arm, so the frame is dropped rather than jerking the wheel. Set anywhere near
  human speed this backfires: a 12 rad/s limit began discarding frames at
  688°/s, which a hard correction reaches, and the wheel simply stopped
  following.
- **Re-anchoring** — any break in the run of good measurements longer than
  200 ms throws the accumulated angle away and re-reads it from horizontal.
  The unwrapped angle is only trustworthy while it is being fed every frame;
  carried across a gap it describes a position the hands have left. This is
  what made the wheel stick at a wrong angle after the detector stalled,
  unrecoverable however much you moved.
- **Velocity feed-forward** — the source reports how fast it is turning and the
  controller aims that far ahead of the target. A spring trails a moving target
  by velocity × damping / stiffness, about 90 ms here, and cancelling it
  directly beats stiffening the wheel until it feels weightless.
- **Flick detection** — a gear flap fires once when a finger straightens and
  not again until it has curled back, with a short refractory period after
  each. One threshold would machine-gun shifts from a finger held near the
  boundary, and without the pause the knuckles moving as the finger extends
  can look like a second pull.
- **Coasting** — when the hands vanish the wheel is held for 700 ms before the
  grip is given up, with confidence bleeding away across that window, so a
  single dropped frame does not make it twitch.

**The mapping is absolute, and that matters more than anything else here.** The
obvious design is relative: take whatever pose you gripped in as straight-ahead
and measure change from it. It feels right and it is wrong, because the
reference is hidden state that goes stale the moment your hands leave the
frame. They almost never come back level, that tilted pose silently becomes the
new zero, and the wheel sits at 0° while staring at hands clearly at 60°. There
is no way to tell from the outside that anything is broken.

Measuring against horizontal has no such state. Every frame stands on its own,
so a re-acquired pair is matched immediately — and the source asks the
controller to *place* the wheel rather than spring to it, so it is there on the
first frame rather than a third of a second later.

The default ratio is **1:1** — the wheel turns exactly as far as your arms do.
The panel shows both numbers side by side so you can see the correlation
directly, and <kbd>-</kbd> / <kbd>=</kbd> change the ratio live if you would
rather reach full lock with less arm movement.

Measured on the running app. Holding still, the wheel wanders **0.42°**. Moving,
the error against where the hands actually are:

| hand speed | before | after |
|---|---|---|
| 57°/s | 4.0° | **1.2°** |
| 115°/s | 8.9° | **2.9°** |
| 229°/s | 16.7° | **7.1°** |
| 458°/s | 32.1° | **21°** |
| 688°/s | 45.3° *(frames being rejected)* | **37°** |

What remains at the top end is sampling latency — at 50 Hz detection a frame is
20 ms stale before anything else in the chain adds to it.

Re-acquisition, measured with the hands hidden for 1.5 s between each: coming
back at 65°, −50°, 110° and −95° puts the wheel at exactly those angles, and it
is already there 120 ms later. Letting go centres the wheel; re-gripping at 30°
reads 30°. One hand flickering out every third frame, twenty-four times over,
loses control zero times and drifts 0.0°.

The sign convention is worth knowing if you ever touch it. The camera faces
you, so your right hand appears on the **left** of the frame. Turning right
drops your right hand and lifts your left, which in the raw frame lowers the
left-hand point — and `atan2` on a y-down axis calls that negative, so the
result is flipped. `tools/check-handmath.mjs` pins all of this down with
synthetic landmarks, including a 298° sweep that asserts the paired angle stays
continuous while the sort-by-x version demonstrably does not. Run it before
trusting any change to the geometry.

Everything then goes through `SteeringController` like any other input: it
picks the highest-priority source with something to say, cross-fades out over
about 250 ms when confidence drops rather than snapping, and runs the result
through a spring-damper so the wheel keeps its inertia.

### The capture pipeline

Detection is driven by `requestVideoFrameCallback`, which fires once per
decoded camera frame. Driving it from `requestAnimationFrame` instead — the
obvious choice, and what this did first — ties it to the display's refresh
rather than the camera's output. The two are never in step, so some camera
frames get processed twice and others are skipped entirely, which are exactly
the frames a fast movement needs. It also reported a flattering lie: 50 Hz
while the camera was delivering 19, because it was re-running the model on the
same frames. The panel's figures are now the real ones.

Each frame carries its capture time, and velocity is measured against that
rather than against when the model finished — inference time varies frame to
frame, and letting that jitter into dt puts the same jitter into the number the
controller leads on. If the model is still busy when a frame arrives it is
dropped rather than queued, so the wheel can never fall progressively further
behind.

**Field of view.** Asking the camera for a particular *shape* of frame is what
quietly costs it: plenty of sensors are 4:3 and produce 16:9 by cropping the
top and bottom away, so hands leave tracking sooner than they need to. The
request now names a height and leaves width and aspect to the camera, which
hands back its own native shape, and the frame is scaled down to a working size
for the model afterwards — so the view is as wide as the hardware allows while
inference costs whatever we pick.

Note what that is *not*: demanding the largest mode on offer. That does give
the full sensor, but the largest mode is usually the slowest — measured, it
produced 3840×2160 at 10 fps with 47 ms inference, trading away exactly the
frame rate fast movement depends on. Resolution is not what widens the view;
shape is. Zoom is also pulled to its minimum where the camera exposes it, since
some cameras and macOS Centre Stage start zoomed in.

**One hand is enough.** A hand gripping the wheel turns with it, so its knuckle
line alone says where the wheel is. While both hands are visible the source
keeps learning how each hand's own roll relates to the angle the pair reports;
if one then leaves the frame, the other carries on from exactly where the pair
left off instead of control being dropped. It is a far shorter baseline — about
25 mm against 250 — so the same landmark noise costs roughly ten times the
angular error, and it never claims full confidence. As a fallback it is worth a
great deal: you can reach right out of frame with one hand and still be
steering.

The other half is confidence. A hand at the edge of frame is partly cut off,
often angled and often blurred, so the model is less sure about it; tighten the
thresholds and tracking stops well inside the picture. They are deliberately
loose, and the cost — occasional false positives — is filtered out downstream,
because a stray detection cannot steer unless it is also a closed fist a
sensible distance from another one.

Frame rate matters more than resolution here. The model crops each hand to a
fixed size before it looks at it, so pixels past roughly 960×540 cost
preprocessing time without sharpening the landmarks, while frame rate is what
decides whether a fast movement is seen at all — and a camera that cannot
expose for 33 ms and still deliver 60 fps is also a camera that is not blurring
your hands. Every capture constraint is `ideal` rather than `min`: a hard one a
camera cannot meet fails the whole request instead of settling for close, which
is how an over-eager `frameRate: { min: 24 }` once stopped the camera opening
at all.

The panel reports what you actually got — resolution, camera fps, model fps,
inference time, and how many frames are being dropped. If the model is not
keeping up, lower the resolution:

```js
tracker.capture = { ...tracker.capture, work: 640 };   // cheaper inference
tracker.capture = { ...tracker.capture, wide: false }; // pin the shape instead
tracker.confidence = { detect: 0.5, presence: 0.5, track: 0.5 }; // fewer false hands
```

Shortening exposure directly is available as `new HandTracker({ exposure:
'short' })` but is off by default: too short in a dim room and the model cannot
see the hands at all, which is worse than the blur it cures.

Both the WASM runtime and the 7.5 MB model are served from the project, so the
tracker starts with no network connection.

### Tuning

`HandTrackingSource` takes `ratio` (wheel degrees per degree of hand angle,
default 1 — raise it to reach full lock with less arm movement), `minSpan` below which your hands are too close together to give a
reliable angle, `staleMs` after which an old frame is ignored, `maxRate` for
the glitch rejector, and `graceMs` for how long to keep hold of the wheel when
the hands disappear — raise it if your camera's field of view is tight and your
hands leave frame often, lower it if the wheel feels like it hangs on too long
after you have genuinely let go. `OneEuroFilter` takes `minCutoff` (lower is steadier
when still) and `beta` (higher follows fast movement more closely) — note that
`beta` is in Hz per radian/second, so for an angle signal it needs to be around
1, not the 0.007 usually quoted for pixel coordinates. `GripLatch` takes the
engage and release thresholds if fists register too eagerly or not eagerly
enough.

## Rendering notes

Three details do most of the work, and all three are easy to get wrong:

- **The image-based lighting is baked from a miniature of the visible rig**
  (`Environment._bakeIBL`). What you see reflected in the carbon and the
  titanium is the same set of softboxes hanging above the wheel. Swapping in a
  generic studio environment loses this immediately.
- **The faceplate is one composited canvas**, not decals stacked on geometry —
  weave, machined pockets, detent scales and legends are painted together in
  the same metre space the geometry uses, then mapped with `planarUV`. The team
  tint is blended onto the weave *before* any ink goes down; tinting the
  finished material instead multiplies the printed legends too and leaves them
  unreadable.
- **`ExtrudeGeometry` with a bevel does not put its cap planes at `0` and
  `depth`** — the bevel pushes them out by its own thickness on each end. The
  shell extrudes to `SPEC.extrudeDepth` for this reason, and
  `splitExtrudeGroups` measures the real extents rather than assuming them.
  Getting this wrong sinks everything mounted on the face below the surface.

Post-processing is a single bloom pass thresholded well above 1.0, so only genuine
emitters flare and the specular along the shell's bevel stays crisp.

## Sources

- [Ranked: All 10 steering wheel designs on the F1 grid](https://www.planetf1.com/features/ranked-steering-wheels-f1-2023) — PlanetF1, for the silhouettes
- [How Hamilton has made his Ferrari's steering wheel like Mercedes'](https://www.motorsport.com/f1/news/hamilton-ferrari-steering-wheel-like-mercedes/10701097/) — Motorsport.com, on Ferrari's six low selectors versus Mercedes' three
- [What's behind Russell's steering wheel change](https://www.the-race.com/formula-1/what-is-behind-george-russell-f1-steering-wheel-change/) — The Race, on the Mercedes grip profile
- [F1 steering wheel: buttons, dials and controls](https://www.formula1-dictionary.net/f1-steering-wheel/) — Formula 1 Dictionary
- [F1 steering wheels: how they work, what the buttons do](https://www.motorsport.com/f1/news/f1-steering-wheels-how-they-work-what-the-buttons-do-and-more/10561142/) — Motorsport.com
- [Evolution of F1 steering wheels](https://www.fanatec.com/us/en/explorer/products/steering-wheel/evolution-of-f1-steering-wheels-from-1950-to-today/) — Fanatec
- [What all those buttons on an F1 steering wheel do](https://www.jalopnik.com/1920870/what-are-the-buttons-on-f1-steering-wheels/) — Jalopnik
