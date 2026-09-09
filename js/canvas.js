/**
 * Bocetos - Canvas Engine Module
 * Motor de renderizado multicapa con soporte HiDPI para iPad
 * Incluye auto-encaje inteligente por cuadrícula y calibrador de 4 esquinas
 */

class CanvasEngine {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');

    // Imágenes cargadas en memoria
    this.referenceImg = null;
    this.sketchImg = null;
    this.referenceUrl = null;
    this.sketchUrl = null;

    // Dimensiones lógicas y de referencia
    this.viewport = {
      width: 0,
      height: 0,
      dpr: window.devicePixelRatio || 1
    };

    // Rectángulo donde se dibuja la imagen de referencia dentro del canvas
    this.refBounds = { x: 0, y: 0, width: 0, height: 0 };

    // Configuración de Cuadrícula
    this.gridConfig = {
      rows: 4,
      cols: 4,
      squareCells: false,
      color: '#00e5ff',
      lineWidth: 2,
      showDiagonals: false,
      showLabels: true,
      visible: true
    };

    // Visibilidad de capas
    this.layers = {
      reference: true,
      grid: true,
      sketch: true
    };

    // Filtros de referencia (ej. escala de grises para artistas)
    this.refFilters = {
      grayscale: false,
      contrast: 100
    };

    // Transformación del boceto superior
    this.sketchTransform = {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0, // en grados
      flipH: false,
      flipV: false,
      opacity: 0.65,
      blendMode: 'difference' // 'difference', 'multiply', 'normal', 'screen', 'overlay'
    };

    // Zoom y Pan del visor global (para examinar detalles en iPad)
    this.viewTransform = {
      zoom: 1,
      panX: 0,
      panY: 0
    };

    // Estado del Calibrador de 4 Esquinas y Deformación de Perspectiva
    this.isCalibrating = false;
    this.calibrationCorners = []; // [{x, y}, {x, y}, {x, y}, {x, y}]
    this.calibratedSketchCanvas = null; // Canvas rectificado en perspectiva 1:1 con refBounds
    this.savedCalibration = null; // Esquinas originales guardadas [S0, S1, S2, S3]
    this.activeCornerDragIndex = -1; // Índice de la esquina arrastrada actualmente (0..3)

    // Modos de interacción: 'transform_sketch' | 'explore_canvas' | 'calibrate_corners'
    this.interactionMode = 'transform_sketch';

