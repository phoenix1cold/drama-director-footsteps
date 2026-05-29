/**
 * Drama Director — Footsteps — Steps Panel (ApplicationV2)
 * Extracted from the original panels.mjs.
 */
import { BUILTIN_SURFACES, FootstepsSystem } from './footsteps.mjs';

const MODULE_ID = 'drama-director-footsteps';
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class StepsPanel extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'dd-steps-panel',
    classes: ['drama-director', 'dd-panel'],
    tag: 'div',
    window: { title: 'DRAMADIRECTOR.steps.panelTitle', icon: 'fas fa-shoe-prints', resizable: true },
    position: { width: 920, height: 580, top: 80, left: 120 },
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/steps-panel.hbs` },
  };

  async _prepareContext() {
    return {
      steps: {
        distFull: this._getSetting?.('stepsDistFull', 5) ?? 5,
        distMax:  this._getSetting?.('stepsDistMax',  30) ?? 30,
      },
    };
  }

  _getSetting(k, fb) {
    try { return game.settings.get(MODULE_ID, k) ?? fb; } catch { return fb; }
  }
  async _setSetting(k, v) {
    try { await game.settings.set(MODULE_ID, k, v); } catch(e) { console.warn('DD Steps |', e); }
  }
  _getPresets() {
    try { return game.settings.get(MODULE_ID, 'stepSoundPresets') ?? []; } catch { return []; }
  }
  async _savePresets(arr) {
    await game.settings.set(MODULE_ID, 'stepSoundPresets', arr);
  }
  _getRegions() {
    try { return game.settings.get(MODULE_ID, 'stepsRegions') ?? []; } catch { return []; }
  }
  async _saveRegions(arr) {
    await game.settings.set(MODULE_ID, 'stepsRegions', arr);
  }
  _getRegionPresets() {
    try { return game.settings.get(MODULE_ID, 'stepsRegionPresets') ?? []; } catch { return []; }
  }
  async _saveRegionPresets(arr) {
    await game.settings.set(MODULE_ID, 'stepsRegionPresets', arr);
  }
  _getSoundRegions() {
    try { return game.settings.get(MODULE_ID, 'stepsSoundRegions') ?? []; } catch { return []; }
  }
  async _saveSoundRegions(arr) {
    await game.settings.set(MODULE_ID, 'stepsSoundRegions', arr);
  }
  _getSoundRegionPresets() {
    try { return game.settings.get(MODULE_ID, 'stepsSoundRegionPresets') ?? []; } catch { return []; }
  }
  async _saveSoundRegionPresets(arr) {
    await game.settings.set(MODULE_ID, 'stepsSoundRegionPresets', arr);
  }
  _getDistRegions() {
    try { return game.settings.get(MODULE_ID, 'stepsDistRegions') ?? []; } catch { return []; }
  }
  async _saveDistRegions(arr) {
    await game.settings.set(MODULE_ID, 'stepsDistRegions', arr);
  }
  _getDistRegionPresets() {
    try { return game.settings.get(MODULE_ID, 'stepsDistRegionPresets') ?? []; } catch { return []; }
  }
  async _saveDistRegionPresets(arr) {
    await game.settings.set(MODULE_ID, 'stepsDistRegionPresets', arr);
  }

  /**
   * Best-effort name→UUID lookup against the currently active scene. Used
   * when adding a region binding by typed name so we can capture the UUID
   * up front and skip the migration step.
   */
  _uuidForName(name) {
    try {
      const lower = (name ?? '').toLowerCase();
      for (const region of (canvas?.regions?.placeables ?? [])) {
        const doc = region.document;
        if (!doc) continue;
        if ((doc.name ?? '').toLowerCase() === lower) return doc.uuid ?? null;
      }
    } catch {}
    return null;
  }

  _onRender(context, options) {
    const html = this.element;

    // ── Tab switching ─────────────────────────────────────────────────────
    html.querySelectorAll('.dd-steps-tabs .dd-tp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        html.querySelectorAll('.dd-steps-tabs .dd-tp-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        html.querySelectorAll('.dd-steps-tab-panel').forEach(p => {
          p.style.display = p.dataset.tabPanel === tab ? 'flex' : 'none';
        });
      });
    });

    // ── Slider sync helper ────────────────────────────────────────────────
    const _syncSlider = (rid, nid, onChange) => {
      const r = html.querySelector(`#${rid}`);
      const n = html.querySelector(`#${nid}`);
      if (!r || !n) return;
      r.addEventListener('input',  () => { n.value = r.value; onChange(parseFloat(r.value)); });
      n.addEventListener('change', () => { r.value = n.value; onChange(parseFloat(n.value)); });
    };

    // ── Master toggle ─────────────────────────────────────────────────────
    const enabledChk = html.querySelector('#dd-steps-enabled');
    if (enabledChk) {
      enabledChk.checked = this._getSetting('stepsEnabled', false);
      enabledChk.addEventListener('change', async () => {
        await this._setSetting('stepsEnabled', enabledChk.checked);
        if (enabledChk.checked) FootstepsSystem.enable();
        else                     FootstepsSystem.disable();
      });
    }

    // ── Surface grid ──────────────────────────────────────────────────────
    const grid      = html.querySelector('#dd-steps-builtin-grid');
    const useCustom = html.querySelector('#dd-steps-use-custom');
    const customRow = html.querySelector('#dd-steps-custom-row');

    const _buildGrid = () => {
      if (!grid) return;
      const cur      = this._getSetting('stepsSurface', 'rock');
      const isCustom = cur === '__custom__';
      const surfaces = [
        ...BUILTIN_SURFACES,
        ...this._getPresets().map(p => ({ ...p, icon: p.icon || 'fa-music' })),
      ];
      grid.innerHTML = '';
      surfaces.forEach(s => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dd-steps-surface-btn' + (s.id === cur && !isCustom ? ' active' : '');
        btn.title = (s.files?.[0] || s.file || s.id);
        btn.innerHTML = `<i class="fas ${s.icon}"></i><span>${s.label}</span>`;
        btn.addEventListener('click', async () => {
          await this._setSetting('stepsSurface', s.id);
          if (useCustom) useCustom.checked = false;
          if (customRow) customRow.style.display = 'none';
          const files = s.files ?? (s.file ? [s.file, s.file2 || s.file] : []);
          if (files.length) FootstepsSystem.preloadSurface(files).catch(() => {});
          _buildGrid(); _buildPresets();
        });
        grid.appendChild(btn);
      });
    };
    this._buildGrid = _buildGrid;

    // ── Custom use toggle ─────────────────────────────────────────────────
    if (useCustom) {
      const isC = this._getSetting('stepsSurface', '') === '__custom__';
      useCustom.checked = isC;
      if (customRow) customRow.style.display = isC ? 'flex' : 'none';
      useCustom.addEventListener('change', async () => {
        if (customRow) customRow.style.display = useCustom.checked ? 'flex' : 'none';
        if (useCustom.checked) { await this._setSetting('stepsSurface', '__custom__'); _buildGrid(); }
      });
    }

    // ── Custom file pickers (L and R) ─────────────────────────────────────
    const _makeFilePicker = (inputId, browseId, testId, settingKey) => {
      const inp = html.querySelector(`#${inputId}`);
      if (!inp) return inp;
      inp.value = this._getSetting(settingKey, '');
      inp.addEventListener('change', () => this._setSetting(settingKey, inp.value.trim()));
      html.querySelector(`#${browseId}`)?.addEventListener('click', () => {
        new (foundry.applications.apps.FilePicker.implementation)({
          type: 'audio', location: 'data',
          callback: p => { inp.value = p; this._setSetting(settingKey, p); }
        }).render({ force: true });
      });
      html.querySelector(`#${testId}`)?.addEventListener('click', () => {
        const url = inp.value.trim() || this._getSetting(settingKey, '');
        if (!url) return;
        const a = new Audio(url);
        a.volume = this._getSetting('stepsVolumeGM', 0.7);
        a.play().catch(() => {});
      });
      return inp;
    };
    _makeFilePicker('dd-steps-custom-url',  'dd-steps-browse-1', 'dd-steps-test-1', 'stepsCustomUrl');
    _makeFilePicker('dd-steps-custom-url2', 'dd-steps-browse-2', 'dd-steps-test-2', 'stepsCustomUrl2');

    // ── Presets (now with file + file2) ───────────────────────────────────
    const presetsList = html.querySelector('#dd-steps-presets-list');
    const _buildPresets = () => {
      if (!presetsList) return;
      presetsList.innerHTML = '';
      const presets = this._getPresets();
      if (presets.length === 0) {
        presetsList.innerHTML = '<div class="dd-layers-empty">No custom presets yet</div>';
        return;
      }
      const cur = this._getSetting('stepsSurface', '');
      presets.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'dd-steps-preset-row';
        const f2label = p.file2 ? p.file2.split('/').pop() : '—';
        row.innerHTML = `
          <button type="button" class="dd-steps-preset-use${cur === p.id ? ' active' : ''}">
            <i class="fas fa-music"></i><span>${p.label}</span>
          </button>
          <div class="dd-steps-preset-files">
            <span title="${p.file}">L: ${p.file.split('/').pop()}</span>
            <span title="${p.file2 || ''}">R: ${f2label}</span>
          </div>
          <button type="button" class="dd-icon-btn dd-danger-btn" title="Delete"><i class="fas fa-trash"></i></button>`;
        row.querySelector('.dd-steps-preset-use').addEventListener('click', async () => {
          await this._setSetting('stepsSurface', p.id);
          if (useCustom) useCustom.checked = false;
          if (customRow) customRow.style.display = 'none';
          _buildGrid(); _buildPresets();
        });
        row.querySelector('.dd-danger-btn').addEventListener('click', async () => {
          await this._savePresets(this._getPresets().filter((_, j) => j !== i));
          _buildGrid(); _buildPresets();
        });
        presetsList.appendChild(row);
      });
    };
    this._buildPresets = _buildPresets;

    html.querySelector('#dd-steps-preset-save')?.addEventListener('click', async () => {
      const name = html.querySelector('#dd-steps-preset-name')?.value?.trim();
      const u1   = this._getSetting('stepsCustomUrl',  '');
      const u2   = this._getSetting('stepsCustomUrl2', '');
      if (!name || !u1) { ui.notifications?.warn('Enter a preset name and select at least the first file'); return; }
      const id  = 'preset_' + Date.now();
      const arr = [...this._getPresets(), { id, label: name, file: u1, file2: u2 || u1, icon: 'fa-music' }];
      await this._savePresets(arr);
      const ni = html.querySelector('#dd-steps-preset-name');
      if (ni) ni.value = '';
      _buildGrid(); _buildPresets();
    });

    // ── Cell interval buttons ─────────────────────────────────────────────
    const _buildIntervalBtns = () => {
      const cur = this._getSetting('stepsCellInterval', 2);
      html.querySelectorAll('.dd-steps-interval-btn').forEach(btn => {
        const v = parseInt(btn.dataset.interval);
        btn.classList.toggle('active', v === cur);
        btn.addEventListener('click', async () => {
          await this._setSetting('stepsCellInterval', v);
          html.querySelectorAll('.dd-steps-interval-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    };
    _buildIntervalBtns();

    // ── Volume sliders ────────────────────────────────────────────────────
    const _initSlider = (rid, nid, key, def) => {
      const v = this._getSetting(key, def);
      const r = html.querySelector(`#${rid}`);
      const n = html.querySelector(`#${nid}`);
      if (r) r.value = v;
      if (n) n.value = v;
      _syncSlider(rid, nid, val => this._setSetting(key, val));
    };
    _initSlider('dd-steps-vol-all-range', 'dd-steps-vol-all', 'stepsVolumeAll', 0.8);
    _initSlider('dd-steps-vol-gm-range',  'dd-steps-vol-gm',  'stepsVolumeGM',  0.7);
    // ── Fade duration slider ──────────────────────────────────────────────
    _initSlider('dd-steps-fade-range', 'dd-steps-fade-ms', 'stepsFadeMs', 261);

    // ── GM mute ───────────────────────────────────────────────────────────
    const muteChk = html.querySelector('#dd-steps-mute-gm');
    if (muteChk) {
      muteChk.checked = this._getSetting('stepsMuteGM', false);
      muteChk.addEventListener('change', () => this._setSetting('stepsMuteGM', muteChk.checked));
    }

    // ── Realistic mode ────────────────────────────────────────────────────
    const realisticChk = html.querySelector('#dd-steps-realistic');
    const levelRow     = html.querySelector('#dd-steps-realistic-level-row');
    const _syncLevelRow = (on) => { if (levelRow) levelRow.style.display = on ? 'block' : 'none'; };
    if (realisticChk) {
      realisticChk.checked = this._getSetting('stepsRealistic', false);
      _syncLevelRow(realisticChk.checked);
      realisticChk.addEventListener('change', () => {
        this._setSetting('stepsRealistic', realisticChk.checked);
        _syncLevelRow(realisticChk.checked);
      });
    }

    const _buildLevelBtns = () => {
      const cur = this._getSetting('stepsRealisticLevel', 'medium');
      html.querySelectorAll('.dd-steps-level-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.level === cur);
        btn.addEventListener('click', async () => {
          await this._setSetting('stepsRealisticLevel', btn.dataset.level);
          html.querySelectorAll('.dd-steps-level-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    };
    _buildLevelBtns();

    // ── Spatial audio ─────────────────────────────────────────────────────
    const spatialChk = html.querySelector('#dd-steps-spatial');
    if (spatialChk) {
      spatialChk.checked = FootstepsSystem.getSpatial();
      spatialChk.addEventListener('change', () => {
        const val = spatialChk.checked;
        FootstepsSystem.setSpatial(val);
        this._setSetting('stepsSpatial', val);
        // Broadcast to all players so their _spatialEnabled is in sync
        try {
          game.socket.emit(`module.drama-director-footsteps`, { action: 'stepsSpatial', enabled: val });
        } catch(e) { console.warn('DD Steps | socket emit failed', e); }
      });
    } else {
      console.error('DD Steps | #dd-steps-spatial checkbox NOT FOUND in DOM');
    }

    // ── Wall occlusion ────────────────────────────────────────────────────
    const WALL_HINTS = {
      none:      game.i18n.localize('DRAMADIRECTOR.steps.wallHintNone'),
      block:     game.i18n.localize('DRAMADIRECTOR.steps.wallHintBlock'),
      attenuate: game.i18n.localize('DRAMADIRECTOR.steps.wallHintAttenuate'),
    };
    const wallHintEl = html.querySelector('#dd-steps-wall-hint');
    const _buildWallBtns = () => {
      const cur = this._getSetting('stepsWallMode', 'none');
      if (wallHintEl) wallHintEl.textContent = WALL_HINTS[cur] ?? '';
      html.querySelectorAll('.dd-steps-wall-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === cur);
        btn.addEventListener('click', async () => {
          await this._setSetting('stepsWallMode', btn.dataset.mode);
          html.querySelectorAll('.dd-steps-wall-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (wallHintEl) wallHintEl.textContent = WALL_HINTS[btn.dataset.mode] ?? '';
        });
      });
    };
    _buildWallBtns();

    // ── Fade distance inputs ──────────────────────────────────────────────
    const distFullInp = html.querySelector('#dd-steps-dist-full');
    const distMaxInp  = html.querySelector('#dd-steps-dist-max');
    if (distFullInp) {
      distFullInp.value = this._getSetting('stepsDistFull', 5);
      distFullInp.addEventListener('change', () => {
        const v = Math.max(0, parseInt(distFullInp.value) || 0);
        distFullInp.value = v;
        this._setSetting('stepsDistFull', v);
      });
    }
    if (distMaxInp) {
      distMaxInp.value = this._getSetting('stepsDistMax', 30);
      distMaxInp.addEventListener('change', () => {
        const v = Math.max(1, parseInt(distMaxInp.value) || 1);
        distMaxInp.value = v;
        this._setSetting('stepsDistMax', v);
      });
    }

    // ── Regions ───────────────────────────────────────────────────────────

    /** Build a list of all available surfaces for the region surface selector. */
    const _buildSurfaceOptions = (selectEl, selectedId = '') => {
      if (!selectEl) return;
      selectEl.innerHTML = '';
      const surfaces = [
        ...BUILTIN_SURFACES,
        ...this._getPresets().map(p => ({ ...p, icon: p.icon || 'fa-music' })),
      ];
      surfaces.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.label;
        if (s.id === selectedId) opt.selected = true;
        selectEl.appendChild(opt);
      });
      // Custom option
      const optC = document.createElement('option');
      optC.value = '__custom__';
      optC.textContent = game.i18n.localize('DRAMADIRECTOR.steps.customSurface');
      if (selectedId === '__custom__') optC.selected = true;
      selectEl.appendChild(optC);
    };

    // ── Sound Regions ─────────────────────────────────────────────────────
    const soundRegionsList = html.querySelector('#dd-steps-sound-regions-list');

    // Stored entries: { name, surface, uuid? }. UUID is the rename-safe key;
    // name is kept for display + fallback when UUID lookup misses.
    const _currentName = (entry) => {
      try {
        if (entry?.uuid) {
          const doc = fromUuidSync?.(entry.uuid);
          if (doc?.name) return doc.name;
        }
      } catch {}
      return entry?.name ?? '';
    };

    const _buildSoundRegions = () => {
      if (!soundRegionsList) return;
      soundRegionsList.innerHTML = '';
      // Merge: new stepsSoundRegions + legacy stepsRegions (show both, edit separately)
      const regs = this._getSoundRegions();
      const legacy = this._getRegions();
      const allRegs = [
        ...regs.map(r => ({ ...r, _src: 'new' })),
        ...legacy.map(r => ({ ...r, _src: 'legacy' })),
      ];
      if (allRegs.length === 0) {
        soundRegionsList.innerHTML = `<div class="dd-layers-empty">${game.i18n.localize('DRAMADIRECTOR.steps.regionsEmpty')}</div>`;
        return;
      }
      const allSurfaces = [
        ...BUILTIN_SURFACES,
        ...this._getPresets(),
        { id: '__custom__', label: game.i18n.localize('DRAMADIRECTOR.steps.customSurface') },
      ];
      allRegs.forEach((reg, i) => {
        const surfLabel = allSurfaces.find(s => s.id === reg.surface)?.label ?? reg.surface;
        const isLegacy  = reg._src === 'legacy';
        const displayName = _currentName(reg);
        const linkedBadge = reg.uuid
          ? `<span class="dd-steps-region-uuid-badge" title="${reg.uuid}"><i class="fas fa-link"></i></span>`
          : `<span class="dd-steps-region-name-badge" title="${game.i18n.localize('DRAMADIRECTOR.steps.bindByName') || 'Bound by name'}"><i class="fas fa-font"></i></span>`;
        const realIdx   = isLegacy
          ? legacy.findIndex(r => (r.uuid && reg.uuid) ? r.uuid === reg.uuid : r.name === reg.name)
          : regs.findIndex  (r => (r.uuid && reg.uuid) ? r.uuid === reg.uuid : r.name === reg.name);
        const row = document.createElement('div');
        row.className = 'dd-steps-region-row';
        row.innerHTML = `
          <div class="dd-steps-region-row-main">
            <span class="dd-steps-region-badge"><i class="fas fa-volume-up"></i> ${displayName}</span>
            ${linkedBadge}
            <span class="dd-steps-region-surface-lbl"><i class="fas fa-music"></i> ${surfLabel}</span>
            ${isLegacy ? '<span class="dd-steps-region-legacy-badge" title="Старый формат">legacy</span>' : ''}
            <button type="button" class="dd-icon-btn dd-danger-btn" title="Delete"><i class="fas fa-trash"></i></button>
          </div>`;
        row.querySelector('.dd-danger-btn').addEventListener('click', async () => {
          if (isLegacy) {
            await this._saveRegions(legacy.filter((_, j) => j !== realIdx));
          } else {
            await this._saveSoundRegions(regs.filter((_, j) => j !== realIdx));
          }
          _buildSoundRegions();
        });
        soundRegionsList.appendChild(row);
      });
    };
    this._buildSoundRegions = _buildSoundRegions;

    const soundRegionSurfaceSel = html.querySelector('#dd-steps-sound-region-surface');
    _buildSurfaceOptions(soundRegionSurfaceSel, 'rock');

    // Add by typed name. If a region with that name exists on the current
    // scene we also capture its UUID so the binding survives renames.
    html.querySelector('#dd-steps-sound-region-add')?.addEventListener('click', async () => {
      const nameInp = html.querySelector('#dd-steps-sound-region-name');
      const surfSel = html.querySelector('#dd-steps-sound-region-surface');
      const name    = nameInp?.value?.trim();
      const surfId  = surfSel?.value ?? 'rock';
      if (!name) { ui.notifications?.warn(game.i18n.localize('DRAMADIRECTOR.steps.regionNameRequired')); return; }
      const existing = this._getSoundRegions();
      const legacyEx = this._getRegions();
      if (existing.some(r => r.name.toLowerCase() === name.toLowerCase())
       || legacyEx.some(r => r.name.toLowerCase() === name.toLowerCase())) {
        ui.notifications?.warn(game.i18n.localize('DRAMADIRECTOR.steps.regionExists')); return;
      }
      const uuid = this._uuidForName(name);
      await this._saveSoundRegions([...existing, uuid ? { name, surface: surfId, uuid } : { name, surface: surfId }]);
      if (nameInp) nameInp.value = '';
      _buildSoundRegions();
    });

    // “Use selected region” — if the GM has a Region selected on the canvas,
    // pick it up by UUID directly (rename-safe even before migration runs).
    html.querySelector('#dd-steps-sound-region-pick')?.addEventListener('click', async () => {
      const surfSel = html.querySelector('#dd-steps-sound-region-surface');
      const surfId  = surfSel?.value ?? 'rock';
      const selected = (canvas?.regions?.controlled ?? []).map(r => r.document).filter(Boolean);
      if (!selected.length) {
        ui.notifications?.warn(game.i18n.localize('DRAMADIRECTOR.steps.noRegionSelected') || 'Select a region on the canvas first.');
        return;
      }
      const existing = this._getSoundRegions();
      let added = 0;
      for (const doc of selected) {
        const uuid = doc.uuid;
        const name = doc.name ?? '';
        if (existing.some(r => (r.uuid && uuid && r.uuid === uuid) || r.name?.toLowerCase() === name.toLowerCase())) continue;
        existing.push({ name, surface: surfId, uuid });
        added++;
      }
      if (added) await this._saveSoundRegions(existing);
      _buildSoundRegions();
      if (added) ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.steps.regionAddedCount', { n: added }) || `${added} added`);
    });

    // Sound region presets
    const soundRegionPresetsList = html.querySelector('#dd-steps-sound-region-presets-list');
    const _buildSoundRegionPresets = () => {
      if (!soundRegionPresetsList) return;
      soundRegionPresetsList.innerHTML = '';
      const presets = this._getSoundRegionPresets();
      if (presets.length === 0) {
        soundRegionPresetsList.innerHTML = `<div class="dd-layers-empty">${game.i18n.localize('DRAMADIRECTOR.steps.regionPresetEmpty')}</div>`;
        return;
      }
      presets.forEach((rp, i) => {
        const row = document.createElement('div');
        row.className = 'dd-steps-preset-row';
        row.innerHTML = `
          <button type="button" class="dd-steps-preset-use">
            <i class="fas fa-bookmark"></i><span>${rp.name}</span>
          </button>
          <span class="dd-steps-preset-files">${rp.regions?.length ?? 0} ${game.i18n.localize('DRAMADIRECTOR.steps.regionCount')}</span>
          <button type="button" class="dd-icon-btn dd-danger-btn" title="Delete"><i class="fas fa-trash"></i></button>`;
        row.querySelector('.dd-steps-preset-use').addEventListener('click', async () => {
          await this._saveSoundRegions(rp.regions ?? []);
          _buildSoundRegions();
          ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.steps.regionPresetLoaded', { name: rp.name }));
        });
        row.querySelector('.dd-danger-btn').addEventListener('click', async () => {
          await this._saveSoundRegionPresets(this._getSoundRegionPresets().filter((_, j) => j !== i));
          _buildSoundRegionPresets();
        });
        soundRegionPresetsList.appendChild(row);
      });
    };
    this._buildSoundRegionPresets = _buildSoundRegionPresets;

    html.querySelector('#dd-steps-sound-region-preset-save')?.addEventListener('click', async () => {
      const nameInp = html.querySelector('#dd-steps-sound-region-preset-name');
      const name    = nameInp?.value?.trim();
      if (!name) { ui.notifications?.warn(game.i18n.localize('DRAMADIRECTOR.steps.regionPresetNameRequired')); return; }
      const arr = [...this._getSoundRegionPresets(), { id: 'srpreset_' + Date.now(), name, regions: this._getSoundRegions() }];
      await this._saveSoundRegionPresets(arr);
      if (nameInp) nameInp.value = '';
      _buildSoundRegionPresets();
      ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.steps.regionPresetSaved', { name }));
    });

    // ── Distance Regions ──────────────────────────────────────────────────
    const distRegionsList = html.querySelector('#dd-steps-dist-regions-list');
    const _distGlobalFull = () => this._getSetting('stepsDistFull', 5);
    const _distGlobalMax  = () => this._getSetting('stepsDistMax', 30);
    const _fmtDist = (v, fallback) =>
      (v !== null && v !== undefined && v !== '')
        ? `<strong>${v}</strong>`
        : `<span style="opacity:.45">${fallback}</span>`;

    const _buildDistRegions = () => {
      if (!distRegionsList) return;
      distRegionsList.innerHTML = '';
      const regs = this._getDistRegions();
      if (regs.length === 0) {
        distRegionsList.innerHTML = `<div class="dd-layers-empty">${game.i18n.localize('DRAMADIRECTOR.steps.distRegionsEmpty')}</div>`;
        return;
      }
      const unitLbl = game.i18n.localize('DRAMADIRECTOR.steps.units');
      regs.forEach((reg, i) => {
        const dFullFmt = _fmtDist(reg.distFull, _distGlobalFull());
        const dMaxFmt  = _fmtDist(reg.distMax,  _distGlobalMax());
        const row = document.createElement('div');
        row.className = 'dd-steps-region-row';
        row.innerHTML = `
          <div class="dd-steps-region-row-main">
            <span class="dd-steps-region-badge dd-steps-dist-badge"><i class="fas fa-compress-alt"></i> ${reg.name}</span>
            <span class="dd-steps-region-dist-info">
              <i class="fas fa-map-marker-alt" style="color:#5ef;font-size:.7rem"></i> ${dFullFmt}
              <span style="opacity:.4;margin:0 3px">·</span>
              <i class="fas fa-map-marker-alt" style="color:#888;font-size:.7rem"></i> ${dMaxFmt}
              <span style="opacity:.4;font-size:.7rem"> ${unitLbl}</span>
            </span>
            <button type="button" class="dd-icon-btn dd-danger-btn" title="Delete"><i class="fas fa-trash"></i></button>
          </div>`;
        row.querySelector('.dd-danger-btn').addEventListener('click', async () => {
          await this._saveDistRegions(this._getDistRegions().filter((_, j) => j !== i));
          _buildDistRegions();
        });
        distRegionsList.appendChild(row);
      });
    };
    this._buildDistRegions = _buildDistRegions;

    html.querySelector('#dd-steps-dist-region-add')?.addEventListener('click', async () => {
      const nameInp  = html.querySelector('#dd-steps-dist-region-name');
      const fullInp  = html.querySelector('#dd-steps-dist-region-full');
      const maxInp   = html.querySelector('#dd-steps-dist-region-max');
      const name     = nameInp?.value?.trim();
      const rawFull  = fullInp?.value?.trim();
      const rawMax   = maxInp?.value?.trim();
      const distFull = rawFull !== '' ? parseInt(rawFull) : null;
      const distMax  = rawMax  !== '' ? parseInt(rawMax)  : null;
      if (!name) { ui.notifications?.warn(game.i18n.localize('DRAMADIRECTOR.steps.regionNameRequired')); return; }
      const existing = this._getDistRegions();
      if (existing.some(r => r.name.toLowerCase() === name.toLowerCase())) {
        ui.notifications?.warn(game.i18n.localize('DRAMADIRECTOR.steps.regionExists')); return;
      }
      const uuid = this._uuidForName(name);
      await this._saveDistRegions([...existing, uuid
        ? { name, distFull, distMax, uuid }
        : { name, distFull, distMax }]);
      if (nameInp) nameInp.value = '';
      if (fullInp) fullInp.value = '';
      if (maxInp)  maxInp.value  = '';
      _buildDistRegions();
    });

    html.querySelector('#dd-steps-dist-region-pick')?.addEventListener('click', async () => {
      const fullInp  = html.querySelector('#dd-steps-dist-region-full');
      const maxInp   = html.querySelector('#dd-steps-dist-region-max');
      const rawFull  = fullInp?.value?.trim();
      const rawMax   = maxInp?.value?.trim();
      const distFull = rawFull !== '' ? parseInt(rawFull) : null;
      const distMax  = rawMax  !== '' ? parseInt(rawMax)  : null;
      const selected = (canvas?.regions?.controlled ?? []).map(r => r.document).filter(Boolean);
      if (!selected.length) {
        ui.notifications?.warn(game.i18n.localize('DRAMADIRECTOR.steps.noRegionSelected') || 'Select a region on the canvas first.');
        return;
      }
      const existing = this._getDistRegions();
      let added = 0;
      for (const doc of selected) {
        const uuid = doc.uuid;
        const name = doc.name ?? '';
        if (existing.some(r => (r.uuid && uuid && r.uuid === uuid) || r.name?.toLowerCase() === name.toLowerCase())) continue;
        existing.push({ name, distFull, distMax, uuid });
        added++;
      }
      if (added) await this._saveDistRegions(existing);
      _buildDistRegions();
      if (added) ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.steps.regionAddedCount', { n: added }) || `${added} added`);
    });

    // Dist region presets
    const distRegionPresetsList = html.querySelector('#dd-steps-dist-region-presets-list');
    const _buildDistRegionPresets = () => {
      if (!distRegionPresetsList) return;
      distRegionPresetsList.innerHTML = '';
      const presets = this._getDistRegionPresets();
      if (presets.length === 0) {
        distRegionPresetsList.innerHTML = `<div class="dd-layers-empty">${game.i18n.localize('DRAMADIRECTOR.steps.regionPresetEmpty')}</div>`;
        return;
      }
      presets.forEach((rp, i) => {
        const row = document.createElement('div');
        row.className = 'dd-steps-preset-row';
        row.innerHTML = `
          <button type="button" class="dd-steps-preset-use">
            <i class="fas fa-bookmark"></i><span>${rp.name}</span>
          </button>
          <span class="dd-steps-preset-files">${rp.regions?.length ?? 0} ${game.i18n.localize('DRAMADIRECTOR.steps.regionCount')}</span>
          <button type="button" class="dd-icon-btn dd-danger-btn" title="Delete"><i class="fas fa-trash"></i></button>`;
        row.querySelector('.dd-steps-preset-use').addEventListener('click', async () => {
          await this._saveDistRegions(rp.regions ?? []);
          _buildDistRegions();
          ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.steps.regionPresetLoaded', { name: rp.name }));
        });
        row.querySelector('.dd-danger-btn').addEventListener('click', async () => {
          await this._saveDistRegionPresets(this._getDistRegionPresets().filter((_, j) => j !== i));
          _buildDistRegionPresets();
        });
        distRegionPresetsList.appendChild(row);
      });
    };
    this._buildDistRegionPresets = _buildDistRegionPresets;

    html.querySelector('#dd-steps-dist-region-preset-save')?.addEventListener('click', async () => {
      const nameInp = html.querySelector('#dd-steps-dist-region-preset-name');
      const name    = nameInp?.value?.trim();
      if (!name) { ui.notifications?.warn(game.i18n.localize('DRAMADIRECTOR.steps.regionPresetNameRequired')); return; }
      const arr = [...this._getDistRegionPresets(), { id: 'drpreset_' + Date.now(), name, regions: this._getDistRegions() }];
      await this._saveDistRegionPresets(arr);
      if (nameInp) nameInp.value = '';
      _buildDistRegionPresets();
      ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.steps.regionPresetSaved', { name }));
    });

    // ── Init ──────────────────────────────────────────────────────────────
    _buildGrid();
    _buildPresets();
    _buildSoundRegions();
    _buildSoundRegionPresets();
    _buildDistRegions();
    _buildDistRegionPresets();

  } // end _onRender

} // end StepsPanel
