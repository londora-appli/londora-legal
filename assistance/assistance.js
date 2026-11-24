// Espace assistance Londora Pro — voir index.html.
// ⚠️ Mêmes valeurs que LondoraPro/Utilities/SupabaseConfig.swift (clé PUBLIQUE).
"use strict";
(() => {
  const SUPABASE_URL = "https://pddevkamxjvnylurqqjo.supabase.co";
  const SUPABASE_KEY = "sb_publishable_FCJHQem6nVkO13VX6l5qrg_Iv6jv-og";
  const IDLE_MS = 15 * 60 * 1000;
  const TRUST_KEY = "lp_assist_trust";
  const TRUST_MS = 7 * 24 * 60 * 60 * 1000; // « Faire confiance à ce navigateur » : 7 jours

  // Pas d'affichage dans un cadre d'un autre site (anti-clickjacking).
  if (window.top !== window.self) { document.body.textContent = ""; return; }

  const app = document.getElementById("app");
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
  const money = (n) => euro.format(Number(n) || 0);
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "—";
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  // Session gardée en mémoire. Seulement si l'agent coche « Faire confiance à
  // ce navigateur », le jeton de renouvellement est conservé (7 jours maximum,
  // non prolongés) pour éviter de refaire code e-mail + double authentification.
  let token = null;
  let refreshToken = null;
  let trust = null; // { until, email } quand le navigateur est de confiance
  let email = "";
  let dossier = null;
  let dossierCode = ""; // gardé en mémoire le temps du dossier (pour le passer à un collègue)
  let recent = [];      // dossiers ouverts pendant cette session (mémoire seulement)
  let idleTimer = null;

  // Code reçu par lien (#code=…) : lu puis retiré aussitôt de la barre d'adresse.
  let pendingCode = "";
  {
    const m = /(?:^|[#&])code=([A-Za-z0-9-]{12,20})/.exec(location.hash || "");
    if (m) pendingCode = m[1].toUpperCase();
    if (location.hash) history.replaceState(null, "", location.pathname);
  }

  // ───── Réseau ─────
  async function api(path, { method = "POST", body, auth = true, retried = false } = {}) {
    const headers = { apikey: SUPABASE_KEY };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
    });
    if (res.status === 401 && auth && token) {
      if (!retried && await renewSession()) return api(path, { method, body, auth, retried: true });
      signOut("Session expirée : reconnectez-vous."); throw new Error("expired");
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) throw new Error((data && (data.msg || data.message || data.error_description || data.error)) || `HTTP ${res.status}`);
    return data;
  }
  const rpc = (name, body = {}) => api(`/rest/v1/rpc/${name}`, { body });

  // ───── Navigateur de confiance ─────
  function readTrust() {
    try {
      const t = JSON.parse(localStorage.getItem(TRUST_KEY) || "null");
      if (t && t.rt && t.until > Date.now()) return t;
    } catch {}
    clearTrust();
    return null;
  }
  function saveTrust() {
    if (!trust || !refreshToken) return;
    try { localStorage.setItem(TRUST_KEY, JSON.stringify({ rt: refreshToken, until: trust.until, email: trust.email })); } catch {}
  }
  function clearTrust() {
    trust = null;
    try { localStorage.removeItem(TRUST_KEY); } catch {}
  }
  function adoptSession(session) {
    token = session.access_token;
    refreshToken = session.refresh_token || refreshToken;
    saveTrust();
  }
  // Renouvelle le jeton d'accès (valable 1 h) sans refaire la connexion.
  async function renewSession() {
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }), credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      });
      if (!res.ok) return false;
      adoptSession(await res.json());
      return true;
    } catch { return false; }
  }

  // ───── Déconnexion & inactivité ─────
  function signOut(message = "") {
    // Révoque la session côté serveur (cet appareil seulement) et retire la confiance.
    if (token) api("/auth/v1/logout?scope=local", { body: {}, retried: true }).catch(() => {});
    clearTrust();
    token = null; refreshToken = null; dossier = null; dossierCode = ""; recent = []; email = "";
    clearTimeout(idleTimer);
    $("logout").hidden = true;
    $("who").textContent = "";
    renderEmail(message);
  }
  $("logout").addEventListener("click", () => signOut());
  function touch() {
    if (!token || trust) return; // navigateur de confiance : pas de déconnexion pour inactivité
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => signOut("Déconnecté après 15 minutes d'inactivité."), IDLE_MS);
  }
  ["click", "keydown", "scroll", "touchstart"].forEach((e) => document.addEventListener(e, touch, { passive: true }));

  function bindEnter(inputId, buttonId) {
    $(inputId).addEventListener("keydown", (e) => { if (e.key === "Enter") $(buttonId).click(); });
  }

  // ───── 1. E-mail ─────
  function renderEmail(message = "") {
    app.innerHTML = `<div class="card narrow">
      <h2 class="mt0">Connexion</h2>
      <p class="muted">Saisissez l'adresse e-mail de votre compte assistance : un code de connexion vous est envoyé.</p>
      <label for="email">Adresse e-mail</label><input id="email" type="email" autocomplete="email" value="${esc(email)}">
      <div class="mt14"><button class="btn" id="send">Recevoir le code</button></div>
      <div class="error" id="err">${esc(message)}</div></div>`;
    bindEnter("email", "send");
    $("send").onclick = async () => {
      const value = $("email").value.trim();
      if (!value) return;
      $("send").disabled = true;
      try { await api("/auth/v1/otp", { body: { email: value, create_user: true }, auth: false }); email = value; renderOtp(); }
      catch { $("err").textContent = "Envoi impossible : vérifiez l'adresse et réessayez dans une minute."; $("send").disabled = false; }
    };
  }

  // ───── 2. Code e-mail ─────
  function renderOtp() {
    app.innerHTML = `<div class="card narrow">
      <h2 class="mt0">Code reçu par e-mail</h2>
      <p class="muted">Code envoyé à ${esc(email)}.</p>
      <label for="otp">Code à 6 chiffres</label><input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="10">
      <div class="row mt14"><button class="btn" id="verify">Continuer</button><button class="btn ghost" id="back">Changer d'adresse</button></div>
      <div class="error" id="err"></div></div>`;
    bindEnter("otp", "verify");
    $("back").onclick = () => renderEmail();
    $("verify").onclick = async () => {
      const code = $("otp").value.replace(/\s/g, "");
      $("verify").disabled = true;
      try {
        const session = await api("/auth/v1/verify", { body: { type: "email", email, token: code }, auth: false });
        adoptSession(session);
        $("logout").hidden = false;
        touch();
        await secondFactor();
      } catch (e) {
        if (e.message !== "expired") { $("err").textContent = "Code incorrect ou expiré."; $("verify").disabled = false; }
      }
    };
  }

  // ───── 3. Double authentification (TOTP) ─────
  async function secondFactor() {
    app.innerHTML = `<p class="muted">Vérification…</p>`;
    const user = await api("/auth/v1/user", { method: "GET" });
    const factors = (user.factors || []).filter((f) => f.factor_type === "totp");
    const verified = factors.find((f) => f.status === "verified");
    if (verified) return renderTotp(verified.id);
    // Nettoie d'anciennes inscriptions non terminées, puis inscrit l'appareil.
    for (const f of factors) { try { await api(`/auth/v1/factors/${encodeURIComponent(f.id)}`, { method: "DELETE" }); } catch {} }
    const enrolled = await api("/auth/v1/factors", { body: { factor_type: "totp", friendly_name: `Assistance ${new Date().toISOString().slice(0, 16)}`, issuer: "Londora Pro assistance" } });
    renderTotp(enrolled.id, enrolled.totp);
  }

  function renderTotp(factorId, enroll = null) {
    const qr = enroll && enroll.qr_code
      ? (enroll.qr_code.startsWith("data:") ? enroll.qr_code : `data:image/svg+xml;utf-8,${encodeURIComponent(enroll.qr_code)}`)
      : "";
    app.innerHTML = `<div class="card narrow">
      <h2 class="mt0">Double authentification</h2>
      ${enroll ? `
        <p class="muted">Première connexion : activez la double authentification. Scannez ce QR code avec une application d'authentification (Google Authenticator, Microsoft Authenticator, 1Password, Mots de passe d'Apple…).</p>
        <img class="qr" id="qr" alt="QR code de double authentification">
        <p class="muted">Ou saisissez cette clé dans l'application :</p>
        <div class="secret" id="secret"></div>` : `
        <p class="muted">Saisissez le code à 6 chiffres affiché par votre application d'authentification.</p>`}
      <label for="totp">Code de l'application</label><input id="totp" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
      <label class="check"><input type="checkbox" id="trust"> Faire confiance à ce navigateur pendant 7 jours</label>
      <p class="muted small">À ne cocher que sur votre ordinateur ou téléphone personnel. « Se déconnecter » retire cette confiance.</p>
      <div class="mt14"><button class="btn" id="ok">Valider</button></div>
      <div class="error" id="err"></div></div>`;
    if (enroll) { $("qr").src = qr; $("secret").textContent = enroll.secret || ""; }
    bindEnter("totp", "ok");
    $("ok").onclick = async () => {
      const code = $("totp").value.replace(/\s/g, "");
      $("ok").disabled = true;
      try {
        const challenge = await api(`/auth/v1/factors/${encodeURIComponent(factorId)}/challenge`, { body: {} });
        const session = await api(`/auth/v1/factors/${encodeURIComponent(factorId)}/verify`, { body: { challenge_id: challenge.id, code } });
        trust = $("trust").checked ? { until: Date.now() + TRUST_MS, email } : null;
        adoptSession(session);
        if (!trust) touch(); else clearTimeout(idleTimer);
        await home();
      } catch (e) {
        if (e.message !== "expired") { $("err").textContent = "Code incorrect. Vérifiez l'heure de votre téléphone et réessayez."; $("ok").disabled = false; }
      }
    };
  }

  // ───── 4. Saisie du code d'accès de l'utilisateur ─────
  async function home(message = "", notice = "") {
    dossier = null; dossierCode = "";
    app.innerHTML = `<p class="muted">Chargement…</p>`;
    let me;
    try { me = await rpc("support_whoami"); } catch (e) { if (e.message !== "expired") app.innerHTML = `<div class="card error">Service indisponible pour le moment.</div>`; return; }
    if (!me.agent) {
      app.innerHTML = `<div class="card narrow"><h2 class="mt0">Compte non activé</h2>
        <p class="muted">Ce compte n'est pas encore déclaré comme membre de l'équipe d'assistance. La double authentification est bien activée : transmettez l'adresse <strong>${esc(email)}</strong> à la responsable Londora pour qu'elle l'active.</p></div>`;
      return;
    }
    if (!me.aal2) return secondFactor();
    $("who").textContent = me.name || "";
    app.innerHTML = `<div class="card narrow">
      <h2 class="mt0">Ouvrir un dossier</h2>
      <p class="muted">Saisissez le code d'accès transmis par l'utilisateur (format LP-XXXX-XXXX-XXXX). Il n'est valable que peu de temps, l'utilisateur peut le révoquer, et chaque ouverture lui est signalée.</p>
      <label for="code">Code d'accès</label><input id="code" class="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" value="${esc(pendingCode)}">
      <div class="mt14"><button class="btn" id="open">Ouvrir le dossier</button></div>
      <div class="error" id="err">${esc(message)}</div>
      ${trust ? `<p class="muted small">Navigateur de confiance jusqu'au ${fmtDateTime(trust.until)}. « Se déconnecter » retire cette confiance.</p>` : ""}</div>
      ${notice ? `<div class="banner narrow">${esc(notice)}</div>` : ""}
      <div class="narrow" id="inbox"></div>`;
    pendingCode = "";
    bindEnter("code", "open");
    $("open").onclick = () => openDossier($("code").value, "code", "open", "err");
    renderInbox("inbox", "code", "open", "err", true);
  }

  // « Dossiers reçus » : dossiers passés par un collègue, ouverts sans saisir de code.
  async function renderInbox(containerId, inputId, buttonId, errId, asCard) {
    let list = [];
    try { list = await rpc("support_inbox"); } catch { return; }
    const box = $(containerId);
    if (!box || !Array.isArray(list) || !list.length) return;
    box.innerHTML = `<div class="${asCard ? "card" : "recent"}">
      ${asCard ? `<h2 class="mt0">Dossiers reçus</h2>` : `<span class="muted">Dossiers reçus :</span>`}
      ${list.map((d) => asCard
        ? `<div class="row inbox-row"><div><strong>${esc(d.name)}</strong><div class="muted">Transmis par ${esc(d.from_name)} · ${fmtDateTime(d.received_at)} · accès jusqu'au ${fmtDateTime(d.expires_at)}</div></div><button class="btn" data-grant="${esc(d.grant_id)}">Ouvrir</button></div>`
        : `<button class="tab" data-grant="${esc(d.grant_id)}">${esc(d.name)} · de ${esc(d.from_name)}</button>`).join("")}
    </div>`;
    box.querySelectorAll("[data-grant]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        const res = await rpc("support_take_handover", { p_grant: b.dataset.grant });
        if (res.error) { $(errId).textContent = "Ce dossier n'est plus disponible (révoqué ou expiré)."; b.remove(); return; }
        openDossier(res.code, inputId, buttonId, errId);
      } catch (e) { if (e.message !== "expired") { $(errId).textContent = "Ouverture impossible pour le moment."; b.disabled = false; } }
    }));
  }

  // Ouvre un dossier (depuis l'accueil ou directement depuis un autre dossier).
  // Chaque ouverture repasse par le serveur : elle est comptée, journalisée,
  // et refusée si l'utilisateur a révoqué son code entre-temps.
  async function openDossier(rawCode, inputId, buttonId, errId) {
    const code = String(rawCode || "").trim();
    if (!code) return;
    $(buttonId).disabled = true;
    try {
      const res = await rpc("support_open_dossier", { p_code: code });
      if ($(inputId)) $(inputId).value = "";
      if (res.error) {
        const msg = {
          invalid_code: "Code invalide, expiré, révoqué ou déjà ouvert par un autre membre de l'équipe.",
          too_many_attempts: "Trop de codes incorrects : réessayez dans une heure.",
          not_agent: "Accès refusé : reconnectez-vous avec la double authentification.",
        }[res.error] || "Ouverture impossible.";
        $(errId).textContent = msg; $(buttonId).disabled = false;
        if (res.error === "invalid_code") recent = recent.filter((r) => r.code !== code);
        return;
      }
      dossier = res;
      dossierCode = code;
      const name = res.payload?.data?.profile?.businessName || res.payload?.data?.profile?.firstName || "Dossier";
      recent = [{ code, name }, ...recent.filter((r) => r.code !== code)].slice(0, 8);
      renderDossier("summary");
    } catch (e) {
      if (e.message !== "expired" && $(errId)) { $(errId).textContent = "Ouverture impossible pour le moment."; $(buttonId).disabled = false; }
    }
  }

  // ───── 5. Dossier (lecture seule) ─────
  function invoiceTotal(inv) {
    const lines = inv.items || [];
    const gross = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const net = inv.discountPerItem ? lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - (l.discountPercent || 0) / 100), 0)
                                    : gross * (1 - (inv.discountPercent || 0) / 100);
    return inv.taxExempt ? net : net * (1 + (inv.taxRatePercent || 0) / 100);
  }
  const sameMonth = (d, ref) => { const x = new Date(d); return x.getFullYear() === ref.getFullYear() && x.getMonth() === ref.getMonth(); };
  const byDateDesc = (key) => (a, b) => new Date(b[key]) - new Date(a[key]);
  const table = (heads, rows, empty = "Aucun élément.") => rows.length
    ? `<div class="card scroll"><table><tr>${heads.map((h) => `<th class="${h.num ? "num" : ""}">${esc(h.t || h)}</th>`).join("")}</tr>${rows.join("")}</table></div>`
    : `<div class="card muted">${esc(empty)}</div>`;
  const td = (v, cls = "") => `<td class="${cls}">${esc(v)}</td>`;
  const LIMIT = 300;
  const limited = (arr) => arr.slice(0, LIMIT);
  const more = (arr) => arr.length > LIMIT ? `<p class="muted">${LIMIT} premiers éléments sur ${arr.length}.</p>` : "";

  const STATUS = { paid: ["Payé", "ok"], pending: ["En attente", ""], unpaid: ["Pas payé", "late"], emise: ["Émise", ""], payee: ["Payée", "ok"],
                   brouillon: ["Brouillon", ""], envoye: ["Envoyé", ""], accepte: ["Accepté", "ok"], refuse: ["Refusé", "late"], annulee: ["Annulée", "late"] };
  const badge = (s) => { const [l, c] = STATUS[s] || [s || "—", ""]; return `<span class="badge ${c}">${esc(l)}</span>`; };

  function renderDossier(tab) {
    const p = dossier.payload || {};
    const diag = p.diagnostic || {};
    const data = p.data || null;
    const prof = (data && data.profile) || {};
    const title = prof.businessName || prof.firstName || "Dossier utilisateur";
    const tabs = data
      ? [["summary", "Résumé"], ["diag", "Diagnostic"], ["clients", "Clients"], ["invoices", "Factures"], ["devis", "Devis"], ["credit", "Avoirs"],
         ["tx", "Ventes & dépenses"], ["catalog", "Catalogue"], ["agenda", "Agenda"], ["settings", "Réglages"]]
      : [["diag", "Diagnostic"]];
    if (!data) tab = "diag";
    app.innerHTML = `
      <div class="row"><div class="row"><button class="btn ghost" id="close">← Fermer le dossier</button><button class="btn ghost" id="transfer">Passer à un collègue</button></div>
        <span class="muted">Données du ${fmtDateTime(dossier.updated_at)} · accès jusqu'au ${fmtDateTime(dossier.expires_at)} · ${esc(dossier.views_left)} ouverture(s) restante(s)</span></div>
      <h2>${esc(title)}</h2>
      <div class="banner">${dossier.scope === "full" ? "L'utilisateur a partagé le diagnostic et ses données de gestion." : "L'utilisateur n'a partagé que le diagnostic (aucune donnée de gestion)."}
        Lecture seule · consultation enregistrée et visible par l'utilisateur. Justificatifs, logo, photos, signatures, IBAN et liens de l'espace client ne sont jamais transmis ; e-mails et téléphones des clients masqués.</div>
      <div class="card switch">
        <div class="row">
          <input id="code2" class="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="Code d'un autre dossier">
          <button class="btn" id="open2">Ouvrir</button>
        </div>
        ${recent.length > 1 ? `<div class="recent"><span class="muted">Ouverts récemment :</span> ${recent.map((r, i) => `<button class="tab ${r.code === dossierCode ? "on" : ""}" data-recent="${i}">${esc(r.name)}</button>`).join("")}</div>` : ""}
        <div id="inbox2"></div>
        <div class="error" id="err2"></div>
      </div>
      <div id="transferBox"></div>
      <div class="tabs">${tabs.map(([id, l]) => `<button class="tab ${id === tab ? "on" : ""}" data-tab="${id}">${esc(l)}</button>`).join("")}</div>
      <div id="content"></div>`;
    $("close").onclick = () => home();
    $("transfer").onclick = openTransfer;
    $("open2").onclick = () => openDossier($("code2").value, "code2", "open2", "err2");
    bindEnter("code2", "open2");
    renderInbox("inbox2", "code2", "open2", "err2", false);
    app.querySelectorAll("[data-recent]").forEach((b) => b.addEventListener("click", () => {
      const r = recent[Number(b.dataset.recent)];
      if (r && r.code !== dossierCode) openDossier(r.code, "code2", "open2", "err2");
    }));
    app.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => renderDossier(b.dataset.tab)));
    $("content").innerHTML = (VIEWS[tab] || VIEWS.diag)(data, diag);
  }

  // ───── Passer le dossier à un collègue ─────
  async function openTransfer() {
    const box = $("transferBox");
    box.innerHTML = `<div class="card muted">Chargement…</div>`;
    let colleagues = [];
    try { colleagues = await rpc("support_colleagues"); } catch (e) { if (e.message === "expired") return; }
    if (!colleagues.length) { box.innerHTML = `<div class="card muted">Aucun autre membre de l'équipe d'assistance n'est actif.</div>`; return; }
    box.innerHTML = `<div class="card">
      <label for="colleague" class="mt0">Passer ce dossier à</label>
      <select id="colleague">${colleagues.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select>
      <p class="muted">Vous ne pourrez plus l'ouvrir. Votre collègue le retrouvera dans « Dossiers reçus », sans saisir de code. L'utilisateur en est informé dans son historique.</p>
      <div class="row"><button class="btn" id="doTransfer">Confirmer</button><button class="btn ghost" id="cancelTransfer">Annuler</button></div>
      <div class="error" id="transferErr"></div></div>`;
    $("cancelTransfer").onclick = () => { box.innerHTML = ""; };
    $("doTransfer").onclick = async () => {
      $("doTransfer").disabled = true;
      try {
        const res = await rpc("support_transfer_dossier", { p_code: dossierCode, p_to: $("colleague").value });
        if (res.error) {
          $("transferErr").textContent = { invalid_code: "Ce dossier ne vous est plus attribué, ou l'accès a expiré.", invalid_colleague: "Collègue introuvable ou désactivé.",
                                           too_many_attempts: "Trop d'essais : réessayez dans une heure.", not_agent: "Reconnectez-vous." }[res.error] || "Opération impossible.";
          $("doTransfer").disabled = false;
          return;
        }
        const code = dossierCode;
        recent = recent.filter((r) => r.code !== code);
        home("", `Dossier passé à ${res.to_name} : il le retrouve dans « Dossiers reçus ».`);
      } catch (e) { if (e.message !== "expired") { $("transferErr").textContent = "Opération impossible pour le moment."; $("doTransfer").disabled = false; } }
    };
  }

  const VIEWS = {
    summary(d) {
      const now = new Date();
      const revenues = d.revenues || [], expenses = d.expenses || [], invoices = d.invoices || [], devis = d.devis || [];
      const ca = revenues.filter((r) => r.isSale && r.statusRaw === "paid" && sameMonth(r.date, now)).reduce((s, r) => s + r.amount, 0);
      const other = revenues.filter((r) => !r.isSale && sameMonth(r.date, now)).reduce((s, r) => s + r.amount, 0);
      const charges = expenses.filter((e) => sameMonth(e.date, now)).reduce((s, e) => s + e.amount, 0);
      const unpaid = invoices.filter((i) => (i.kindRaw || "facture") === "facture" && i.statusRaw === "emise");
      const pending = devis.filter((x) => x.statusRaw === "envoye" || x.statusRaw === "brouillon");
      return `<div class="kpis">
          <div class="card kpi"><div class="label">Chiffre d'affaires du mois</div><div class="value">${money(ca)}</div></div>
          <div class="card kpi"><div class="label">Charges du mois</div><div class="value">${money(charges)}</div></div>
          <div class="card kpi"><div class="label">Bénéfice du mois</div><div class="value">${money(ca + other - charges)}</div></div>
          <div class="card kpi"><div class="label">Factures impayées</div><div class="value">${unpaid.length} · ${money(unpaid.reduce((s, i) => s + invoiceTotal(i), 0))}</div></div>
          <div class="card kpi"><div class="label">Devis en attente</div><div class="value">${pending.length}</div></div>
          <div class="card kpi"><div class="label">Clients</div><div class="value">${(d.clients || []).length}</div></div>
        </div>
        <h2>Factures impayées</h2>
        ${table(["N°", "Client", "Échéance", { t: "Montant", num: true }], unpaid.map((i) => `<tr>${td(i.number)}${td(i.beneficiaryName)}<td>${fmtDate(i.dueDate)} ${new Date(i.dueDate) < now ? '<span class="badge late">En retard</span>' : ""}</td>${td(money(invoiceTotal(i)), "num")}</tr>`), "Aucune facture impayée.")}`;
    },
    diag(_d, g) {
      const rows = [
        ["Version de l'app", `${g.appVersion || "—"} (${g.build || "—"})`], ["Système", g.system], ["Modèle d'appareil", g.deviceModel],
        ["Langue", g.language], ["Région", g.region], ["Devise", g.currency], ["Premium", g.premium ? "Oui" : "Non"],
        ["Dernière sauvegarde cloud", fmtDateTime(g.lastCloudBackupAt)], ["Type d'activité", g.businessType],
        ["Franchise de TVA", g.vatExempt ? "Oui" : "Non"], ["Plateforme de facturation électronique", g.eInvoicingPlatform || "—"],
        ["Diagnostic généré le", fmtDateTime(g.generatedAt)],
      ];
      const names = { clients: "Clients", products: "Produits", prestations: "Prestations", categories: "Catégories", revenues: "Ventes / revenus",
                      expenses: "Dépenses", agendaEvents: "Rendez-vous", devis: "Devis", invoices: "Factures", creditNotes: "Avoirs", receipts: "Justificatifs (non transmis)" };
      const counts = Object.entries(g.counts || {});
      return `<div class="card"><table class="kv">${rows.map(([k, v]) => `<tr>${td(k)}${td(v || "—")}</tr>`).join("")}</table></div>
        <h2>Nombre d'éléments</h2>
        <div class="card"><table class="kv">${counts.map(([k, v]) => `<tr>${td(names[k] || k)}${td(v, "num")}</tr>`).join("")}</table></div>`;
    },
    clients(d) {
      const list = [...(d.clients || [])].sort((a, b) => `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`, "fr"));
      return table(["Nom", "Société", "E-mail", "Téléphone", "Créé le"],
        limited(list).map((c) => `<tr>${td(`${c.firstName || ""} ${c.lastName || ""}`.trim())}${td(c.companyName)}${td(c.email)}${td(c.phone)}${td(fmtDate(c.createdAt))}</tr>`)) + more(list);
    },
    invoices(d) {
      const list = [...(d.invoices || [])].sort(byDateDesc("issueDate"));
      return table(["N°", "Type", "Client", "Date", "Échéance", "Statut", { t: "Montant", num: true }],
        limited(list).map((i) => `<tr>${td(i.number)}${td(i.kindRaw === "proforma" ? "Proforma" : "Facture")}${td(i.beneficiaryName)}${td(fmtDate(i.issueDate))}${td(fmtDate(i.dueDate))}<td>${badge(i.statusRaw)}</td>${td(money(invoiceTotal(i)), "num")}</tr>`)) + more(list);
    },
    devis(d) {
      const list = [...(d.devis || [])].sort(byDateDesc("issueDate"));
      return table(["N°", "Client", "Objet", "Date", "Statut", { t: "Montant", num: true }],
        limited(list).map((x) => `<tr>${td(x.number)}${td(x.beneficiaryName)}${td(x.subject)}${td(fmtDate(x.issueDate))}<td>${badge(x.statusRaw)}</td>${td(money(invoiceTotal(x)), "num")}</tr>`)) + more(list);
    },
    credit(d) {
      const list = [...(d.creditNotes || [])].sort(byDateDesc("issueDate"));
      return table(["N°", "Client", "Facture liée", "Motif", "Date", { t: "Montant HT", num: true }],
        limited(list).map((c) => `<tr>${td(c.number)}${td(c.beneficiaryName)}${td(c.linkedInvoiceNumber)}${td(c.reason)}${td(fmtDate(c.issueDate))}${td(money((c.items || []).reduce((s, l) => s + l.quantity * l.unitPrice, 0)), "num")}</tr>`)) + more(list);
    },
    tx(d) {
      const list = [...(d.revenues || []).map((r) => ({ d: r.date, l: r.label, a: r.amount, t: r.isSale ? "Vente" : "Autre revenu", s: r.statusRaw, m: r.paymentMethodRaw })),
                    ...(d.expenses || []).map((e) => ({ d: e.date, l: e.label, a: -e.amount, t: "Dépense", s: e.statusRaw || "paid", m: "" }))]
                   .sort((a, b) => new Date(b.d) - new Date(a.d));
      return table(["Date", "Libellé", "Type", "Paiement", "Statut", { t: "Montant", num: true }],
        limited(list).map((t) => `<tr>${td(fmtDate(t.d))}${td(t.l)}${td(t.t)}${td(t.m || "—")}<td>${badge(t.s)}</td>${td(money(t.a), t.a < 0 ? "num neg" : "num")}</tr>`)) + more(list);
    },
    catalog(d) {
      return `<h2 class="mt0">Produits</h2>` + table(["Nom", { t: "Prix", num: true }, { t: "Stock", num: true }],
          limited(d.products || []).map((p) => `<tr>${td(p.name)}${td(money(p.unitPrice), "num")}${td(p.quantity ?? "—", "num")}</tr>`)) +
        `<h2>Prestations</h2>` + table(["Nom", { t: "Prix", num: true }],
          limited(d.prestations || []).map((p) => `<tr>${td(p.name)}${td(money(p.price), "num")}</tr>`)) +
        `<h2>Catégories</h2>` + table(["Nom"], limited(d.categories || []).map((c) => `<tr>${td(c.name)}</tr>`));
    },
    agenda(d) {
      const list = [...(d.agendaEvents || [])].sort(byDateDesc("date"));
      return table(["Date", "Titre", "Note"], limited(list).map((e) => `<tr>${td(fmtDateTime(e.date))}${td(e.title)}${td(e.note)}</tr>`)) + more(list);
    },
    settings(d) {
      const p = d.profile || {};
      const rows = [["Prénom", p.firstName], ["Entreprise", p.businessName], ["E-mail pro", p.businessEmail], ["Téléphone pro", p.businessPhone],
                    ["Adresse", p.businessAddress], ["SIRET", p.siret], ["SIREN", p.siren], ["Langue", p.language], ["Devise", p.currency],
                    ["Apparence", p.appearanceMode], ["Proforma", p.usesProforma ? "Oui" : "Non"]];
      const legal = Object.entries(p.businessLegal || {}).map(([k, v]) => [k.replace(/^lp\./, ""), v]);
      return `<div class="card"><table class="kv">${rows.map(([k, v]) => `<tr>${td(k)}${td(v || "—")}</tr>`).join("")}</table></div>
        <h2>Mentions et réglages</h2>
        <div class="card"><table class="kv">${legal.map(([k, v]) => `<tr>${td(k)}${td(v || "—")}</tr>`).join("") || `<tr>${td("Aucun réglage")}</tr>`}</table></div>`;
    },
  };

  // Démarrage : reprend la session si ce navigateur est de confiance.
  (async () => {
    const t = readTrust();
    if (!t) return renderEmail();
    trust = { until: t.until, email: t.email || "" };
    email = trust.email;
    refreshToken = t.rt;
    app.innerHTML = `<p class="muted">Reconnexion…</p>`;
    if (await renewSession()) { $("logout").hidden = false; return home(); }
    clearTrust(); refreshToken = null;
    renderEmail("Confiance expirée : reconnectez-vous.");
  })();
})();
