/**
 * Drama Director — Footsteps System v7
 *
 * Movement check: token.document.movementAction (official v13 API)
 *   Ground-contact actions that produce sound: walk, crawl, climb
 *   Silent actions: fly, swim, burrow, blink, jump, + any unknown custom
 *
 * Drag check: token.isDragged / token.isPreview (official v13 getters)
 *
 * Cell tracking: integer grid cell — one sound per cell entered.
 * Duplicate guard: 80ms cooldown per token against cell-edge jitter.
 *
 * Realistic mode: low (±5%), medium (±15%), high (±30%) presets.
 *   Pitch variation applied via playbackRate on both WebAudio and Audio fallback.
 *
 * Spatial audio: StereoPannerNode positions sound left/right by token X offset.
 *
 * Wall occlusion modes:
 *   none     — walls have no effect on footstep volume
 *   block    — any wall on the path fully silences the sound
 *   attenuate — each wall halves volume; 3+ walls = complete silence
 */

const MODULE_ID = 'drama-director-footsteps';

// These are now dynamic — read from settings each time (see _distFull / _distMax below)

// Actions that should produce footstep sound (ground contact)
const GROUND_ACTIONS = new Set(['walk', 'crawl', 'climb']);

export const BUILTIN_SURFACES = [
  { id: 'rock',  label: 'Rock / Stone',  icon: 'fa-mountain',
    files: [`modules/${MODULE_ID}/assets/steps/rock_1.ogg`,
            `modules/${MODULE_ID}/assets/steps/rock_2.ogg`] },
  { id: 'grass', label: 'Grass / Earth', icon: 'fa-leaf',
    files: [`modules/${MODULE_ID}/assets/steps/grass_1.ogg`,
            `modules/${MODULE_ID}/assets/steps/grass_2.ogg`] },
  { id: 'snow',  label: 'Snow / Ice',    icon: 'fa-snowflake',
    files: [`modules/${MODULE_ID}/assets/steps/snow_1.ogg`,
            `modules/${MODULE_ID}/assets/steps/snow_2.ogg`] },
  { id: 'swamp', label: 'Swamp / Mud',   icon: 'fa-water',
    files: [`modules/${MODULE_ID}/assets/steps/swamp_1.ogg`,
            `modules/${MODULE_ID}/assets/steps/swamp_2.ogg`] },
  { id: 'metal', label: 'Metal',         icon: 'fa-industry',
    files: [`modules/${MODULE_ID}/assets/steps/metal_1.ogg`,
            `modules/${MODULE_ID}/assets/steps/metal_2.ogg`] },
  { id: 'wood',  label: 'Wood',          icon: 'fa-tree',
    files: [`modules/${MODULE_ID}/assets/steps/wood_1.ogg`,
            `modules/${MODULE_ID}/assets/steps/wood_2.ogg`] },
];

// ── Settings ──────────────────────────────────────────────────────────────────

function _get(key, fb) {
  try { return game.settings.get(MODULE_ID, key) ?? fb; }
  catch { return fb; }
}

// ── Region detection ──────────────────────────────────────────────────────────

