// A small iOS-picker-style wheel: a snap-scrolling list of options where the
// centered item is the selected value. Works with mouse wheel, touch drag,
// arrow keys, and direct clicks on visible items.

const ITEM_HEIGHT = 36;

export class Wheel {
  constructor({ container, options, index = 0, label, onChange }) {
    this.container = container;
    this.options = options;
    this.onChange = onChange;
    this.index = index;
    this._settleTimer = null;
    this._rafId = null;
    this._build(label);
    this.scrollToIndex(index, false);
  }

  _build(label) {
    this.container.classList.add('wheel');
    this.container.setAttribute('tabindex', '0');
    this.container.setAttribute('role', 'listbox');
    if (label) this.container.setAttribute('aria-label', label);
    this.container.innerHTML = '';

    const track = document.createElement('div');
    track.className = 'wheel-track';
    track.style.paddingTop = `${ITEM_HEIGHT}px`;
    track.style.paddingBottom = `${ITEM_HEIGHT}px`;

    this.items = this.options.map((text, i) => {
      const item = document.createElement('div');
      item.className = 'wheel-item';
      item.textContent = text;
      item.dataset.index = String(i);
      item.style.height = `${ITEM_HEIGHT}px`;
      item.addEventListener('click', () => this.scrollToIndex(i, true));
      track.appendChild(item);
      return item;
    });

    this.container.appendChild(track);
    this.track = track;

    this.container.addEventListener('scroll', () => this._onScroll(), { passive: true });
    this.container.addEventListener('keydown', (e) => this._onKeydown(e));
  }

  _onKeydown(e) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.scrollToIndex(Math.max(0, this.index - 1), true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.scrollToIndex(Math.min(this.options.length - 1, this.index + 1), true);
    }
  }

  _onScroll() {
    this._updateVisualState();
    clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => this._settle(), 90);
  }

  _updateVisualState() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      const centerY = this.container.scrollTop + this.container.clientHeight / 2;
      this.items.forEach((item) => {
        const itemCenter = item.offsetTop + ITEM_HEIGHT / 2;
        const distance = Math.abs(itemCenter - centerY) / ITEM_HEIGHT;
        const opacity = Math.max(0.22, 1 - distance * 0.55);
        const scale = Math.max(0.72, 1 - distance * 0.18);
        item.style.opacity = String(opacity);
        item.style.transform = `scale(${scale})`;
      });
    });
  }

  _settle() {
    const centerY = this.container.scrollTop + this.container.clientHeight / 2;
    let nearest = 0;
    let nearestDist = Infinity;
    this.items.forEach((item, i) => {
      const itemCenter = item.offsetTop + ITEM_HEIGHT / 2;
      const dist = Math.abs(itemCenter - centerY);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    this.scrollToIndex(nearest, true);
  }

  scrollToIndex(i, animate) {
    const changed = i !== this.index;
    this.index = i;
    const item = this.items[i];
    if (item) {
      const target = item.offsetTop + ITEM_HEIGHT / 2 - this.container.clientHeight / 2;
      this.container.scrollTo({ top: target, behavior: animate ? 'smooth' : 'auto' });
    }
    this.items.forEach((el, idx) => el.classList.toggle('is-selected', idx === i));
    this._updateVisualState();
    if (changed && this.onChange) this.onChange(i);
  }
}
