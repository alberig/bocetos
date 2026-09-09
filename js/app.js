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

    // Asegurar que la app inicie siempre en la vista de Galería
    this.showGalleryView();
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

    // Forzar actualización inmediata de dimensiones en cuanto el contenedor es visible
    this.canvasEngine.resize();

    // Actualizar título del proyecto
    document.getElementById('project-title-text').textContent = project.name;

    // Configurar Cuadrícula desde el proyecto guardado o valores por defecto visibles
    const gridCfg = project.gridConfig || {
      rows: 4,
      cols: 4,
      squareCells: false,
      color: '#00e5ff',
      lineWidth: 2,
      showDiagonals: false,
      showLabels: true,
      visible: true
    };
    gridCfg.visible = true; // Asegurar que las guías siempre estén visibles al empezar
    this.canvasEngine.setGridConfig(gridCfg);
    this.syncGridUI(gridCfg);

    // Normalizar layersState asegurando compatibilidad con nombres antiguos y nuevos
    const rawLayers = project.layersState || {};
    this.canvasEngine.layers = {
      reference: rawLayers.reference !== undefined ? !!rawLayers.reference : (rawLayers.referenceVisible !== undefined ? !!rawLayers.referenceVisible : true),
      grid: rawLayers.grid !== undefined ? !!rawLayers.grid : (rawLayers.gridVisible !== undefined ? !!rawLayers.gridVisible : true),
      sketch: rawLayers.sketch !== undefined ? !!rawLayers.sketch : (rawLayers.sketchVisible !== undefined ? !!rawLayers.sketchVisible : true)
    };
    // Forzar que la referencia y la cuadrícula estén activadas al ingresar para empezar el dibujo
    this.canvasEngine.layers.reference = true;
    this.canvasEngine.layers.grid = true;
    this.canvasEngine.gridConfig.visible = true;
    this.syncLayerTogglesUI();

    // Cargar Imagen de Referencia (Capa 1)
    if (project.referenceImageBlob) {
      try {
        await this.canvasEngine.loadReferenceBlob(project.referenceImageBlob);
      } catch (err) {
        console.error('Error cargando referencia:', err);
        this.showToast('Aviso: problema al leer imagen de referencia guardada');
      }
    }

    // Asegurar medición con la imagen ya cargada y sincronizar cuadrícula
    this.canvasEngine.resize();
    this.syncGridUI(this.canvasEngine.gridConfig);

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

      // Si es la primera versión o no hay transformación previa calibrada,
      // encajar automáticamente tomando como referencia la cuadrícula
      if (newIteration.versionNumber === 1 || !inheritedTransform || (inheritedTransform.scale === 1 && inheritedTransform.offsetX === 0 && inheritedTransform.offsetY === 0)) {
        const aligned = this.canvasEngine.autoAlignSketchWithGrid();
        if (aligned) {
          this.syncSketchTransformUI(this.canvasEngine.sketchTransform);
          await window.bocetosDB.updateIterationTransform(newIteration.id, this.canvasEngine.sketchTransform);
          this.showToast(`✨ ¡Versión ${newIteration.versionNumber} encajada automáticamente con la cuadrícula!`);
        } else {
          this.showToast(`¡Versión ${newIteration.versionNumber} cargada!`);
        }
      } else {
        this.showToast(`¡Versión ${newIteration.versionNumber} añadida con alineación previa!`);
      }
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

      // Si el modo de calibración de 4 esquinas está activo, verificar si tocó una esquina
      if (this.canvasEngine.isCalibrating && this.canvasEngine.calibrationCorners.length === 4) {
        const rect = canvas.getBoundingClientRect();
        const touchX = e.clientX - rect.left;
        const touchY = e.clientY - rect.top;

        let closestIdx = -1;
        let minDist = 56; // Área táctil generosa para dedos / Apple Pencil (56px)
        this.canvasEngine.calibrationCorners.forEach((pt, idx) => {
          const d = Math.hypot(pt.x - touchX, pt.y - touchY);
          if (d < minDist) {
            minDist = d;
            closestIdx = idx;
          }
        });

        if (closestIdx !== -1) {
          this.activeCornerDrag = {
            pointerId: e.pointerId,
            index: closestIdx
          };
          this.canvasEngine.activeCornerDragIndex = closestIdx;
          this.canvasEngine.render();
          return;
        }
      }

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
      // Movimiento de esquina en modo calibración
      if (this.activeCornerDrag && this.activeCornerDrag.pointerId === e.pointerId) {
        const rect = canvas.getBoundingClientRect();
        const curIdx = this.activeCornerDrag.index;
        this.canvasEngine.calibrationCorners[curIdx] = {
          x: Math.round(e.clientX - rect.left),
          y: Math.round(e.clientY - rect.top)
        };
        this.canvasEngine.activeCornerDragIndex = curIdx;
        this.canvasEngine.render();
        return;
      }

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
      if (this.activeCornerDrag && this.activeCornerDrag.pointerId === e.pointerId) {
        this.activeCornerDrag = null;
        this.canvasEngine.activeCornerDragIndex = -1;
        this.canvasEngine.render();
      }

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
    if (cleanToggleBtn) {
      cleanToggleBtn.addEventListener('click', () => {
        const studio = document.getElementById('studio-view');
        studio.classList.toggle('clean-mode');
        const isClean = studio.classList.contains('clean-mode');
        cleanToggleBtn.setAttribute('aria-label', isClean ? 'Salir de modo limpio' : 'Modo limpio');
      });
    }

    const exitCleanBtn = document.getElementById('btn-exit-clean-mode');
    if (exitCleanBtn) {
      exitCleanBtn.addEventListener('click', () => {
        const studio = document.getElementById('studio-view');
        studio.classList.remove('clean-mode');
      });
    }

    // 2b. Cambiar o Cargar Foto de Referencia desde el Estudio
    const btnChangeRef = document.getElementById('btn-change-ref');
    const inputChangeRefFile = document.getElementById('input-change-ref-file');
    if (btnChangeRef && inputChangeRefFile) {
      btnChangeRef.addEventListener('click', () => {
        inputChangeRefFile.click();
      });

      inputChangeRefFile.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files[0] && this.currentProject) {
          const file = e.target.files[0];
          this.showToast('Optimizando y actualizando foto...');
          try {
            const optBlob = await window.bocetosDB.optimizeImageBlob(file, 2048, 0.90);
            const thumbBlob = await window.bocetosDB.createThumbnail(optBlob, 360);
            this.currentProject.referenceImageBlob = optBlob;
            this.currentProject.referenceThumbnailBlob = thumbBlob;
            await window.bocetosDB.saveProject(this.currentProject);
            await this.canvasEngine.loadReferenceBlob(optBlob);
            this.syncGridUI(this.canvasEngine.gridConfig);
            this.showToast('✓ ¡Foto de referencia actualizada!');
          } catch (err) {
            console.error('Error actualizando foto de referencia:', err);
            this.showToast('Error al actualizar la foto');
          }
          inputChangeRefFile.value = '';
        }
      });
    }

    // 3. Toggles de Visibilidad de Capas
    document.getElementById('chip-toggle-ref').addEventListener('click', () => {
      const isVis = !this.canvasEngine.layers.reference;
      this.canvasEngine.setLayerVisibility('reference', isVis);
      this.syncLayerTogglesUI();
      this.saveLayerState();
    });

    document.getElementById('chip-toggle-grid').addEventListener('click', () => {
      const isVis = !(this.canvasEngine.layers.grid && this.canvasEngine.gridConfig.visible);
      this.canvasEngine.setLayerVisibility('grid', isVis);
      this.canvasEngine.setGridConfig({ visible: isVis });
      this.syncLayerTogglesUI();
      this.saveLayerState();
    });

    document.getElementById('chip-toggle-sketch').addEventListener('click', () => {
      const isVis = !this.canvasEngine.layers.sketch;
      this.canvasEngine.setLayerVisibility('sketch', isVis);
      this.syncLayerTogglesUI();
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
    // Toggle Cuadrados Perfectos (1:1)
    const toggleSquare = document.getElementById('toggle-grid-square');
    if (toggleSquare) {
      toggleSquare.addEventListener('change', (e) => {
        this.updateGrid({ squareCells: e.target.checked });
      });
    }

    // Steppers Columnas
    document.getElementById('btn-cols-minus').addEventListener('click', () => {
      const cur = this.canvasEngine.gridConfig.cols;
      if (cur > 1) this.updateGrid({ cols: cur - 1 });
    });
    document.getElementById('btn-cols-plus').addEventListener('click', () => {
      const cur = this.canvasEngine.gridConfig.cols;
      if (cur < 25) this.updateGrid({ cols: cur + 1 });
    });

    // Steppers Filas
    document.getElementById('btn-rows-minus').addEventListener('click', () => {
      const cur = this.canvasEngine.gridConfig.rows;
      if (cur > 1) this.updateGrid({ rows: cur - 1 });
    });
    document.getElementById('btn-rows-plus').addEventListener('click', () => {
      const cur = this.canvasEngine.gridConfig.rows;
      if (cur < 25) this.updateGrid({ rows: cur + 1 });
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
    // Auto-Encajar Cuadrícula
    const autoAlignAction = () => {
      if (!this.canvasEngine.sketchImg) {
        this.showToast('Toma o sube una foto del boceto primero');
        return;
      }
      this.showToast('Analizando cuadrícula y encajando...');
      const ok = this.canvasEngine.autoAlignSketchWithGrid();
      if (ok) {
        this.syncSketchTransformUI(this.canvasEngine.sketchTransform);
        this.scheduleAutoSave();
        this.showToast('✨ ¡Boceto encajado con la cuadrícula!');
      } else {
        this.showToast('No se detectaron líneas claras. Usa "4 Esquinas" para ajuste manual.');
      }
    };

    const btnAutoAlign = document.getElementById('btn-auto-align-grid');
    if (btnAutoAlign) btnAutoAlign.addEventListener('click', autoAlignAction);

    const btnQuickAutoAlign = document.getElementById('btn-quick-autoalign');
    if (btnQuickAutoAlign) btnQuickAutoAlign.addEventListener('click', autoAlignAction);

    // Calibrador de 4 Esquinas
    const calibBanner = document.getElementById('calibration-banner');
    const btnCalibrate = document.getElementById('btn-calibrate-corners');
    if (btnCalibrate) {
      btnCalibrate.addEventListener('click', () => {
        if (!this.canvasEngine.sketchImg) {
          this.showToast('Toma o sube una foto del boceto primero');
          return;
        }
        // Cerrar paneles flotantes para despejar el lienzo
        document.querySelectorAll('.floating-side-panel').forEach(p => p.classList.remove('open'));
        document.querySelectorAll('.tool-tab-btn').forEach(b => b.classList.remove('active'));

        this.canvasEngine.startCalibration();
        if (calibBanner) calibBanner.classList.add('active');
        this.showToast('🎯 Arrastra las 4 esquinas a la cuadrícula de tu papel');
      });
    }

    const btnApplyCalib = document.getElementById('btn-apply-calibration');
    if (btnApplyCalib) {
      btnApplyCalib.addEventListener('click', () => {
        this.canvasEngine.applyCalibrationCorners();
        if (calibBanner) calibBanner.classList.remove('active');
        this.syncSketchTransformUI(this.canvasEngine.sketchTransform);
        this.scheduleAutoSave();
        this.showToast('✓ ¡Boceto encajado con precisión milimétrica!');
      });
    }

    const btnCancelCalib = document.getElementById('btn-cancel-calibration');
    if (btnCancelCalib) {
      btnCancelCalib.addEventListener('click', () => {
        this.canvasEngine.cancelCalibration();
        if (calibBanner) calibBanner.classList.remove('active');
        this.showToast('Calibración cancelada');
      });
    }

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
    const isSquare = !!config.squareCells;
    const toggleSquare = document.getElementById('toggle-grid-square');
    if (toggleSquare) toggleSquare.checked = isSquare;

    document.getElementById('cols-value-display').textContent = config.cols;

    const rowsMinusBtn = document.getElementById('btn-rows-minus');
    const rowsPlusBtn = document.getElementById('btn-rows-plus');
    const rowsRow = document.getElementById('row-control-rows');

    if (isSquare) {
      const refW = (this.canvasEngine.refBounds && this.canvasEngine.refBounds.width) || 1;
      const refH = (this.canvasEngine.refBounds && this.canvasEngine.refBounds.height) || 1;
      const cellSize = refW / config.cols;
      const effectiveRows = Math.ceil(refH / cellSize);
      document.getElementById('rows-value-display').textContent = `${effectiveRows} (auto)`;
      if (rowsMinusBtn) rowsMinusBtn.disabled = true;
      if (rowsPlusBtn) rowsPlusBtn.disabled = true;
      if (rowsRow) rowsRow.classList.add('control-disabled');
    } else {
      document.getElementById('rows-value-display').textContent = config.rows;
      if (rowsMinusBtn) rowsMinusBtn.disabled = false;
      if (rowsPlusBtn) rowsPlusBtn.disabled = false;
      if (rowsRow) rowsRow.classList.remove('control-disabled');
    }

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
    const refActive = !!l.reference;
    const gridActive = !!(l.grid && this.canvasEngine.gridConfig.visible);
    const sketchActive = !!l.sketch;

    document.getElementById('chip-toggle-ref').classList.toggle('active', refActive);
    document.getElementById('chip-toggle-grid').classList.toggle('active', gridActive);
    document.getElementById('chip-toggle-sketch').classList.toggle('active', sketchActive);
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
      inputRefFile.value = '';
      selectedRefBlob = null;
      previewImg.style.display = 'none';
      placeholderText.style.display = 'block';
      newProjModal.classList.add('open');
      document.getElementById('input-project-name').focus();
    };

    document.getElementById('btn-cancel-new-proj').addEventListener('click', () => {
      newProjModal.classList.remove('open');
      inputRefFile.value = '';
      selectedRefBlob = null;
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
        inputRefFile.value = '';
        selectedRefBlob = null;
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
