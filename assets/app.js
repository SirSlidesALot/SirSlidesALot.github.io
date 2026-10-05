/* Realmaps globe: one pin and one true footprint per map, a sheet per map.
   Data comes from data/maps.json, written by the realmaps repo's
   `scripts/showcase.py site --out <this repo>` from showcase/<map>/. */
(function () {
  "use strict";

  const STATUS = {
    development: "In development",
    prototype: "Prototype",
    next: "Next up",
    released: "Released",
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

  Promise.all([
    fetch("data/maps.json").then((r) => r.json()),
    // the Sentinel-2 rings round each map; without them the globe is Blue Marble only
    fetch("tiles/index.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ])
    .then(([d, ti]) => {
      data = d;
      rings = (ti && ti.s2) || {};
      if (d.credit) document.querySelector("#credit-line em").textContent = d.credit;
      build();
    })
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
      .globeImageUrl("assets/earth/earth-1024.jpg")   // only under the tiles: the poles, and before they load
      .globeTileEngineUrl(tileUrl)
      .globeTileEngineMaxLevel(BM_MAX)
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
      .polygonAltitude(SLAB)
      .polygonCapCurvatureResolution(0.2)
      .onPolygonClick((p) => go(p.id))
      .htmlElementsData(everything)
      .htmlLat((d) => d.lat)
      .htmlLng((d) => d.lon)
      .htmlAltitude(0.004)
      .htmlTransitionDuration(0)
      .htmlElement(makePin)
      .onGlobeReady(initPlates);

    window.realmapsGlobe = globe;   // for the headless check and the console
    initTiles();
    const controls = globe.controls();
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.25;
    controls.minDistance = 100.12;  // ~8 km up: close enough to fill the view with the smallest plate
    ["start"].forEach((ev) => controls.addEventListener(ev, () => { controls.autoRotate = false; }));
    controls.addEventListener("change", updatePlates);
    controls.addEventListener("change", updateTileCap);

    fit();
    window.addEventListener("resize", fit);
    globe.pointOfView({ lat: 40, lng: 12, altitude: wide() ? 2.1 : 2.6 }, 0);

    renderLists();
    document.getElementById("sheet-close").addEventListener("click", () => { location.hash = ""; });
    window.addEventListener("hashchange", route);
    route();
  }

  /* ---- tiles: the Earth in levels, sharp as the camera comes down (tk-0008) ----
     z0-4 Blue Marble hosted here; z5-8 the same layer from NASA GIBS (its maximum);
     z11-14 round each map our own Sentinel-2 tiles (tiles/index.json, written by the
     realmaps repo's scripts/globe_tiles.py). globe.gl draws ONE level at a time and
     keeps the coarser ones under it, so a tile we do not have is hidden and the
     level below shows through. */
  const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief/default/GoogleMapsCompatible_Level8/";
  const BM_LOCAL_MAX = 4, BM_MAX = 8, RING_MAX = 14;
  // globe.gl's own levels give ~3-6 screen pixels per tile pixel. Scaling level t's threshold
  // by 2^(t/4), at most x4, gives ~1 close up, and keeps the whole-globe view at z3 (64 tiles).
  const levelBias = (t) => Math.min(4, 2 ** (t / 4));
  const NO_TILE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  let rings = {}, tileEngine = null, tileCap = BM_MAX;

  function tileUrl(x, y, l) {
    if (l <= BM_LOCAL_MAX) return `tiles/bm/${l}/${x}/${y}.jpg`;
    for (const sid in rings) {
      const lv = rings[sid].levels[l];
      if (!lv) continue;
      const [x0, x1, y0, y1] = lv.range, h = lv.hole;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (h && x >= h[0] && x <= h[1] && y >= h[2] && y <= h[3]) return NO_TILE;   // under the plate
      return `tiles/s2/${sid}/${l}/${x}/${y}.${rings[sid].fmt}`;
    }
    return l <= BM_MAX ? `${GIBS}${l}/${y}/${x}.jpeg` : NO_TILE;
  }

  function initTiles() {
    // three-globe adds its tile engine to the scene only on its first update, so this
    // runs again from onGlobeReady and on camera moves until it finds it.
    if (tileEngine) return;
    globe.scene().traverse((o) => { if (!tileEngine && "thresholds" in o && "tileUrl" in o) tileEngine = o; });
    if (!tileEngine) return;
    tileEngine.thresholds = tileEngine.thresholds.map((v, t) => v * levelBias(t));
    const add = tileEngine.add.bind(tileEngine);
    tileEngine.add = (...objs) => {
      objs.forEach((o) => {
        const im = o.material && o.material.map && o.material.map.image;
        if (im && im.src === NO_TILE) o.visible = false;
      });
      return add(...objs);
    };
  }

  const tileXY = (lat, lng, z) => {
    const n = 2 ** z, s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180);
    return [Math.floor((lng + 180) / 360 * n), Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n)];
  };

  function updateTileCap() {
    // The finest level whose ring tiles cover the middle of the view; else Blue Marble's.
    initTiles();
    if (!tileEngine) return;
    const pov = globe.pointOfView(), cam = globe.camera();
    let want = tileEngine.thresholds.findIndex((v) => v <= pov.altitude);   // the engine's own rule
    if (want < 0) want = tileEngine.thresholds.length;
    let cap = BM_MAX;
    if (want > BM_MAX) {
      const hh = pov.altitude * EARTH_KM * Math.tan(cam.fov * Math.PI / 360) * 0.5;   // half the half-height, km
      const dlat = hh / 111.32, dlng = (hh * cam.aspect) / (111.32 * Math.cos(pov.lat * Math.PI / 180));
      search: for (let z = Math.min(want, RING_MAX); z > BM_MAX; z--) {
        const [ax, ay] = tileXY(pov.lat + dlat, pov.lng - dlng, z), [bx, by] = tileXY(pov.lat - dlat, pov.lng + dlng, z);
        for (const sid in rings) {
          const lv = rings[sid].levels[z];
          if (lv && ax >= lv.range[0] && bx <= lv.range[1] && ay >= lv.range[2] && by <= lv.range[3]) { cap = z; break search; }
        }
      }
    }
    if (cap !== tileCap) { tileCap = cap; globe.globeTileEngineMaxLevel(cap); }
  }

  /* ---- plates: each map seen from above, laid on the globe where it really is ----
     The Blue Marble is ~10 km a pixel; a plate is 2-8 m a pixel. It sits just above
     its own footprint, whose amber sides become the slab's edge, and fades in as the
     camera comes close. The 1024 px image loads first, the full one only up close. */
  const EARTH_KM = 6371;
  const SLAB = 0.00025;            // the footprint's height above the globe: ~1.6 km
  const PLATE_ALT = SLAB + 0.00008;  // just under the outline, which three-globe draws 1e-4 above the cap
  const SHADOW_ALT = 0.00001;        // the plate's shadow, on the ground
  const SHADOW_GROW = 0.07;          // how far the shadow reaches past the plate, as a share of its width
  let THREE_ = null;
  const plates = new Map();

  function initPlates() {
    // From onGlobeReady, and from the first camera moves: with tiles on, three-globe can
    // report ready before the chain that registers onGlobeReady has finished.
    if (THREE_) return;
    initTiles();
    // globe.gl bundles three.js without exposing it. Its own objects carry the
    // classes, so the plates are built from those rather than a second copy of three.
    const gm = globe.globeMaterial();
    let globeMesh = null;
    globe.scene().traverse((o) => { if (o.isMesh && o.material === gm) globeMesh = o; });
    if (!globeMesh || !gm.map) return;
    // The small Blue Marble stays under the tiles (globe.gl hides the globe when tiles
    // are on): it fills the poles the mercator tiles never reach, and any tile not loaded yet.
    Object.defineProperty(globeMesh, "visible", { get: () => true, set: () => {} });
    globeMesh.scale.setScalar(0.999);
    globeMesh.renderOrder = -1;
    const Mesh = globeMesh.constructor;
    const probe = new Mesh();
    THREE_ = {
      Mesh,
      BufferGeometry: probe.geometry.constructor,
      MeshBasicMaterial: probe.material.constructor,
      Attribute: globeMesh.geometry.getAttribute("position").constructor,
      Texture: gm.map.constructor,
      colorSpace: gm.map.colorSpace,
    };
    data.maps.filter((m) => m.plate).forEach(makePlate);
    updatePlates();
  }

  function sheet(m, alt, grow, shift = 0) {
    // The plate's grid draped at an altitude; grow > 0 pushes every point out
    // from the map's centre by that share of the width (the shadow's margin).
    const T = THREE_;
    const n = m.plate.grid_steps;
    const pos = [], uv = [], idx = [];
    const [clng, clat] = m.plate.grid[Math.floor(m.plate.grid.length / 2)];
    const [wl, nl] = m.plate.grid[0], [el_, sl] = m.plate.grid[m.plate.grid.length - 1];
    const dlng = (el_ - wl) * shift, dlat = (sl - nl) * shift;   // toward the south-east
    m.plate.grid.forEach(([lng, lat], i) => {
      const r = i % (n + 1), q = Math.floor(i / (n + 1));
      const s = 1 + grow * 2;
      const p = globe.getCoords(clat + (lat - clat) * s + dlat, clng + (lng - clng) * s + dlng, alt);
      pos.push(p.x, p.y, p.z);
      uv.push(r / n, 1 - q / n);
    });
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const a = r * (n + 1) + c, b = a + 1, d = a + n + 1, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Attribute(new Float32Array(pos), 3));
    geo.setAttribute("uv", new T.Attribute(new Float32Array(uv), 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }

  let shadowTex = null;
  function shadowTexture() {
    // A soft dark square: solid where the plate covers it, fading out past its edge.
    if (shadowTex) return shadowTex;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const img = g.createImageData(128, 128);
    const inner = 0.5 / (1 + 2 * SHADOW_GROW);    // the plate's half width in this square
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const d = Math.max(Math.abs((x + 0.5) / 128 - 0.5), Math.abs((y + 0.5) / 128 - 0.5));
        const t = Math.min(1, Math.max(0, (0.5 - d) / (0.5 - inner)));
        img.data[(y * 128 + x) * 4 + 3] = Math.round(255 * 0.55 * t * t * (3 - 2 * t));
      }
    }
    g.putImageData(img, 0, 0);
    shadowTex = new THREE_.Texture(c);
    shadowTex.needsUpdate = true;
    return shadowTex;
  }

  function makePlate(m) {
    const T = THREE_;
    const smat = new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    smat.map = shadowTexture();
    smat.color.setRGB(0, 0, 0);
    smat.side = 2;
    const shadow = new T.Mesh(sheet(m, SHADOW_ALT, SHADOW_GROW, 0.025), smat);
    shadow.renderOrder = 9;
    shadow.visible = false;
    globe.scene().add(shadow);
    const geo = sheet(m, PLATE_ALT, 0);
    const mat = new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    mat.side = 2;                  // DoubleSide: the winding then cannot hide it
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -4;
    mat.polygonOffsetUnits = -4;
    const mesh = new T.Mesh(geo, mat);
    mesh.renderOrder = 10;
    mesh.visible = false;
    globe.scene().add(mesh);
    plates.set(m.id, { m, mesh, mat, shadow, smat, tex: { lo: null, hi: null }, loading: { lo: false, hi: false } });
  }

  function loadPlate(p, which) {
    if (p.tex[which] || p.loading[which]) return;
    p.loading[which] = true;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      p.loading[which] = false;
      const tex = new THREE_.Texture(img);
      tex.colorSpace = THREE_.colorSpace;
      tex.anisotropy = globe.renderer().capabilities.getMaxAnisotropy();
      tex.needsUpdate = true;
      p.tex[which] = tex;
      updatePlates();
    };
    img.onerror = () => { p.loading[which] = false; };
    img.src = which === "hi" ? p.m.plate.hi : p.m.plate.lo;
  }

  function dropHi(p) {
    // A full plate is ~85 MB on the GPU: let it go once the camera has left.
    if (!p.tex.hi) return;
    if (p.mat.map === p.tex.hi) { p.mat.map = p.tex.lo; p.mat.needsUpdate = true; }
    p.tex.hi.dispose();
    p.tex.hi = null;
  }

  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  function updatePlates() {
    if (!THREE_) initPlates();
    if (!THREE_) return;
    const pov = globe.pointOfView();
    const rad = Math.PI / 180;
    plates.forEach((p) => {
      // How big the map looks: its width over the camera's height above the ground.
      const k = p.m.extent_km / (Math.max(pov.altitude, 1e-6) * EARTH_KM);
      const fade = smooth(0.004, 0.012, k);
      // Great-circle distance from the view's centre, as a share of what is in view.
      const c = Math.sin(pov.lat * rad) * Math.sin(p.m.lat * rad) +
        Math.cos(pov.lat * rad) * Math.cos(p.m.lat * rad) * Math.cos((pov.lng - p.m.lon) * rad);
      const off = Math.acos(Math.min(1, Math.max(-1, c))) * EARTH_KM / Math.max(pov.altitude * EARTH_KM, 1);
      if (fade > 0) loadPlate(p, "lo");
      if (k > 0.06 && off < 1.5) loadPlate(p, "hi");
      else if (k < 0.03 || off > 3) dropHi(p);
      const want = p.tex.hi || p.tex.lo;
      if (want && p.mat.map !== want) { p.mat.map = want; p.mat.needsUpdate = true; }
      p.mat.opacity = want ? fade : 0;
      p.mesh.visible = p.mat.opacity > 0.001;
      p.smat.opacity = p.mat.opacity;
      p.shadow.visible = p.mesh.visible;
    });
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
    // A map flies in until its plate fills most of the view; a candidate stays regional.
    const alt = d.kind === "map" ? (d.plate ? Math.max(0.0012, (d.extent_km * 1.6) / EARTH_KM) : Math.min(0.3, Math.max(0.06, d.extent_km / 160))) : 0.35;
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
