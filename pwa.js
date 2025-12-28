(() => {
  const statusEl = document.getElementById("pwaStatus");
  const btnInstall = document.getElementById("btnInstall");
  let deferredPrompt = null;

  function setStatus(txt){ if(statusEl) statusEl.textContent = txt; }

  function showUpdateButton(reg){
    let btn = document.getElementById("btnUpdateNow");
    if(!btn){
      btn = document.createElement("button");
      btn.id = "btnUpdateNow";
      btn.type = "button";
      btn.className = "btn btnPrimary";
      btn.textContent = "Atualizar agora";
      const row = document.querySelector(".miniRow");
      if(row) row.prepend(btn);
    }
    btn.onclick = () => {
      setStatus("PWA: aplicando atualização…");
      if(reg?.waiting) reg.waiting.postMessage({ type:"SKIP_WAITING" });
    };
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try{
        const reg = await navigator.serviceWorker.register("./sw.js");
        setStatus(navigator.onLine ? "PWA: online ✅" : "PWA: offline ativo ✅");

        navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());

        if(reg.waiting){
          setStatus("PWA: nova versão disponível ✅");
          showUpdateButton(reg);
        }

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if(!newWorker) return;
          setStatus("PWA: baixando atualização…");
          newWorker.addEventListener("statechange", () => {
            if(newWorker.state === "installed"){
              if(navigator.serviceWorker.controller){
                setStatus("PWA: nova versão disponível ✅");
                showUpdateButton(reg);
              } else {
                setStatus("PWA: offline ativo ✅");
              }
            }
          });
        });
      }catch(e){
        setStatus("PWA: offline não registrado ❌");
      }
    });
  } else {
    setStatus("PWA: navegador não suporta SW");
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if(btnInstall){
      btnInstall.style.display = "inline-flex";
      btnInstall.onclick = async () => {
        try{
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
        } finally {
          deferredPrompt = null;
          btnInstall.style.display = "none";
        }
      };
    }
  });

  window.addEventListener("appinstalled", () => {
    if(btnInstall) btnInstall.style.display = "none";
    setStatus("PWA: instalado ✅");
  });

  window.addEventListener("online", () => setStatus("PWA: online ✅"));
  window.addEventListener("offline", () => setStatus("PWA: offline ativo ✅"));
})();