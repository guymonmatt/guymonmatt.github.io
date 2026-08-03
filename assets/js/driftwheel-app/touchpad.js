// A 2D XY touch/drag surface. Reports normalized (x, y) in [0, 1] with
// (0, 0) at the top-left, via Pointer Events so mouse, touch, and pen all
// work through one code path.
export class TouchPad {
  constructor({ container, x = 0.5, y = 0.5, onChange }) {
    this.container = container;
    this.onChange = onChange || null;
    this.x = x;
    this.y = y;
    this._build();
    this._render();
  }

  _build() {
    this.container.classList.add('touchpad');
    this.container.innerHTML = '';

    this.handle = document.createElement('div');
    this.handle.className = 'touchpad-handle';
    this.container.appendChild(this.handle);

    this.container.addEventListener('pointerdown', (e) => this._onPointerDown(e));
  }

  _onPointerDown(e) {
    e.preventDefault();
    this.container.setPointerCapture(e.pointerId);
    this._updateFromEvent(e);

    const onMove = (ev) => this._updateFromEvent(ev);
    const onUp = () => {
      this.container.removeEventListener('pointermove', onMove);
      this.container.removeEventListener('pointerup', onUp);
      this.container.removeEventListener('pointercancel', onUp);
    };
    this.container.addEventListener('pointermove', onMove);
    this.container.addEventListener('pointerup', onUp);
    this.container.addEventListener('pointercancel', onUp);
  }

  _updateFromEvent(e) {
    const rect = this.container.getBoundingClientRect();
    const x = rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
    const y = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
    this.setValue(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
  }

  setValue(x, y) {
    this.x = x;
    this.y = y;
    this._render();
    if (this.onChange) this.onChange(this.x, this.y);
  }

  _render() {
    this.handle.style.left = `${this.x * 100}%`;
    this.handle.style.top = `${this.y * 100}%`;
  }
}
