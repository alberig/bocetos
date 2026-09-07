/**
 * Bocetos - Canvas Engine Module
 * Motor de renderizado multicapa con soporte HiDPI para iPad
 */

class CanvasEngine {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');

    // Imágenes cargadas en memoria
    this.referenceImg = null;
    this.sketchImg = null;

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

    // Modos de interacción: 'transform_sketch' | 'explore_canvas'
    this.interactionMode = 'transform_sketch';

    this.initResizeObserver();
  }

  initResizeObserver() {
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(this.canvas.parentElement);
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    this.viewport.width = rect.width;
    this.viewport.height = rect.height;
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
    if (!this.referenceImg) {
      this.refBounds = {
        x: this.viewport.width * 0.1,
        y: this.viewport.height * 0.1,
        width: this.viewport.width * 0.8,
        height: this.viewport.height * 0.8
      };
      return;
    }

    const padding = 32; // margen en px
    const availW = Math.max(100, this.viewport.width - padding * 2);
    const availH = Math.max(100, this.viewport.height - padding * 2);

    const imgW = this.referenceImg.naturalWidth || this.referenceImg.width;
    const imgH = this.referenceImg.naturalHeight || this.referenceImg.height;

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

    const x = (this.viewport.width - drawW) / 2;
    const y = (this.viewport.height - drawH) / 2;

    this.refBounds = { x, y, width: drawW, height: drawH };
  }

  async loadReferenceBlob(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);
        this.referenceImg = img;
        this.calculateRefBounds();
        this.render();
        resolve(img);
      };

      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };

      img.src = url;
    });
  }

  async loadSketchBlob(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);
        this.sketchImg = img;
        this.render();
        resolve(img);
      };

      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };

      img.src = url;
    });
  }

  clearSketch() {
    this.sketchImg = null;
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
    if (this.layers[layerName] !== undefined) {
      this.layers[layerName] = visible;
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
   * PIPELINE DE RENDERIZADO
   * ======================================================== */

  render() {
    const ctx = this.ctx;
    const dpr = this.viewport.dpr;
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

    ctx.restore();
  }

  drawReferenceLayer(ctx) {
    const { x, y, width, height } = this.refBounds;

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

    const sketchW = this.sketchImg.naturalWidth || this.sketchImg.width;
    const sketchH = this.sketchImg.naturalHeight || this.sketchImg.height;

    // Calcular tamaño base del boceto para que coincida inicialmente con el tamaño de referencia
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

    // Modo de fusión para resaltar las líneas del boceto sobre la referencia
    // (ej. 'difference', 'multiply', 'screen', 'normal')
    ctx.globalCompositeOperation = blendMode || 'difference';
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));

    // Centro de rotación y escalado: centro de la referencia + offset
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

    // Dibujar boceto centrado en (0, 0)
    ctx.drawImage(this.sketchImg, -baseW / 2, -baseH / 2, baseW, baseH);

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

