---
---
import { NOTE_NAMES, CHORD_TYPES, TONES } from './theory.js?v={{ site.time | date: '%s' }}';

export const STEP_COUNT = 8;

// A grid of tappable step tiles. Each step is either null (a rest) or
// { rootIndex, chordTypeIndex, toneIndex }. Tapping an empty tile fills it
// (via onSelect, the caller decides with what); tapping a filled tile
// selects it for editing; tapping the selected tile again deselects it.
export class Sequencer {
  constructor({ container, onSelect, onChange }) {
    this.container = container;
    this.onSelect = onSelect || null;
    this.onChange = onChange || null;
    this.steps = new Array(STEP_COUNT).fill(null);
    this.selectedIndex = null;
    this.playingIndex = null;
    this._build();
  }

  _build() {
    this.container.innerHTML = '';
    this.tiles = this.steps.map((_, i) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'seq-tile';
      tile.setAttribute('role', 'listitem');
      tile.addEventListener('click', () => this._onTileClick(i));
      this.container.appendChild(tile);
      return tile;
    });
    this._renderAll();
  }

  _onTileClick(i) {
    this.selectedIndex = this.selectedIndex === i ? null : i;
    this._renderAll();
    if (this.onSelect) this.onSelect(this.selectedIndex, this.selectedIndex === null ? null : this.steps[this.selectedIndex]);
  }

  // Fill (or update) the currently-selected step. No-op if nothing selected.
  setSelectedStep(data) {
    if (this.selectedIndex === null) return;
    this.steps[this.selectedIndex] = data;
    this._renderAll();
    if (this.onChange) this.onChange(this.steps);
  }

  clearSelectedStep() {
    if (this.selectedIndex === null) return;
    this.steps[this.selectedIndex] = null;
    this._renderAll();
    if (this.onChange) this.onChange(this.steps);
  }

  setPlayingIndex(i) {
    this.playingIndex = i;
    this._renderAll();
  }

  _renderAll() {
    this.tiles.forEach((_, i) => this._renderTile(i));
  }

  _renderTile(i) {
    const tile = this.tiles[i];
    const step = this.steps[i];
    tile.classList.toggle('is-selected', i === this.selectedIndex);
    tile.classList.toggle('is-playing', i === this.playingIndex);

    if (step) {
      const hue = Math.round((step.rootIndex / 12) * 360);
      const chordName = `${NOTE_NAMES[step.rootIndex]} ${CHORD_TYPES[step.chordTypeIndex].name}`;
      const toneName = TONES[step.toneIndex].short;
      tile.classList.add('is-filled');
      tile.style.setProperty('--tile-hue', String(hue));
      tile.innerHTML = '';
      const chordSpan = document.createElement('span');
      chordSpan.className = 'seq-tile-chord';
      chordSpan.textContent = chordName;
      const toneSpan = document.createElement('span');
      toneSpan.className = 'seq-tile-tone';
      toneSpan.textContent = toneName;
      tile.append(chordSpan, toneSpan);
      tile.setAttribute('aria-label', `Step ${i + 1}, ${chordName}, ${toneName}`);
    } else {
      tile.classList.remove('is-filled');
      tile.style.removeProperty('--tile-hue');
      tile.innerHTML = '';
      const emptySpan = document.createElement('span');
      emptySpan.className = 'seq-tile-empty';
      emptySpan.textContent = '+';
      tile.append(emptySpan);
      tile.setAttribute('aria-label', `Step ${i + 1}, empty`);
    }
  }
}
