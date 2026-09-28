/* Realmaps globe: one pin and one true footprint per map, a sheet per map.
   Data comes from data/maps.json, written by tools/export_showcase.py. */
(function () {
  "use strict";

  const STATUS = {
    development: "In development",
    prototype: "Prototype",
    next: "Next up",
    candidate: "Candidate",
  };
  const LABEL_BELOW = new Set(["small_crater", "naxos_island"]);   // keeps labels clear of their neighbours
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wide = () => window.matchMedia("(min-width: 821px)").matches;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function dms(v, pos, neg) {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const mf = (a - d) * 60;
    const m = Math.floor(mf);
    const s = Math.round((mf - m) * 60);
    return `${d}°${String(m).padStart(2, "0")}′${String(s).padStart(2, "0")}″${v >= 0 ? pos : neg}`;
  }
  const coords = (lat, lon) => `${dms(lat, "N", "S")}  ${dms(lon, "E", "W")}`;
  const fmt = (n) => n.toLocaleString("en-US");

  let data, globe, current = null, pins = new Map();

  fetch("data/maps.json")
    .then((r) => r.json())
    .then((d) => { data = d; build(); })
    .catch(() => {
      document.getElementById("map-list").append(el("li", "no-shots", "The map list could not be loaded. Reload the page to try again."));
    });

  function build() {
    const container = document.getElementById("globe");
    const everything = [
      ...data.maps.map((m) => ({ ...m, kind: "map" })),
      ...data.candidates.map((c) => ({ ...c, kind: "cand", status: "candidate" })),
    ];

    globe = Globe({ animateIn: !reduceMotion })(container)
      .backgroundColor("rgba(0,0,0,0)")
      .globeImageUrl("assets/earth/earth-blue-marble.jpg")
      .bumpImageUrl("assets/earth/earth-topology.png")
      .showAtmosphere(true)
      .atmosphereColor("#7fb2d6")
      .atmosphereAltitude(0.16)
      .polygonsData(data.maps.map((m) => ({
        id: m.id,
        geometry: { type: "Polygon", coordinates: [m.footprint] },
      })))
      .polygonCapColor((p) => (p.id === current ? "rgba(232,163,58,0.45)" : "rgba(232,163,58,0.22)"))
      .polygonSideColor(() => "rgba(232,163,58,0.35)")
      .polygonStrokeColor(() => "#e8a33a")
      .polygonAltitude(0.003)
      .polygonCapCurvatureResolution(0.2)
      .onPolygonClick((p) => go(p.id))
      .htmlElementsData(everything)
      .htmlLat((d) => d.lat)
      .htmlLng((d) => d.lon)
      .htmlAltitude(0.004)
      .htmlTransitionDuration(0)
      .htmlElement(makePin);

    const controls = globe.controls();
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.25;
    controls.minDistance = 101.5;   // never quite touch the ground: the Blue Marble is ~10 km a pixel
    ["start"].forEach((ev) => controls.addEventListener(ev, () => { controls.autoRotate = false; }));

    fit();
    window.addEventListener("resize", fit);
    globe.pointOfView({ lat: 40, lng: 12, altitude: wide() ? 2.1 : 2.6 }, 0);

    renderLists();
    document.getElementById("sheet-close").addEventListener("click", () => { location.hash = ""; });
    window.addEventListener("hashchange", route);
    route();
  }

  function fit() {
    const box = document.getElementById("globe").getBoundingClientRect();
    globe.width(box.width).height(box.height);
  }

  function makePin(d) {
    const wrap = el("div", "pin-anchor");
    wrap.style.cssText = "position:relative;width:0;height:0;";
    const pin = el("div", `pin ${d.kind === "cand" ? "cand" : ""} ${d.status === "next" ? "next" : ""}`);
    pin.style.position = "absolute";
    pin.setAttribute("role", "button");
    pin.setAttribute("tabindex", "0");
    pin.setAttribute("aria-label", `${d.title}, ${d.region}`);
    const tag = el("span", "tag", d.title);
    const stem = el("span", "stem");
    const dot = el("span", "dot");
    if (LABEL_BELOW.has(d.id)) {
      pin.style.transform = "translate(-50%, -3px)";
      pin.append(dot, stem, tag);
    } else {
      pin.style.transform = "translate(-50%, calc(-100% + 3px))";
      pin.append(tag, stem, dot);
    }
    if (d.kind === "cand") tag.hidden = true;   // candidates crowd; name on hover or when chosen
    pin.addEventListener("mouseenter", () => { tag.hidden = false; });
    pin.addEventListener("mouseleave", () => { if (d.kind === "cand" && current !== d.id) tag.hidden = true; });
    const open = (e) => { e.stopPropagation(); go(d.id); };
    pin.addEventListener("click", open);
    pin.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") open(e); });
    pins.set(d.id, { pin, tag, kind: d.kind });
    wrap.append(pin);
    return wrap;
  }

  function renderLists() {
    const list = document.getElementById("map-list");
    data.maps.forEach((m) => {
      const li = el("li");
      const b = el("button");
      b.type = "button";
      b.dataset.id = m.id;
      b.append(el("span", "name", m.title), el("span", "size", `${m.extent_km} km`), el("span", "region", m.region));
      b.addEventListener("click", () => go(m.id));
      li.append(b);
      list.append(li);
    });
    const cands = document.getElementById("cand-list");
    data.candidates.forEach((c) => {
      const li = el("li");
      const b = el("button", null, c.title);
      b.type = "button";
      b.dataset.id = c.id;
      b.addEventListener("click", () => go(c.id));
      li.append(b);
      cands.append(li);
    });
  }

  function go(id) {
    if (location.hash === `#${id}`) route();
    else location.hash = id;
  }

  function route() {
    const id = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    const m = data.maps.find((x) => x.id === id);
    const c = data.candidates.find((x) => x.id === id);
    select(m ? { ...m, kind: "map" } : c ? { ...c, kind: "cand", status: "candidate" } : null);
  }

  function select(d) {
    current = d ? d.id : null;
    document.querySelectorAll("#map-list button, #cand-list button").forEach((b) => {
      b.setAttribute("aria-current", String(b.dataset.id === current));
    });
    pins.forEach((p, id) => {
      p.pin.classList.toggle("active", id === current);
      if (p.kind === "cand") p.tag.hidden = id !== current;
    });
    globe.polygonCapColor(globe.polygonCapColor());   // repaint the chosen footprint

    const sheet = document.getElementById("sheet");
    const app = document.getElementById("app");
    if (!d) {
      sheet.hidden = true;
      app.classList.remove("sheet-open");
      fit();
      return;
    }
    renderSheet(d);
    sheet.hidden = false;
    sheet.scrollTop = 0;
    app.classList.add("sheet-open");
    fit();
    globe.controls().autoRotate = false;
    const alt = d.kind === "map" ? Math.min(0.3, Math.max(0.06, d.extent_km / 160)) : 0.35;
    globe.pointOfView({ lat: d.lat, lng: d.lon, altitude: alt }, reduceMotion ? 0 : 1600);
    document.title = `${d.title} · SirSlidesALot Realmaps`;
  }

  function renderSheet(d) {
    const body = document.getElementById("sheet-body");
    body.replaceChildren();

    const head = el("header", "sheet-head");
    head.append(el("span", `status ${d.status}`, STATUS[d.status] || d.status));
    head.append(el("h2", null, d.title));
    head.append(el("p", "where", d.region));
    head.append(el("span", "coords", coords(d.lat, d.lon)));
    body.append(head);

    body.append(el("p", "pitch", d.pitch || d.note || ""));

    if (d.kind === "map") {
      const facts = el("dl", "facts");
      const fact = (label, value, unit) => {
        const div = el("div");
        const dd = el("dd", null, value);
        if (unit) dd.append(" ", el("small", null, unit));
        div.append(el("dt", null, label), dd);
        facts.append(div);
      };
      const area = Math.round(d.extent_km * d.extent_km);
      fact("Map square", `${d.extent_km} × ${d.extent_km}`, "km");
      fact("Area", fmt(area), "km²");
      fact("Terrain cell", String(d.cell_m), "m");
      fact("Events", d.events ? String(d.events) : "none yet", d.events ? "missions" : "");
      if (d.elev_min_m != null) {
        const low = d.water_m === 0 ? "Sea level" : fmt(d.elev_min_m);
        fact(d.water_m != null && d.water_m !== 0 ? "Lake surface to top" : "Elevation", `${low} to ${fmt(d.elev_max_m)}`, "m");
      }
      body.append(facts);
      if (d.elev_min_m != null) body.append(elevBar(d.elev_min_m, d.elev_max_m));

      if (d.images.length) {
        const g = el("div", "gallery");
        d.images.forEach((img, i) => {
          const b = el("button");
          b.type = "button";
          b.setAttribute("aria-label", `Open screenshot: ${img.caption}`);
          const im = el("img");
          im.src = i === 0 ? img.full : img.thumb;
          im.alt = img.caption;
          im.loading = "lazy";
          b.append(im, el("span", "cap", img.caption));
          b.addEventListener("click", () => openLightbox(d.images, i));
          g.append(b);
        });
        body.append(g);
      } else {
        body.append(el("p", "no-shots", "No screenshots yet. This map has not been built."));
      }

      const src = el("p", "sources");
      src.append(el("strong", null, "Built from: "), d.sources.join(" · "));
      body.append(src);
    } else {
      body.append(el("p", "no-shots", "A scouted location, not started. The map square is drawn once a map is built."));
    }
  }

  function elevBar(lo, hi) {
    // A fixed scale shared by every map, so heights compare between sheets.
    const MIN = -300, MAX = 2800;
    const pct = (v) => ((v - MIN) / (MAX - MIN)) * 100;
    const wrap = el("div", "elev");
    const bar = el("div", "elev-bar");
    const fill = el("div", "elev-fill");
    fill.style.left = `${pct(lo)}%`;
    fill.style.width = `${pct(hi) - pct(lo)}%`;
    const sea = el("div", "elev-sea");
    sea.style.left = `${pct(0)}%`;
    sea.title = "Sea level";
    bar.append(fill, sea);
    const scale = el("div", "elev-scale");
    [[MIN, "−300"], [0, "0"], [1000, "1,000"], [2000, "2,000"], [MAX, "2,800 m"]].forEach(([v, t]) => {
      const s = el("span", null, t);
      s.style.left = `${pct(v)}%`;
      if (v === MIN) s.style.transform = "none";
      if (v === MAX) s.style.transform = "translateX(-100%)";
      scale.append(s);
    });
    wrap.append(bar, scale);
    return wrap;
  }

  /* ---- lightbox ---- */
  let lb = { list: [], i: 0 };
  const lbEl = document.getElementById("lightbox");
  function openLightbox(list, i) { lb = { list, i }; showLb(); lbEl.hidden = false; document.getElementById("lb-close").focus(); }
  function showLb() {
    const img = lb.list[lb.i];
    const im = document.getElementById("lb-img");
    im.src = img.full;
    im.alt = img.caption;
    document.getElementById("lb-cap").textContent = `${img.caption}  (${lb.i + 1} / ${lb.list.length})`;
  }
  const step = (k) => { lb.i = (lb.i + k + lb.list.length) % lb.list.length; showLb(); };
  document.getElementById("lb-close").addEventListener("click", () => { lbEl.hidden = true; });
  document.getElementById("lb-prev").addEventListener("click", () => step(-1));
  document.getElementById("lb-next").addEventListener("click", () => step(1));
  lbEl.addEventListener("click", (e) => { if (e.target === lbEl) lbEl.hidden = true; });
  document.addEventListener("keydown", (e) => {
    if (lbEl.hidden) {
      if (e.key === "Escape" && current) location.hash = "";
      return;
    }
    if (e.key === "Escape") lbEl.hidden = true;
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });
})();
