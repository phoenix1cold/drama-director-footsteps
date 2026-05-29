/**
 * Drama Director — Footsteps — Module entry point
 *
 * Registers footstep settings, exposes the panel through the hub, and starts
 * FootstepsSystem when world setting `stepsEnabled` is true.
 */

import { FootstepsSystem } from './footsteps.mjs';
import { StepsPanel } from './steps-panel.mjs';

const MODULE_ID = 'drama-director-footsteps';
const HUB_ID    = 'drama-director-hub';
const SOCKET    = `module.${MODULE_ID}`;

function _ensureHub() {
  return game.modules.get(HUB_ID)?.api;
}

// ── Settings registration ───────────────────────────────────────────────────
function _registerSettings() {
  const reg = (key, def) => {
    try { game.settings.register(MODULE_ID, key, def); }
    catch (e) { console.warn(`[DD Footsteps] settings.register(${key}) failed`, e); }
  };

  reg('stepsEnabled',              { scope: 'world',  config: false, type: Boolean, default: false });
  reg('stepsSurface',               { scope: 'world',  config: false, type: String,  default: 'rock' });
  reg('stepsCustomUrl',             { scope: 'world',  config: false, type: String,  default: '' });
  reg('stepsCustomUrl2',            { scope: 'world',  config: false, type: String,  default: '' });
  reg('stepsCellInterval',          { scope: 'world',  config: false, type: Number,  default: 2 });
  reg('stepSoundPresets',           { scope: 'world',  config: false, type: Array,   default: [] });
  reg('stepsVolumeAll',             { scope: 'world',  config: false, type: Number,  default: 0.8 });
  reg('stepsVolumeGM',              { scope: 'client', config: false, type: Number,  default: 0.7 });
  reg('stepsMuteGM',                { scope: 'client', config: false, type: Boolean, default: false });
  reg('stepsRealistic',             { scope: 'world',  config: false, type: Boolean, default: false });
  reg('stepsRealisticLevel',        { scope: 'world',  config: false, type: String,  default: 'medium' });
  reg('stepsSpatial',               { scope: 'world',  config: false, type: Boolean, default: false });
  reg('stepsWallMode',              { scope: 'world',  config: false, type: String,  default: 'none' });
  reg('stepsFadeMs',                { scope: 'world',  config: false, type: Number,  default: 261 });
  reg('stepsDistFull',              { scope: 'world',  config: false, type: Number,  default: 5 });
  reg('stepsDistMax',               { scope: 'world',  config: false, type: Number,  default: 30 });
  reg('stepsRegions',               { scope: 'world',  config: false, type: Array,   default: [] });
  reg('stepsRegionPresets',         { scope: 'world',  config: false, type: Array,   default: [] });
  reg('stepsSoundRegions',          { scope: 'world',  config: false, type: Array,   default: [] });
  reg('stepsSoundRegionPresets',    { scope: 'world',  config: false, type: Array,   default: [] });
  reg('stepsDistRegions',           { scope: 'world',  config: false, type: Array,   default: [] });
  reg('stepsDistRegionPresets',     { scope: 'world',  config: false, type: Array,   default: [] });
}

// ── Init ────────────────────────────────────────────────────────────────────
Hooks.once('init', () => {
  _registerSettings();
  console.log('[DD Footsteps] settings registered');
});

// ── Setup: register with hub ────────────────────────────────────────────────
Hooks.once('setup', () => {
  const hub = _ensureHub();
  if (!hub) {
    console.error('[DD Footsteps] hub module not found — module will not appear in sidebar');
    return;
  }
  hub.registerPanel({
    id: 'footsteps',
    moduleId: MODULE_ID,
    label: 'DDFOOTSTEPS.hub.label',
    hint:  'DDFOOTSTEPS.hub.hint',
    description: 'DDFOOTSTEPS.hub.desc',
    icon: 'fa-solid fa-shoe-prints',
    color: '#70d870',
    order: 60,
    open: () => new StepsPanel().render(true),
  });
});

// ── Ready: enable system if world flag is set ───────────────────────────────
Hooks.once('ready', () => {
  try {
    const enabled = game.settings.get(MODULE_ID, 'stepsEnabled');
    if (enabled) FootstepsSystem.enable();
  } catch (e) {
    console.warn('[DD Footsteps] failed to read stepsEnabled', e);
  }

  // One-shot rename-safe migration: backfill UUIDs on existing name-keyed
  // region bindings. Runs whenever the canvas is ready for a scene; safe
  // to call repeatedly (it's idempotent and only writes when something
  // actually changed).
  if (game.user?.isGM) {
    Hooks.on('canvasReady', async () => {
      try { await FootstepsSystem.migrateRegionUuids(); } catch {}
    });
    // Fire once for the initial scene that loaded before this hook bound.
    try { Promise.resolve(FootstepsSystem.migrateRegionUuids()).catch(() => {}); } catch {}
  }

  // Per-module socket channel: handle cross-client step sync.
  try {
    game.socket?.on?.(SOCKET, (data) => {
      if (!data) return;
      switch (data.action) {
        case 'stepsSpatial':
          FootstepsSystem.setSpatial(!!data.enabled);
          break;
        // Reserved for future cross-client step events.
      }
    });
  } catch {}
});
