/**
 * Bocetos - DB & Image Optimization Module (IndexedDB)
 * Optimizado para iPad con compresión automática a 2048px
 */

const DB_NAME = 'bocetos_db';
const DB_VERSION = 1;

class BocetosDB {
  constructor() {
    this.db = null;
    this.initPromise = this.openDB();
  }

  async openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Almacén de proyectos
        if (!db.objectStoreNames.contains('projects')) {
          const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
          projectStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // Almacén de iteraciones (versiones de bocetos de cada proyecto)
        if (!db.objectStoreNames.contains('iterations')) {
          const iterationStore = db.createObjectStore('iterations', { keyPath: 'id' });
          iterationStore.createIndex('projectId', 'projectId', { unique: false });
          iterationStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('Error al abrir IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async ready() {
    if (!this.db) {
      await this.initPromise;
    }
    return this.db;
  }

  /**
   * Optimiza y redimensiona cualquier imagen/foto de cámara a un máximo en su lado mayor.
   * Evita fugas de memoria en Safari / iPadOS con fotos de 12MP/48MP.
   * @param {Blob|File} fileOrBlob 
   * @param {number} maxDimension Tamaño máximo en px (default 2048)
   * @param {number} quality Calidad de compresión JPEG (0.0 - 1.0)
   * @returns {Promise<Blob>} Blob comprimido JPEG
   */
  static async optimizeImageBlob(fileOrBlob, maxDimension = 2048, quality = 0.88) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(fileOrBlob);
      const img = new Image();

      img.onload = () => {
        let width = img.naturalWidth || img.width || 1;
        let height = img.naturalHeight || img.height || 1;

        // Calcular escalado manteniendo relación de aspecto
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        // Renderizado en canvas auxiliar
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Suavizado de imagen de alta calidad
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Revocar URL del objeto tras pintar en el canvas
        URL.revokeObjectURL(url);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('No se pudo generar el Blob optimizado'));
            }
          },
          'image/jpeg',
          quality
        );
      };

      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };

      img.src = url;
    });
  }

  /**
   * Crea una miniatura rápida para galerías e historial
   */
  static async createThumbnail(fileOrBlob, maxDimension = 320) {
    return this.optimizeImageBlob(fileOrBlob, maxDimension, 0.75);
  }

  /* ========================================================
   * GESTIÓN DE PROYECTOS (CRUD)
   * ======================================================== */

  async getAllProjects() {
    const db = await this.ready();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('projects', 'readonly');
      const store = transaction.objectStore('projects');
      const request = store.getAll();

      request.onsuccess = () => {
        // Ordenar por más recientemente modificado
        const projects = request.result || [];
        projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(projects);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async getProject(id) {
    const db = await this.ready();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('projects', 'readonly');
      const store = transaction.objectStore('projects');
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async saveProject(project) {
    const db = await this.ready();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('projects', 'readwrite');
      const store = transaction.objectStore('projects');
      project.updatedAt = Date.now();
      const request = store.put(project);

      request.onsuccess = () => resolve(project);
      request.onerror = () => reject(request.error);
    });
  }

  async createProject({ name, referenceBlob }) {
    const id = 'proj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    // Optimizar imagen original y generar miniatura
    const optimizedBlob = await BocetosDB.optimizeImageBlob(referenceBlob, 2048, 0.90);
    const thumbnailBlob = await BocetosDB.createThumbnail(optimizedBlob, 360);

    const project = {
      id,
      name: name.trim() || 'Nuevo Proyecto',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      referenceImageBlob: optimizedBlob,
      referenceThumbnailBlob: thumbnailBlob,
      gridConfig: {
        rows: 4,
        cols: 4,
        color: '#00e5ff',
        lineWidth: 2,
        showDiagonals: false,
        showLabels: true,
        visible: true
      },
      layersState: {
        reference: true,
        grid: true,
        sketch: true
      },
      lastTransform: {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        rotation: 0,
        flipH: false,
        flipV: false,
        opacity: 0.65,
        blendMode: 'difference'
      }
    };

    await this.saveProject(project);
    return project;
  }

  async deleteProject(id) {
    const db = await this.ready();
    // Eliminar proyecto e iteraciones asociadas
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['projects', 'iterations'], 'readwrite');
      const projectStore = transaction.objectStore('projects');
      const iterationStore = transaction.objectStore('iterations');

      projectStore.delete(id);

      // Eliminar iteraciones vinculadas
      const index = iterationStore.index('projectId');
      const iterRequest = index.openCursor(IDBKeyRange.only(id));

      iterRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /* ========================================================
   * GESTIÓN DE ITERACIONES (LÍNEA DE TIEMPO)
   * ======================================================== */

  async getIterations(projectId) {
    const db = await this.ready();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('iterations', 'readonly');
      const store = transaction.objectStore('iterations');
      const index = store.index('projectId');
      const request = index.getAll(IDBKeyRange.only(projectId));

      request.onsuccess = () => {
        const list = request.result || [];
        list.sort((a, b) => a.versionNumber - b.versionNumber);
        resolve(list);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async addIteration(projectId, sketchBlob, inheritedTransform = null) {
    const existing = await this.getIterations(projectId);
    const nextVersion = existing.length + 1;

    // Optimizar imagen de boceto a max 2048px y miniatura
    const optimizedBlob = await BocetosDB.optimizeImageBlob(sketchBlob, 2048, 0.88);
    const thumbnailBlob = await BocetosDB.createThumbnail(optimizedBlob, 280);

    const iteration = {
      id: 'iter_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      projectId,
      versionNumber: nextVersion,
      timestamp: Date.now(),
      sketchImageBlob: optimizedBlob,
      sketchThumbnailBlob: thumbnailBlob,
      transform: inheritedTransform ? { ...inheritedTransform } : {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        rotation: 0,
        flipH: false,
        flipV: false,
        opacity: 0.65,
        blendMode: 'difference'
      }
    };

    const db = await this.ready();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('iterations', 'readwrite');
      const store = transaction.objectStore('iterations');
      const request = store.add(iteration);

      request.onsuccess = () => resolve(iteration);
      request.onerror = () => reject(request.error);
    });

    // Actualizar timestamp del proyecto
    const project = await this.getProject(projectId);
    if (project) {
      project.updatedAt = Date.now();
      if (inheritedTransform) {
        project.lastTransform = { ...inheritedTransform };
      }
      await this.saveProject(project);
    }

    return iteration;
  }

  async updateIterationTransform(iterationId, transform) {
    const db = await this.ready();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('iterations', 'readwrite');
      const store = transaction.objectStore('iterations');
      const getReq = store.get(iterationId);

      getReq.onsuccess = () => {
        const item = getReq.result;
        if (!item) {
          return resolve(null);
        }
        item.transform = { ...transform };
        const putReq = store.put(item);
        putReq.onsuccess = () => resolve(item);
        putReq.onerror = () => reject(putReq.error);
      };

      getReq.onerror = () => reject(getReq.error);
    });
  }

  async deleteIteration(iterationId) {
    const db = await this.ready();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('iterations', 'readwrite');
      const store = transaction.objectStore('iterations');
      const request = store.delete(iterationId);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }
}

// Instancia global
window.bocetosDB = new BocetosDB();

