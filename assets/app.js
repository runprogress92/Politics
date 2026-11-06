(function () {
  "use strict";

  const D = window.ISOLOIR_DATA;
  const AXES = D.AXES;
  const AXIS_IDS = AXES.map((a) => a.id);
  const AXIS = Object.fromEntries(AXES.map((a) => [a.id, a]));
  const STORE_KEY = "isoloir-progress-v" + D.VERSION;
  const SVGNS = "http://www.w3.org/2000/svg";
  const M = window.ISOLOIR_MEDIA;

  // Ordre d'affichage des réponses : de l'accord au désaccord.
  const CHOICES = [
    { v: 2, label: "Tout à fait d'accord", code: "a" },
    { v: 1, label: "Plutôt d'accord", code: "b" },
    { v: 0, label: "Neutre ou partagé", code: "c" },
    { v: -1, label: "Plutôt pas d'accord", code: "d" },
    { v: -2, label: "Pas du tout d'accord", code: "e" },
  ];
  const CODE_TO_VALUE = { a: 2, b: 1, c: 0, d: -1, e: -2, x: null };
  const VALUE_TO_CODE = { 2: "a", 1: "b", 0: "c", "-1": "d", "-2": "e" };
  const MODE_LABEL = { c: "version complète", r: "version rapide" };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "style") node.setAttribute("style", v);
        else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const c of [].concat(children || [])) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function svg(tag, attrs, text) {
    const node = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const storage = {
    get() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    set(v) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(v));
      } catch (e) {
        /* stockage indisponible : on continue sans sauvegarde */
      }
    },
    clear() {
      try {
        localStorage.removeItem(STORE_KEY);
      } catch (e) {
        /* rien */
      }
    },
  };

  // ------------------------------------------------------------------
  // Questions et calculs
  // ------------------------------------------------------------------
  const primaryAxis = (q) => Object.keys(q.w)[0];

  // Ordre déterministe : on alterne les axes pour varier les thèmes.
  function buildOrder(mode) {
    const lists = AXIS_IDS.map((id) => D.QUESTIONS.filter((q) => primaryAxis(q) === id && (mode === "c" || q.s)));
    const total = lists.reduce((n, l) => n + l.length, 0);
    const out = [];
    for (let i = 0; out.length < total; i++) {
      for (const l of lists) if (l[i]) out.push(l[i]);
    }
    return out;
  }

  const ORDERS = { c: buildOrder("c"), r: buildOrder("r") };

  function computeScores(order, answers) {
    const num = {}, den = {}, n = {};
    AXIS_IDS.forEach((a) => { num[a] = 0; den[a] = 0; n[a] = 0; });
    for (const q of order) {
      const v = answers[q.id];
      if (v === undefined || v === null) continue;
      for (const [a, w] of Object.entries(q.w)) {
        num[a] += v * w;
        den[a] += 2 * Math.abs(w);
        n[a] += 1;
      }
    }
    const s = {};
    AXIS_IDS.forEach((a) => { s[a] = den[a] ? (100 * num[a]) / den[a] : 0; });
    return { s, n };
  }

  function distance(u, p) {
    let sum = 0;
    for (const a of AXIS_IDS) {
      const d = u[a] - p[a];
      sum += d * d;
    }
    return Math.sqrt(sum / AXIS_IDS.length);
  }

  const affinity = (u, p) => Math.max(0, Math.min(100, Math.round(100 - 0.7 * distance(u, p))));

  function rankParties(u, parties) {
    return parties
      .map((p) => ({ party: p, aff: affinity(u, p.pos), dist: distance(u, p.pos) }))
      .sort((a, b) => a.dist - b.dist);
  }

  function intensity(v) {
    const m = Math.abs(v);
    if (m < 10) return null;
    if (m < 30) return "légèrement";
    if (m < 55) return "plutôt";
    if (m < 80) return "nettement";
    return "très nettement";
  }

  function axisVerdict(axis, v) {
    const i = intensity(v);
    if (!i) return "À l'équilibre";
    const pole = v < 0 ? axis.neg : axis.pos;
    return i.charAt(0).toUpperCase() + i.slice(1) + " côté " + pole;
  }

  // Place dans l'hémicycle : moyenne des places des partis français,
  // pondérée par la proximité (les partis proches comptent beaucoup plus).
  function hemicyclePosition(u) {
    const fr = D.COUNTRIES.find((c) => c.id === "fr").parties;
    let sw = 0, sum = 0;
    for (const p of fr) {
      const w = Math.exp(-distance(u, p.pos) / 9);
      sw += w;
      sum += w * p.lr;
    }
    return sw ? sum / sw : 0;
  }

  function lrLabel(x) {
    if (x < -70) return "à l'extrême gauche";
    if (x < -45) return "à gauche";
    if (x < -20) return "au centre gauche";
    if (x <= 20) return "au centre";
    if (x <= 45) return "au centre droit";
    if (x <= 75) return "à droite";
    return "à l'extrême droite";
  }

  // ------------------------------------------------------------------
  // État
  // ------------------------------------------------------------------
  const state = {
    mode: "c",
    order: ORDERS.c,
    answers: {},
    index: 0,
    ctxOpen: false,
    results: null,
    country: "fr",
    resCompass: { country: "fr", x: "eco", y: "aut" },
    previewCompass: { country: "fr", x: "eco", y: "aut" },
    gallery: "fr",
    view: null,
    compare: new Set(),
    compareInit: false,
  };

  function showView(name) {
    state.view = name;
    $("#view-home").hidden = name !== "home";
    $("#view-quiz").hidden = name !== "quiz";
    $("#view-results").hidden = name !== "results";
    $("#methode").hidden = name === "quiz";
    renderSaved();
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------
  // Accueil
  // ------------------------------------------------------------------
  function renderHome() {
    $$("[data-count]").forEach((n) => { n.textContent = ORDERS[n.dataset.count].length; });
    const grid = $("#axes-grid");
    grid.replaceChildren(
      ...AXES.map((a) =>
        el("div", { class: "axis-card" }, [
          el("h3", { text: a.name }),
          el("div", { class: "axis-poles" }, [
            el("div", { class: "neg" }, [el("b", { text: "← " + a.neg }), a.negDesc]),
            el("div", { class: "pos" }, [el("b", { text: a.pos + " →" }), a.posDesc]),
          ]),
        ])
      )
    );
    renderResume();
    renderCompassBlock($("#preview-compass"), $("#preview-controls"), state.previewCompass, null);
    renderGallery();
  }

  // ------------------------------------------------------------------
  // Logos des partis et portraits des dirigeants
  // ------------------------------------------------------------------
  const whoText = (p) => p.people.map((h) => h.n).join(", ");

  // Couleur de texte lisible sur la couleur du parti (pastilles de secours).
  function readableOn(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#ffffff";
    const n = parseInt(m[1], 16);
    const lin = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.4 ? "#14161b" : "#ffffff";
  }

  function initials(name) {
    return name
      .split(/[\s-]+/)
      .filter((w) => /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(w) && w !== "De" && w !== "van")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  const partyStyle = (p) => "--party:" + p.color + ";--party-ink:" + readableOn(p.color);

  function logoEl(p, size) {
    return el("span", { class: "logo logo-" + size, "data-media": M.partyKey(p), "data-label": "Logo : " + p.name, style: partyStyle(p) }, [
      el("span", { class: "logo-fallback", "aria-hidden": "true", text: p.short }),
    ]);
  }

  function faceEl(h, p, size) {
    return el("span", { class: "face face-" + size, "data-media": M.personKey(h), "data-label": h.n, style: partyStyle(p) }, [
      el("span", { class: "face-fallback", "aria-hidden": "true", text: initials(h.n) }),
    ]);
  }

  function peopleList(p) {
    return el(
      "ul",
      { class: "people" },
      p.people.map((h) => el("li", {}, [faceEl(h, p, "md"), el("span", {}, [el("strong", { text: h.n }), el("span", { class: "muted", text: h.role })])]))
    );
  }

  // Remplace les pastilles par les images dès qu'elles sont disponibles.
  function applyMedia(root) {
    $$("[data-media]", root || document).forEach((node) => {
      if (node.dataset.applied) return;
      const m = M.get(node.dataset.media);
      if (!m) return;
      node.dataset.applied = "1";
      const fallback = node.firstElementChild;
      const img = el("img", {
        src: m.src,
        alt: "",
        title: node.dataset.label + " · " + m.artist + " · " + m.license + " · Wikimédia Commons",
        loading: "lazy",
        decoding: "async",
      });
      img.addEventListener("error", () => {
        img.remove();
        if (fallback) fallback.hidden = false;
        node.classList.remove("has-img");
      });
      if (fallback) fallback.hidden = true;
      node.classList.add("has-img");
      node.append(img);
    });
  }

  function renderGallery() {
    const tabs = $("#gallery-tabs");
    if (!tabs.childElementCount) {
      tabs.replaceChildren(
        ...D.COUNTRIES.map((c) =>
          el("button", {
            type: "button",
            "data-country": c.id,
            "aria-pressed": String(state.gallery === c.id),
            text: c.name,
            onclick: () => {
              state.gallery = c.id;
              $$("button", tabs).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.country === c.id)));
              renderGallery();
            },
          })
        )
      );
    }
    const c = D.COUNTRIES.find((x) => x.id === state.gallery);
    const parties = c.id === "fr" ? c.parties.slice().sort((a, b) => a.lr - b.lr) : c.parties;
    const grid = $("#gallery");
    grid.replaceChildren(
      ...parties.map((p) =>
        el("article", { class: "pcard" }, [
          el("div", { class: "pcard-head" }, [logoEl(p, "lg"), el("div", { class: "pcard-title" }, [el("h3", { text: p.name }), el("span", { class: "muted", text: p.family })])]),
          peopleList(p),
        ])
      )
    );
    applyMedia(grid);
  }

  function renderCredits() {
    const list = $("#credits");
    const note = $("#credits-status");
    const st = M.status();
    const items = M.all()
      .slice()
      .sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label, "fr") : a.kind === "logo" ? -1 : 1));
    if (st === "idle" || st === "loading") {
      note.textContent = "Chargement des logos et des portraits depuis Wikimédia Commons…";
    } else if (!items.length) {
      note.textContent =
        "Les logos et les portraits n'ont pas pu être chargés depuis Wikimédia Commons (connexion bloquée ou hors ligne). Des pastilles aux couleurs des partis les remplacent.";
    } else {
      note.textContent =
        items.length + " images sous licence libre, hébergées par Wikimédia Commons. Chaque lien ouvre la page du fichier, avec sa licence complète.";
    }
    list.replaceChildren(
      ...items.map((m) =>
        el("li", {}, [el("a", { href: m.page, target: "_blank", rel: "noopener", text: (m.kind === "logo" ? "Logo " : "Portrait ") + "· " + m.label }), " : " + m.artist + ", " + m.license])
      )
    );
  }

  function renderResume() {
    const saved = storage.get();
    const box = $("#resume");
    if (!saved || !saved.answers || !ORDERS[saved.mode]) {
      box.hidden = true;
      return;
    }
    const done = ORDERS[saved.mode].filter((q) => q.id in saved.answers).length;
    if (done === 0) {
      box.hidden = true;
      return;
    }
    $("#resume-count").textContent = done + " / " + ORDERS[saved.mode].length + " (" + MODE_LABEL[saved.mode] + ")";
    box.hidden = false;
  }

  // ------------------------------------------------------------------
  // Questionnaire
  // ------------------------------------------------------------------
  function startQuiz(mode, resume) {
    state.mode = mode;
    state.order = ORDERS[mode];
    state.answers = {};
    state.index = 0;
    if (resume) {
      const saved = storage.get();
      if (saved && saved.mode === mode) {
        state.answers = saved.answers || {};
        const firstEmpty = state.order.findIndex((q) => !(q.id in state.answers));
        state.index = firstEmpty === -1 ? state.order.length - 1 : firstEmpty;
      }
    }
    clearHash();
    showView("quiz");
    renderQuestion();
  }

  function save() {
    storage.set({ mode: state.mode, answers: state.answers });
  }

  function renderQuestion() {
    const q = state.order[state.index];
    const total = state.order.length;
    const answered = state.order.filter((x) => x.id in state.answers).length;

    $("#q-index").textContent = state.index + 1;
    $("#q-total").textContent = total;
    $("#q-axis").textContent = AXIS[primaryAxis(q)].name;
    const pct = Math.round((answered / total) * 100);
    $("#q-progress span").style.width = pct + "%";
    $("#q-progress").setAttribute("aria-valuenow", pct);

    const text = $("#q-text");
    text.textContent = q.t;

    const toggle = $("#q-ctx-toggle");
    const ctx = $("#q-ctx");
    if (q.c) {
      toggle.hidden = false;
      ctx.textContent = q.c;
      ctx.hidden = !state.ctxOpen;
      toggle.setAttribute("aria-expanded", String(state.ctxOpen));
      toggle.textContent = state.ctxOpen ? "Masquer le contexte" : "Afficher le contexte";
    } else {
      toggle.hidden = true;
      ctx.hidden = true;
    }

    const current = state.answers[q.id];
    const box = $("#answers");
    box.replaceChildren(
      ...CHOICES.map((c, i) =>
        el(
          "button",
          {
            type: "button",
            class: "ans",
            "data-v": c.v,
            "aria-pressed": String(current === c.v),
            onclick: () => answer(c.v),
          },
          [el("span", { class: "dot", "aria-hidden": "true" }), el("span", { text: c.label }), el("span", { class: "key", "aria-hidden": "true", text: String(i + 1) })]
        )
      )
    );

    $("#q-prev").disabled = state.index === 0;
    const skip = $("#q-skip");
    skip.classList.toggle("is-on", current === null);
    skip.textContent = current === null ? "Question passée" : "Je ne sais pas, passer";
    $("#q-finish").hidden = answered < Math.min(10, total) || answered === total;
  }

  function answer(v) {
    const q = state.order[state.index];
    state.answers[q.id] = v;
    save();
    next();
  }

  function next() {
    const total = state.order.length;
    const firstEmpty = state.order.findIndex((q, i) => i > state.index && !(q.id in state.answers));
    if (state.index < total - 1) {
      state.index += 1;
      renderQuestion();
      return;
    }
    if (firstEmpty !== -1) {
      state.index = firstEmpty;
      renderQuestion();
      return;
    }
    const anyEmpty = state.order.findIndex((q) => !(q.id in state.answers));
    if (anyEmpty !== -1) {
      state.index = anyEmpty;
      renderQuestion();
      return;
    }
    finish();
  }

  function prev() {
    if (state.index > 0) {
      state.index -= 1;
      renderQuestion();
    }
  }

  function finish() {
    const code = encodeAnswers(state.mode, state.answers);
    storage.clear();
    setHash(code);
    showResults(state.mode, state.answers);
  }

  // ------------------------------------------------------------------
  // Lien de partage (uniquement lettres, chiffres et tirets)
  // ------------------------------------------------------------------
  function answersCode(mode, answers) {
    return ORDERS[mode]
      .map((q) => {
        const v = answers[q.id];
        return v === undefined || v === null ? "x" : VALUE_TO_CODE[v];
      })
      .join("");
  }

  // Le pseudo est ajouté au lien en hexadécimal (UTF-8), pour ne garder
  // que des lettres, des chiffres et des tirets dans l'adresse.
  function nameToHex(name) {
    return Array.from(new TextEncoder().encode(name))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function hexToName(hex) {
    try {
      if (!hex || hex.length % 2) return "";
      const bytes = Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
      return cleanName(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (e) {
      return "";
    }
  }

  function resultHash(mode, code, name) {
    return "resultat-" + mode + D.VERSION + "-" + code + (name ? "-de-" + nameToHex(name) : "");
  }

  function encodeAnswers(mode, answers, name) {
    return resultHash(mode, answersCode(mode, answers), name);
  }

  function decodeHash(hash) {
    const m = /^#?resultat-([cr])(\d+)-([a-ex]+)(?:-de-([0-9a-f]+))?$/.exec(hash || "");
    if (!m || m[2] !== D.VERSION) return null;
    const mode = m[1];
    const order = ORDERS[mode];
    if (m[3].length !== order.length) return null;
    const answers = {};
    order.forEach((q, i) => {
      const v = CODE_TO_VALUE[m[3][i]];
      if (v !== null) answers[q.id] = v;
      else answers[q.id] = null;
    });
    return { mode, answers, code: m[3], name: hexToName(m[4]) };
  }

  function setHash(code) {
    try {
      history.replaceState(null, "", "#" + code);
    } catch (e) {
      location.hash = code;
    }
  }

  function clearHash() {
    if (!location.hash) return;
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) {
      location.hash = "";
    }
  }

  // ------------------------------------------------------------------
  // Résultats
  // ------------------------------------------------------------------
  function showResults(mode, answers, name) {
    const order = ORDERS[mode];
    const { s, n } = computeScores(order, answers);
    const answered = order.filter((q) => answers[q.id] !== undefined && answers[q.id] !== null).length;
    const ranks = Object.fromEntries(D.COUNTRIES.map((c) => [c.id, rankParties(s, c.parties)]));
    const ideos = rankParties(s, D.IDEOLOGIES);
    state.results = { mode, answers, s, n, ranks, ideos, answered, order, code: answersCode(mode, answers), name: name || "" };
    state.country = "fr";
    state.resCompass.country = "fr";

    showView("results");
    renderVerdict();
    renderAxisRows();
    renderHemicycle();
    renderCompassBlock($("#res-compass"), $("#res-controls"), state.resCompass, s);
    renderCountryTabs();
    renderCountry();
    renderIdeologies();
    renderRecap();
    renderSaveBar();
    renderSaved();
    $("#copy-out").hidden = true;
    $("#copy-toast").textContent = "";
  }

  function renderVerdict() {
    const R = state.results;
    const top = R.ranks.fr[0];
    const p = top.party;

    renderResultLabel();

    const ballot = $("#ballot");
    ballot.replaceChildren(
      el("span", { class: "ballot-bar", style: "background:" + p.color, "aria-hidden": "true" }),
      el("span", { class: "ballot-kicker", text: "Bulletin de vote" }),
      logoEl(p, "xl"),
      el("span", { class: "ballot-name", text: p.name }),
      el("span", { class: "ballot-people" }, p.people.map((h) => el("span", { class: "ballot-person" }, [faceEl(h, p, "md"), el("span", { text: h.n })]))),
      el("span", { class: "stamp", "aria-hidden": "true", text: "A VOTÉ" })
    );

    const ideo = R.ideos[0].party;
    $("#res-title").textContent = ideo.name;

    const match = $("#res-match");
    match.replaceChildren(
      "En France, le parti le plus proche de tes réponses est ",
      el("strong", { text: p.name }),
      " avec ",
      el("strong", { class: "num", text: top.aff + " %" }),
      " d'affinité, devant " + R.ranks.fr[1].party.name + " (" + R.ranks.fr[1].aff + " %)."
    );

    const hemi = hemicyclePosition(R.s);
    const sorted = AXIS_IDS.map((a) => ({ a, v: R.s[a] })).sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
    const strong = sorted.filter((x) => Math.abs(x.v) >= 30).slice(0, 2);
    let sentence = "Sur l'échiquier politique français, tes réponses te placent " + lrLabel(hemi) + ". ";
    if (strong.length) {
      sentence +=
        "Tes convictions les plus marquées : " +
        strong.map((x) => AXIS[x.a].name.toLowerCase() + " (" + axisVerdict(AXIS[x.a], x.v).toLowerCase() + ")").join(" et ") +
        ".";
    } else {
      sentence += "Tu n'as pas de position très tranchée : tu cherches plutôt l'équilibre sur tous les sujets.";
    }
    $("#res-summary").textContent = sentence;

    const items = D.COUNTRIES.filter((c) => c.id !== "fr").map((c) => {
      const t = R.ranks[c.id][0];
      return el("div", { class: "elsewhere-item has-logo" }, [
        logoEl(t.party, "md"),
        el("div", { class: "ew-text" }, [
          el("span", { class: "eyebrow", text: "Si tu votais " + countryIn(c) }),
          el("strong", { text: t.party.name }),
          el("span", { class: "num", text: t.aff + " % d'affinité" }),
        ]),
      ]);
    });
    const ideo2 = R.ideos[1].party;
    items.push(
      el("div", { class: "elsewhere-item" }, [
        el("span", { class: "eyebrow", text: "Courant d'idées voisin" }),
        el("strong", { text: ideo2.name }),
        el("span", { class: "num", text: R.ideos[1].aff + " % d'affinité" }),
      ])
    );
    $("#res-elsewhere").replaceChildren(...items);
    applyMedia($(".verdict"));
  }

  function countryIn(c) {
    return { us: "aux États-Unis", uk: "au Royaume-Uni", de: "en Allemagne", fr: "en France" }[c.id];
  }

  function track(value, partyValue, partyColor) {
    const t = el("div", { class: "track", "aria-hidden": "true" });
    if (partyValue !== undefined) {
      t.append(el("span", { class: "them", style: "left:" + toPct(partyValue) + "%;background:" + partyColor }));
    }
    t.append(el("span", { class: "you", style: "left:" + toPct(value) + "%" }));
    return t;
  }

  const toPct = (v) => ((Math.max(-100, Math.min(100, v)) + 100) / 2).toFixed(1);

  function renderAxisRows() {
    const R = state.results;
    $("#axis-rows").replaceChildren(
      ...AXES.map((a) => {
        const v = R.s[a.id];
        const noData = R.n[a.id] === 0;
        return el("div", { class: "axis-row" }, [
          el("div", { class: "axis-row-name", text: a.name }),
          el("div", { class: "track-wrap" }, [el("span", { class: "neg", text: a.neg }), track(v), el("span", { class: "pos", text: a.pos })]),
          el("div", { class: "axis-row-verdict" }, [
            noData ? "Aucune réponse" : axisVerdict(a, v),
            el("br"),
            el("span", { class: "num", text: noData ? "" : (v > 0 ? "+" : "") + Math.round(v) }),
          ]),
        ]);
      })
    );
  }

  // ------------------------------------------------------------------
  // Hémicycle
  // ------------------------------------------------------------------
  function renderHemicycle() {
    const R = state.results;
    const fr = D.COUNTRIES.find((c) => c.id === "fr").parties.slice().sort((a, b) => a.lr - b.lr);
    const W = 600, H = 330, cx = 300, cy = 290, R0 = 188;
    const angleOf = (lr) => Math.PI * (1 - (lr + 100) / 200); // -100 -> π (gauche), +100 -> 0 (droite)
    const at = (r, ang) => [cx + r * Math.cos(ang), cy - r * Math.sin(ang)];

    const root = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-labelledby": "hemi-title-svg" });
    root.append(svg("title", { id: "hemi-title-svg" }, "Hémicycle des partis français et ta position"));

    // Rangées de sièges stylisées
    const rows = [0.5, 0.62, 0.74, 0.86];
    rows.forEach((k) => {
      const r = R0 * k;
      const seats = Math.round(14 + k * 26);
      for (let i = 0; i <= seats; i++) {
        const ang = Math.PI * (1 - i / seats);
        const [x, y] = at(r, ang);
        root.append(svg("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 3.2, class: "svg-seat" }));
      }
    });

    // Arc principal
    const [ax0, ay0] = at(R0, Math.PI);
    const [ax1, ay1] = at(R0, 0);
    root.append(svg("path", { d: "M" + ax0 + " " + ay0 + " A" + R0 + " " + R0 + " 0 0 1 " + ax1 + " " + ay1, fill: "none", class: "svg-line", "stroke-width": 2 }));

    // Étiquettes espacées pour ne pas se chevaucher
    const minSep = (10.5 * Math.PI) / 180;
    const lo = (4 * Math.PI) / 180, hi = Math.PI - lo;
    const labels = fr.map((p) => ({ p, ang: angleOf(p.lr) }));
    labels.forEach((l) => { l.la = Math.min(hi, Math.max(lo, l.ang)); });
    for (let i = 1; i < labels.length; i++) {
      if (labels[i - 1].la - labels[i].la < minSep) labels[i].la = labels[i - 1].la - minSep;
    }
    if (labels[labels.length - 1].la < lo) {
      labels[labels.length - 1].la = lo;
      for (let i = labels.length - 2; i >= 0; i--) {
        if (labels[i].la - labels[i + 1].la < minSep) labels[i].la = labels[i + 1].la + minSep;
      }
    }

    labels.forEach(({ p, ang, la }) => {
      const [x, y] = at(R0, ang);
      const [lx1, ly1] = at(R0 + 8, ang);
      const [lx2, ly2] = at(R0 + 22, la);
      const [tx, ty] = at(R0 + 30, la);
      root.append(svg("path", { d: "M" + lx1.toFixed(1) + " " + ly1.toFixed(1) + " L" + lx2.toFixed(1) + " " + ly2.toFixed(1), class: "svg-axis", "stroke-width": 1, fill: "none", opacity: 0.5 }));
      root.append(svg("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 8, fill: p.color, class: "svg-surface-stroke", "stroke-width": 2 }));
      const c = Math.cos(la);
      const anchor = c > 0.25 ? "start" : c < -0.25 ? "end" : "middle";
      root.append(svg("text", { x: tx.toFixed(1), y: (ty + 5).toFixed(1), "text-anchor": anchor, class: "svg-label", "font-size": 17 }, p.short));
    });

    // Aiguille
    const pos = hemicyclePosition(R.s);
    const ang = angleOf(pos);
    const [nx, ny] = at(R0 - 16, ang);
    root.append(svg("line", { x1: cx, y1: cy, x2: nx.toFixed(1), y2: ny.toFixed(1), class: "svg-axis", stroke: "currentColor", "stroke-width": 4, "stroke-linecap": "round", style: "stroke:var(--ink)" }));
    root.append(svg("circle", { cx: cx, cy: cy, r: 10, class: "svg-you" }));
    const [yx, yy] = at(R0 - 34, ang);
    root.append(svg("circle", { cx: yx.toFixed(1), cy: yy.toFixed(1), r: 16, fill: "var(--accent)" }));
    root.append(svg("text", { x: yx.toFixed(1), y: (yy + 4.5).toFixed(1), "text-anchor": "middle", "font-size": 12, "font-weight": 700, style: "fill:var(--accent-ink);font-family:var(--font-mono)" }, "TOI"));

    root.append(svg("text", { x: 8, y: cy + 30, class: "svg-muted", "font-size": 15 }, "Gauche"));
    root.append(svg("text", { x: W - 8, y: cy + 30, "text-anchor": "end", class: "svg-muted", "font-size": 15 }, "Droite"));
    root.setAttribute("viewBox", "0 0 " + W + " " + (H + 16));

    $("#hemicycle").replaceChildren(root);
    const near = fr.slice().sort((a, b) => Math.abs(a.lr - pos) - Math.abs(b.lr - pos)).slice(0, 2);
    $("#hemi-caption").textContent =
      "Tu siégerais " + lrLabel(pos) + ", entre les bancs de " + near.map((p) => p.name).join(" et de ") + ".";
  }

  // ------------------------------------------------------------------
  // Boussole (deux axes au choix)
  // ------------------------------------------------------------------
  function renderCompassBlock(target, controls, cfg, user) {
    const draw = () => {
      target.replaceChildren(compassSVG(cfg, user));
    };

    const countrySeg = el(
      "div",
      { class: "seg", role: "group", "aria-label": "Pays affiché" },
      D.COUNTRIES.map((c) =>
        el("button", {
          type: "button",
          "aria-pressed": String(cfg.country === c.id),
          text: c.name,
          onclick: (ev) => {
            cfg.country = c.id;
            $$("button", ev.currentTarget.parentNode).forEach((b) => b.setAttribute("aria-pressed", String(b === ev.currentTarget)));
            draw();
          },
        })
      )
    );

    const makeSelect = (key, label) => {
      const id = target.id + "-" + key;
      const sel = el(
        "select",
        {
          id,
          onchange: (ev) => {
            cfg[key] = ev.target.value;
            draw();
          },
        },
        AXES.map((a) => el("option", { value: a.id, selected: cfg[key] === a.id, text: a.name + " (" + a.neg + " ↔ " + a.pos + ")" }))
      );
      return el("div", { class: "control" }, [el("label", { for: id, text: label }), sel]);
    };

    controls.replaceChildren(
      el("div", { class: "control" }, [el("label", { text: "Pays" }), countrySeg]),
      makeSelect("x", "Axe horizontal"),
      makeSelect("y", "Axe vertical"),
      el("div", { class: "legend" }, user ? [el("span", {}, [el("i", { class: "l-you" }), "Toi"]), el("span", { text: "Points colorés : les partis" })] : [el("span", { text: "Points colorés : les partis" })])
    );
    draw();
  }

  function compassSVG(cfg, user) {
    const S = 520, padL = 46, padR = 20, padT = 20, padB = 46, inner = S - padL - padR;
    const ax = AXIS[cfg.x], ay = AXIS[cfg.y];
    const country = D.COUNTRIES.find((c) => c.id === cfg.country);
    const X = (v) => padL + ((v + 100) / 200) * inner;
    const Y = (v) => padT + ((100 - v) / 200) * inner; // pôle « pos » en haut

    const root = svg("svg", { viewBox: "0 0 " + S + " " + (padT + inner + padB), role: "img" });
    root.append(svg("title", {}, "Boussole : " + ax.name + " et " + ay.name + ", " + country.name));
    root.append(svg("rect", { x: padL, y: padT, width: inner, height: inner, class: "svg-bg", rx: 6 }));
    [-50, 50].forEach((v) => {
      root.append(svg("line", { x1: X(v), y1: padT, x2: X(v), y2: padT + inner, class: "svg-line", "stroke-width": 1, "stroke-dasharray": "3 5" }));
      root.append(svg("line", { x1: padL, y1: Y(v), x2: padL + inner, y2: Y(v), class: "svg-line", "stroke-width": 1, "stroke-dasharray": "3 5" }));
    });
    root.append(svg("line", { x1: X(0), y1: padT, x2: X(0), y2: padT + inner, class: "svg-axis", "stroke-width": 1.2 }));
    root.append(svg("line", { x1: padL, y1: Y(0), x2: padL + inner, y2: Y(0), class: "svg-axis", "stroke-width": 1.2 }));

    const fs = 14;
    if (cfg.x === cfg.y) {
      root.append(svg("text", { x: X(0), y: Y(0) - 12, "text-anchor": "middle", class: "svg-muted", "font-size": fs }, "Choisis deux axes différents"));
    }
    const by = padT + inner + 28;
    root.append(svg("text", { x: padL, y: by, class: "svg-muted", "font-size": fs, style: "fill:var(--pole-neg)" }, "← " + ax.neg));
    root.append(svg("text", { x: padL + inner, y: by, "text-anchor": "end", class: "svg-muted", "font-size": fs, style: "fill:var(--pole-pos)" }, ax.pos + " →"));
    root.append(svg("text", { x: 0, y: 0, transform: "translate(" + (padL - 14) + " " + (padT + inner) + ") rotate(-90)", class: "svg-muted", "font-size": fs, style: "fill:var(--pole-neg)" }, "← " + ay.neg));
    root.append(svg("text", { x: 0, y: 0, transform: "translate(" + (padL - 14) + " " + padT + ") rotate(-90)", "text-anchor": "end", class: "svg-muted", "font-size": fs, style: "fill:var(--pole-pos)" }, ay.pos + " →"));

    // Placement des étiquettes sans chevauchement (glouton)
    const boxes = [];
    const pts = country.parties.map((p) => ({ x: X(p.pos[cfg.x]), y: Y(p.pos[cfg.y]), label: p.short, color: p.color, name: p.name }));
    let you = null;
    if (user) you = { x: X(user[cfg.x]), y: Y(user[cfg.y]) };
    pts.forEach((p) => boxes.push({ x: p.x - 7, y: p.y - 7, w: 14, h: 14 }));
    if (you) boxes.push({ x: you.x - 14, y: you.y - 14, w: 28, h: 28 });

    const overlaps = (b) => boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
    const lfs = 13;
    const placeLabel = (p) => {
      const w = p.label.length * lfs * 0.62 + 4, h = lfs + 2;
      const cands = [
        [p.x + 10, p.y - h / 2, "start"],
        [p.x - 10 - w, p.y - h / 2, "end"],
        [p.x - w / 2, p.y - 12 - h, "middle"],
        [p.x - w / 2, p.y + 10, "middle"],
        [p.x + 8, p.y - 8 - h, "start"],
        [p.x + 8, p.y + 6, "start"],
        [p.x - 8 - w, p.y - 8 - h, "end"],
        [p.x - 8 - w, p.y + 6, "end"],
      ];
      for (const [bx, by, anchor] of cands) {
        const b = { x: bx, y: by, w, h };
        if (bx < padL + 2 || bx + w > padL + inner - 2 || by < padT + 2 || by + h > padT + inner - 2) continue;
        if (!overlaps(b)) {
          boxes.push(b);
          const tx = anchor === "start" ? bx + 2 : anchor === "end" ? bx + w - 2 : bx + w / 2;
          return { tx, ty: by + h - 3, anchor };
        }
      }
      return null;
    };

    pts.forEach((p) => {
      const g = svg("g", {});
      g.append(svg("title", {}, p.name));
      g.append(svg("circle", { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 7, fill: p.color, class: "svg-surface-stroke", "stroke-width": 2 }));
      root.append(g);
    });
    pts.forEach((p) => {
      const pl = placeLabel(p);
      if (pl) root.append(svg("text", { x: pl.tx.toFixed(1), y: pl.ty.toFixed(1), "text-anchor": pl.anchor, class: "svg-label", "font-size": lfs }, p.label));
    });

    if (you) {
      root.append(svg("circle", { cx: you.x.toFixed(1), cy: you.y.toFixed(1), r: 13, class: "svg-you-ring", "stroke-width": 2 }));
      root.append(svg("circle", { cx: you.x.toFixed(1), cy: you.y.toFixed(1), r: 7, class: "svg-you" }));
      const pl = placeLabel({ x: you.x, y: you.y, label: "TOI" });
      if (pl) root.append(svg("text", { x: pl.tx.toFixed(1), y: pl.ty.toFixed(1), "text-anchor": pl.anchor, class: "svg-label", "font-size": 14 }, "TOI"));
    }
    return root;
  }

  // ------------------------------------------------------------------
  // Classements par pays
  // ------------------------------------------------------------------
  function renderCountryTabs() {
    const tabs = $("#country-tabs");
    tabs.replaceChildren(
      ...D.COUNTRIES.map((c) =>
        el("button", {
          type: "button",
          role: "tab",
          id: "tab-" + c.id,
          "aria-selected": String(state.country === c.id),
          "aria-controls": "country-panel",
          text: c.name,
          onclick: () => {
            state.country = c.id;
            $$("[role=tab]", tabs).forEach((b) => b.setAttribute("aria-selected", String(b.id === "tab-" + c.id)));
            renderCountry();
          },
        })
      )
    );
  }

  function renderCountry() {
    const R = state.results;
    const c = D.COUNTRIES.find((x) => x.id === state.country);
    const ranks = R.ranks[c.id];
    const panel = $("#country-panel");
    panel.setAttribute("aria-labelledby", "tab-" + c.id);
    const parts = [el("p", { class: "country-intro", text: c.intro })];

    if (c.id === "us") parts.push(renderDuel(ranks));

    const list = el("ol", { class: "rank" });
    ranks.forEach((r, i) => {
      const p = r.party;
      const detailId = "detail-" + c.id + "-" + p.id;
      const detail = el("div", { class: "rank-detail", id: detailId, hidden: i !== 0 }, partyDetail(p, R.s));
      const btn = el(
        "button",
        {
          type: "button",
          class: "rank-btn",
          "aria-expanded": String(i === 0),
          "aria-controls": detailId,
          onclick: (ev) => {
            const open = ev.currentTarget.getAttribute("aria-expanded") === "true";
            ev.currentTarget.setAttribute("aria-expanded", String(!open));
            detail.hidden = open;
          },
        },
        [
          el("span", { class: "rank-pos", text: String(i + 1) }),
          logoEl(p, "sm"),
          el("span", { class: "rank-name" }, [el("strong", { text: p.name }), el("span", { text: [p.family, whoText(p)].filter(Boolean).join(" · ") })]),
          el("span", { class: "bar", "aria-hidden": "true" }, [el("span", { style: "width:" + r.aff + "%;background:" + p.color })]),
          el("span", { class: "rank-pct", text: r.aff + " %" }),
          el("span", { class: "chev", "aria-hidden": "true", text: "›" }),
        ]
      );
      list.append(el("li", {}, [btn, detail]));
    });
    parts.push(list);
    panel.replaceChildren(...parts);
    applyMedia(panel);
  }

  function partyDetail(p, u) {
    const diffs = AXIS_IDS.map((a) => ({ a, d: Math.abs(u[a] - p.pos[a]) })).sort((x, y) => x.d - y.d);
    const close = diffs.filter((x) => x.d <= 30).map((x) => AXIS[x.a].name.toLowerCase());
    const far = diffs.filter((x) => x.d >= 60).reverse().map((x) => AXIS[x.a].name.toLowerCase());
    const prox = [];
    if (close.length) prox.push(el("span", {}, ["Vous êtes proches sur : ", el("b", { text: close.join(", ") }), ". "]));
    if (far.length) prox.push(el("span", {}, ["Vous divergez nettement sur : ", el("b", { text: far.join(", ") }), "."]));
    if (!prox.length) prox.push("Ni accord net ni désaccord majeur sur un axe en particulier.");

    return [
      peopleList(p),
      el("p", { class: "desc", text: p.desc }),
      el("ul", {}, p.points.map((t) => el("li", { text: t }))),
      el("div", { class: "legend" }, [
        el("span", {}, [el("i", { class: "l-you" }), "Toi"]),
        el("span", {}, [el("i", { class: "l-them", style: "background:" + p.color }), p.name]),
      ]),
      el(
        "div",
        { class: "compare" },
        AXES.map((a) => el("div", { class: "compare-row" }, [el("span", { text: a.name + " · " + a.neg + " ↔ " + a.pos }), track(u[a.id], p.pos[a.id], p.color)]))
      ),
      el("p", { class: "proximity" }, prox),
    ];
  }

  function renderDuel(ranks) {
    const best = (camp) => ranks.filter((r) => r.party.camp === camp)[0];
    const d = best("D"), r = best("R");
    const total = d.aff + r.aff || 1;
    const dShare = Math.round((100 * d.aff) / total);
    const rShare = 100 - dShare;
    const lean = dShare === rShare ? "Tu te situes pile entre les deux camps." : dShare > rShare ? "Tu penches du côté démocrate." : "Tu penches du côté républicain.";
    return el("div", { class: "duel" }, [
      el("div", { class: "duel-head" }, [el("span", { text: "Démocrates " + dShare + " %" }), el("span", { text: rShare + " % Républicains" })]),
      el("div", { class: "duel-bar", role: "img", "aria-label": "Démocrates " + dShare + " %, Républicains " + rShare + " %" }, [
        el("span", { style: "width:" + dShare + "%" }),
        el("span", { style: "width:" + rShare + "%" }),
      ]),
      el("p", { text: lean + " Courant le plus proche : " + (d.dist <= r.dist ? d.party.name : r.party.name) + "." }),
    ]);
  }

  // ------------------------------------------------------------------
  // Idéologies et récapitulatif
  // ------------------------------------------------------------------
  function renderIdeologies() {
    const R = state.results;
    $("#ideo-grid").replaceChildren(
      ...R.ideos.slice(0, 3).map((r, i) =>
        el("div", { class: "ideo" + (i === 0 ? " first" : "") }, [
          el("span", { class: "eyebrow", text: i === 0 ? "Le plus proche" : i === 1 ? "Deuxième" : "Troisième" }),
          el("h3", { text: r.party.name }),
          el("span", { class: "num", text: r.aff + " % d'affinité" }),
          el("p", { text: r.party.desc }),
        ])
      )
    );
  }

  function renderRecap() {
    const R = state.results;
    const label = (v) => (v === undefined || v === null ? "Passée" : CHOICES.find((c) => c.v === v).label);
    $("#recap-list").replaceChildren(
      ...R.order.map((q, i) =>
        el("li", {}, [el("span", {}, [el("span", { class: "num muted", text: i + 1 + ". " }), q.t]), el("span", { class: "r-ans", text: label(R.answers[q.id]) })])
      )
    );
  }

  // ------------------------------------------------------------------
  // Résultats enregistrés sous un prénom ou un pseudo
  // ------------------------------------------------------------------
  const SAVED_KEY = "isoloir-saved-v1";
  const MAX_SAVED = 200;
  const PERSON_COLORS = ["#5b3fd6", "#0e7a8a", "#c2410c", "#be185d", "#4d7c0f", "#1d4ed8", "#a16207", "#475569"];
  const resultCache = new Map();

  const saved = {
    list() {
      try {
        const arr = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
        return Array.isArray(arr)
          ? arr.filter((e) => e && typeof e.id === "string" && typeof e.name === "string" && typeof e.code === "string" && (e.mode === "c" || e.mode === "r"))
          : [];
      } catch (e) {
        return [];
      }
    },
    write(arr) {
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(arr));
        return true;
      } catch (e) {
        return false;
      }
    },
  };

  function cleanName(raw) {
    const s = String(raw || "")
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return Array.from(s).slice(0, 24).join("").trim();
  }

  const sameName = (a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }) === 0;

  // Enregistre ou met à jour : un même pseudo ne garde que son dernier résultat.
  function upsertSaved(name, mode, code) {
    const list = saved.list();
    const existing = list.find((e) => sameName(e.name, name));
    const now = new Date().toISOString();
    let entry;
    if (existing) {
      Object.assign(existing, { name, mode, code, v: D.VERSION, at: now });
      entry = existing;
    } else {
      entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name, mode, code, v: D.VERSION, at: now };
      list.push(entry);
      while (list.length > MAX_SAVED) list.shift();
    }
    const ok = saved.write(list);
    if (ok) state.compare.add(entry.id);
    return { ok, entry, replaced: !!existing };
  }

  function removeSaved(id) {
    saved.write(saved.list().filter((e) => e.id !== id));
    state.compare.delete(id);
  }

  // Recalcule le profil d'un résultat enregistré (avec les positions actuelles des partis).
  function entryResult(e) {
    if ((e.v || D.VERSION) !== D.VERSION) return null;
    const key = e.mode + e.code;
    if (resultCache.has(key)) return resultCache.get(key);
    const dec = decodeHash(resultHash(e.mode, e.code));
    if (!dec) return null;
    const { s } = computeScores(ORDERS[e.mode], dec.answers);
    const fr = D.COUNTRIES.find((c) => c.id === "fr").parties;
    const r = { s, answers: dec.answers, top: rankParties(s, fr)[0], ideo: rankParties(s, D.IDEOLOGIES)[0].party, hemi: hemicyclePosition(s) };
    resultCache.set(key, r);
    return r;
  }

  const personColor = (list, e) => PERSON_COLORS[Math.max(0, list.findIndex((x) => x.id === e.id)) % PERSON_COLORS.length];
  const avatarText = (name) => initials(name) || Array.from(name)[0] || "?";

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    } catch (e) {
      return "";
    }
  }

  function shareUrl(hash) {
    return location.href.split("#")[0] + "#" + hash;
  }

  function copyText(text, statusEl, outEl, okMsg) {
    const fallback = () => {
      outEl.value = text;
      outEl.hidden = false;
      outEl.focus();
      outEl.select();
      statusEl.textContent = "Copie automatique impossible : sélectionne le lien ci-dessous.";
    };
    outEl.hidden = true;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => { statusEl.textContent = okMsg || "Lien copié."; }, fallback);
    } else {
      fallback();
    }
  }

  function renderResultLabel() {
    const R = state.results;
    $("#res-mode").textContent = (R.name ? "Résultat de " + R.name + " · " : "") + MODE_LABEL[R.mode] + ", " + R.answered + " réponses sur " + R.order.length;
  }

  function renderSaveBar() {
    const R = state.results;
    const list = saved.list();
    const existing = list.find((e) => e.mode === R.mode && e.code === R.code && (!R.name || sameName(e.name, R.name)));
    $("#save-name").value = R.name || (existing ? existing.name : "");
    $("#save-msg").textContent = existing ? "Ce résultat est enregistré sous « " + existing.name + " »." : "";
    $("#save-msg").classList.remove("is-error");
  }

  function submitSave(ev) {
    ev.preventDefault();
    const R = state.results;
    const msg = $("#save-msg");
    const input = $("#save-name");
    const name = cleanName(input.value);
    msg.classList.remove("is-error");
    if (!name) {
      msg.textContent = "Choisis un prénom ou un pseudo pour enregistrer ce résultat.";
      msg.classList.add("is-error");
      input.focus();
      return;
    }
    const res = upsertSaved(name, R.mode, R.code);
    if (!res.ok) {
      msg.textContent = "Impossible d'enregistrer : le stockage de ce navigateur est désactivé (navigation privée ?).";
      msg.classList.add("is-error");
      return;
    }
    input.value = name;
    R.name = name;
    setHash(resultHash(R.mode, R.code, name));
    renderResultLabel();
    msg.textContent = res.replaced
      ? "Le résultat de « " + name + " » a été mis à jour."
      : "Enregistré sous « " + name + " ». Retrouve-le plus bas, dans les résultats enregistrés.";
    renderSaved();
  }

  function submitImport(ev) {
    ev.preventDefault();
    const msg = $("#import-msg");
    const link = $("#import-link");
    const nameInput = $("#import-name");
    msg.classList.remove("is-error");
    const fail = (text, field) => {
      msg.textContent = text;
      msg.classList.add("is-error");
      field.focus();
    };
    const m = /resultat-[cr]\d+-[a-ex]+(?:-de-[0-9a-f]+)?/.exec(link.value || "");
    const dec = m ? decodeHash(m[0]) : null;
    if (!dec) return fail("Ce lien ne contient pas de résultat lisible. Copie le lien complet de la page de résultat.", link);
    const name = cleanName(nameInput.value) || dec.name;
    if (!name) return fail("Indique un prénom ou un pseudo pour ce résultat.", nameInput);
    const res = upsertSaved(name, dec.mode, dec.code);
    if (!res.ok) return fail("Impossible d'enregistrer : le stockage de ce navigateur est désactivé (navigation privée ?).", link);
    link.value = "";
    nameInput.value = "";
    msg.textContent = res.replaced ? "Le résultat de « " + name + " » a été mis à jour." : "Résultat de « " + name + " » ajouté.";
    renderSaved();
  }

  function renderSaved() {
    const section = $("#groupe");
    const list = saved.list();
    const usable = list.filter((e) => entryResult(e));
    if (!state.compareInit) {
      usable.slice(-4).forEach((e) => state.compare.add(e.id));
      state.compareInit = true;
    }
    section.hidden = state.view === "quiz" || (state.view !== "results" && list.length === 0);
    $("#nav-saved").hidden = list.length === 0;
    $("#saved-link").hidden = list.length === 0;
    $("#saved-count").textContent = list.length;
    $("#saved-empty").hidden = list.length > 0;

    const cards = list
      .slice()
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
      .map((e) => savedCard(e, list));
    $("#saved-list").replaceChildren(...cards);
    applyMedia($("#saved-list"));
    renderCompare(list);
  }

  function savedCard(e, list) {
    const r = entryResult(e);
    const color = personColor(list, e);
    const cmpId = "cmp-" + e.id;
    const head = el("div", { class: "sc-head" }, [
      el("span", { class: "avatar", style: "--person:" + color, "aria-hidden": "true", text: avatarText(e.name) }),
      el("div", { class: "sc-title" }, [el("h3", { text: e.name }), el("span", { class: "muted", text: formatDate(e.at) + " · " + MODE_LABEL[e.mode] })]),
    ]);
    const body = r
      ? [
          el("div", { class: "sc-party" }, [
            logoEl(r.top.party, "sm"),
            el("span", {}, [el("strong", { text: r.top.party.name }), el("span", { class: "muted num", text: r.top.aff + " % d'affinité" })]),
          ]),
          el("p", { class: "sc-ideo" }, [el("b", { text: r.ideo.name }), " · " + lrLabel(r.hemi)]),
        ]
      : [el("p", { class: "muted", text: "Résultat d'une ancienne version du test : il ne peut plus être affiché." })];

    const status = el("p", { class: "form-msg", role: "status" });
    const out = el("input", { class: "copy-out", type: "text", readonly: true, hidden: true, "aria-label": "Lien du résultat de " + e.name });
    const del = el("button", { type: "button", class: "btn btn-ghost btn-small", text: "Supprimer" });
    let armed = null;
    del.addEventListener("click", () => {
      if (armed) {
        clearTimeout(armed);
        removeSaved(e.id);
        renderSaved();
        return;
      }
      del.textContent = "Confirmer la suppression";
      del.classList.add("is-danger");
      armed = setTimeout(() => {
        armed = null;
        del.textContent = "Supprimer";
        del.classList.remove("is-danger");
      }, 4000);
    });

    const actions = el("div", { class: "sc-actions" }, [
      r
        ? el("button", {
            type: "button",
            class: "btn btn-small",
            text: "Voir",
            onclick: () => {
              setHash(resultHash(e.mode, e.code, e.name));
              showResults(e.mode, r.answers, e.name);
            },
          })
        : null,
      r
        ? el("button", {
            type: "button",
            class: "btn btn-small",
            text: "Copier le lien",
            onclick: () => copyText(shareUrl(resultHash(e.mode, e.code, e.name)), status, out, "Lien de « " + e.name + " » copié."),
          })
        : null,
      del,
    ]);

    const compare = r
      ? el("label", { class: "sc-compare", for: cmpId }, [
          el("input", {
            type: "checkbox",
            id: cmpId,
            checked: state.compare.has(e.id),
            onchange: (ev) => {
              if (ev.target.checked) state.compare.add(e.id);
              else state.compare.delete(e.id);
              renderCompare(saved.list());
            },
          }),
          "Comparer",
        ])
      : null;

    return el("article", { class: "saved-card", style: "--person:" + color }, [head, ...body, el("div", { class: "sc-foot" }, [compare, actions]), status, out]);
  }

  function renderCompare(list) {
    const panel = $("#compare-panel");
    const people = list
      .map((e) => ({ e, r: entryResult(e), color: personColor(list, e) }))
      .filter((x) => x.r && state.compare.has(x.e.id));
    const usable = list.filter((e) => entryResult(e)).length;
    if (usable < 2) {
      panel.hidden = true;
      panel.replaceChildren();
      return;
    }
    panel.hidden = false;
    const head = el("div", { class: "compare-head" }, [el("h3", { text: "Comparaison" })]);
    if (people.length < 2) {
      panel.replaceChildren(head, el("p", { class: "muted", text: "Coche « Comparer » sur au moins deux résultats pour les voir côte à côte." }));
      return;
    }

    // Accord entre chaque paire
    const pairs = [];
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        pairs.push({ a: people[i], b: people[j], aff: affinity(people[i].r.s, people[j].r.s) });
      }
    }
    pairs.sort((x, y) => y.aff - x.aff);
    const best = pairs[0], worst = pairs[pairs.length - 1];
    const gap = (p) => {
      const g = AXIS_IDS.map((a) => ({ a, d: Math.abs(p.a.r.s[a] - p.b.r.s[a]) })).sort((x, y) => y.d - x.d)[0];
      return AXIS[g.a].name.toLowerCase();
    };
    const summary =
      pairs.length === 1
        ? best.a.e.name + " et " + best.b.e.name + " sont d'accord à " + best.aff + " %. Leur plus grand désaccord : " + gap(best) + "."
        : "Les plus proches : " + best.a.e.name + " et " + best.b.e.name + " (" + best.aff + " %). Les plus éloignés : " + worst.a.e.name + " et " + worst.b.e.name + " (" + worst.aff + " %), surtout sur " + gap(worst) + ".";

    const legend = el(
      "div",
      { class: "legend" },
      people.map((p) => el("span", {}, [el("i", { class: "l-person", style: "--person:" + p.color }), p.e.name]))
    );

    const rows = AXES.map((a) => {
      const t = el("div", { class: "track", "aria-hidden": "true" });
      const placed = [];
      people
        .slice()
        .sort((x, y) => x.r.s[a.id] - y.r.s[a.id])
        .forEach((p) => {
          const left = Number(toPct(p.r.s[a.id]));
          const stack = placed.filter((x) => Math.abs(x - left) < 4).length;
          placed.push(left);
          t.append(
            el("span", {
              class: "mark",
              title: p.e.name + " : " + (p.r.s[a.id] > 0 ? "+" : "") + Math.round(p.r.s[a.id]),
              style: "left:" + left + "%;--person:" + p.color + ";--lift:" + stack * -14 + "px",
              text: avatarText(p.e.name),
            })
          );
        });
      return el("div", { class: "compare-row cmp-row" }, [el("span", { text: a.name + " · " + a.neg + " ↔ " + a.pos }), t]);
    });

    const table = el("table", { class: "matrix" }, [
      el("caption", { text: "Pourcentage d'accord entre chaque paire" }),
      el("thead", {}, [el("tr", {}, [el("th", { scope: "col", text: "" }), ...people.map((p) => el("th", { scope: "col", text: p.e.name }))])]),
      el(
        "tbody",
        {},
        people.map((p, i) =>
          el("tr", {}, [
            el("th", { scope: "row" }, [el("i", { class: "l-person", style: "--person:" + p.color }), p.e.name]),
            ...people.map((q, j) => {
              if (i === j) return el("td", { class: "diag", text: "—" });
              const v = affinity(p.r.s, q.r.s);
              return el("td", { class: "num", style: "--v:" + v, text: v + " %" });
            }),
          ])
        )
      ),
    ]);

    const parties = el(
      "ul",
      { class: "cmp-parties" },
      people.map((p) =>
        el("li", {}, [el("i", { class: "l-person", style: "--person:" + p.color }), el("b", { text: p.e.name }), logoEl(p.r.top.party, "sm"), el("span", { text: p.r.top.party.name + " · " + p.r.ideo.name })])
      )
    );

    panel.replaceChildren(head, el("p", { class: "cmp-summary", text: summary }), legend, el("div", { class: "compare cmp-axes" }, rows), el("div", { class: "matrix-wrap" }, [table]), parties);
    applyMedia(panel);
  }

  // ------------------------------------------------------------------
  // Évènements
  // ------------------------------------------------------------------
  function bind() {
    $$("[data-updated]").forEach((n) => { n.textContent = D.UPDATED; });
    $("#sources").replaceChildren(...D.SOURCES.map((src) => el("li", {}, [el("a", { href: src.url, target: "_blank", rel: "noopener", text: src.label })])));
    $$("[data-mode]").forEach((b) => b.addEventListener("click", () => startQuiz(b.dataset.mode, false)));
    $("#resume-go").addEventListener("click", () => {
      const saved = storage.get();
      if (saved) startQuiz(saved.mode, true);
    });
    $("#resume-drop").addEventListener("click", () => {
      storage.clear();
      renderResume();
    });
    $("#brand").addEventListener("click", goHome);
    $$("[data-scroll]").forEach((a) =>
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        const id = a.dataset.scroll;
        if ((id === "axes" || id === "partis") && $("#view-home").hidden) goHome();
        const target = document.getElementById(id);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      })
    );

    $("#q-prev").addEventListener("click", prev);
    $("#q-skip").addEventListener("click", () => answer(null));
    $("#q-finish").addEventListener("click", finish);
    $("#q-ctx-toggle").addEventListener("click", () => {
      state.ctxOpen = !state.ctxOpen;
      renderQuestion();
    });

    document.addEventListener("keydown", (ev) => {
      if ($("#view-quiz").hidden || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = ev.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (/^[1-5]$/.test(ev.key)) {
        ev.preventDefault();
        answer(CHOICES[Number(ev.key) - 1].v);
      } else if (ev.key === "0") {
        ev.preventDefault();
        answer(null);
      } else if (ev.key === "ArrowLeft" || ev.key === "Backspace") {
        ev.preventDefault();
        prev();
      }
    });

    $("#copy-link").addEventListener("click", () => {
      const R = state.results;
      copyText(shareUrl(resultHash(R.mode, R.code, R.name)), $("#copy-toast"), $("#copy-out"));
    });
    $("#save-form").addEventListener("submit", submitSave);
    $("#import-form").addEventListener("submit", submitImport);
    $("#restart-c").addEventListener("click", () => startQuiz("c", false));
    $("#restart-r").addEventListener("click", () => startQuiz("r", false));

    window.addEventListener("hashchange", route);
  }

  function goHome() {
    clearHash();
    showView("home");
    renderHome();
  }

  function route() {
    const decoded = decodeHash(location.hash);
    if (decoded) {
      showResults(decoded.mode, decoded.answers, decoded.name);
    } else if ($("#view-results").hidden === false && !location.hash) {
      goHome();
    }
  }

  function init() {
    bind();
    M.onChange(() => {
      applyMedia(document);
      renderCredits();
    });
    renderCredits();
    renderHome();
    M.load();
    const decoded = decodeHash(location.hash);
    if (decoded) showResults(decoded.mode, decoded.answers, decoded.name);
    else showView("home");
  }

  // Exposé pour les tests automatiques.
  window.ISOLOIR = { computeScores, rankParties, affinity, distance, hemicyclePosition, ORDERS, encodeAnswers, decodeHash, nameToHex, hexToName };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
