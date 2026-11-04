/*
 * L'Isoloir — logos des partis et portraits des dirigeants
 * --------------------------------------------------------
 * Les images viennent de Wikimédia Commons, qui n'héberge que des fichiers
 * sous licence libre. Pour chaque parti ou personne :
 *   1. le titre de l'article Wikipédia donne l'élément Wikidata ;
 *   2. Wikidata donne le logo (propriété P154) ou le portrait (P18) ;
 *   3. Commons donne la miniature, l'auteur et la licence, affichés dans les crédits.
 * Les résultats sont gardés 7 jours dans le navigateur. Si Wikimédia est
 * inaccessible, le site affiche des pastilles de couleur à la place.
 */
window.ISOLOIR_MEDIA = (function () {
  "use strict";

  const CACHE_KEY = "isoloir-media-v1";
  const TTL = 7 * 24 * 3600 * 1000;
  const THUMB_WIDTH = 240;
  const BATCH = 50;
  const TIMEOUT = 12000;

  let media = {};
  let status = "idle";
  let pending = null;
  const listeners = [];

  const partyKey = (p) => "logo:" + p.wp.split("|")[0];
  const personKey = (h) => "photo:" + h.n;

  function parseTitles(spec) {
    return spec.split("|").map((s) => {
      const i = s.indexOf(":");
      return { lang: s.slice(0, i), title: s.slice(i + 1) };
    });
  }

  function entities() {
    const D = window.ISOLOIR_DATA;
    const seen = new Set();
    const list = [];
    const add = (key, kind, spec, label) => {
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ key, kind, titles: parseTitles(spec), label });
    };
    for (const c of D.COUNTRIES) {
      for (const p of c.parties) {
        add(partyKey(p), "logo", p.wp, p.name);
        for (const h of p.people) add(personKey(h), "photo", h.wp, h.n);
      }
    }
    return list;
  }

  function chunks(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  async function getJSON(url) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT) : null;
    try {
      const res = await fetch(url, { signal: ctrl ? ctrl.signal : undefined, credentials: "omit" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const q = (params) =>
    Object.entries(params)
      .map(([k, v]) => k + "=" + encodeURIComponent(v))
      .join("&");

  // Étape 1 : titres Wikipédia -> identifiants Wikidata
  async function resolveTitles(lang, titles) {
    const out = {};
    for (const batch of chunks(titles, BATCH)) {
      const url =
        "https://" + lang + ".wikipedia.org/w/api.php?" +
        q({ action: "query", format: "json", formatversion: 2, redirects: 1, prop: "pageprops", ppprop: "wikibase_item|disambiguation", titles: batch.join("|"), origin: "*" });
      const data = await getJSON(url);
      const query = data.query || {};
      const norm = {};
      (query.normalized || []).forEach((n) => { norm[n.from] = n.to; });
      const redir = {};
      (query.redirects || []).forEach((r) => { redir[r.from] = r.to; });
      const pages = {};
      (query.pages || []).forEach((pg) => { pages[pg.title] = pg; });
      for (const t of batch) {
        let cur = norm[t] || t;
        cur = redir[cur] || cur;
        const pg = pages[cur];
        if (!pg || pg.missing || !pg.pageprops) continue;
        if ("disambiguation" in pg.pageprops) continue;
        if (pg.pageprops.wikibase_item) out[t] = pg.pageprops.wikibase_item;
      }
    }
    return out;
  }

  function pickValue(claims, prop) {
    const st = (claims[prop] || []).filter((c) => c.rank !== "deprecated" && c.mainsnak && c.mainsnak.snaktype === "value");
    if (!st.length) return null;
    const current = (c) => !(c.qualifiers && c.qualifiers.P582);
    const best =
      st.find((c) => c.rank === "preferred" && current(c)) ||
      st.find((c) => c.rank === "preferred") ||
      st.find(current) ||
      st[0];
    return best.mainsnak.datavalue.value;
  }

  const isHuman = (claims) => (claims.P31 || []).some((c) => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id === "Q5");

  // Étape 2 : Wikidata -> nom du fichier Commons
  async function fileNames(qids) {
    const out = {};
    for (const batch of chunks(qids, BATCH)) {
      const url = "https://www.wikidata.org/w/api.php?" + q({ action: "wbgetentities", format: "json", props: "claims", ids: batch.join("|"), origin: "*" });
      const data = await getJSON(url);
      for (const [id, ent] of Object.entries(data.entities || {})) {
        if (!ent.claims) continue;
        out[id] = { logo: pickValue(ent.claims, "P154"), photo: isHuman(ent.claims) ? pickValue(ent.claims, "P18") : null };
      }
    }
    return out;
  }

  function htmlToText(html) {
    if (!html) return "";
    try {
      const doc = new DOMParser().parseFromString(String(html), "text/html");
      doc.querySelectorAll("script, style").forEach((n) => n.remove());
      return (doc.body.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
    } catch (e) {
      return "";
    }
  }

  // Étape 3 : Commons -> miniature, auteur, licence
  async function fileInfo(files) {
    const out = {};
    for (const batch of chunks(files, BATCH)) {
      const titles = batch.map((f) => "File:" + f);
      const url =
        "https://commons.wikimedia.org/w/api.php?" +
        q({ action: "query", format: "json", formatversion: 2, prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: THUMB_WIDTH, iiextmetadatafilter: "Artist|LicenseShortName", titles: titles.join("|"), origin: "*" });
      const data = await getJSON(url);
      const query = data.query || {};
      const norm = {};
      (query.normalized || []).forEach((n) => { norm[n.from] = n.to; });
      const pages = {};
      (query.pages || []).forEach((pg) => { pages[pg.title] = pg; });
      batch.forEach((f, i) => {
        const pg = pages[norm[titles[i]] || titles[i]];
        const ii = pg && pg.imageinfo && pg.imageinfo[0];
        if (!ii || !(ii.thumburl || ii.url)) return;
        const meta = ii.extmetadata || {};
        out[f] = {
          src: ii.thumburl || ii.url,
          page: ii.descriptionurl || "https://commons.wikimedia.org/wiki/" + encodeURIComponent(titles[i]),
          artist: htmlToText(meta.Artist && meta.Artist.value) || "Auteur inconnu",
          license: htmlToText(meta.LicenseShortName && meta.LicenseShortName.value) || "Licence libre",
        };
      });
    }
    return out;
  }

  async function fetchAll() {
    const list = entities();

    // Titres par langue, dans l'ordre de préférence de chaque entité
    const byLang = {};
    list.forEach((e) => e.titles.forEach((t) => { (byLang[t.lang] = byLang[t.lang] || new Set()).add(t.title); }));
    const qidByLangTitle = {};
    await Promise.all(
      Object.entries(byLang).map(async ([lang, set]) => {
        try {
          const res = await resolveTitles(lang, Array.from(set));
          for (const [t, id] of Object.entries(res)) qidByLangTitle[lang + ":" + t] = id;
        } catch (e) {
          /* une langue indisponible n'empêche pas les autres */
        }
      })
    );

    const qidOf = {};
    list.forEach((e) => {
      for (const t of e.titles) {
        const id = qidByLangTitle[t.lang + ":" + t.title];
        if (id) { qidOf[e.key] = id; break; }
      }
    });

    const files = await fileNames(Array.from(new Set(Object.values(qidOf))));
    const fileOf = {};
    list.forEach((e) => {
      const f = files[qidOf[e.key]];
      if (f && f[e.kind]) fileOf[e.key] = f[e.kind];
    });

    const infos = await fileInfo(Array.from(new Set(Object.values(fileOf))));
    const result = {};
    list.forEach((e) => {
      const info = infos[fileOf[e.key]];
      if (info) result[e.key] = Object.assign({ label: e.label, kind: e.kind }, info);
    });
    return result;
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (!c || !c.t || Date.now() - c.t > TTL || !c.v) return null;
      return c.v;
    } catch (e) {
      return null;
    }
  }

  function writeCache(v) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), v }));
    } catch (e) {
      /* stockage indisponible */
    }
  }

  function notify() {
    listeners.forEach((fn) => {
      try { fn(status); } catch (e) { /* rien */ }
    });
  }

  function load() {
    if (pending) return pending;
    const cached = readCache();
    if (cached && Object.keys(cached).length) {
      media = cached;
      status = "ready";
      pending = Promise.resolve(media);
      notify();
      return pending;
    }
    if (typeof fetch !== "function") {
      status = "failed";
      notify();
      return (pending = Promise.resolve(media));
    }
    status = "loading";
    pending = fetchAll().then(
      (res) => {
        media = res;
        status = Object.keys(res).length ? "ready" : "failed";
        if (status === "ready") writeCache(res);
        notify();
        return media;
      },
      () => {
        status = "failed";
        notify();
        return media;
      }
    );
    return pending;
  }

  return {
    load,
    get: (key) => media[key] || null,
    all: () => Object.values(media),
    status: () => status,
    onChange: (fn) => listeners.push(fn),
    partyKey,
    personKey,
  };
})();
