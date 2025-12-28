/* BTX Docs Premium — IndexedDB + Backup */
(() => {
  const DB_NAME = "btx_docs_premium_db";
  const DB_VER = 1;

  const STORES = {
    settings: "settings",
    clinic: "clinic",
    pros: "pros",
    patients: "patients",
    appts: "appts",
    notes: "notes"
  };

  function openDB(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);

      req.onupgradeneeded = () => {
        const db = req.result;

        if(!db.objectStoreNames.contains(STORES.settings)){
          db.createObjectStore(STORES.settings, { keyPath: "key" });
        }
        if(!db.objectStoreNames.contains(STORES.clinic)){
          db.createObjectStore(STORES.clinic, { keyPath: "id" });
        }
        if(!db.objectStoreNames.contains(STORES.pros)){
          const st = db.createObjectStore(STORES.pros, { keyPath: "id" });
          st.createIndex("by_name", "nome", { unique:false });
        }
        if(!db.objectStoreNames.contains(STORES.patients)){
          const st = db.createObjectStore(STORES.patients, { keyPath: "id" });
          st.createIndex("by_name", "nome", { unique:false });
          st.createIndex("by_phone", "telefone", { unique:false });
        }
        if(!db.objectStoreNames.contains(STORES.appts)){
          const st = db.createObjectStore(STORES.appts, { keyPath: "id" });
          st.createIndex("by_date", "date", { unique:false });
          st.createIndex("by_proId", "proId", { unique:false });
          st.createIndex("by_patientId", "patientId", { unique:false });
          st.createIndex("by_status", "status", { unique:false });
        }
        if(!db.objectStoreNames.contains(STORES.notes)){
          const st = db.createObjectStore(STORES.notes, { keyPath: "id" });
          st.createIndex("by_patientId", "patientId", { unique:false });
          st.createIndex("by_date", "date", { unique:false });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, storeName, mode="readonly"){
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  async function setSetting(key, value){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const st = tx(db, STORES.settings, "readwrite");
      const req = st.put({ key, value });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function getSetting(key){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const st = tx(db, STORES.settings);
      const req = st.get(key);
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(storeName, obj){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const st = tx(db, storeName, "readwrite");
      const req = st.put(obj);
      req.onsuccess = () => resolve(obj);
      req.onerror = () => reject(req.error);
    });
  }

  async function del(storeName, id){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const st = tx(db, storeName, "readwrite");
      const req = st.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(storeName, id){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const st = tx(db, storeName);
      const req = st.get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAll(storeName){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const st = tx(db, storeName);
      const req = st.getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllByIndex(storeName, indexName, value){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const st = tx(db, storeName);
      const idx = st.index(indexName);
      const req = idx.getAll(value);
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearAll(){
    const db = await openDB();
    const names = Object.values(STORES);
    for(const s of names){
      await new Promise((resolve, reject) => {
        const st = tx(db, s, "readwrite");
        const req = st.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    }
    return true;
  }

  async function exportAll(){
    const data = {};
    for(const s of Object.values(STORES)){
      data[s] = await getAll(s);
    }
    return {
      app: "BTX Docs Premium",
      exportedAt: new Date().toISOString(),
      version: DB_VER,
      data
    };
  }

  async function importAll(payload){
    if(!payload?.data) throw new Error("Arquivo inválido");
    await clearAll();
    for(const s of Object.values(STORES)){
      const arr = payload.data[s] || [];
      for(const item of arr){
        await put(s, item);
      }
    }
    return true;
  }

  window.BTXDB = {
    STORES,
    openDB,
    setSetting,
    getSetting,
    put,
    del,
    get,
    getAll,
    getAllByIndex,
    clearAll,
    exportAll,
    importAll
  };
})();