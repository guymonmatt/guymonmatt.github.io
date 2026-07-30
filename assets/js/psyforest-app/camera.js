// Thin wrapper around getUserMedia: stream lifecycle + front/back camera toggle.
// Nothing here ever leaves the device — the stream is only ever read locally.

export class Camera {
  constructor(videoEl) {
    this.videoEl = videoEl;
    this.stream = null;
    this.facingMode = "user";
    this.canFlip = false;
  }

  static isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  async start(facingMode = this.facingMode) {
    this.stop();

    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.facingMode = facingMode;
    this.videoEl.srcObject = this.stream;

    await new Promise((resolve) => {
      if (this.videoEl.readyState >= 2) return resolve();
      this.videoEl.onloadedmetadata = () => resolve();
    });
    await this.videoEl.play();

    this._detectMultipleCameras();
    return this.stream;
  }

  async flip() {
    const next = this.facingMode === "user" ? "environment" : "user";
    await this.start(next);
    return this.facingMode;
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }

  async _detectMultipleCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      this.canFlip = cams.length > 1;
    } catch {
      this.canFlip = false;
    }
  }

  static describeError(err) {
    if (!err) return "Camera access was denied or isn't available on this device.";
    switch (err.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "Camera access was denied. Allow camera access in your browser settings and try again.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No camera was found on this device.";
      case "NotReadableError":
      case "TrackStartError":
        return "The camera is already in use by another app.";
      case "OverconstrainedError":
        return "This device doesn't support the requested camera mode.";
      default:
        return "Camera access failed. Try reloading the page.";
    }
  }
}