/** Ray-casting point-in-polygon for a flat [x0,y0,x1,y1,…] array. */
function _pointInPolygon(px, py, pts) {
  let inside = false;
  const n = pts.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], yi = pts[i * 2 + 1];
    const xj = pts[j * 2], yj = pts[j * 2 + 1];
    if (((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function _shapeContains(shape, x, y) {
  try {
    switch (shape.type) {
      case 'rectangle':
        return x >= shape.x && x <= shape.x + (shape.width  ?? 0) &&
               y >= shape.y && y <= shape.y + (shape.height ?? 0);
      case 'circle': {
        const dx = x - (shape.x ?? 0), dy = y - (shape.y ?? 0);
        return Math.hypot(dx, dy) <= (shape.radius ?? 0);
      }
      case 'polygon':
        return _pointInPolygon(x, y, shape.points ?? []);
      case 'ellipse': {
        const rx = (shape.radiusX ?? shape.radius ?? 0);
        const ry = (shape.radiusY ?? shape.radius ?? 0);
        if (!rx || !ry) return false;
        const dx = x - (shape.x ?? 0), dy = y - (shape.y ?? 0);
        return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
      }
    }
  } catch { }
  return false;
}

/**
 * Returns every Foundry Scene Region that contains (x, y), in canvas
 * iteration order, as `{ uuid, name }` objects. Empty array if none.
 * Tries the official V13 containsPoint API first, then falls back to
 * shapes-based checking.
 *
 * Returning ALL containing regions (rather than the first one) lets callers
 * pick a configured region from an overlapping stack — fixes the issue where
 * an unconfigured region masked a configured one and caused the default
 * footstep sound to play.
 *
 * UUID-first matching makes region→sound bindings survive renames; name is
 * kept as a fallback for legacy entries created before the UUID migration.
 */
function _getRegionHitsAt(x, y) {
  const hits = [];
  try {
    const regions = canvas?.regions?.placeables ?? [];
    for (const region of regions) {
      const doc = region.document;
      if (!doc) continue;
      let hit = false;
      if (typeof region.containsPoint === 'function') {
        hit = region.containsPoint({ x, y });
      } else {
        const shapes = doc.shapes ?? [];
        hit = shapes.some(s => _shapeContains(s, x, y));
      }
      if (hit) hits.push({ uuid: doc.uuid ?? '', name: doc.name ?? '' });
    }
  } catch { }
  return hits;
}

/** Legacy helper preserved in case other code reads region names. */
function _getRegionNamesAt(x, y) {
  return _getRegionHitsAt(x, y).map(h => h.name).filter(Boolean);
}

// ── Sound resolution ──────────────────────────────────────────────────────────

/** Resolve [file1, file2] for an explicit surface id + optional custom files. */
function _resolveFilesForSurface(id, customFile, customFile2) {
  if (id === '__custom__') {
    if (!customFile) return null;
    return [customFile, customFile2 || customFile];
  }
  const preset = (_get('stepSoundPresets', []) ?? []).find(p => p.id === id);
  if (preset) return [preset.file, preset.file2 || preset.file];
  return BUILTIN_SURFACES.find(s => s.id === id)?.files ?? null;
}

function _resolveFiles() {
  return _resolveFilesForSurface(
    _get('stepsSurface', 'rock'),
    _get('stepsCustomUrl',  ''),
    _get('stepsCustomUrl2', ''),
  );
}

/**
 * Resolves { files, distFull, distMax } for a token at (x, y).
 * If the token is inside a configured region, the region's values take priority.
 * distFull / distMax may be null — callers fall back to global settings then.
 *
 * When multiple regions overlap, the first region (in canvas order) that has
 * a configured override of the relevant kind wins. Unconfigured overlapping
 * regions are silently skipped, so a generic "trigger" region drawn over a
 * "Tavern" sound region no longer falls through to the default footstep.
 */
function _resolveForToken(x, y) {
  try {
    const regionHits = _getRegionHitsAt(x, y);
    if (regionHits.length) {
      const soundRegions  = (_get('stepsSoundRegions', []) ?? []);
      const legacyRegions = (_get('stepsRegions',      []) ?? []);
      const distRegions   = (_get('stepsDistRegions',  []) ?? []);

      // UUID-first match (survives rename), name fallback for legacy entries.
      const _findIn = (list, hit) => {
        const lowerName = (hit.name ?? '').toLowerCase();
        return list.find(r => {
          if (r?.uuid && hit.uuid && r.uuid === hit.uuid) return true;
          // Legacy entries (or entries on a different scene) fall back to name.
          if (!r?.uuid && lowerName && (r?.name ?? '').toLowerCase() === lowerName) return true;
          return false;
        });
      };

      let soundMatch  = null;
      let distMatch   = null;
      let legacyMatch = null;

      for (const hit of regionHits) {
        if (!soundMatch) {
          soundMatch = _findIn(soundRegions, hit) ?? _findIn(legacyRegions, hit);
        }
        if (!distMatch)   distMatch   = _findIn(distRegions,   hit);
        if (!legacyMatch) legacyMatch = _findIn(legacyRegions, hit);
        if (soundMatch && distMatch && legacyMatch) break;
      }

      const files = soundMatch
        ? (_resolveFilesForSurface(soundMatch.surface, soundMatch.file ?? '', soundMatch.file2 ?? '') ?? _resolveFiles())
        : _resolveFiles();

      // Distance: distRegions take priority; fall back to legacy region's fields
      const _num = (v) => (v !== null && v !== undefined && v !== '') ? Number(v) : null;
      const distFull = distMatch ? _num(distMatch.distFull)
                     : legacyMatch ? _num(legacyMatch.distFull) : null;
      const distMax  = distMatch ? _num(distMatch.distMax)
                     : legacyMatch ? _num(legacyMatch.distMax)  : null;

      return { files, distFull, distMax };
    }
  } catch { }
  return { files: _resolveFiles(), distFull: null, distMax: null };
}

// ── Movement action check ─────────────────────────────────────────────────────

function _isGroundMovement(token) {
  try {
    // Official v13 API: TokenDocument.movementAction
    // Values: "walk" | "crawl" | "climb" | "jump" | "fly" | "swim" | "burrow" | "blink"
    const action = token.document?.movementAction;
    if (action === undefined || action === null || action === '') {
      // No action set — default to allowing sound (backward compat)
      return true;
    }
    return GROUND_ACTIONS.has(action);
  } catch { return true; }
}

// ── Geometry ──────────────────────────────────────────────────────────────────

function _gs() {
  try { return canvas?.scene?.grid?.size ?? canvas?.grid?.size ?? 100; }
  catch { return 100; }
}

function _cell(px, py) {
  const gs = _gs();
  return `${Math.floor(px / gs)},${Math.floor(py / gs)}`;
}

function _vcenter(token) {
  const gs = _gs();
  const tw = (token.document?.width  ?? 1) * gs;
  const th = (token.document?.height ?? 1) * gs;
  const x  = token.position?.x ?? token.document?.x ?? 0;
  const y  = token.position?.y ?? token.document?.y ?? 0;
  return { x: x + tw / 2, y: y + th / 2 };
}

function _distGrid(x1, y1, x2, y2) {
  const gs = _gs();
  return Math.hypot((x2 - x1) / gs, (y2 - y1) / gs);
}

function _distFull() { return _get('stepsDistFull', 5); }
function _distMax()  { return _get('stepsDistMax',  30); }

function _falloff(dist) {
  const full = _distFull();
  const max  = _distMax();
  if (dist <= full) return 1;
  if (dist >= max)  return 0;
  return 1 - (dist - full) / (max - full);
}

// ── Viewer position helper ────────────────────────────────────────────────────

function _viewerCenter() {
  try {
    const ct = canvas?.tokens?.controlled?.[0];
    if (ct) return _vcenter(ct);
    const wt = canvas?.app?.stage?.transform?.worldTransform;
    if (wt) {
      const sc = wt.a || 1;
      return {
        x: (window.innerWidth  / 2 - (wt.tx ?? 0)) / sc,
        y: (window.innerHeight / 2 - (wt.ty ?? 0)) / sc,
      };
    }
  } catch {}
  return null;
}

function _distToViewer(cx, cy) {
  try {
    const v = _viewerCenter();
    if (v) return _distGrid(cx, cy, v.x, v.y);
    return 0;
  } catch { return 0; }
}

// ── 3D Spatial audio — HRTF PannerNode ───────────────────────────────────────
//
// Canvas → WebAudio 3D coordinate mapping:
//   canvas X increases right  → audio X (right = right)
//   canvas Y increases down   → audio Z (down on map = behind listener)
//
// Listener faces −Z (= north on map), up = +Y (out of screen).
//   Token north (smaller Y) → negative Z → sounds in FRONT
//   Token south (larger Y)  → positive Z → sounds BEHIND
//   Token east  (larger X)  → positive X → sounds RIGHT
//   Token SW                → behind-left, NE → front-right, etc.
//
// rolloffFactor = 0: volume handled by GainNode, HRTF only sets direction.

let _spatialEnabled = false;
let _lastListenerUpdate = 0;
let _lastListenerPos = { x: 0, y: 0 };

function _updateListener(ctx, vx, vy) {
  const gs = _gs();
  const li = ctx.listener;
  
  // Throttle listener updates to reduce jitter (max 10 updates/sec)
  const now = Date.now();
  const dx = Math.abs(vx - _lastListenerPos.x);
  const dy = Math.abs(vy - _lastListenerPos.y);
  const moved = dx > gs * 0.5 || dy > gs * 0.5; // Only update if moved significantly
  
  if (now - _lastListenerUpdate < 100 && !moved) return;
  
  _lastListenerUpdate = now;
  _lastListenerPos.x = vx;
  _lastListenerPos.y = vy;
  
  try {
    if (li.positionX) {
      li.positionX.setValueAtTime(vx / gs, ctx.currentTime);
      li.positionY.setValueAtTime(0,       ctx.currentTime);
      li.positionZ.setValueAtTime(vy / gs, ctx.currentTime);
      li.forwardX.setValueAtTime(0,  ctx.currentTime);
      li.forwardY.setValueAtTime(0,  ctx.currentTime);
      li.forwardZ.setValueAtTime(-1, ctx.currentTime);
      li.upX.setValueAtTime(0, ctx.currentTime);
      li.upY.setValueAtTime(1, ctx.currentTime);
      li.upZ.setValueAtTime(0, ctx.currentTime);
    } else {
      li.setPosition(vx / gs, 0, vy / gs);
      li.setOrientation(0, 0, -1, 0, 1, 0);
    }
  } catch {}
}

function _createHRTFPanner(ctx, srcX, srcY) {
  const gs = _gs();
  const p = ctx.createPanner();
  p.panningModel  = 'HRTF';
  p.distanceModel = 'linear';
  p.refDistance   = 1;
  p.maxDistance   = 10000;
  p.rolloffFactor = 0;
  p.coneInnerAngle = 360;
  p.coneOuterAngle = 360;
  p.coneOuterGain = 1;
  
  try {
    const x = srcX / gs;
    const z = srcY / gs;
    
    if (p.positionX) {
      // Use value assignment instead of setValueAtTime for more stable positioning
      p.positionX.value = x;
      p.positionY.value = 0;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, 0, z);
    }
  } catch {}
  return p;
}

// ── Wall occlusion ────────────────────────────────────────────────────────────

/** Standard 2D line-segment intersection test. Returns true if [p1p2] crosses [p3p4]. */
function _segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return false;  // parallel
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Returns the number of sound-blocking walls that cross the line from (cx, cy)
 * to the current viewer position.
 * Walls with sound restriction NONE (type 0) are skipped.
 */
function _wallCount(cx, cy) {
  try {
    const v = _viewerCenter();
    if (!v) return 0;
    const walls = canvas?.walls?.placeables ?? [];
    let count = 0;
    for (const wall of walls) {
      const doc = wall.document;
      if (!doc) continue;
      // Skip walls explicitly set to no sound restriction
      // Foundry WALL_SENSE_TYPES: 0 = NONE (no restriction)
      const soundType = doc.sound ?? doc.ds ?? -1;
      if (soundType === 0) continue;
      const c = doc.c;
      if (!c || c.length < 4) continue;
      if (_segmentsIntersect(cx, cy, v.x, v.y, c[0], c[1], c[2], c[3])) {
        count++;
      }
    }
    return count;
  } catch { return 0; }
}

/**
 * Returns a volume multiplier [0, 1] based on the current wall occlusion mode.
 *
 * none      → always 1.0
 * block     → 0.0 if any wall is in the way, else 1.0
 * attenuate → 0 walls=1.0 · 1 wall=0.5 · 2 walls=0.25 · 3+ walls=0.0
 */
function _wallAttenuation(cx, cy) {
  const mode = _get('stepsWallMode', 'none');
  if (mode === 'none') return 1;
  const count = _wallCount(cx, cy);
  if (mode === 'block')    return count > 0 ? 0 : 1;
  if (mode === 'attenuate') return count >= 3 ? 0 : Math.pow(0.5, count);
  return 1;
}

// ── Realistic variation ───────────────────────────────────────────────────────

// low=±5%, medium=±15%, high=±30%
const REALISTIC_PRESETS = {
  low:    0.05,
  medium: 0.15,
  high:   0.30,
};

function _variation() {
  const spread = REALISTIC_PRESETS[_get('stepsRealisticLevel', 'medium')] ?? 0.15;
  return {
    volMult: 1 - spread + Math.random() * spread * 2,
    pitch:   1 - spread + Math.random() * spread * 2,
  };
}

// ── Audio ─────────────────────────────────────────────────────────────────────

let   _actx     = null;
const _bufCache = new Map();
const _bufLoad  = new Map();

function _actxGet() {
  if (!_actx || _actx.state === 'closed')
    _actx = new (window.AudioContext || window.webkitAudioContext)();
  if (_actx.state === 'suspended') _actx.resume().catch(() => {});
  return _actx;
}

async function _loadBuf(url) {
  if (_bufCache.has(url)) return _bufCache.get(url);
  if (_bufLoad.has(url))  return _bufLoad.get(url);
  const p = fetch(url)
    .then(r => r.arrayBuffer())
    .then(ab => _actxGet().decodeAudioData(ab))
    .then(b  => { _bufCache.set(url, b); _bufLoad.delete(url); return b; })
    .catch(e => { console.warn('DD Steps | load fail:', url, e); _bufLoad.delete(url); return null; });
  _bufLoad.set(url, p);
  return p;
}

export async function preloadSurface(files) {
  for (const f of files) _loadBuf(f).catch(() => {});
}

function _play(url, vol, realistic, srcX = null, srcY = null) {
  if (!url || vol < 0.005) return;

  const ctx = _actxGet();

  let v = Math.min(1, Math.max(0, vol));
  let r = 1.0;
  if (realistic) {
    const vr = _variation();
    v = Math.min(1, v * vr.volMult);
    r = Math.min(2, Math.max(0.1, vr.pitch));
  }

  const _playBuf = (buf) => {
    try {
      const fadeSec = _stepFadeMs() / 1000;
      const src     = ctx.createBufferSource();
      const gain    = ctx.createGain();
      src.buffer             = buf;
      src.playbackRate.value = r;

      // Gradual linear fade: full volume at t=0, silence at t=fadeSec.
      // Replaces the old hard-cap + 25ms tail — the entire window is a
      // smooth fade so the sound never feels abruptly cut off.
      gain.gain.setValueAtTime(v, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeSec);

      src.connect(gain);

      if (_spatialEnabled && srcX !== null && srcY !== null) {
        // ── HRTF 3D: full directional audio (front/back/left/right + diagonals)
        const viewer = _viewerCenter();
        if (viewer) _updateListener(ctx, viewer.x, viewer.y);
        const panner = _createHRTFPanner(ctx, srcX, srcY);
        gain.connect(panner);
        panner.connect(ctx.destination);
      } else {
        gain.connect(ctx.destination);
      }

      src.start(ctx.currentTime);
      // Stop source after the fade window so long buffers don't keep running
      src.stop(ctx.currentTime + fadeSec);
    } catch(e) { console.error('DD Steps | _playBuf error', e); }
  };

  const cached = _bufCache.get(url);
  if (cached) {
    _playBuf(cached);
  } else {
    // Buffer not ready — load it now, then play (slight delay on first step only)
    _loadBuf(url).then(buf => { if (buf) _playBuf(buf); }).catch(() => {});
  }
}

// ── Per-token state ───────────────────────────────────────────────────────────

// Fade duration is now a configurable setting (ms).
// The sound starts at full volume and linearly fades to 0 over this window.
// Source is stopped after the window so long files never overstay.
// Default 261 ms keeps the behaviour identical to the previous hardcoded value.
function _stepFadeMs() { return Math.max(50, _get('stepsFadeMs', 261)); }

const _lastCell   = new Map();   // tokenId → cell string
const _variantIdx = new Map();   // tokenId → 0|1
const _lastStepMs = new Map();   // tokenId → timestamp ms
const _cellCount  = new Map();   // tokenId → cells crossed since last sound

const STEP_MIN_MS = 105;   // jitter guard only (cell-edge double-fire)

function _nextVariant(id, files) {
  const i = _variantIdx.get(id) ?? 0;
  _variantIdx.set(id, i ^ 1);
  return files[i % files.length];
}

// ── refreshToken hook ─────────────────────────────────────────────────────────

let _hookId       = null;
let _updateHookId = null;

function _onRefresh(token) {
  if (!_get('stepsEnabled', false)) return;

  // ── Skip drag / preview using official v13 getters ────────────────────
  if (token.isDragged) return;   // token.isDragged — official v13 getter
  if (token.isPreview) return;   // token.isPreview — official v13 getter

  // ── Skip non-ground movement types (fly, swim, burrow, blink, jump) ───
  if (!_isGroundMovement(token)) return;

  const id       = token.id;
  const { x, y } = _vcenter(token);
  const cell     = _cell(x, y);

  // First frame — just record, no sound
  if (!_lastCell.has(id)) {
    _lastCell.set(id, cell);
    _cellCount.set(id, 0);
    return;
  }

  // Cell unchanged
  if (_lastCell.get(id) === cell) return;

  // Track how many cells crossed since last sound
  _lastCell.set(id, cell);
  const count    = (_cellCount.get(id) ?? 0) + 1;
  const interval = _get('stepsCellInterval', 2);   // default: every 2 cells

  if (count < interval) {
    _cellCount.set(id, count);
    return;
  }
  _cellCount.set(id, 0);   // reset counter

  // Jitter guard — prevents double-fire on cell edge (80 ms).
  // No additional cooldown: cell-interval controls frequency,
  // and the fade duration handles natural overlap between steps.
  const now = Date.now();
  if (now - (_lastStepMs.get(id) ?? 0) < STEP_MIN_MS) return;
  _lastStepMs.set(id, now);

  const resolved  = _resolveForToken(x, y);
  const files     = resolved.files;
  if (!files) return;

  const tokenDistFull = resolved.distFull ?? _distFull();
  const tokenDistMax  = resolved.distMax  ?? _distMax();
  const _tokenFalloff = (dist) => {
    if (dist <= tokenDistFull) return 1;
    if (dist >= tokenDistMax)  return 0;
    return 1 - (dist - tokenDistFull) / (tokenDistMax - tokenDistFull);
  };

  const url       = _nextVariant(id, files);
  const realistic = _get('stepsRealistic', false);

  // If this token IS the viewer's own controlled token, the listener and
  // source are the same point. Feeding identical (but separately-sampled)
  // coordinates into the HRTF panner causes rapid L/R jumps because the
  // relative vector is near-zero and numerically unstable.
  // Solution: pass null coords for own-token footsteps → sound plays centered.
  const ownToken  = canvas?.tokens?.controlled?.[0];
  const isOwnToken = ownToken && ownToken.id === token.id;
  const spatialX  = isOwnToken ? null : x;
  const spatialY  = isOwnToken ? null : y;

  if (game.user?.isGM) {
    if (_get('stepsMuteGM', false)) return;
    _play(url, _get('stepsVolumeGM', 0.7), realistic, spatialX, spatialY);
  } else {
    const base    = _get('stepsVolumeAll', 0.8);
    const spatial = _tokenFalloff(_distToViewer(x, y));
    const walls   = _wallAttenuation(x, y);
    _play(url, base * spatial * walls, realistic, spatialX, spatialY);
  }
}

function _install() {
  if (_hookId !== null) return;

  // Restore spatial setting from game.settings (best-effort on load)
  try { _spatialEnabled = !!game.settings.get(MODULE_ID, 'stepsSpatial'); } catch {}
  console.log(`DD Footsteps | spatial restored to ${_spatialEnabled}`);

  _hookId = Hooks.on('refreshToken', _onRefresh);

  // Snap cell to final position after movement commits
  _updateHookId = Hooks.on('updateToken', (doc) => {
    const gs = _gs();
    const cx = (doc.x ?? 0) + (doc.width  ?? 1) * gs / 2;
    const cy = (doc.y ?? 0) + (doc.height ?? 1) * gs / 2;
    _lastCell.set(doc.id, _cell(cx, cy));
    _cellCount.set(doc.id, 0);   // reset interval counter after each move
  });

  console.log('DD Footsteps | installed (movementAction API, cell-tracking)');
}

function _uninstall() {
  if (_hookId === null) return;
  Hooks.off('refreshToken', _hookId);
  Hooks.off('updateToken',  _updateHookId);
  _hookId = _updateHookId = null;
  _lastCell.clear();
  _variantIdx.clear();
  _lastStepMs.clear();
  _cellCount.clear();
  console.log('DD Footsteps | uninstalled');
}

export function handleStepSocket(_data) {}

/**
 * One-shot migration: for each region binding stored as `{ name, ... }`
 * without a `uuid`, look up the matching region on the *currently active*
 * scene by name (case-insensitive) and attach the document UUID. Idempotent.
 *
 * Limitation: only entries whose name matches a region on the current scene
 * get a UUID — bindings created on another scene stay name-keyed until that
 * scene is opened. This is intentional: we never guess across scenes.
 *
 * Returns true iff any entry was modified.
 */
export async function migrateRegionUuids() {
  const MID = 'drama-director-footsteps';
  let changed = false;

  const _byName = (() => {
    const map = new Map();
    try {
      for (const region of (canvas?.regions?.placeables ?? [])) {
        const doc = region.document;
        if (!doc?.name || !doc?.uuid) continue;
        map.set(doc.name.toLowerCase(), doc.uuid);
      }
    } catch { }
    return map;
  })();

  if (!_byName.size) return false;

  for (const key of ['stepsSoundRegions', 'stepsDistRegions', 'stepsRegions']) {
    let arr;
    try { arr = game.settings.get(MID, key) ?? []; } catch { arr = []; }
    if (!Array.isArray(arr) || arr.length === 0) continue;

    let mutated = false;
    const next = arr.map(entry => {
      if (!entry || typeof entry !== 'object') return entry;
      if (entry.uuid) return entry;
      const uuid = _byName.get((entry.name ?? '').toLowerCase());
      if (!uuid) return entry;
      mutated = true;
      return { ...entry, uuid };
    });
    if (mutated) {
      try { await game.settings.set(MID, key, next); changed = true; } catch { }
    }
  }

  return changed;
}

export const FootstepsSystem = {
  enable()              { _install(); },
  disable()             { _uninstall(); },
  isActive()            { return _hookId !== null; },
  preloadSurface,
  setSpatial(val)       { _spatialEnabled = !!val; console.log(`DD Footsteps | spatial set to ${_spatialEnabled}`); },
  getSpatial()          { return _spatialEnabled; },
  migrateRegionUuids,
};
