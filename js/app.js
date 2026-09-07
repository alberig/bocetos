/**
 * Bocetos - Main Application Controller
 * UI, Gestos Táctiles Multitouch (iPad) e Integración con IndexedDB & Canvas
 */

class BocetosApp {
  constructor() {
    this.currentProject = null;
    this.currentIteration = null;
    this.iterations = [];
    this.canvasEngine = null;

    // Estado de gestos táctiles (Pointer Events)
    this.activePointers = new Map();
    this.gestureStart = null;

    // Debounce timer para autoguardado en IndexedDB
    this.autoSaveTimer = null;

    this.init();
  }

  async init() {
    // Inicializar Canvas Engine
    const canvasEl = document.getElementById('main-canvas');
    this.canvasEngine = new CanvasEngine(canvasEl);

    // Inicializar eventos de UI
    this.bindUIEvents();
    this.bindTouchGestures();

    // Registrar Service Worker para PWA Offline
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.log('SW registration skipped:', err);
      });
    }

    // Cargar galería inicial
    await this.loadGallery();
  }

  /* ========================================================
   * GESTIÓN DE VISTAS (GALERÍA vs ESTUDIO)
   * ======================================================== */

  showGalleryView() {
    document.getElementById('studio-view').classList.remove('active');
    document.getElementById('gallery-view').classList.add('active');
    this.currentProject = null;
    this.currentIteration = null;
    this.canvasEngine.clearSketch();
    this.loadGallery();
  }

  async showStudioView(project) {
    this.currentProject = project;
    document.getElementById('gallery-view').classList.remove('active');
    const studioEl = document.getElementById('studio-view');
    studioEl.classList.add('active');
    studioEl.classList.remove('clean-mode');

    // Actualizar título del proyecto
    document.getElementById('project-title-text').textContent = project.name;

    // Configurar Cuadrícula desde el proyecto guardado
    if (project.gridConfig) {
      this.canvasEngine.setGridConfig(project.gridConfig);
      this.syncGridUI(project.gridConfig);
    }

    // Configurar Estado de Capas
    if (project.layersState) {
      this.canvasEngine.layers = { ...project.layersState };
      this.syncLayerTogglesUI();
    }

    // Cargar Imagen de Referencia (Capa 1)
    if (project.referenceImageBlob) {
      await this.canvasEngine.loadReferenceBlob(project.referenceImageBlob);
    }

    // Cargar Iteraciones del Proyecto (Timeline)
    await this.loadProjectIterations(project.id);
  }

  /* ========================================================
   * GALERÍA ("MIS RETRATOS")
   * ======================================================== */

  async loadGallery() {
    const galleryContainer = document.getElementById('gallery-projects-list');
    galleryContainer.innerHTML = `
      <div class="card-new-project" id="btn-card-new-project">
        <div class="card-new-icon">+</div>
        <span>Nuevo Proyecto</span>
      </div>
    `;

    document.getElementById('btn-card-new-project').addEventListener('click', () => {
      this.openNewProjectModal();
    });

    try {
      const projects = await window.bocetosDB.getAllProjects();
      if (projects.length === 0) return;

      projects.forEach((proj) => {
        const card = document.createElement('div');
        card.className = 'project-card';
        const dateStr = new Date(proj.updatedAt || proj.createdAt).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        });

        const thumbUrl = proj.referenceThumbnailBlob
          ? URL.createObjectURL(proj.referenceThumbnailBlob)
          : '';

        card.innerHTML = `
          <div class="project-thumb-box">
            ${thumbUrl ? `<img src="${thumbUrl}" alt="${proj.name}">` : ''}
          </div>
          <div class="project-card-meta">
            <div class="project-info">
              <h3>${this.escapeHTML(proj.name)}</h3>
              <p>Actualizado: ${dateStr}</p>
            </div>
            <button class="btn-card-menu" title="Opciones" data-id="${proj.id}">⋮</button>
          </div>
        `;

        card.addEventListener('click', (e) => {
          if (e.target.closest('.btn-card-menu')) return;
          this.showStudioView(proj);
        });

        const menuBtn = card.querySelector('.btn-card-menu');
        menuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openProjectOptionsModal(proj);
        });

        galleryContainer.appendChild(card);
      });
    } catch (err) {
      console.error('Error cargando proyectos:', err);
      this.showToast('Error al cargar la galería');
    }
  }

  /* ========================================================
   * ITERACIONES (LÍNEA DE TIEMPO)
   * ======================================================== */

  async loadProjectIterations(projectId) {
    this.iterations = await window.bocetosDB.getIterations(projectId);
    this.renderTimeline();

    if (this.iterations.length > 0) {
      // Seleccionar la última versión por defecto
      const last = this.iterations[this.iterations.length - 1];
      await this.selectIteration(last);
    } else {
      this.currentIteration = null;
      this.canvasEngine.clearSketch();
      this.syncSketchTransformUI(this.canvasEngine.sketchTransform);
    }
  }

  renderTimeline() {
    const container = document.getElementById('timeline-items');
    container.innerHTML = '';

    if (this.iterations.length === 0) {
      container.innerHTML = `<span style="font-size: 12px; color: var(--text-muted); padding-left: 8px;">Toma tu primera foto para superponer el boceto</span>`;
      return;
    }

    this.iterations.forEach((iter) => {
      const pill = document.createElement('div');
      pill.className = `iteration-pill ${this.currentIteration && this.currentIteration.id === iter.id ? 'active' : ''}`;
      pill.dataset.id = iter.id;

      const timeStr = new Date(iter.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const thumbUrl = iter.sketchThumbnailBlob ? URL.createObjectURL(iter.sketchThumbnailBlob) : '';

      pill.innerHTML = `
        ${thumbUrl ? `<img class="iteration-thumb" src="${thumbUrl}" alt="V${iter.versionNumber}">` : ''}
        <div class="iteration-info">
          <span class="iteration-title">Versión ${iter.versionNumber}</span>
          <span class="iteration-time">${timeStr}</span>
        </div>
      `;

      pill.addEventListener('click', () => {
        this.selectIteration(iter);
      });

      container.appendChild(pill);
    });

    // Auto-scroll al final del timeline
    container.scrollLeft = container.scrollWidth;
  }

  async selectIteration(iteration) {
    this.currentIteration = iteration;

    // Actualizar clase activa en pills
    document.querySelectorAll('.iteration-pill').forEach((el) => {
      el.classList.toggle('active', el.dataset.id === iteration.id);
    });

    // Cargar imagen en Layer 3
    if (iteration.sketchImageBlob) {
      await this.canvasEngine.loadSketchBlob(iteration.sketchImageBlob);
    }

    // Aplicar transformación guardada de esta versión
    if (iteration.transform) {
      this.canvasEngine.setSketchTransform(iteration.transform);
      this.syncSketchTransformUI(iteration.transform);
    }
  }

  async handleNewSketchCapture(file) {
    if (!file || !this.currentProject) return;

    this.showToast('Optimizando foto de cámara...');

    try {
      // HERENCIA DE TRANSFORMACIÓN: Si ya existía una versión previa alineada,
      // la nueva versión hereda automáticamente su escala, posición y rotación.
      const inheritedTransform = this.currentIteration
        ? { ...this.canvasEngine.sketchTransform }
        : this.currentProject.lastTransform;

      const newIteration = await window.bocetosDB.addIteration(
        this.currentProject.id,
        file,
        inheritedTransform
      );

      this.iterations.push(newIteration);
      this.renderTimeline();
      await this.selectIteration(newIteration);

      this.showToast(`¡Versión ${newIteration.versionNumber} añadida con alineación previa!`);
    } catch (err) {
      console.error('Error al procesar foto de boceto:', err);
      this.showToast('Error al procesar la foto');
    }
  }

  /* ========================================================
   * GESTOS TÁCTILES MULTITOUCH (POINTER EVENTS) PARA IPAD
   * ======================================================== */

  bindTouchGestures() {
    const canvas = document.getElementById('main-canvas');

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.activePointers.size === 1) {
        // Inicio de arrastre con 1 dedo
        this.gestureStart = {
          mode: 'pan',
          initOffsetX: this.canvasEngine.sketchTransform.offsetX,
          initOffsetY: this.canvasEngine.sketchTransform.offsetY,
          startX: e.clientX,
          startY: e.clientY
        };
      } else if (this.activePointers.size === 2) {
        // Inicio de gesto con 2 dedos (Pinch Zoom + Rotación)
        const pts = Array.from(this.activePointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * (180 / Math.PI);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;

        this.gestureStart = {
          mode: 'pinch_rotate',
          initScale: this.canvasEngine.sketchTransform.scale,
          initRotation: this.canvasEngine.sketchTransform.rotation,
          initOffsetX: this.canvasEngine.sketchTransform.offsetX,
          initOffsetY: this.canvasEngine.sketchTransform.offsetY,
          initDist: dist,
          initAngle: angle,
          initMidX: midX,
          initMidY: midY
        };
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.activePointers.has(e.pointerId) || !this.gestureStart) return;

      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.activePointers.size === 1 && this.gestureStart.mode === 'pan') {
        const dx = e.clientX - this.gestureStart.startX;
        const dy = e.clientY - this.gestureStart.startY;

        const newOffsetX = Math.round(this.gestureStart.initOffsetX + dx);
        const newOffsetY = Math.round(this.gestureStart.initOffsetY + dy);

        this.canvasEngine.setSketchTransform({ offsetX: newOffsetX, offsetY: newOffsetY });
        this.syncSketchTransformUI(this.canvasEngine.sketchTransform, false);
        this.scheduleAutoSave();
      } else if (this.activePointers.size === 2 && this.gestureStart.mode === 'pinch_rotate') {
        const pts = Array.from(this.activePointers.values());
        const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const currentAngle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * (180 / Math.PI);
        const currentMidX = (pts[0].x + pts[1].x) / 2;
        const currentMidY = (pts[0].y + pts[1].y) / 2;

        // Factor de escala
        const scaleFactor = currentDist / this.gestureStart.initDist;
        const newScale = Math.max(0.1, Math.min(8.0, +(this.gestureStart.initScale * scaleFactor).toFixed(3)));

        // Rotación en grados
        let angleDelta = currentAngle - this.gestureStart.initAngle;
        let newRot = Math.round((this.gestureStart.initRotation + angleDelta) % 360);
        if (newRot > 180) newRot -= 360;
        if (newRot < -180) newRot += 360;

        // Pan simultáneo con 2 dedos
        const midDx = currentMidX - this.gestureStart.initMidX;
        const midDy = currentMidY - this.gestureStart.initMidY;
        const newOffsetX = Math.round(this.gestureStart.initOffsetX + midDx);
        const newOffsetY = Math.round(this.gestureStart.initOffsetY + midDy);

        this.canvasEngine.setSketchTransform({
          scale: newScale,
          rotation: newRot,
          offsetX: newOffsetX,
          offsetY: newOffsetY
        });

        this.syncSketchTransformUI(this.canvasEngine.sketchTransform, false);
        this.scheduleAutoSave();
      }
    });

    const pointerEndHandler = (e) => {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size === 0) {
        this.gestureStart = null;
      } else if (this.activePointers.size === 1) {
        // Queda 1 dedo: reiniciar inicio de pan
        const remaining = Array.from(this.activePointers.values())[0];
        this.gestureStart = {
          mode: 'pan',
          initOffsetX: this.canvasEngine.sketchTransform.offsetX,
          initOffsetY: this.canvasEngine.sketchTransform.offsetY,
          startX: remaining.x,
          startY: remaining.y
        };
      }
    };

    canvas.addEventListener('pointerup', pointerEndHandler);
    canvas.addEventListener('pointercancel', pointerEndHandler);
  }

  /* ========================================================
   * BINDING DE EVENTOS DE UI & CONTROLES
   * ======================================================== */

  bindUIEvents() {
    // 1. Navegación & Barra Superior
    document.getElementById('btn-back-gallery').addEventListener('click', () => {
      this.showGalleryView();
    });

    // 2. Modo Lienzo Limpio (Zen Mode)
    const cleanToggleBtn = document.getElementById('btn-toggle-clean-mode');
    cleanToggleBtn.addEventListener('click', () => {
      const studio = document.getElementById('studio-view');
      studio.classList.toggle('clean-mode');
      const isClean = studio.classList.contains('clean-mode');
      cleanToggleBtn.setAttribute('aria-label', isClean ? 'Salir de modo limpio' : 'Modo limpio');
    });

    // 3. Toggles de Visibilidad de Capas
    document.getElementById('chip-toggle-ref').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const isVis = !btn.classList.contains('active');
      btn.classList.toggle('active', isVis);
      this.canvasEngine.setLayerVisibility('reference', isVis);
      this.saveLayerState();
    });

    document.getElementById('chip-toggle-grid').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const isVis = !btn.classList.contains('active');
      btn.classList.toggle('active', isVis);
      this.canvasEngine.setGridConfig({ visible: isVis });
      this.saveLayerState();
    });

    document.getElementById('chip-toggle-sketch').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const isVis = !btn.classList.contains('active');
      btn.classList.toggle('active', isVis);
      this.canvasEngine.setLayerVisibility('sketch', isVis);
      this.saveLayerState();
    });

    // 4. Pestañas de Herramientas Inferiores (Cuadrícula, Boceto)
    const tabGridBtn = document.getElementById('tab-btn-grid');
    const tabSketchBtn = document.getElementById('tab-btn-sketch');
    const panelGrid = document.getElementById('panel-grid-settings');
    const panelSketch = document.getElementById('panel-sketch-settings');

    const togglePanel = (panel, tabBtn) => {
      const isOpen = panel.classList.contains('open');
      // Cerrar ambos primero
      panelGrid.classList.remove('open');
      panelSketch.classList.remove('open');
      tabGridBtn.classList.remove('active');
      tabSketchBtn.classList.remove('active');

      if (!isOpen) {
        panel.classList.add('open');
        tabBtn.classList.add('active');
      }
    };

    tabGridBtn.addEventListener('click', () => togglePanel(panelGrid, tabGridBtn));
    tabSketchBtn.addEventListener('click', () => togglePanel(panelSketch, tabSketchBtn));

    document.querySelectorAll('.panel-close-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        panelGrid.classList.remove('open');
        panelSketch.classList.remove('open');
        tabGridBtn.classList.remove('active');
        tabSketchBtn.classList.remove('active');
      });
    });

    // 5. Botones de Captura de Cámara e Importación
    const cameraInput = document.getElementById('input-camera-capture');
    const fileFallbackInput = document.getElementById('input-file-fallback');

    document.getElementById('btn-capture-sketch').addEventListener('click', () => {
      cameraInput.click();
    });

    const uploadFileBtn = document.getElementById('btn-upload-sketch-file');
    if (uploadFileBtn) {
      uploadFileBtn.addEventListener('click', () => {
        fileFallbackInput.click();
      });
    }

    cameraInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.handleNewSketchCapture(e.target.files[0]);
        cameraInput.value = '';
      }
    });

    fileFallbackInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.handleNewSketchCapture(e.target.files[0]);
        fileFallbackInput.value = '';
      }
    });

    // Botón de Exportar Lienzo Combinado
    const exportBtn = document.getElementById('btn-export-canvas');
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        if (!this.currentProject) return;
        this.showToast('Exportando imagen...');
        const blob = await this.canvasEngine.exportToBlob('image/png');
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const safeName = (this.currentProject.name || 'boceto').replace(/[^a-z0-9_-]/gi, '_');
          a.download = `${safeName}_comparativa.png`;
          a.href = url;
          a.click();
          URL.revokeObjectURL(url);
          this.showToast('¡Imagen descargada!');
        }
      });
    }

    // 6. Controles del Panel de Cuadrícula
    this.bindGridControls();

    // 7. Controles del Panel de Boceto y Fusión
    this.bindSketchControls();

    // 8. Modales (Nuevo Proyecto, Opciones)
    this.bindModalEvents();
  }

  bindGridControls() {
    // Steppers Filas
    document.getElementById('btn-rows-minus').addEventListener('click', () => {
      const cur = this.canvasEngine.gridConfig.rows;
      if (cur > 1) this.updateGrid({ rows: cur - 1 });
    });
    document.getElementById('btn-rows-plus').addEventListener('click', () => {
      const cur = this.canvasEngine.gridConfig.rows;
      if (cur < 20) this.updateGrid({ rows: cur + 1 });
    });

    // Steppers Columnas
    document.getElementById('btn-cols-minus').addEventListener('click', () => {
      const cur = this.canvasEngine.gridConfig.cols;
      if (cur > 1) this.updateGrid({ cols: cur - 1 });
    });
    document.getElementById('btn-cols-plus').addEventListener('click', () => {
      const cur = this.canvasEngine.gridConfig.cols;
      if (cur < 20) this.updateGrid({ cols: cur + 1 });
    });

    // Grosor de línea
    const widthSlider = document.getElementById('grid-line-width');
    widthSlider.addEventListener('input', (e) => {
      this.updateGrid({ lineWidth: parseFloat(e.target.value) });
    });

    // Color picker dots
    document.querySelectorAll('.color-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        document.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('active'));
        dot.classList.add('active');
        this.updateGrid({ color: dot.dataset.color });
      });
    });

    // Toggle Diagonales
    document.getElementById('toggle-grid-diagonals').addEventListener('change', (e) => {
      this.updateGrid({ showDiagonals: e.target.checked });
    });

    // Toggle Etiquetas
    document.getElementById('toggle-grid-labels').addEventListener('change', (e) => {
      this.updateGrid({ showLabels: e.target.checked });
    });
  }

  bindSketchControls() {
    // Opacidad Slider
    const opacitySlider = document.getElementById('sketch-opacity-slider');
    const opacityValText = document.getElementById('sketch-opacity-value');
    opacitySlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      opacityValText.textContent = `${Math.round(val * 100)}%`;
      this.canvasEngine.setSketchTransform({ opacity: val });
      this.scheduleAutoSave();
    });

    // Modo de Fusión Dropdown
    const blendSelect = document.getElementById('sketch-blend-select');
    blendSelect.addEventListener('change', (e) => {
      this.canvasEngine.setSketchTransform({ blendMode: e.target.value });
      this.scheduleAutoSave();
    });

    // Escala Stepper (+/-)
    document.getElementById('btn-scale-minus').addEventListener('click', () => {
      const s = Math.max(0.2, +(this.canvasEngine.sketchTransform.scale - 0.05).toFixed(2));
      this.updateTransform({ scale: s });
    });
    document.getElementById('btn-scale-plus').addEventListener('click', () => {
      const s = Math.min(5.0, +(this.canvasEngine.sketchTransform.scale + 0.05).toFixed(2));
      this.updateTransform({ scale: s });
    });

    // Rotación Stepper (+/- 1°)
    document.getElementById('btn-rot-minus').addEventListener('click', () => {
      const r = (this.canvasEngine.sketchTransform.rotation - 1 + 360) % 360;
      this.updateTransform({ rotation: r > 180 ? r - 360 : r });
    });
    document.getElementById('btn-rot-plus').addEventListener('click', () => {
      const r = (this.canvasEngine.sketchTransform.rotation + 1 + 360) % 360;
      this.updateTransform({ rotation: r > 180 ? r - 360 : r });
    });

    // Volteo Horizontal / Vertical
    document.getElementById('btn-flip-h').addEventListener('click', () => {
      this.updateTransform({ flipH: !this.canvasEngine.sketchTransform.flipH });
    });

    // Botón Restablecer Transformación
    document.getElementById('btn-reset-transform').addEventListener('click', () => {
      this.canvasEngine.resetSketchTransform();
      this.syncSketchTransformUI(this.canvasEngine.sketchTransform);
      this.scheduleAutoSave();
      this.showToast('Alineación restablecida');
    });

    // Botón Eliminar Versión Actual
    document.getElementById('btn-delete-iteration').addEventListener('click', async () => {
      if (!this.currentIteration) return;
      if (confirm(`¿Eliminar la Versión ${this.currentIteration.versionNumber}?`)) {
        await window.bocetosDB.deleteIteration(this.currentIteration.id);
        await this.loadProjectIterations(this.currentProject.id);
        this.showToast('Versión eliminada');
      }
    });
  }

  updateGrid(partialConfig) {
    this.canvasEngine.setGridConfig(partialConfig);
    this.syncGridUI(this.canvasEngine.gridConfig);
    this.scheduleAutoSave();
  }

  updateTransform(partialTransform) {
    this.canvasEngine.setSketchTransform(partialTransform);
    this.syncSketchTransformUI(this.canvasEngine.sketchTransform);
    this.scheduleAutoSave();
  }

  syncGridUI(config) {
    document.getElementById('rows-value-display').textContent = config.rows;
    document.getElementById('cols-value-display').textContent = config.cols;
    document.getElementById('grid-line-width').value = config.lineWidth;
    document.getElementById('toggle-grid-diagonals').checked = !!config.showDiagonals;
    document.getElementById('toggle-grid-labels').checked = !!config.showLabels;

    document.querySelectorAll('.color-dot').forEach((dot) => {
      dot.classList.toggle('active', dot.dataset.color.toLowerCase() === (config.color || '').toLowerCase());
    });
  }

  syncSketchTransformUI(t, updateControls = true) {
    if (updateControls) {
      document.getElementById('sketch-opacity-slider').value = t.opacity;
      document.getElementById('sketch-opacity-value').textContent = `${Math.round(t.opacity * 100)}%`;
      document.getElementById('sketch-blend-select').value = t.blendMode || 'difference';
    }
    document.getElementById('scale-value-display').textContent = `${Math.round(t.scale * 100)}%`;
    document.getElementById('rot-value-display').textContent = `${Math.round(t.rotation || 0)}°`;
  }

  syncLayerTogglesUI() {
    const l = this.canvasEngine.layers;
    document.getElementById('chip-toggle-ref').classList.toggle('active', l.reference);
    document.getElementById('chip-toggle-grid').classList.toggle('active', this.canvasEngine.gridConfig.visible);
    document.getElementById('chip-toggle-sketch').classList.toggle('active', l.sketch);
  }

  saveLayerState() {
    if (!this.currentProject) return;
    this.currentProject.layersState = { ...this.canvasEngine.layers };
    this.scheduleAutoSave();
  }

  scheduleAutoSave() {
    clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(async () => {
      if (!this.currentProject) return;

      // Guardar configuración del proyecto
      this.currentProject.gridConfig = { ...this.canvasEngine.gridConfig };
      this.currentProject.lastTransform = { ...this.canvasEngine.sketchTransform };
      await window.bocetosDB.saveProject(this.currentProject);

      // Si hay una iteración activa, actualizar también sus transforms específicos
      if (this.currentIteration) {
        await window.bocetosDB.updateIterationTransform(
          this.currentIteration.id,
          this.canvasEngine.sketchTransform
        );
      }
    }, 400);
  }

  /* ========================================================
   * MODALES (NUEVO PROYECTO & OPCIONES)
   * ======================================================== */

  bindModalEvents() {
    const newProjModal = document.getElementById('modal-new-project');
    const inputRefFile = document.getElementById('input-reference-file');
    const dropzone = document.getElementById('ref-dropzone');
    const previewImg = document.getElementById('ref-preview-img');
    const placeholderText = document.getElementById('ref-placeholder-text');
    let selectedRefBlob = null;

    this.openNewProjectModal = () => {
      document.getElementById('input-project-name').value = '';
      selectedRefBlob = null;
      previewImg.style.display = 'none';
      placeholderText.style.display = 'block';
      newProjModal.classList.add('open');
      document.getElementById('input-project-name').focus();
    };

    document.getElementById('btn-cancel-new-proj').addEventListener('click', () => {
      newProjModal.classList.remove('open');
    });

    dropzone.addEventListener('click', () => {
      inputRefFile.click();
    });

    inputRefFile.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        selectedRefBlob = e.target.files[0];
        previewImg.src = URL.createObjectURL(selectedRefBlob);
        previewImg.style.display = 'block';
        placeholderText.style.display = 'none';
        inputRefFile.value = '';
      }
    });

    document.getElementById('btn-submit-new-proj').addEventListener('click', async () => {
      const name = document.getElementById('input-project-name').value.trim();
      if (!name) {
        alert('Por favor ingresa un nombre para el proyecto');
        return;
      }
      if (!selectedRefBlob) {
        alert('Por favor selecciona la foto de referencia inicial');
        return;
      }

      this.showToast('Creando proyecto y optimizando imagen...');
      try {
        const project = await window.bocetosDB.createProject({
          name,
          referenceBlob: selectedRefBlob
        });

        newProjModal.classList.remove('open');
        this.showToast(`Proyecto "${name}" creado`);
        await this.showStudioView(project);
      } catch (err) {
        console.error('Error creando proyecto:', err);
        this.showToast('Error al crear el proyecto');
      }
    });

    // Modal de Opciones de Proyecto (Renombrar, Eliminar)
    this.openProjectOptionsModal = (project) => {
      const action = prompt(`Opciones para "${project.name}":\n1. Escribe un nuevo nombre para renombrar\n2. Escribe "ELIMINAR" para borrar el proyecto`, project.name);
      if (!action) return;

      if (action.trim().toUpperCase() === 'ELIMINAR') {
        if (confirm(`¿Estás seguro de eliminar el proyecto "${project.name}" y todas sus versiones?`)) {
          window.bocetosDB.deleteProject(project.id).then(() => {
            this.showToast('Proyecto eliminado');
            this.loadGallery();
          });
        }
      } else if (action.trim() !== project.name) {
        project.name = action.trim();
        window.bocetosDB.saveProject(project).then(() => {
          this.showToast('Proyecto renombrado');
          this.loadGallery();
        });
      }
    };
  }

  showToast(message) {
    const toast = document.getElementById('app-toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  escapeHTML(str) {
    return (str || '').replace(/[&<>'"]/g, 
      (tag) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }
}

// Inicializar al cargar el DOM
window.addEventListener('DOMContentLoaded', () => {
  window.bocetosApp = new BocetosApp();
});
