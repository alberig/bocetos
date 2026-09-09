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

    // Estado del Calibrador de 4 Esquinas
    this.isCalibrating = false;
    this.calibrationCorners = []; // [{x, y}, {x, y}, {x, y}, {x, y}]

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
    this.isCalibrating = false;
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

  /* ========================================================
   * AUTO-ENCAJE INTELIGENTE POR CUADRÍCULA (AUTO-ALIGN)
   * ======================================================== */

  /**
   * Encaja automáticamente el boceto tomando como referencia la cuadrícula
   * de la foto original y los bordes/líneas del dibujo capturado.
   */
  autoAlignSketchWithGrid() {
    if (!this.sketchImg || !this.referenceImg) return false;

    try {
      const sketchNatW = this.sketchImg.naturalWidth || this.sketchImg.width || 1;
      const sketchNatH = this.sketchImg.naturalHeight || this.sketchImg.height || 1;

      // 1. Crear canvas auxiliar de análisis rápido
      const sampleW = 380;
      const sampleH = Math.round((sampleW * sketchNatH) / sketchNatW);

      const offCanvas = document.createElement('canvas');
      offCanvas.width = sampleW;
      offCanvas.height = sampleH;
      const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
      offCtx.drawImage(this.sketchImg, 0, 0, sampleW, sampleH);

      const imgData = offCtx.getImageData(0, 0, sampleW, sampleH);
      const data = imgData.data;

      // 2. Grayscale & Gradiente de bordes (filtro Sobel ligero)
      const gray = new Float32Array(sampleW * sampleH);
      for (let i = 0; i < data.length; i += 4) {
        gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }

      const colEdges = new Float32Array(sampleW);
      const rowEdges = new Float32Array(sampleH);

      for (let y = 1; y < sampleH - 1; y++) {
        for (let x = 1; x < sampleW - 1; x++) {
          const idx = y * sampleW + x;
          const gx = Math.abs(gray[idx + 1] - gray[idx - 1]);
          const gy = Math.abs(gray[idx + sampleW] - gray[idx - sampleW]);
          colEdges[x] += gx;
          rowEdges[y] += gy;
        }
      }

      // 3. Detección de límites de la cuadrícula o papel dibujado
      let maxCol = 0;
      for (let x = 0; x < sampleW; x++) if (colEdges[x] > maxCol) maxCol = colEdges[x];
      const thresholdCol = maxCol * 0.32;

      let minX = Math.round(sampleW * 0.08);
      let maxX = Math.round(sampleW * 0.92);

      for (let x = 6; x < sampleW * 0.45; x++) {
        if (colEdges[x] > thresholdCol) {
          minX = x;
          break;
        }
      }
      for (let x = sampleW - 7; x > sampleW * 0.55; x--) {
        if (colEdges[x] > thresholdCol) {
          maxX = x;
          break;
        }
      }

      let maxRow = 0;
      for (let y = 0; y < sampleH; y++) if (rowEdges[y] > maxRow) maxRow = rowEdges[y];
      const thresholdRow = maxRow * 0.32;

      let minY = Math.round(sampleH * 0.08);
      let maxY = Math.round(sampleH * 0.92);

      for (let y = 6; y < sampleH * 0.45; y++) {
        if (rowEdges[y] > thresholdRow) {
          minY = y;
          break;
        }
      }
      for (let y = sampleH - 7; y > sampleH * 0.55; y--) {
        if (rowEdges[y] > thresholdRow) {
          maxY = y;
          break;
        }
      }

      // Validar dimensiones detectadas
      if ((maxX - minX) < sampleW * 0.25 || (maxY - minY) < sampleH * 0.25) {
        minX = Math.round(sampleW * 0.08);
        maxX = Math.round(sampleW * 0.92);
        minY = Math.round(sampleH * 0.08);
        maxY = Math.round(sampleH * 0.92);
      }

      // 4. Calcular transformación matemática para encajar en refBounds
      const { width: refW, height: refH } = this.refBounds;
      const sketchAspect = sketchNatW / sketchNatH;
      const refAspect = refW / refH;

      let baseW, baseH;
      if (sketchAspect > refAspect) {
        baseW = refW;
        baseH = refW / sketchAspect;
      } else {
        baseH = refH;
        baseW = refH * sketchAspect;
      }

      const detectedGridW = ((maxX - minX) / sampleW) * baseW;
      const detectedGridH = ((maxY - minY) / sampleH) * baseH;

      const scaleX = refW / detectedGridW;
      const scaleY = refH / detectedGridH;
      const newScale = +(Math.max(0.3, Math.min(4.5, (scaleX + scaleY) / 2))).toFixed(3);

      const normCenterX = (((minX + maxX) / 2) / sampleW - 0.5) * baseW;
      const normCenterY = (((minY + maxY) / 2) / sampleH - 0.5) * baseH;

      const newOffsetX = Math.round(-normCenterX * newScale);
      const newOffsetY = Math.round(-normCenterY * newScale);

      this.setSketchTransform({
        scale: newScale,
        offsetX: newOffsetX,
        offsetY: newOffsetY,
        rotation: 0
      });

      return true;
    } catch (err) {
      console.warn('Auto-encaje por cuadrícula falló:', err);
      return false;
    }
  }

  /* ========================================================
   * CALIBRADOR INTERACTIVO DE 4 ESQUINAS
   * ======================================================== */

  startCalibration() {
    if (!this.sketchImg) return;
    this.isCalibrating = true;

    // Inicializar las 4 esquinas según el estado actual de refBounds
    const { x, y, width: w, height: h } = this.refBounds;
    this.calibrationCorners = [
      { x: x + w * 0.05, y: y + h * 0.05 }, // 0: Top-Left
      { x: x + w * 0.95, y: y + h * 0.05 }, // 1: Top-Right
      { x: x + w * 0.95, y: y + h * 0.95 }, // 2: Bottom-Right
      { x: x + w * 0.05, y: y + h * 0.95 }  // 3: Bottom-Left
    ];

    this.render();
  }

  applyCalibrationCorners() {
    if (!this.isCalibrating || this.calibrationCorners.length !== 4) {
      this.isCalibrating = false;
      this.render();
      return;
    }

    const [p0, p1, p2, p3] = this.calibrationCorners;
    const { x: refX, y: refY, width: refW, height: refH } = this.refBounds;

    // Centro del cuadrilátero marcado por el usuario
    const quadCenterX = (p0.x + p1.x + p2.x + p3.x) / 4;
    const quadCenterY = (p0.y + p1.y + p2.y + p3.y) / 4;

    // Ancho y alto medios del cuadrilátero marcado
    const topW = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const bottomW = Math.hypot(p2.x - p3.x, p2.y - p3.y);
    const avgW = (topW + bottomW) / 2 || 1;

    const leftH = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    const rightH = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const avgH = (leftH + rightH) / 2 || 1;

    // Ángulo de inclinación en grados
    const angleRad = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const angleDeg = Math.round((angleRad * 180) / Math.PI);

    // Factor de escala necesario
    const scaleFactor = ((refW / avgW) + (refH / avgH)) / 2;
    const newScale = +(Math.max(0.2, Math.min(5.0, this.sketchTransform.scale * scaleFactor))).toFixed(3);

    // Centro de referencia
    const refCenterX = refX + refW / 2;
    const refCenterY = refY + refH / 2;

    const newOffsetX = Math.round(this.sketchTransform.offsetX + (refCenterX - quadCenterX));
    const newOffsetY = Math.round(this.sketchTransform.offsetY + (refCenterY - quadCenterY));
    const newRotation = Math.round((this.sketchTransform.rotation - angleDeg) % 360);

    this.setSketchTransform({
      scale: newScale,
      offsetX: newOffsetX,
      offsetY: newOffsetY,
      rotation: newRotation
    });

    this.isCalibrating = false;
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
    const { rows, cols, color, lineWidth, showDiagonals, showLabels } = this.gridConfig;

    if (rows <= 0 || cols <= 0 || width <= 0 || height <= 0) return;

    const cellW = width / cols;
    const cellH = height / rows;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'square';

    // Borde exterior
    ctx.strokeRect(x, y, width, height);

    // Líneas verticales internas
    for (let c = 1; c < cols; c++) {
      const lineX = x + c * cellW;
      ctx.beginPath();
      ctx.moveTo(lineX, y);
      ctx.lineTo(lineX, y + height);
      ctx.stroke();
    }

    // Líneas horizontales internas
    for (let r = 1; r < rows; r++) {
      const lineY = y + r * cellH;
      ctx.beginPath();
      ctx.moveTo(x, lineY);
      ctx.lineTo(x + width, lineY);
      ctx.stroke();
    }

    // Diagonales de encaje (opcional para artistas)
    if (showDiagonals) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = Math.max(1, lineWidth * 0.75);
      ctx.globalAlpha = 0.65;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = x + c * cellW;
          const cy = y + r * cellH;

          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + cellW, cy + cellH);
          ctx.moveTo(cx + cellW, cy);
          ctx.lineTo(cx, cy + cellH);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

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
      for (let r = 0; r < rows; r++) {
        const label = (r + 1).toString();
        const posY = y + r * cellH + cellH / 2;
        ctx.fillText(label, x - 10, posY);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  drawSketchLayer(ctx) {
    if (!this.sketchImg) return;

    const { x: refX, y: refY, width: refW, height: refH } = this.refBounds;
    const { scale, offsetX, offsetY, rotation, flipH, flipV, opacity, blendMode } = this.sketchTransform;

    const sketchW = this.sketchImg.naturalWidth || this.sketchImg.width || 1;
    const sketchH = this.sketchImg.naturalHeight || this.sketchImg.height || 1;

    // Calcular tamaño base del boceto para coincidir proporcionalmente
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

    ctx.save();

    // Modo de fusión: si la referencia está activa y cargada debajo, usar blendMode (difference/multiply).
    // Si la referencia está oculta o no existe, usar 'source-over' para que el boceto sea 100% visible sobre el fondo.
    const hasReferenceBelow = !!(this.layers.reference && this.referenceImg);
    ctx.globalCompositeOperation = hasReferenceBelow ? (blendMode || 'difference') : 'source-over';
    ctx.globalAlpha = Math.max(0.05, Math.min(1, opacity));

    // Centro de rotación y escalado
    const centerX = refX + refW / 2 + offsetX;
    const centerY = refY + refH / 2 + offsetY;

    ctx.translate(centerX, centerY);

    // Rotación (en radianes)
    if (rotation) {
      ctx.rotate((rotation * Math.PI) / 180);
    }

    // Escala y volteo horizontal/vertical
    const scaleX = (flipH ? -1 : 1) * scale;
    const scaleY = (flipV ? -1 : 1) * scale;
    ctx.scale(scaleX, scaleY);

    // Dibujar boceto centrado
    ctx.drawImage(this.sketchImg, -baseW / 2, -baseH / 2, baseW, baseH);

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

      // Halo exterior
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 229, 255, 0.4)';
      ctx.fill();

      // Círculo botón táctil
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#00e5ff';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Punto blanco central
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Texto de la esquina
      ctx.font = 'bold 12px -apple-system, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      const textY = idx < 2 ? pt.y - 28 : pt.y + 36;
      ctx.fillText(labels[idx], pt.x, textY);
    });

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
