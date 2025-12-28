/* BTX Docs Saúde — Premium (Clínica Integrada + Agenda Inteligente + PDFs Individuais)
   - Offline-first: IndexedDB (BTXDB)
   - Multi-profissional (perfil ativo)
   - Agenda semanal com busca, status e vínculo com paciente
   - Documentos: Ficha, Receita inteligente (inclui HAS/DM), Atestado, Laudo, Recibo, Orçamento
   - Backup/Restore JSON
   - Controle local de ativação por dispositivo (não é nuvem)
*/
(() => {
  // ===== Helpers =====
  const $ = (id) => document.getElementById(id);
  const toastEl = $("toast");
  function toast(msg){
    if(!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(()=>toastEl.classList.remove("show"), 2200);
  }
  const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : ("id"+Math.random().toString(16).slice(2)+Date.now()));
  const todayISO = () => new Date().toISOString().slice(0,10);
  const nowBR = () => new Date().toLocaleString("pt-BR");
  const fmtDateBR = (iso) => {
    if(!iso) return "";
    const [y,m,d] = iso.split("-").map(Number);
    if(!y||!m||!d) return iso;
    return `${String(d).padStart(2,"0")}/${String(m).padStart(2,"0")}/${y}`;
  };
  const safe = (s) => String(s ?? "").replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
  const onlyDigits = (s) => String(s||"").replace(/\D/g,"");
  const waLink = (phone, text) => {
    const p = onlyDigits(phone);
    if(!p) return null;
    const t = encodeURIComponent(text || "");
    return `https://wa.me/55${p}?text=${t}`;
  };

  // ===== License / Device binding (simple offline lock) =====
  function deviceFingerprint(){
    const ua = navigator.userAgent || "";
    const plat = navigator.platform || "";
    const lang = navigator.language || "";
    const scr = `${screen.width}x${screen.height}x${screen.colorDepth}`;
    return `${ua}||${plat}||${lang}||${scr}`;
  }
  async function sha256(str){
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
  }

  // ===== State =====
  let clinic = { id:"clinic", nome:"", endereco:"", tel:"", whats:"" };
  let pros = [];            // professionals
  let activeProId = null;
  let patients = [];
  let appts = [];           // appointments
  let notes = [];           // evolutions
  let currentTab = "agenda";

  // ===== Templates / Presets =====
  const PRESCR_PRESETS = {
    analgesico: [
      "Dipirona 500 mg — 1 comp VO a cada 6/6h se dor por 3 dias",
      "Paracetamol 750 mg — 1 comp VO a cada 8/8h se dor por 3 dias",
      "Ibuprofeno 400 mg — 1 comp VO a cada 8/8h após refeições por 3 dias"
    ],
    antiinflamatorio: [
      "Naproxeno 500 mg — 1 comp VO 12/12h por 3 dias",
      "Diclofenaco 50 mg — 1 comp VO 8/8h por 3 dias"
    ],
    antibiotico: [
      "Amoxicilina 500 mg — 1 cáps VO 8/8h por 7 dias",
      "Amoxicilina + Clavulanato 875/125 mg — 1 comp VO 12/12h por 7 dias",
      "Azitromicina 500 mg — 1 comp VO 1x/dia por 3 dias",
      "Clindamicina 300 mg — 1 cáps VO 6/6h por 7 dias"
    ],
    hipertensao: [
      "Losartana 50 mg — 1 comp VO 1x/dia (uso contínuo)",
      "Enalapril 10 mg — 1 comp VO 12/12h (uso contínuo)",
      "Amlodipino 5 mg — 1 comp VO 1x/dia (uso contínuo)",
      "Hidroclorotiazida 25 mg — 1 comp VO 1x/dia (uso contínuo)"
    ],
    diabetes: [
      "Metformina 500 mg — 1 comp VO 12/12h após refeições (uso contínuo)",
      "Metformina 850 mg — 1 comp VO 12/12h (uso contínuo)",
      "Gliclazida MR 30 mg — 1 comp VO 1x/dia (uso contínuo)",
      "Insulina (conforme prescrição individual) — registrar esquema e doses"
    ]
  };

  // ===== UI refs =====
  const loginWrap = $("loginWrap");
  const appTopbar = $("appTopbar");
  const appMain = $("appMain");

  const clinicName = $("clinicName");
  const clinicAddr = $("clinicAddr");
  const clinicTel = $("clinicTel");
  const clinicWhats = $("clinicWhats");
  const btnClinicSave = $("btnClinicSave");
  const btnClinicClear = $("btnClinicClear");

  const activeProSel = $("activePro");
  const activeProLabel = $("activeProLabel");
  const btnProNew = $("btnProNew");
  const btnProManage = $("btnProManage");

  const tabs = $("tabs");
  const formPanel = $("formPanel");
  const btnLimparForm = $("btnLimparForm");
  const btnPrint = $("btnPrint");

  const pvClinicName = $("pvClinicName");
  const pvClinicAddr = $("pvClinicAddr");
  const pvMeta = $("pvMeta");
  const pvProfBox = $("pvProfBox");
  const pvTitle = $("pvTitle");
  const pvSub = $("pvSub");
  const pvBody = $("pvBody");
  const pvSign = $("pvSign");
  const pvFooter = $("pvFooter");

  const docTitle = $("docTitle");
  const docSub = $("docSub");
  const clinicResumo = $("clinicResumo");
  const profResumo = $("profResumo");

  const btnBackup = $("btnBackup");
  const btnRestore = $("btnRestore");
  const restoreFile = $("restoreFile");
  const btnLogout = $("btnLogout");
  const btnResetAll = $("btnResetAll");
  const btnDownloadApp = $("btnDownloadApp");

  // ===== Load/Save =====
  async function loadAll(){
    // settings
    const savedClinic = await BTXDB.get(BTXDB.STORES.clinic, "clinic");
    if(savedClinic) clinic = savedClinic;

    pros = await BTXDB.getAll(BTXDB.STORES.pros);
    patients = await BTXDB.getAll(BTXDB.STORES.patients);
    appts = await BTXDB.getAll(BTXDB.STORES.appts);
    notes = await BTXDB.getAll(BTXDB.STORES.notes);

    activeProId = await BTXDB.getSetting("activeProId");
    if(!activeProId && pros[0]?.id){
      activeProId = pros[0].id;
      await BTXDB.setSetting("activeProId", activeProId);
    }
  }

  async function saveClinic(){
    clinic.nome = clinicName.value.trim();
    clinic.endereco = clinicAddr.value.trim();
    clinic.tel = clinicTel.value.trim();
    clinic.whats = clinicWhats.value.trim();
    await BTXDB.put(BTXDB.STORES.clinic, clinic);
    toast("Clínica salva ✅");
    renderHeaderSummary();
    renderPreviewHeader();
  }

  function resetClinicForm(){
    clinicName.value = "";
    clinicAddr.value = "";
    clinicTel.value = "";
    clinicWhats.value = "";
  }

  function fillClinicForm(){
    clinicName.value = clinic.nome || "";
    clinicAddr.value = clinic.endereco || "";
    clinicTel.value = clinic.tel || "";
    clinicWhats.value = clinic.whats || "";
  }

  function getActivePro(){
    return pros.find(p => p.id === activeProId) || null;
  }

  async function setActivePro(id){
    activeProId = id || null;
    await BTXDB.setSetting("activeProId", activeProId);
    renderProSelect();
    renderHeaderSummary();
    renderTab(currentTab);
  }

  // ===== UI: Header & Preview header =====
  function renderHeaderSummary(){
    clinicResumo.textContent = clinic.nome ? clinic.nome : "—";
    const pro = getActivePro();
    profResumo.textContent = pro ? `${pro.nome} (${pro.conselho||""}${pro.registro?(" "+pro.registro):""})` : "—";
    activeProLabel.textContent = pro ? pro.nome : "—";
  }

  function renderPreviewHeader(){
    const pro = getActivePro();
    const addr = clinic.endereco || (pro?.endereco || "—");
    pvClinicName.textContent = clinic.nome || "BTX Docs Saúde — Premium";
    pvClinicAddr.textContent = addr;
    pvMeta.innerHTML = `
      <div><b>Gerado:</b> ${safe(nowBR())}</div>
      <div><b>Profissional:</b> ${safe(pro?.nome || "—")}</div>
    `;
    pvProfBox.innerHTML = renderProBoxHTML(pro);
    pvFooter.innerHTML = `
      <div>${safe(clinic.nome || "BTX Docs Premium")} — ${safe(addr)}</div>
      <div>${safe(clinic.tel || "")} ${clinic.whats ? " • " + safe(clinic.whats) : ""}</div>
    `;
  }

  function renderProBoxHTML(pro){
    if(!pro) return "<b>Configure um profissional</b> no menu lateral.";
    const reg = `${pro.conselho || ""}${pro.registro ? (" "+pro.registro) : ""}`.trim();
    return `
      <div class="kv">
        <div class="k">Profissional</div><div class="v">${safe(pro.nome || "")}</div>
        <div class="k">Especialidade</div><div class="v">${safe(pro.especialidade || "")}</div>
        <div class="k">Registro</div><div class="v">${safe(reg || "—")}</div>
        <div class="k">Contato</div><div class="v">${safe(pro.telefone || "")} ${pro.email ? (" • "+safe(pro.email)) : ""}</div>
        <div class="k">Endereço</div><div class="v">${safe(pro.endereco || clinic.endereco || "—")}</div>
      </div>
    `;
  }

  // ===== Professionals =====
  function renderProSelect(){
    activeProSel.innerHTML = "";
    if(pros.length === 0){
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "— sem profissionais —";
      activeProSel.appendChild(opt);
      activeProSel.disabled = true;
      return;
    }
    activeProSel.disabled = false;
    for(const p of pros){
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.nome}${p.especialidade ? " — "+p.especialidade : ""}`;
      if(p.id === activeProId) opt.selected = true;
      activeProSel.appendChild(opt);
    }
  }

  async function createProFlow(){
    const nome = prompt("Nome completo do profissional:");
    if(!nome) return;
    const especialidade = prompt("Especialidade (ex.: Cirurgião-dentista / Médico):") || "";
    const conselho = prompt("Conselho (CRO/CRM/etc):") || "";
    const registro = prompt("Registro:") || "";
    const telefone = prompt("Telefone:") || "";
    const email = prompt("E-mail:") || "";
    const endereco = prompt("Endereço do profissional (se diferente da clínica):") || "";
    const p = { id: uid(), nome, especialidade, conselho, registro, telefone, email, endereco, createdAt: new Date().toISOString() };
    await BTXDB.put(BTXDB.STORES.pros, p);
    pros = await BTXDB.getAll(BTXDB.STORES.pros);
    if(!activeProId) await setActivePro(p.id);
    renderProSelect();
    renderHeaderSummary();
    renderPreviewHeader();
    toast("Profissional criado ✅");
  }

  async function manageProsFlow(){
    if(pros.length === 0){
      toast("Nenhum profissional cadastrado.");
      return;
    }
    const list = pros.map((p,i)=> `${i+1}) ${p.nome} (${p.conselho||""}${p.registro?(" "+p.registro):""})`).join("\n");
    const ans = prompt(`Gerenciar profissionais:\n\n${list}\n\nDigite o número para remover, ou deixe vazio para cancelar:`);
    if(!ans) return;
    const idx = Number(ans)-1;
    if(!(idx>=0 && idx<pros.length)) return toast("Número inválido.");
    const target = pros[idx];
    if(!confirm(`Remover "${target.nome}"? (não apaga pacientes/agenda automaticamente)`)) return;
    await BTXDB.del(BTXDB.STORES.pros, target.id);
    pros = await BTXDB.getAll(BTXDB.STORES.pros);
    if(activeProId === target.id){
      await setActivePro(pros[0]?.id || null);
    }
    renderProSelect();
    renderHeaderSummary();
    renderPreviewHeader();
    toast("Profissional removido ✅");
  }

  // ===== Tabs =====
  function setTab(tab){
    currentTab = tab;
    // highlight
    document.querySelectorAll(".tabbtn").forEach(b=>{
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    renderTab(tab);
  }

  function renderTab(tab){
    renderPreviewHeader();
    if(tab === "agenda") return renderAgenda();
    if(tab === "pacientes") return renderPatients();
    if(tab === "ficha") return renderFicha();
    if(tab === "receita") return renderReceita();
    if(tab === "recibo") return renderRecibo();
    if(tab === "orcamento") return renderOrcamento();
    if(tab === "laudo") return renderLaudo();
    if(tab === "atestado") return renderAtestado();
    if(tab === "config") return renderConfig();
  }

  function setDocHead(title, subtitle){
    docTitle.textContent = title;
    docSub.textContent = subtitle;
    pvTitle.textContent = title;
    pvSub.textContent = subtitle;
  }

  function setPreviewBody(html){
    pvBody.innerHTML = html;
    renderPreviewSignature();
  }

  function renderPreviewSignature(extraLeft=""){
    const pro = getActivePro();
    const reg = `${pro?.conselho || ""}${pro?.registro ? (" "+pro.registro) : ""}`.trim();
    pvSign.innerHTML = `
      <div>
        ${extraLeft ? `<div><b>${safe(extraLeft)}</b></div>` : ""}
        <div>Assinatura: _______________________________________</div>
      </div>
      <div style="text-align:right">
        <div><b>${safe(pro?.nome || "—")}</b></div>
        <div>${safe(reg || "")}</div>
      </div>
    `;
  }

  // ===== Agenda =====
  function startOfWeek(d){
    const dt = new Date(d);
    const day = dt.getDay(); // 0 Sun
    const diff = (day===0?6:day-1); // monday=0
    dt.setDate(dt.getDate() - diff);
    dt.setHours(0,0,0,0);
    return dt;
  }
  function addDays(d, n){ const dt = new Date(d); dt.setDate(dt.getDate()+n); return dt; }
  function toISODate(d){ return new Date(d).toISOString().slice(0,10); }

  function renderAgenda(){
    setDocHead("Agenda Inteligente", "Semana, status, busca e multi-profissional. Tudo salvo offline.");
    const pro = getActivePro();
    if(!pro){
      formPanel.innerHTML = `<div class="small">Cadastre um profissional para usar a agenda.</div>`;
      setPreviewBody(`<div class="small">Cadastre um profissional no menu lateral.</div>`);
      return;
    }

    const base = startOfWeek(new Date());
    const baseISO = toISODate(base);
    const days = Array.from({length:7}, (_,i)=> {
      const d = addDays(base, i);
      return { iso: toISODate(d), label: d.toLocaleDateString("pt-BR", {weekday:"short", day:"2-digit", month:"2-digit"}) };
    });

    const statuses = ["Confirmado","Pendente","Remarcar","Faltou","Atendido","Cancelado"];

    formPanel.innerHTML = `
      <div class="group">
        <label>Semana atual</label>
        <div class="row">
          <div><input id="agStart" value="${baseISO}" type="date"/></div>
          <div>
            <select id="agFilterStatus">
              <option value="">(todos status)</option>
              ${statuses.map(s=>`<option value="${s}">${s}</option>`).join("")}
            </select>
          </div>
        </div>

        <label>Busca rápida (paciente/obs)</label>
        <input id="agSearch" placeholder="digite nome ou observação">

        <hr class="sep" />

        <label>Novo agendamento</label>
        <div class="row">
          <div>
            <label>Data</label>
            <input id="agDate" type="date" value="${todayISO()}">
          </div>
          <div>
            <label>Hora</label>
            <input id="agTime" type="time" value="08:00">
          </div>
        </div>

        <label>Paciente</label>
        <div class="row">
          <div>
            <input id="agPatientName" placeholder="Nome do paciente">
          </div>
          <div>
            <input id="agPatientPhone" placeholder="Telefone (WhatsApp)">
          </div>
        </div>

        <div class="row">
          <div>
            <label>Procedimento / Motivo</label>
            <input id="agProc" placeholder="Ex.: Retorno / Exame / Restauração...">
          </div>
          <div>
            <label>Status</label>
            <select id="agStatus">
              ${statuses.map(s=>`<option value="${s}">${s}</option>`).join("")}
            </select>
          </div>
        </div>

        <label>Observação</label>
        <input id="agObs" placeholder="Ex.: dor / preferir tarde / alergias...">

        <div class="actionsLeft">
          <button class="btn btnGhost" type="button" id="btnAgClear">Limpar</button>
          <button class="btn btnPrimary" type="button" id="btnAgSave">Salvar agendamento</button>
        </div>

        <hr class="sep" />

        <div class="small">
          Dicas Premium:
          <ul>
            <li>Agendamentos ficam vinculados ao profissional ativo.</li>
            <li>Se o paciente não existir, ele é criado automaticamente.</li>
            <li>Use WhatsApp 1-toque no painel abaixo.</li>
          </ul>
        </div>
      </div>
    `;

    function getWeekFromInput(){
      const v = $("agStart").value || baseISO;
      return startOfWeek(new Date(v+"T00:00:00"));
    }

    function buildAgendaTable(){
      const wk = getWeekFromInput();
      const weekDays = Array.from({length:7}, (_,i)=> {
        const d = addDays(wk, i);
        return { iso: toISODate(d), label: d.toLocaleDateString("pt-BR", {weekday:"short", day:"2-digit", month:"2-digit"}) };
      });

      const q = ($("agSearch").value||"").trim().toLowerCase();
      const st = $("agFilterStatus").value || "";

      // filter appts by pro + week + query
      const weekSet = new Set(weekDays.map(x=>x.iso));
      let rows = appts.filter(a => a.proId === pro.id && weekSet.has(a.date));
      if(st) rows = rows.filter(a=>a.status === st);
      if(q){
        rows = rows.filter(a => (a.patientName||"").toLowerCase().includes(q) || (a.obs||"").toLowerCase().includes(q) || (a.proc||"").toLowerCase().includes(q));
      }

      // sort by date+time
      rows.sort((a,b)=> (a.date+a.time).localeCompare(b.date+b.time));

      const byDay = {};
      for(const d of weekDays) byDay[d.iso] = [];
      for(const r of rows) (byDay[r.date] ||= []).push(r);

      const body = weekDays.map(d=>{
        const list = byDay[d.iso] || [];
        if(list.length === 0) return `<tr><td>${safe(d.label)}</td><td colspan="4">—</td></tr>`;
        return list.map((a,idx)=>{
          const wa = a.patientPhone ? waLink(a.patientPhone, `Olá ${a.patientName}! Confirmando seu horário em ${fmtDateBR(a.date)} às ${a.time}.`) : null;
          const waBtn = wa ? `<a class="miniLink" href="${wa}" target="_blank">WhatsApp</a>` : `<span class="muted">sem Whats</span>`;
          return `
            <tr>
              ${idx===0? `<td rowspan="${list.length}"><b>${safe(d.label)}</b></td>` : ""}
              <td><b>${safe(a.time)}</b></td>
              <td>${safe(a.patientName||"")}</td>
              <td>${safe(a.proc||"")}</td>
              <td>
                <span class="tag tag-${tagClass(a.status)}">${safe(a.status||"")}</span>
                <div class="miniRow2">
                  ${waBtn}
                  <button class="miniBtn" data-act="edit" data-id="${a.id}">Editar</button>
                  <button class="miniBtn danger" data-act="del" data-id="${a.id}">Excluir</button>
                </div>
              </td>
            </tr>
          `;
        }).join("");
      }).join("");

      return `
        <table class="table">
          <thead>
            <tr>
              <th>Dia</th>
              <th>Hora</th>
              <th>Paciente</th>
              <th>Procedimento</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
        <div class="small" style="margin-top:10px;">
          <b>Filtro:</b> ${safe(st||"todos")} • <b>Busca:</b> ${safe(q||"—")} • <b>Profissional:</b> ${safe(pro.nome)}
        </div>
      `;
    }

    function tagClass(st){
      const s = (st||"").toLowerCase();
      if(s.includes("confirm")) return "ok";
      if(s.includes("pend")) return "warn";
      if(s.includes("falt")) return "bad";
      if(s.includes("canc")) return "bad";
      if(s.includes("atend")) return "ok";
      if(s.includes("remar")) return "warn";
      return "muted";
    }

    // preview document = agenda table
    setPreviewBody(buildAgendaTable());

    // bind events
    $("agStart").addEventListener("change", ()=> setPreviewBody(buildAgendaTable()));
    $("agSearch").addEventListener("input", ()=> setPreviewBody(buildAgendaTable()));
    $("agFilterStatus").addEventListener("change", ()=> setPreviewBody(buildAgendaTable()));

    $("btnAgClear").onclick = () => {
      $("agDate").value = todayISO();
      $("agTime").value = "08:00";
      $("agPatientName").value = "";
      $("agPatientPhone").value = "";
      $("agProc").value = "";
      $("agStatus").value = "Confirmado";
      $("agObs").value = "";
      toast("Form limpo.");
    };

    $("btnAgSave").onclick = async () => {
      const date = $("agDate").value || todayISO();
      const time = $("agTime").value || "08:00";
      const patientName = $("agPatientName").value.trim();
      const patientPhone = $("agPatientPhone").value.trim();
      const proc = $("agProc").value.trim();
      const status = $("agStatus").value || "Pendente";
      const obs = $("agObs").value.trim();

      if(!patientName) return toast("Informe o nome do paciente.");

      // find or create patient
      let pat = patients.find(p => (p.nome||"").toLowerCase() === patientName.toLowerCase() && (!patientPhone || onlyDigits(p.telefone) === onlyDigits(patientPhone)));
      if(!pat){
        pat = { id: uid(), nome: patientName, telefone: patientPhone, createdAt: new Date().toISOString() };
        await BTXDB.put(BTXDB.STORES.patients, pat);
        patients = await BTXDB.getAll(BTXDB.STORES.patients);
      }

      const ap = {
        id: uid(),
        proId: pro.id,
        proName: pro.nome,
        date, time,
        patientId: pat.id,
        patientName: pat.nome,
        patientPhone: pat.telefone || patientPhone,
        proc,
        status,
        obs,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await BTXDB.put(BTXDB.STORES.appts, ap);
      appts = await BTXDB.getAll(BTXDB.STORES.appts);
      toast("Agendamento salvo ✅");
      setPreviewBody(buildAgendaTable());
    };

    // actions in table
    pvBody.onclick = async (e) => {
      const btn = e.target.closest("button");
      if(!btn) return;
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      const ap = appts.find(a=>a.id===id);
      if(!ap) return;

      if(act === "del"){
        if(!confirm("Excluir este agendamento?")) return;
        await BTXDB.del(BTXDB.STORES.appts, id);
        appts = await BTXDB.getAll(BTXDB.STORES.appts);
        toast("Excluído ✅");
        setPreviewBody(buildAgendaTable());
        return;
      }

      if(act === "edit"){
        const nStatus = prompt("Status (Confirmado/Pendente/Remarcar/Faltou/Atendido/Cancelado):", ap.status || "");
        if(!nStatus) return;
        const nObs = prompt("Observação:", ap.obs || "") ?? ap.obs;
        const nProc = prompt("Procedimento:", ap.proc || "") ?? ap.proc;
        ap.status = nStatus;
        ap.obs = nObs;
        ap.proc = nProc;
        ap.updatedAt = new Date().toISOString();
        await BTXDB.put(BTXDB.STORES.appts, ap);
        appts = await BTXDB.getAll(BTXDB.STORES.appts);
        toast("Atualizado ✅");
        setPreviewBody(buildAgendaTable());
      }
    };
  }

  // ===== Patients / Prontuário =====
  function renderPatients(){
    setDocHead("Pacientes e Prontuário", "Cadastre pacientes, registre evolução e puxe dados para documentos.");
    formPanel.innerHTML = `
      <div class="group">
        <label>Busca</label>
        <input id="ptSearch" placeholder="nome ou telefone">

        <hr class="sep"/>

        <label>Novo paciente</label>
        <input id="ptNome" placeholder="Nome completo">
        <input id="ptTel" placeholder="Telefone (WhatsApp)">
        <input id="ptDoc" placeholder="Documento (CPF/RG) opcional">
        <input id="ptNasc" type="date" placeholder="Nascimento">

        <div class="actionsLeft">
          <button class="btn btnGhost" type="button" id="btnPtClear">Limpar</button>
          <button class="btn btnPrimary" type="button" id="btnPtSave">Salvar paciente</button>
        </div>

        <hr class="sep"/>

        <label>Evolução / Nota</label>
        <select id="ptPick"></select>
        <textarea id="ptNote" placeholder="Evolução, conduta, queixa, achados..."></textarea>
        <div class="actionsLeft">
          <button class="btn btnGhost" type="button" id="btnNoteClear">Limpar</button>
          <button class="btn btnPrimary" type="button" id="btnNoteSave">Salvar evolução</button>
        </div>
      </div>
    `;

    function renderPick(){
      const sel = $("ptPick");
      sel.innerHTML = "";
      const opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = "— selecione um paciente —";
      sel.appendChild(opt0);
      patients.slice().sort((a,b)=> (a.nome||"").localeCompare(b.nome||"")).forEach(p=>{
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = `${p.nome}${p.telefone ? " • "+p.telefone : ""}`;
        sel.appendChild(opt);
      });
    }

    function buildPatientsDoc(){
      const q = ($("ptSearch").value||"").trim().toLowerCase();
      let list = patients.slice();
      if(q){
        list = list.filter(p => (p.nome||"").toLowerCase().includes(q) || (p.telefone||"").toLowerCase().includes(q));
      }
      list.sort((a,b)=> (a.nome||"").localeCompare(b.nome||""));
      const rows = list.map(p=>{
        const wa = p.telefone ? waLink(p.telefone, `Olá ${p.nome}!`) : null;
        return `
          <tr>
            <td><b>${safe(p.nome||"")}</b><div class="muted">${safe(p.documento||"")}</div></td>
            <td>${safe(p.telefone||"")}</td>
            <td>${p.nascimento? safe(fmtDateBR(p.nascimento)) : "—"}</td>
            <td>${wa ? `<a class="miniLink" target="_blank" href="${wa}">WhatsApp</a>` : `<span class="muted">—</span>`}</td>
          </tr>
        `;
      }).join("");
      return `
        <table class="table">
          <thead><tr><th>Paciente</th><th>Telefone</th><th>Nascimento</th><th>Contato</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4">—</td></tr>`}</tbody>
        </table>
        <div class="small" style="margin-top:10px;">Total: <b>${list.length}</b></div>
      `;
    }

    setPreviewBody(buildPatientsDoc());
    renderPick();

    $("ptSearch").addEventListener("input", ()=> setPreviewBody(buildPatientsDoc()));

    $("btnPtClear").onclick = () => {
      $("ptNome").value = "";
      $("ptTel").value = "";
      $("ptDoc").value = "";
      $("ptNasc").value = "";
      toast("Form limpo.");
    };

    $("btnPtSave").onclick = async () => {
      const nome = $("ptNome").value.trim();
      if(!nome) return toast("Informe o nome do paciente.");
      const telefone = $("ptTel").value.trim();
      const documento = $("ptDoc").value.trim();
      const nascimento = $("ptNasc").value || "";
      const p = { id: uid(), nome, telefone, documento, nascimento, createdAt: new Date().toISOString() };
      await BTXDB.put(BTXDB.STORES.patients, p);
      patients = await BTXDB.getAll(BTXDB.STORES.patients);
      toast("Paciente salvo ✅");
      renderPick();
      setPreviewBody(buildPatientsDoc());
    };

    $("btnNoteClear").onclick = () => { $("ptNote").value=""; toast("Nota limpa."); };

    $("btnNoteSave").onclick = async () => {
      const pid = $("ptPick").value;
      if(!pid) return toast("Selecione um paciente.");
      const txt = $("ptNote").value.trim();
      if(!txt) return toast("Digite a evolução.");
      const n = { id: uid(), patientId: pid, date: new Date().toISOString(), text: txt };
      await BTXDB.put(BTXDB.STORES.notes, n);
      notes = await BTXDB.getAll(BTXDB.STORES.notes);
      toast("Evolução salva ✅");
      $("ptNote").value = "";
    };
  }

  // ===== Documents (Ficha / Receita / Laudo / Atestado / Recibo / Orçamento) =====
  function pickPatientOptions(){
    return patients.slice().sort((a,b)=> (a.nome||"").localeCompare(b.nome||""))
      .map(p=> `<option value="${p.id}">${safe(p.nome)}${p.telefone ? " • "+safe(p.telefone) : ""}</option>`).join("");
  }

  function renderFicha(){
    setDocHead("Ficha Clínica", "Ficha individualizada com dados do paciente e do profissional.");
    formPanel.innerHTML = `
      <label>Paciente</label>
      <select id="fcPatient"><option value="">— selecione —</option>${pickPatientOptions()}</select>

      <div class="row">
        <div>
          <label>Data</label>
          <input id="fcDate" type="date" value="${todayISO()}">
        </div>
        <div>
          <label>Queixa principal</label>
          <input id="fcChief" placeholder="Ex.: dor, sangramento, revisão...">
        </div>
      </div>

      <label>História / Anamnese</label>
      <textarea id="fcHx" placeholder="Anamnese, alergias, comorbidades, medicações, etc"></textarea>

      <label>Exame / Achados</label>
      <textarea id="fcExam" placeholder="Exame físico, achados, dentes, lesões, etc"></textarea>

      <label>Conduta / Plano</label>
      <textarea id="fcPlan" placeholder="Conduta, tratamento, orientações, retorno"></textarea>
    `;

    const update = () => {
      const pid = $("fcPatient").value;
      const p = patients.find(x=>x.id===pid);
      const html = `
        ${p ? `<div class="kv" style="margin-bottom:10px">
          <div class="k">Paciente</div><div class="v">${safe(p.nome)}</div>
          <div class="k">Telefone</div><div class="v">${safe(p.telefone||"—")}</div>
          <div class="k">Documento</div><div class="v">${safe(p.documento||"—")}</div>
          <div class="k">Nascimento</div><div class="v">${p.nascimento? safe(fmtDateBR(p.nascimento)) : "—"}</div>
        </div>` : `<div class="small">Selecione um paciente para preencher o cabeçalho.</div>`}

        <div class="kv">
          <div class="k">Data</div><div class="v">${safe(fmtDateBR($("fcDate").value))}</div>
          <div class="k">Queixa</div><div class="v">${safe($("fcChief").value)}</div>
        </div>

        <hr style="border:none;height:1px;background:rgba(0,0,0,.08);margin:12px 0">

        <div><b>Anamnese</b><div style="white-space:pre-wrap">${safe($("fcHx").value)}</div></div>
        <div style="margin-top:10px"><b>Exame</b><div style="white-space:pre-wrap">${safe($("fcExam").value)}</div></div>
        <div style="margin-top:10px"><b>Conduta</b><div style="white-space:pre-wrap">${safe($("fcPlan").value)}</div></div>
      `;
      setPreviewBody(html);
    };

    ["fcPatient","fcDate","fcChief","fcHx","fcExam","fcPlan"].forEach(id=>{
      $(id).addEventListener("input", update);
      $(id).addEventListener("change", update);
    });
    update();
  }

  function renderReceita(){
    setDocHead("Receituário", "Inteligente: presets (inclui HAS e Diabetes) + campo livre. PDF premium em 1 clique.");
    formPanel.innerHTML = `
      <label>Paciente</label>
      <select id="rxPatient"><option value="">— selecione —</option>${pickPatientOptions()}</select>

      <div class="row">
        <div>
          <label>Data</label>
          <input id="rxDate" type="date" value="${todayISO()}">
        </div>
        <div>
          <label>Tipo</label>
          <select id="rxPreset">
            <option value="analgesico">Analgésico</option>
            <option value="antiinflamatorio">Anti-inflamatório</option>
            <option value="antibiotico">Antibiótico</option>
            <option value="hipertensao">Hipertensão (HAS)</option>
            <option value="diabetes">Diabetes (DM)</option>
            <option value="livre">Livre</option>
          </select>
        </div>
      </div>

      <label>Presets</label>
      <select id="rxPick"></select>
      <div class="row">
        <button class="btn btnGhost" type="button" id="rxAdd">Adicionar</button>
        <button class="btn btnGhost" type="button" id="rxClear">Limpar lista</button>
      </div>

      <label>Medicações (final)</label>
      <textarea id="rxList" placeholder="A lista final aparece aqui..."></textarea>

      <label>Orientações</label>
      <textarea id="rxObs" placeholder="Orientações e observações (opcional)"></textarea>
    `;

    function fillPreset(){
      const type = $("rxPreset").value;
      const sel = $("rxPick");
      sel.innerHTML = "";
      if(type === "livre"){
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "Digite manualmente na lista";
        sel.appendChild(opt);
        sel.disabled = true;
        return;
      }
      sel.disabled = false;
      (PRESCR_PRESETS[type] || []).forEach((txt, idx)=>{
        const opt = document.createElement("option");
        opt.value = String(idx);
        opt.textContent = txt;
        sel.appendChild(opt);
      });
    }

    function buildDoc(){
      const pid = $("rxPatient").value;
      const p = patients.find(x=>x.id===pid);
      const meds = $("rxList").value.trim();
      const obs = $("rxObs").value.trim();

      const html = `
        ${p ? `<div class="kv" style="margin-bottom:10px">
          <div class="k">Paciente</div><div class="v">${safe(p.nome)}</div>
          <div class="k">Telefone</div><div class="v">${safe(p.telefone||"—")}</div>
        </div>` : `<div class="small">Selecione um paciente para vincular a receita.</div>`}

        <div class="kv">
          <div class="k">Data</div><div class="v">${safe(fmtDateBR($("rxDate").value))}</div>
          <div class="k">Tipo</div><div class="v">${safe($("rxPreset").selectedOptions[0]?.textContent || "")}</div>
        </div>

        <hr style="border:none;height:1px;background:rgba(0,0,0,.08);margin:12px 0">

        <div><b>Prescrição</b></div>
        <div style="white-space:pre-wrap; margin-top:6px">${safe(meds || "—")}</div>

        ${obs ? `<div style="margin-top:12px"><b>Orientações</b><div style="white-space:pre-wrap; margin-top:6px">${safe(obs)}</div></div>` : ``}
      `;
      setPreviewBody(html);
      renderPreviewSignature("Receituário");
    }

    $("rxPreset").addEventListener("change", ()=>{ fillPreset(); buildDoc(); });

    $("rxAdd").onclick = () => {
      const type = $("rxPreset").value;
      if(type === "livre") return toast("Digite direto na lista.");
      const idx = Number($("rxPick").value||0);
      const txt = (PRESCR_PRESETS[type] || [])[idx];
      if(!txt) return;
      const cur = $("rxList").value.trim();
      $("rxList").value = cur ? (cur + "\n" + txt) : txt;
      buildDoc();
    };
    $("rxClear").onclick = () => { $("rxList").value=""; buildDoc(); toast("Lista limpa."); };

    ["rxPatient","rxDate","rxList","rxObs"].forEach(id=>{
      $(id).addEventListener("input", buildDoc);
      $(id).addEventListener("change", buildDoc);
    });

    fillPreset();
    buildDoc();
  }

  function renderLaudo(){
    setDocHead("Laudo", "Laudo individualizado com identificação completa.");
    formPanel.innerHTML = `
      <label>Paciente</label>
      <select id="ldPatient"><option value="">— selecione —</option>${pickPatientOptions()}</select>

      <div class="row">
        <div>
          <label>Data</label>
          <input id="ldDate" type="date" value="${todayISO()}">
        </div>
        <div>
          <label>Título</label>
          <input id="ldTitle" placeholder="Ex.: Laudo clínico / Radiográfico">
        </div>
      </div>

      <label>Conteúdo do laudo</label>
      <textarea id="ldBody" placeholder="Descreva o laudo aqui..."></textarea>

      <label>Conclusão (opcional)</label>
      <textarea id="ldConc" placeholder="Conclusão..."></textarea>
    `;

    const build = () => {
      const p = patients.find(x=>x.id===$("ldPatient").value);
      const html = `
        ${p ? `<div class="kv" style="margin-bottom:10px">
          <div class="k">Paciente</div><div class="v">${safe(p.nome)}</div>
          <div class="k">Telefone</div><div class="v">${safe(p.telefone||"—")}</div>
        </div>` : `<div class="small">Selecione um paciente.</div>`}

        <div class="kv">
          <div class="k">Data</div><div class="v">${safe(fmtDateBR($("ldDate").value))}</div>
          <div class="k">Título</div><div class="v">${safe($("ldTitle").value || "Laudo")}</div>
        </div>

        <hr style="border:none;height:1px;background:rgba(0,0,0,.08);margin:12px 0">

        <div style="white-space:pre-wrap">${safe($("ldBody").value)}</div>
        ${$("ldConc").value.trim() ? `<div style="margin-top:12px"><b>Conclusão</b><div style="white-space:pre-wrap;margin-top:6px">${safe($("ldConc").value)}</div></div>` : ``}
      `;
      setPreviewBody(html);
      renderPreviewSignature("Laudo");
    };

    ["ldPatient","ldDate","ldTitle","ldBody","ldConc"].forEach(id=>{
      $(id).addEventListener("input", build);
      $(id).addEventListener("change", build);
    });
    build();
  }

  function renderAtestado(){
    setDocHead("Atestado", "Atestado individualizado (sem “declaração”).");
    formPanel.innerHTML = `
      <label>Paciente</label>
      <select id="atPatient"><option value="">— selecione —</option>${pickPatientOptions()}</select>

      <div class="row">
        <div>
          <label>Data</label>
          <input id="atDate" type="date" value="${todayISO()}">
        </div>
        <div>
          <label>Dias</label>
          <input id="atDays" type="number" min="0" value="1">
        </div>
      </div>

      <label>Motivo / Observação (opcional)</label>
      <textarea id="atObs" placeholder="Ex.: afastamento por condição clínica, repouso, etc."></textarea>
    `;

    const build = () => {
      const p = patients.find(x=>x.id===$("atPatient").value);
      const days = Number($("atDays").value||0);
      const date = $("atDate").value;
      const obs = $("atObs").value.trim();

      const txt = p ? `Atesto para os devidos fins que ${p.nome} esteve sob meus cuidados profissionais em ${fmtDateBR(date)}${days?`, necessitando de afastamento por ${days} dia(s).`:"."}` : "Selecione um paciente para gerar o atestado.";

      const html = `
        ${p ? `<div class="kv" style="margin-bottom:10px">
          <div class="k">Paciente</div><div class="v">${safe(p.nome)}</div>
          <div class="k">Telefone</div><div class="v">${safe(p.telefone||"—")}</div>
        </div>` : ``}

        <div style="white-space:pre-wrap; font-size:13px; line-height:1.6">${safe(txt)}</div>
        ${obs ? `<div style="margin-top:10px"><b>Obs.</b><div style="white-space:pre-wrap;margin-top:6px">${safe(obs)}</div></div>` : ``}
      `;
      setPreviewBody(html);
      renderPreviewSignature("Atestado");
    };

    ["atPatient","atDate","atDays","atObs"].forEach(id=>{
      $(id).addEventListener("input", build);
      $(id).addEventListener("change", build);
    });
    build();
  }

  function renderRecibo(){
    setDocHead("Recibo", "Recibo individualizado com dados completos (clínica + profissional).");
    formPanel.innerHTML = `
      <label>Paciente</label>
      <select id="rcPatient"><option value="">— selecione —</option>${pickPatientOptions()}</select>

      <div class="row">
        <div>
          <label>Data</label>
          <input id="rcDate" type="date" value="${todayISO()}">
        </div>
        <div>
          <label>Valor (R$)</label>
          <input id="rcValor" placeholder="Ex.: 200,00">
        </div>
      </div>

      <label>Referente a</label>
      <input id="rcRef" placeholder="Ex.: procedimento / consulta / exame">

      <label>Observações</label>
      <textarea id="rcObs" placeholder="Opcional"></textarea>
    `;

    const build = () => {
      const p = patients.find(x=>x.id===$("rcPatient").value);
      const html = `
        ${p ? `<div class="kv" style="margin-bottom:10px">
          <div class="k">Recebemos de</div><div class="v">${safe(p.nome)}</div>
          <div class="k">Telefone</div><div class="v">${safe(p.telefone||"—")}</div>
        </div>` : `<div class="small">Selecione um paciente.</div>`}

        <div class="kv">
          <div class="k">Data</div><div class="v">${safe(fmtDateBR($("rcDate").value))}</div>
          <div class="k">Valor</div><div class="v">R$ ${safe($("rcValor").value || "—")}</div>
          <div class="k">Referente</div><div class="v">${safe($("rcRef").value || "—")}</div>
        </div>

        ${$("rcObs").value.trim() ? `<div style="margin-top:12px"><b>Obs.</b><div style="white-space:pre-wrap;margin-top:6px">${safe($("rcObs").value)}</div></div>` : ``}
      `;
      setPreviewBody(html);
      renderPreviewSignature("Recibo");
    };

    ["rcPatient","rcDate","rcValor","rcRef","rcObs"].forEach(id=>{
      $(id).addEventListener("input", build);
      $(id).addEventListener("change", build);
    });
    build();
  }

  function renderOrcamento(){
    setDocHead("Orçamento", "Texto livre com paciente e data automáticos (sem soma automática).");
    formPanel.innerHTML = `
      <label>Paciente</label>
      <select id="orPatient"><option value="">— selecione —</option>${pickPatientOptions()}</select>

      <div class="row">
        <div>
          <label>Data</label>
          <input id="orDate" type="date" value="${todayISO()}">
        </div>
        <div>
          <label>Validade (dias)</label>
          <input id="orVal" type="number" min="0" value="7">
        </div>
      </div>

      <label>Itens / descrição</label>
      <textarea id="orBody" placeholder="Ex.:\n1) Procedimento X — R$ ...\n2) Material Y — R$ ..."></textarea>

      <label>Observações</label>
      <textarea id="orObs" placeholder="Opcional"></textarea>
    `;

    const build = () => {
      const p = patients.find(x=>x.id===$("orPatient").value);
      const val = Number($("orVal").value||0);
      const html = `
        ${p ? `<div class="kv" style="margin-bottom:10px">
          <div class="k">Paciente</div><div class="v">${safe(p.nome)}</div>
          <div class="k">Telefone</div><div class="v">${safe(p.telefone||"—")}</div>
        </div>` : `<div class="small">Selecione um paciente.</div>`}

        <div class="kv">
          <div class="k">Data</div><div class="v">${safe(fmtDateBR($("orDate").value))}</div>
          <div class="k">Validade</div><div class="v">${val ? `${val} dia(s)` : "—"}</div>
        </div>

        <hr style="border:none;height:1px;background:rgba(0,0,0,.08);margin:12px 0">

        <div><b>Itens</b><div style="white-space:pre-wrap;margin-top:6px">${safe($("orBody").value || "—")}</div></div>
        ${$("orObs").value.trim() ? `<div style="margin-top:12px"><b>Obs.</b><div style="white-space:pre-wrap;margin-top:6px">${safe($("orObs").value)}</div></div>` : ``}
      `;
      setPreviewBody(html);
      renderPreviewSignature("Orçamento");
    };

    ["orPatient","orDate","orVal","orBody","orObs"].forEach(id=>{
      $(id).addEventListener("input", build);
      $(id).addEventListener("change", build);
    });
    build();
  }

  function renderConfig(){
    setDocHead("Config Premium", "Ativação local, segurança, manutenção e diagnóstico.");
    const fp = deviceFingerprint();
    formPanel.innerHTML = `
      <div class="group">
        <div class="small"><b>Dispositivo (fingerprint local)</b><br><span style="word-break:break-all">${safe(fp)}</span></div>
        <hr class="sep"/>

        <label>Modo clínica</label>
        <div class="small">Agenda por profissional ativo, mas pacientes são compartilhados na clínica.</div>

        <hr class="sep"/>

        <button class="btn btnGhost" type="button" id="btnReindex">Recarregar dados</button>
        <button class="btn btnDanger" type="button" id="btnPurgeOld">Limpar agendamentos antigos (90+ dias)</button>
      </div>
    `;

    $("btnReindex").onclick = async () => {
      await loadAll();
      renderProSelect();
      fillClinicForm();
      renderHeaderSummary();
      renderPreviewHeader();
      renderTab(currentTab);
      toast("Dados recarregados ✅");
    };

    $("btnPurgeOld").onclick = async () => {
      if(!confirm("Limpar agendamentos com mais de 90 dias?")) return;
      const cut = new Date(); cut.setDate(cut.getDate()-90);
      const keep = appts.filter(a => new Date(a.date+"T00:00:00") >= cut);
      // clear appts store and reinsert keep
      const all = await BTXDB.getAll(BTXDB.STORES.appts);
      for(const a of all) await BTXDB.del(BTXDB.STORES.appts, a.id);
      for(const a of keep) await BTXDB.put(BTXDB.STORES.appts, a);
      appts = await BTXDB.getAll(BTXDB.STORES.appts);
      toast("Limpeza feita ✅");
      if(currentTab==="agenda") renderAgenda();
    };

    setPreviewBody(`
      <div class="small">
        <b>Premium pronto.</b><br>
        - Memória: IndexedDB (blindada) <br>
        - Backup: JSON completo <br>
        - PDFs: impressão da aba atual (PDF individual) <br>
        - Receituário: presets + HAS + DM <br><br>
        Use a lateral para configurar clínica e profissionais.
      </div>
    `);
  }

  // ===== Print / PDF =====
  function printPDF(){
    renderPreviewHeader();
    window.print();
  }

  // ===== Backup/Restore =====
  async function doBackup(){
    const payload = await BTXDB.exportAll();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `btx_docs_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Backup gerado ✅");
  }

  async function doRestore(file){
    const txt = await file.text();
    const payload = JSON.parse(txt);
    await BTXDB.importAll(payload);
    await loadAll();
    renderProSelect();
    fillClinicForm();
    renderHeaderSummary();
    renderPreviewHeader();
    renderTab(currentTab);
    toast("Backup restaurado ✅");
  }

  // ===== Login / Activation =====
  async function login(){
    const key = $("loginKey").value.trim();
    if(!key) return toast("Digite a chave.");
    // store activation
    const fp = deviceFingerprint();
    const fpHash = await sha256(fp);
    const saved = await BTXDB.getSetting("license");
    if(saved){
      // already activated — verify device
      if(saved.fpHash !== fpHash){
        alert("Esta licença já está vinculada a outro dispositivo. (Bloqueio automático)");
        return;
      }
      // allow
    } else {
      // first activation
      const lic = { key, fpHash, activatedAt: new Date().toISOString() };
      await BTXDB.setSetting("license", lic);
    }

    // show app
    loginWrap.style.display = "none";
    appTopbar.style.display = "flex";
    appMain.style.display = "block";
    toast("Bem-vindo ✅");

    await initAfterLogin();
  }

  async function logout(){
    loginWrap.style.display = "flex";
    appTopbar.style.display = "none";
    appMain.style.display = "none";
    $("loginKey").value = "";
  }

  // ===== Init & Events =====
  async function initAfterLogin(){
    await loadAll();
    fillClinicForm();
    renderProSelect();
    renderHeaderSummary();
    renderPreviewHeader();
    renderTab(currentTab);
  }

  function bindGlobalEvents(){
    $("btnLogin").onclick = login;
    btnLogout.onclick = logout;

    btnClinicSave.onclick = saveClinic;
    btnClinicClear.onclick = () => { resetClinicForm(); toast("Limpo."); };

    activeProSel.onchange = () => setActivePro(activeProSel.value);

    btnProNew.onclick = createProFlow;
    btnProManage.onclick = manageProsFlow;

    tabs.addEventListener("click", (e) => {
      const b = e.target.closest(".tabbtn");
      if(!b) return;
      setTab(b.dataset.tab);
    });

    btnLimparForm.onclick = () => {
      // simplest: rerender current tab
      renderTab(currentTab);
      toast("Aba reiniciada.");
    };

    btnPrint.onclick = printPDF;

    btnBackup.onclick = doBackup;
    btnRestore.onclick = () => restoreFile.click();
    restoreFile.onchange = async () => {
      const f = restoreFile.files?.[0];
      restoreFile.value = "";
      if(!f) return;
      try{ await doRestore(f); } catch(e){ alert("Falha ao restaurar: "+e.message); }
    };

    btnResetAll.onclick = async () => {
      if(!confirm("Zerar tudo (pacientes, agenda, profissionais, clínica)?")) return;
      await BTXDB.clearAll();
      clinic = { id:"clinic", nome:"", endereco:"", tel:"", whats:"" };
      pros = []; patients = []; appts = []; notes = [];
      activeProId = null;
      fillClinicForm();
      renderProSelect();
      renderHeaderSummary();
      renderPreviewHeader();
      renderTab(currentTab);
      toast("Tudo zerado ✅");
    };

    btnDownloadApp.onclick = () => {
      toast("No Android: menu do navegador → Instalar app (PWA).");
    };
  }

  // add tiny styles for tags/mini buttons in preview (keeps CSS clean)
  const extraStyle = document.createElement("style");
  extraStyle.textContent = `
    .miniBtn{
      border:1px solid rgba(0,0,0,.12);
      background:rgba(0,0,0,.02);
      border-radius:10px;
      padding:6px 8px;
      font-weight:800;
      cursor:pointer;
      font-size:11px;
      margin-right:6px;
    }
    .miniBtn.danger{ border-color: rgba(255,77,77,.35); color:#b10000; background:rgba(255,77,77,.08); }
    .miniRow2{ margin-top:6px; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
    .miniLink{
      font-size:11px; font-weight:900;
      color:#0b5;
      text-decoration:none;
      border:1px solid rgba(25,226,140,.35);
      padding:5px 8px;
      border-radius:999px;
    }
    .tag{
      display:inline-block;
      font-size:11px;
      font-weight:950;
      padding:4px 8px;
      border-radius:999px;
      border:1px solid rgba(0,0,0,.10);
      margin-right:8px;
    }
    .tag-ok{ background:rgba(25,226,140,.18); border-color:rgba(25,226,140,.35); color:#063a22; }
    .tag-warn{ background:rgba(255,196,0,.18); border-color:rgba(255,196,0,.35); color:#5a4300; }
    .tag-bad{ background:rgba(255,77,77,.14); border-color:rgba(255,77,77,.35); color:#7a0000; }
    .tag-muted{ background:rgba(0,0,0,.04); border-color:rgba(0,0,0,.10); color:#223; opacity:.8; }
  `;
  document.head.appendChild(extraStyle);

  bindGlobalEvents();

  // ===== Auto show login or app if already activated =====
  (async () => {
    // If there is a stored license, allow direct enter (still checks device)
    const lic = await BTXDB.getSetting("license");
    if(lic){
      const fpHash = await sha256(deviceFingerprint());
      if(lic.fpHash === fpHash){
        // skip login
        loginWrap.style.display = "none";
        appTopbar.style.display = "flex";
        appMain.style.display = "block";
        await initAfterLogin();
      } else {
        // device mismatch -> force login but will block on attempt
        toast("Licença vinculada a outro dispositivo.");
      }
    }
  })();

})();