    this.initResizeObserver();
  }

  initResizeObserver() {
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    if (this.canvas.parentElement) {
      this.resizeObserver.observe(this.canvas.parentElement);
    }
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.viewport.width = rect.width;
      this.viewport.height = rect.height;
    } else {
      // Fallback a ventana si el padre aún no se ha renderizado
      this.viewport.width = window.innerWidth;
      this.viewport.height = window.innerHeight - 56;
    }
    this.viewport.dpr = window.devicePixelRatio || 1;

    this.canvas.width = Math.round(this.viewport.width * this.viewport.dpr);
    this.canvas.height = Math.round(this.viewport.height * this.viewport.dpr);

    this.canvas.style.width = `${this.viewport.width}px`;
    this.canvas.style.height = `${this.viewport.height}px`;

    this.calculateRefBounds();
    this.render();
  }

  /**
   * Calcula el encaje ("contain") de la imagen de referencia dentro del canvas
   */
  calculateRefBounds() {
    if (this.viewport.width <= 0 || this.viewport.height <= 0) {
      const parent = this.canvas.parentElement;
      if (parent) {
        const rect = parent.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          this.viewport.width = rect.width;
          this.viewport.height = rect.height;
          this.viewport.dpr = window.devicePixelRatio || 1;
          this.canvas.width = Math.round(this.viewport.width * this.viewport.dpr);
          this.canvas.height = Math.round(this.viewport.height * this.viewport.dpr);
          this.canvas.style.width = `${this.viewport.width}px`;
          this.canvas.style.height = `${this.viewport.height}px`;
        }
      }
    }

    const currentW = this.viewport.width > 0 ? this.viewport.width : (window.innerWidth || 800);
    const currentH = this.viewport.height > 0 ? this.viewport.height : (window.innerHeight - 56 || 600);

    if (!this.referenceImg) {
      this.refBounds = {
        x: currentW * 0.1,
        y: currentH * 0.1,
        width: currentW * 0.8,
        height: currentH * 0.8
      };
      return;
    }

    const padding = 28; // margen ergonómico
    const availW = Math.max(100, currentW - padding * 2);
    const availH = Math.max(100, currentH - padding * 2);

    const imgW = this.referenceImg.naturalWidth || this.referenceImg.width || 1;
    const imgH = this.referenceImg.naturalHeight || this.referenceImg.height || 1;

    const imgAspect = imgW / imgH;
    const availAspect = availW / availH;

    let drawW, drawH;

    if (imgAspect > availAspect) {
      drawW = availW;
      drawH = availW / imgAspect;
    } else {
      drawH = availH;
      drawW = availH * imgAspect;
    }

    const x = (currentW - drawW) / 2;
    const y = (currentH - drawH) / 2;

    this.refBounds = { x, y, width: drawW, height: drawH };
  }

  async loadReferenceBlob(blob) {
    return new Promise((resolve, reject) => {
      if (this.referenceUrl) {
        URL.revokeObjectURL(this.referenceUrl);
      }
      const url = URL.createObjectURL(blob);
      this.referenceUrl = url;

      const img = new Image();
      img.onload = () => {
        this.referenceImg = img;
        this.calculateRefBounds();
        this.render();
        resolve(img);
      };

      img.onerror = (err) => {
        reject(err);
      };

      img.src = url;
    });
  }

  async loadSketchBlob(blob) {
    return new Promise((resolve, reject) => {
      if (this.sketchUrl) {
        URL.revokeObjectURL(this.sketchUrl);
      }
      const url = URL.createObjectURL(blob);
      this.sketchUrl = url;

      const img = new Image();
      img.onload = () => {
        this.sketchImg = img;
        this.calibratedSketchCanvas = null;
        this.savedCalibration = null;
        this.render();
        resolve(img);
      };

      img.onerror = (err) => {
        reject(err);
      };

      img.src = url;
    });
  }

  clearSketch() {
    this.sketchImg = null;
    this.calibratedSketchCanvas = null;
    this.savedCalibration = null;
    this.isCalibrating = false;
    this.activeCornerDragIndex = -1;
    this.render();
  }

  setGridConfig(newConfig) {
    this.gridConfig = { ...this.gridConfig, ...newConfig };
    this.render();
  }

  setSketchTransform(newTransform) {
    this.sketchTransform = { ...this.sketchTransform, ...newTransform };
    this.render();
  }

  setLayerVisibility(layerName, visible) {
    const key = layerName.replace('Visible', '');
    if (this.layers[key] !== undefined) {
      this.layers[key] = !!visible;
      this.render();
    }
  }

  resetViewTransform() {
    this.viewTransform = { zoom: 1, panX: 0, panY: 0 };
    this.render();
  }

  resetSketchTransform() {
    this.calibratedSketchCanvas = null;
    this.savedCalibration = null;
    this.sketchTransform = {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      flipH: false,
      flipV: false,
      opacity: this.sketchTransform.opacity,
      blendMode: this.sketchTransform.blendMode
    };
    this.render();
  }

  /**
   * Conversión exacta de coordenadas de pantalla/viewport al espacio de píxeles
   * de la imagen original del boceto (sketchImg).
   */
  screenToSketchCoords(screenX, screenY) {
    if (!this.sketchImg) return { x: 0, y: 0 };

    const { x: refX, y: refY, width: refW, height: refH } = this.refBounds;
    const { scale, offsetX, offsetY, rotation, flipH, flipV } = this.sketchTransform;
    const sketchW = this.sketchImg.naturalWidth || this.sketchImg.width || 1;
    const sketchH = this.sketchImg.naturalHeight || this.sketchImg.height || 1;

    const sketchAspect = sketchW / sketchH;
    const refAspect = refW / refH;

    let baseW, baseH;
    if (sketchAspect > refAspect) {
      baseW = refW;
      baseH = refW / sketchAspect;
    } else {
      baseH = refH;
      baseW = refH * sketchAspect;
    }

    const centerX = refX + refW / 2 + offsetX;
    const centerY = refY + refH / 2 + offsetY;

    let dx = screenX - centerX;
    let dy = screenY - centerY;

    if (rotation) {
      const rad = (-rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      dx = rx;
      dy = ry;
    }

    const scaleX = (flipH ? -1 : 1) * (scale || 1);
    const scaleY = (flipV ? -1 : 1) * (scale || 1);
    const x0 = dx / scaleX;
    const y0 = dy / scaleY;

    const imgX = (x0 / baseW + 0.5) * sketchW;
    const imgY = (y0 / baseH + 0.5) * sketchH;

    return {
      x: Math.max(0, Math.min(sketchW, imgX)),
      y: Math.max(0, Math.min(sketchH, imgY))
    };
  }

  /**
   * Conversión del espacio de píxeles de la foto original a coordenadas del viewport del canvas.
   */
  sketchToScreenCoords(imgX, imgY) {
    if (!this.sketchImg) return { x: 0, y: 0 };

    const { x: refX, y: refY, width: refW, height: refH } = this.refBounds;
    const { scale, offsetX, offsetY, rotation, flipH, flipV } = this.sketchTransform;
    const sketchW = this.sketchImg.naturalWidth || this.sketchImg.width || 1;
    const sketchH = this.sketchImg.naturalHeight || this.sketchImg.height || 1;

    const sketchAspect = sketchW / sketchH;
    const refAspect = refW / refH;

    let baseW, baseH;
    if (sketchAspect > refAspect) {
      baseW = refW;
      baseH = refW / sketchAspect;
    } else {
      baseH = refH;
      baseW = refH * sketchAspect;
    }

    const x0 = (imgX / sketchW - 0.5) * baseW;
    const y0 = (imgY / sketchH - 0.5) * baseH;

    const scaleX = (flipH ? -1 : 1) * (scale || 1);
    const scaleY = (flipV ? -1 : 1) * (scale || 1);
    let dx = x0 * scaleX;
    let dy = y0 * scaleY;

    if (rotation) {
      const rad = (rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      dx = rx;
      dy = ry;
    }

    const centerX = refX + refW / 2 + offsetX;
    const centerY = refY + refH / 2 + offsetY;

    return {
      x: Math.round(centerX + dx),
      y: Math.round(centerY + dy)
    };
  }

  /**
   * Resuelve la matriz de Homografía 3x3 para transformar src -> dst
   */
  static calculateHomography(src, dst) {
    const A = [];
    for (let i = 0; i < 4; i++) {
      const sx = src[i].x, sy = src[i].y;
      const dx = dst[i].x, dy = dst[i].y;
      A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy, -dx]);
      A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy, -dy]);
    }

    // Eliminación Gaussiana con pivoteo parcial
    for (let i = 0; i < 8; i++) {
      let maxRow = i;
      for (let k = i + 1; k < 8; k++) {
        if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
      }
      const tmp = A[i]; A[i] = A[maxRow]; A[maxRow] = tmp;
      if (Math.abs(A[i][i]) < 1e-10) continue;

      for (let k = i + 1; k < 8; k++) {
        const factor = A[k][i] / A[i][i];
        for (let j = i; j < 9; j++) {
          A[k][j] -= factor * A[i][j];
        }
      }
    }

    const h = new Array(9);
    h[8] = 1;
    for (let i = 7; i >= 0; i--) {
      let sum = A[i][8] * h[8];
      for (let j = i + 1; j < 8; j++) sum += A[i][j] * h[j];
      h[i] = Math.abs(A[i][i]) > 1e-10 ? -sum / A[i][i] : 0;
    }
    return h;
  }

  /**
   * Deforma un cuadrilátero a un rectángulo plano mediante Homografía y muestreo bilineal.
   * Elimina toda distorsión de perspectiva, inclinación o ángulo de la cámara.
   */
  warpQuadToRect(sourceImg, srcCorners, targetW, targetH) {
    const srcW = sourceImg.naturalWidth || sourceImg.width;
    const srcH = sourceImg.naturalHeight || sourceImg.height;

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = srcW;
    srcCanvas.height = srcH;
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
    srcCtx.drawImage(sourceImg, 0, 0);
    const srcData = srcCtx.getImageData(0, 0, srcW, srcH);
    const srcPixels = new Uint32Array(srcData.data.buffer);

    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = targetW;
    dstCanvas.height = targetH;
    const dstCtx = dstCanvas.getContext('2d', { willReadFrequently: true });
    const dstData = dstCtx.createImageData(targetW, targetH);
    const dstPixels = new Uint32Array(dstData.data.buffer);

    const dstCorners = [
      { x: 0, y: 0 },
      { x: targetW, y: 0 },
      { x: targetW, y: targetH },
      { x: 0, y: targetH }
    ];

    const Hinv = CanvasEngine.calculateHomography(dstCorners, srcCorners);

    const h0 = Hinv[0], h1 = Hinv[1], h2 = Hinv[2];
    const h3 = Hinv[3], h4 = Hinv[4], h5 = Hinv[5];
    const h6 = Hinv[6], h7 = Hinv[7], h8 = Hinv[8];

    let dstIdx = 0;
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const w = h6 * x + h7 * y + h8;
        if (w !== 0) {
          const invW = 1.0 / w;
          const sx = (h0 * x + h1 * y + h2) * invW;
          const sy = (h3 * x + h4 * y + h5) * invW;

          const ix = Math.floor(sx);
          const iy = Math.floor(sy);

          if (ix >= 0 && ix < srcW - 1 && iy >= 0 && iy < srcH - 1) {
            const fx = sx - ix;
            const fy = sy - iy;
            const p00 = srcPixels[iy * srcW + ix];
            const p10 = srcPixels[iy * srcW + (ix + 1)];
            const p01 = srcPixels[(iy + 1) * srcW + ix];
            const p11 = srcPixels[(iy + 1) * srcW + (ix + 1)];

            const r = ((p00 & 0xff) * (1 - fx) + (p10 & 0xff) * fx) * (1 - fy) +
                      (((p01 & 0xff) * (1 - fx) + (p11 & 0xff) * fx)) * fy;
            const g = (((p00 >> 8) & 0xff) * (1 - fx) + ((p10 >> 8) & 0xff) * fx) * (1 - fy) +
                      ((((p01 >> 8) & 0xff) * (1 - fx) + ((p11 >> 8) & 0xff) * fx)) * fy;
            const b = (((p00 >> 16) & 0xff) * (1 - fx) + ((p10 >> 16) & 0xff) * fx) * (1 - fy) +
                      ((((p01 >> 16) & 0xff) * (1 - fx) + ((p11 >> 16) & 0xff) * fx)) * fy;
            const a = (((p00 >> 24) & 0xff) * (1 - fx) + ((p10 >> 24) & 0xff) * fx) * (1 - fy) +
                      ((((p01 >> 24) & 0xff) * (1 - fx) + ((p11 >> 24) & 0xff) * fx)) * fy;

            dstPixels[dstIdx] = (Math.round(a) << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r);
          } else if (ix >= 0 && ix < srcW && iy >= 0 && iy < srcH) {
            dstPixels[dstIdx] = srcPixels[iy * srcW + ix];
          }
        }
        dstIdx++;
      }
    }

    dstCtx.putImageData(dstData, 0, 0);
    return dstCanvas;
  }

  /* ========================================================
   * AUTO-ENCAJE INTELIGENTE POR CUADRÍCULA O PAPEL
   * ======================================================== */

  autoAlignSketchWithGrid() {
    if (!this.sketchImg || !this.referenceImg) return false;

    try {
      const sketchNatW = this.sketchImg.naturalWidth || this.sketchImg.width || 1;
      const sketchNatH = this.sketchImg.naturalHeight || this.sketchImg.height || 1;

      // 1. Análisis rápido de luminancia para detectar la hoja de papel blanca
      const sampleW = 380;
      const sampleH = Math.round((sampleW * sketchNatH) / sketchNatW);

      const offCanvas = document.createElement('canvas');
      offCanvas.width = sampleW;
      offCanvas.height = sampleH;
      const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
      offCtx.drawImage(this.sketchImg, 0, 0, sampleW, sampleH);

      const imgData = offCtx.getImageData(0, 0, sampleW, sampleH);
      const data = imgData.data;

      const gray = new Float32Array(sampleW * sampleH);
      let minLum = 255, maxLum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const val = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        gray[i / 4] = val;
        if (val < minLum) minLum = val;
        if (val > maxLum) maxLum = val;
      }

      // El papel es significativamente más claro que el tablero de soporte
      const paperThreshold = minLum + (maxLum - minLum) * 0.58;
      const colBright = new Float32Array(sampleW);
      const rowBright = new Float32Array(sampleH);

      for (let y = 0; y < sampleH; y++) {
        for (let x = 0; x < sampleW; x++) {
          if (gray[y * sampleW + x] >= paperThreshold) {
            colBright[x]++;
            rowBright[y]++;
          }
        }
      }

      let minX = 0, maxX = sampleW - 1, minY = 0, maxY = sampleH - 1;
      const minColCount = sampleH * 0.22;
      const minRowCount = sampleW * 0.22;

      for (let x = 0; x < sampleW; x++) {
        if (colBright[x] >= minColCount) { minX = x; break; }
      }
      for (let x = sampleW - 1; x >= 0; x--) {
        if (colBright[x] >= minColCount) { maxX = x; break; }
      }
      for (let y = 0; y < sampleH; y++) {
        if (rowBright[y] >= minRowCount) { minY = y; break; }
      }
      for (let y = sampleH - 1; y >= 0; y--) {
        if (rowBright[y] >= minRowCount) { maxY = y; break; }
      }

      // Si detectamos los límites del papel de dibujo (mínimo 30% del encuadre)
      if ((maxX - minX) > sampleW * 0.30 && (maxY - minY) > sampleH * 0.30) {
        const S0 = { x: (minX / sampleW) * sketchNatW, y: (minY / sampleH) * sketchNatH };
        const S1 = { x: (maxX / sampleW) * sketchNatW, y: (minY / sampleH) * sketchNatH };
        const S2 = { x: (maxX / sampleW) * sketchNatW, y: (maxY / sampleH) * sketchNatH };
        const S3 = { x: (minX / sampleW) * sketchNatW, y: (maxY / sampleH) * sketchNatH };

        const { width: refW, height: refH } = this.refBounds;
        const dpr = window.devicePixelRatio || 2;
        const targetW = Math.max(1200, Math.min(2048, Math.round(refW * dpr)));
        const targetH = Math.round(targetW * (refH / refW));

        const warped = this.warpQuadToRect(this.sketchImg, [S0, S1, S2, S3], targetW, targetH);
        this.calibratedSketchCanvas = warped;
        this.savedCalibration = [S0, S1, S2, S3];

        this.sketchTransform.scale = 1.0;
        this.sketchTransform.offsetX = 0;
        this.sketchTransform.offsetY = 0;
        this.sketchTransform.rotation = 0;
        this.sketchTransform.flipH = false;
        this.sketchTransform.flipV = false;

        this.render();
        return true;
      }

      return false;
    } catch (err) {
      console.warn('Auto-encaje por papel/cuadrícula falló:', err);
      return false;
    }
  }

  /* ========================================================
   * CALIBRADOR INTERACTIVO DE 4 ESQUINAS (RECTIFICACIÓN PERSPECTIVA)
   * ======================================================== */

  startCalibration() {
    if (!this.sketchImg) return;
    this.isCalibrating = true;
    this.activeCornerDragIndex = -1;
    this.resetViewTransform();

    const sketchW = this.sketchImg.naturalWidth || this.sketchImg.width || 1;
    const sketchH = this.sketchImg.naturalHeight || this.sketchImg.height || 1;

    // Si ya teníamos esquinas guardadas previamente, colocarlas donde estaban
    if (this.savedCalibration && this.savedCalibration.length === 4) {
      this.calibrationCorners = this.savedCalibration.map(pt => this.sketchToScreenCoords(pt.x, pt.y));
    } else {
      // Iniciar las 4 esquinas sobre la foto del boceto con un margen accesible del 12%
      this.calibrationCorners = [
        this.sketchToScreenCoords(sketchW * 0.12, sketchH * 0.12), // 0: Top-Left
        this.sketchToScreenCoords(sketchW * 0.88, sketchH * 0.12), // 1: Top-Right
        this.sketchToScreenCoords(sketchW * 0.88, sketchH * 0.88), // 2: Bottom-Right
        this.sketchToScreenCoords(sketchW * 0.12, sketchH * 0.88)  // 3: Bottom-Left
      ];
    }

    this.render();
  }

  applyCalibrationCorners() {
    if (!this.isCalibrating || this.calibrationCorners.length !== 4 || !this.sketchImg) {
      this.isCalibrating = false;
      this.render();
      return;
    }

    const [p0, p1, p2, p3] = this.calibrationCorners;
    const { width: refW, height: refH } = this.refBounds;

    // 1. Obtener las 4 esquinas exactas en el espacio de píxeles de la foto original
    const S0 = this.screenToSketchCoords(p0.x, p0.y);
    const S1 = this.screenToSketchCoords(p1.x, p1.y);
    const S2 = this.screenToSketchCoords(p2.x, p2.y);
    const S3 = this.screenToSketchCoords(p3.x, p3.y);

    // 2. Dimensiones de destino de alta resolución para iPad Retina
    const dpr = window.devicePixelRatio || 2;
    const targetW = Math.max(1200, Math.min(2048, Math.round(refW * dpr)));
    const targetH = Math.round(targetW * (refH / refW));

    // 3. Rectificar perspectiva mediante homografía bilineal
    const warpedCanvas = this.warpQuadToRect(this.sketchImg, [S0, S1, S2, S3], targetW, targetH);
    this.calibratedSketchCanvas = warpedCanvas;

    // 4. Guardar esquinas originales de calibración para persistencia
    this.savedCalibration = [S0, S1, S2, S3];

    // 5. Restablecer transformaciones (el warpedCanvas ahora encaja 1:1 exactamente en refBounds)
    this.sketchTransform.scale = 1.0;
    this.sketchTransform.offsetX = 0;
    this.sketchTransform.offsetY = 0;
    this.sketchTransform.rotation = 0;
    this.sketchTransform.flipH = false;
    this.sketchTransform.flipV = false;

    this.isCalibrating = false;
    this.activeCornerDragIndex = -1;
    this.render();
  }

  cancelCalibration() {
    this.isCalibrating = false;
    this.render();
  }

  /* ========================================================
   * PIPELINE DE RENDERIZADO
   * ======================================================== */

  render() {
    const ctx = this.ctx;
    const dpr = this.viewport.dpr || 1;
    const w = this.viewport.width;
    const h = this.viewport.height;

    ctx.save();
    // Limpiar canvas completo
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Ajuste a escala retina y transformación global de visor (Pan/Zoom del lienzo)
    ctx.scale(dpr, dpr);

    // Aplicar transformación del visor global
    ctx.translate(w / 2 + this.viewTransform.panX, h / 2 + this.viewTransform.panY);
    ctx.scale(this.viewTransform.zoom, this.viewTransform.zoom);
    ctx.translate(-w / 2, -h / 2);

    // Fondo oscuro sutil para el área del lienzo de trabajo
    ctx.fillStyle = '#161618';
    ctx.fillRect(0, 0, w, h);

    // 1. CAPA INFERIOR: FOTO ORIGINAL DE REFERENCIA
    if (this.layers.reference && this.referenceImg) {
      this.drawReferenceLayer(ctx);
    }

    // 2. CAPA SUPERIOR: FOTO DEL BOCETO (SUPERPOSICIÓN)
    if (this.layers.sketch && this.sketchImg) {
      this.drawSketchLayer(ctx);
    }

    // 3. CAPA INTERMEDIA / SUPERIOR DE GUÍA: CUADRÍCULA PARAMÉTRICA
    // Se dibuja encima para que las guías de encaje siempre sean visibles contra el boceto y la referencia
    if (this.layers.grid && this.gridConfig.visible) {
      this.drawGridLayer(ctx);
    }

    // 4. CAPA DE CALIBRACIÓN DE 4 ESQUINAS (SI ESTÁ ACTIVA)
    if (this.isCalibrating) {
      this.drawCalibrationLayer(ctx);
    }

    ctx.restore();
  }

  drawReferenceLayer(ctx) {
    const { x, y, width, height } = this.refBounds;
    if (width <= 0 || height <= 0) return;

    ctx.save();
    // Sombra suave para separar la referencia del fondo
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;

    // Filtros visuales (escala de grises / contraste para estudio de valores)
    let filterString = '';
    if (this.refFilters.grayscale) {
      filterString += 'grayscale(100%) ';
    }
    if (this.refFilters.contrast !== 100) {
      filterString += `contrast(${this.refFilters.contrast}%) `;
    }
    if (filterString) {
      ctx.filter = filterString.trim();
    }

    ctx.drawImage(this.referenceImg, x, y, width, height);
    ctx.restore();
  }

  drawGridLayer(ctx) {
    const { x, y, width, height } = this.refBounds;
    const { rows, cols, color, lineWidth, showDiagonals, showLabels, squareCells } = this.gridConfig;

    if (cols <= 0 || width <= 0 || height <= 0) return;

    let cellW, cellH, effectiveRows;

    if (squareCells) {
      cellW = width / cols;
      cellH = cellW; // Cuadrados perfectos 1:1
      effectiveRows = Math.ceil(height / cellH);
    } else {
      if (rows <= 0) return;
      cellW = width / cols;
      cellH = height / rows;
      effectiveRows = rows;
    }

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'square';

    // Borde exterior del encuadre
    ctx.strokeRect(x, y, width, height);

    // Recortar al área exacta de la referencia
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    // Líneas verticales internas
    for (let c = 1; c < cols; c++) {
      const lineX = x + c * cellW;
      ctx.beginPath();
      ctx.moveTo(lineX, y);
      ctx.lineTo(lineX, y + height);
      ctx.stroke();
    }

    // Líneas horizontales internas
    for (let r = 1; r < effectiveRows; r++) {
      const lineY = y + r * cellH;
      if (lineY < y + height) {
        ctx.beginPath();
        ctx.moveTo(x, lineY);
        ctx.lineTo(x + width, lineY);
        ctx.stroke();
      }
    }

    // Diagonales de encaje (opcional para artistas)
    if (showDiagonals) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = Math.max(1, lineWidth * 0.75);
      ctx.globalAlpha = 0.65;

      for (let r = 0; r < effectiveRows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = x + c * cellW;
          const cy = y + r * cellH;
          const curCellH = Math.min(cellH, (y + height) - cy);

          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + cellW, cy + curCellH);
          ctx.moveTo(cx + cellW, cy);
          ctx.lineTo(cx, cy + curCellH);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    ctx.restore(); // Termina clip

    // Etiquetas en los bordes (Letras columnas A, B, C... y Números filas 1, 2, 3...)
    if (showLabels) {
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = `600 ${Math.max(11, Math.min(18, cellW * 0.18))}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Columnas (A, B, C...)
      for (let c = 0; c < cols; c++) {
        const label = String.fromCharCode(65 + (c % 26));
        const posX = x + c * cellW + cellW / 2;
        ctx.fillText(label, posX, y - 12);
      }

      // Filas (1, 2, 3...)
      ctx.textAlign = 'right';
      for (let r = 0; r < effectiveRows; r++) {
        const label = (r + 1).toString();
        const curCellH = Math.min(cellH, (y + height) - (y + r * cellH));
        if (curCellH >= 12) {
          const posY = y + r * cellH + curCellH / 2;
          ctx.fillText(label, x - 10, posY);
        }
      }
      ctx.restore();
    }

    ctx.restore();
  }

  drawSketchLayer(ctx, forceOpaque = false) {
    if (!this.sketchImg) return;

    const { x: refX, y: refY, width: refW, height: refH } = this.refBounds;
    const { scale, offsetX, offsetY, rotation, flipH, flipV, opacity, blendMode } = this.sketchTransform;

    ctx.save();

    // Si está en modo calibración o forceOpaque, dibujar 100% visible para que el artista vea sus trazos con nitidez
    if (this.isCalibrating || forceOpaque) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.96;
    } else {
      const hasReferenceBelow = !!(this.layers.reference && this.referenceImg);
      ctx.globalCompositeOperation = hasReferenceBelow ? (blendMode || 'difference') : 'source-over';
      ctx.globalAlpha = Math.max(0.05, Math.min(1, opacity));
    }

    // Centro de rotación y escalado
    const centerX = refX + refW / 2 + offsetX;
    const centerY = refY + refH / 2 + offsetY;

    ctx.translate(centerX, centerY);

    if (rotation) {
      ctx.rotate((rotation * Math.PI) / 180);
    }

    const scaleX = (flipH ? -1 : 1) * scale;
    const scaleY = (flipV ? -1 : 1) * scale;
    ctx.scale(scaleX, scaleY);

    if (this.calibratedSketchCanvas && !this.isCalibrating && !forceOpaque) {
      // Dibujar la imagen calibrada rectificada que encaja 1:1 con refBounds
      ctx.drawImage(this.calibratedSketchCanvas, -refW / 2, -refH / 2, refW, refH);
    } else {
      // Dibujar la foto original escalada
      const sketchW = this.sketchImg.naturalWidth || this.sketchImg.width || 1;
      const sketchH = this.sketchImg.naturalHeight || this.sketchImg.height || 1;
      const sketchAspect = sketchW / sketchH;
      const refAspect = refW / refH;

      let baseW, baseH;
      if (sketchAspect > refAspect) {
        baseW = refW;
        baseH = refW / sketchAspect;
      } else {
        baseH = refH;
        baseW = refH * sketchAspect;
      }

      ctx.drawImage(this.sketchImg, -baseW / 2, -baseH / 2, baseW, baseH);
    }

    ctx.restore();
  }

  drawCalibrationLayer(ctx) {
    if (!this.isCalibrating || this.calibrationCorners.length !== 4) return;

    const corners = this.calibrationCorners;
    ctx.save();

    // Líneas del cuadrilátero guía
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    ctx.lineTo(corners[1].x, corners[1].y);
    ctx.lineTo(corners[2].x, corners[2].y);
    ctx.lineTo(corners[3].x, corners[3].y);
    ctx.closePath();
    ctx.stroke();

    // Relleno suave de área
    ctx.fillStyle = 'rgba(0, 229, 255, 0.08)';
    ctx.fill();

    // Manijas en las 4 esquinas táctiles (iPad ergonomía)
    const labels = ['1. Sup-Izq', '2. Sup-Der', '3. Inf-Der', '4. Inf-Izq'];
    corners.forEach((pt, idx) => {
      ctx.setLineDash([]);

      const isDragging = (this.activeCornerDragIndex === idx);

      // Halo exterior
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isDragging ? 32 : 24, 0, Math.PI * 2);
      ctx.fillStyle = isDragging ? 'rgba(0, 229, 255, 0.5)' : 'rgba(0, 229, 255, 0.3)';
      ctx.fill();

      // Círculo botón táctil
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isDragging ? 18 : 14, 0, Math.PI * 2);
      ctx.fillStyle = isDragging ? '#ffffff' : '#00e5ff';
      ctx.fill();
      ctx.strokeStyle = isDragging ? '#00e5ff' : '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Punto central
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = isDragging ? '#00e5ff' : '#ffffff';
      ctx.fill();

      // Texto de la esquina
      ctx.font = 'bold 12px -apple-system, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      const textY = idx < 2 ? pt.y - 30 : pt.y + 36;
      ctx.fillText(labels[idx], pt.x, textY);
    });

    // Lupa de aumento interactiva para iPad (cuando el usuario está arrastrando una esquina)
    if (this.activeCornerDragIndex !== undefined && this.activeCornerDragIndex >= 0) {
      const activePt = corners[this.activeCornerDragIndex];
      const loupeRadius = 56;
      const loupeYOffset = (activePt.y - 130 > 40) ? -95 : 95;
      const loupeX = activePt.x;
      const loupeY = activePt.y + loupeYOffset;

      ctx.save();
      // Sombra exterior de la lupa
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 6;

      // Círculo de recorte
      ctx.beginPath();
      ctx.arc(loupeX, loupeY, loupeRadius, 0, Math.PI * 2);
      ctx.clip();

      // Fondo oscuro
      ctx.fillStyle = '#1a1a1e';
      ctx.fillRect(loupeX - loupeRadius, loupeY - loupeRadius, loupeRadius * 2, loupeRadius * 2);

      // Dibujar sketch ampliado 2.4x
      ctx.save();
      ctx.translate(loupeX, loupeY);
      ctx.scale(2.4, 2.4);
      ctx.translate(-activePt.x, -activePt.y);

      this.drawSketchLayer(ctx, true);
      ctx.restore();

      // Retícula / Crosshair en el centro de la lupa
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(loupeX - 20, loupeY);
      ctx.lineTo(loupeX + 20, loupeY);
      ctx.moveTo(loupeX, loupeY - 20);
      ctx.lineTo(loupeX, loupeY + 20);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(loupeX, loupeY, 4, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore(); // Termina clip

      // Borde exterior blanco de la lupa
      ctx.save();
      ctx.beginPath();
      ctx.arc(loupeX, loupeY, loupeRadius, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Exporta el canvas completo a Blob PNG/JPEG
   */
  async exportToBlob(type = 'image/png', quality = 0.95) {
    return new Promise((resolve) => {
      this.canvas.toBlob(resolve, type, quality);
    });
  }
}

window.CanvasEngine = CanvasEngine;
