(function () {
  "use strict";

  const D = window.ISOLOIR_DATA;
  const AXES = D.AXES;
  const AXIS_IDS = AXES.map((a) => a.id);
  const AXIS = Object.fromEntries(AXES.map((a) => [a.id, a]));
  const STORE_KEY = "isoloir-progress-v" + D.VERSION;
  const SVGNS = "http://www.w3.org/2000/svg";

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
  };

  function showView(name) {
    $("#view-home").hidden = name !== "home";
    $("#view-quiz").hidden = name !== "quiz";
    $("#view-results").hidden = name !== "results";
    $("#methode").hidden = name === "quiz";
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
  function encodeAnswers(mode, answers) {
    const body = ORDERS[mode]
      .map((q) => {
        const v = answers[q.id];
        return v === undefined || v === null ? "x" : VALUE_TO_CODE[v];
      })
      .join("");
    return "resultat-" + mode + D.VERSION + "-" + body;
  }

  function decodeHash(hash) {
    const m = /^#?resultat-([cr])(\d+)-([a-ex]+)$/.exec(hash || "");
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
    return { mode, answers };
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
  function showResults(mode, answers) {
    const order = ORDERS[mode];
    const { s, n } = computeScores(order, answers);
    const answered = order.filter((q) => answers[q.id] !== undefined && answers[q.id] !== null).length;
    const ranks = Object.fromEntries(D.COUNTRIES.map((c) => [c.id, rankParties(s, c.parties)]));
    const ideos = rankParties(s, D.IDEOLOGIES);
    state.results = { mode, answers, s, n, ranks, ideos, answered, order };
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
    $("#copy-out").hidden = true;
    $("#copy-toast").textContent = "";
  }

  function renderVerdict() {
    const R = state.results;
    const top = R.ranks.fr[0];
    const p = top.party;

    $("#res-mode").textContent = MODE_LABEL[R.mode] + ", " + R.answered + " réponses sur " + R.order.length;

    const ballot = $("#ballot");
    ballot.replaceChildren(
      el("span", { class: "ballot-bar", style: "background:" + p.color, "aria-hidden": "true" }),
      el("span", { class: "ballot-kicker", text: "Bulletin de vote" }),
      el("span", { class: "ballot-name", text: p.name }),
      el("span", { class: "ballot-who", text: p.who }),
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
      return el("div", { class: "elsewhere-item" }, [
        el("span", { class: "eyebrow", text: "Si tu votais " + countryIn(c) }),
        el("strong", { text: t.party.name }),
        el("span", { class: "num", text: t.aff + " % d'affinité" }),
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
          el("span", { class: "swatch", style: "background:" + p.color }),
          el("span", { class: "rank-name" }, [el("strong", { text: p.name }), el("span", { text: [p.family, p.who].filter(Boolean).join(" · ") })]),
          el("span", { class: "bar", "aria-hidden": "true" }, [el("span", { style: "width:" + r.aff + "%;background:" + p.color })]),
          el("span", { class: "rank-pct", text: r.aff + " %" }),
          el("span", { class: "chev", "aria-hidden": "true", text: "›" }),
        ]
      );
      list.append(el("li", {}, [btn, detail]));
    });
    parts.push(list);
    panel.replaceChildren(...parts);
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
        if (id === "axes" && $("#view-home").hidden) goHome();
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
      const url = location.href;
      const out = $("#copy-out");
      const toast = $("#copy-toast");
      const fallback = () => {
        out.value = url;
        out.hidden = false;
        out.focus();
        out.select();
        toast.textContent = "Copie automatique impossible : sélectionne le lien ci-dessous.";
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => { toast.textContent = "Lien copié."; }, fallback);
      } else {
        fallback();
      }
    });
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
      showResults(decoded.mode, decoded.answers);
    } else if ($("#view-results").hidden === false && !location.hash) {
      goHome();
    }
  }

  function init() {
    bind();
    renderHome();
    const decoded = decodeHash(location.hash);
    if (decoded) showResults(decoded.mode, decoded.answers);
    else showView("home");
  }

  // Exposé pour les tests automatiques.
  window.ISOLOIR = { computeScores, rankParties, affinity, distance, hemicyclePosition, ORDERS, encodeAnswers, decodeHash };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
