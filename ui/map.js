// Erzeugt aus ui/map-src mit tools/build-ui.js – hier nicht bearbeiten, Änderungen in ui/map-src.
// Karte in Fahrtrichtung: Straßen aus europe-map.bin, Route (ETS2LA), Städtenamen und Orte
// aus europe-places.json, Truck-Pfeil. Dazu Abbiegehinweise aus der Routengeometrie.
(function () {
  // Städtename in der Sprache der App (ui/city-names.js); Kartendaten: [name, x, y, Einwohner, Land, token]
  function cityLabel(name, token) {
    const lang = window.CarI18n?.lang;
    if (!lang || lang === 'en' || places?.game === 'ats') return name;
    if (lang === 'zh') return window.CarCityNamesZh?.[token] || name; // Chinesisch: Tabelle von KloseY
    if (lang === 'zh-hant') return window.CarCityNamesZhHant?.[token] || window.CarCityNamesZh?.[token] || name;
    return window.CarCityNames?.[token]?.[lang] || name;
  }
  const SEGMENT_BREAK_M = 2000; // Fähre / Teleport → neue Linie
  const MIN_STEP_M = 12;
  const MAX_POINTS = 6000;

  class Trail {
    constructor() {
      this.segments = [[]];
      this.count = 0;
    }

    add(x, z) {
      let seg = this.segments[this.segments.length - 1];
      const last = seg[seg.length - 1];
      if (last) {
        const d = Math.hypot(x - last.x, z - last.z);
        if (d < MIN_STEP_M) return;
        if (d > SEGMENT_BREAK_M) {
          seg = [];
          this.segments.push(seg);
        }
      }
      seg.push({ x, z });
      if (++this.count > MAX_POINTS) {
        this.segments[0].shift();
        if (!this.segments[0].length) this.segments.shift();
        this.count--;
      }
    }
  }

  // Position zwischen zwei Telemetrie-Samples weich interpolieren
  class Pose {
    constructor() {
      this.from = null;
      this.to = null;
      this.at = 0;
    }

    update(x, z, headingDeg) {
      const now = performance.now();
      this.from = this.to ? this.current(now) : { x, z, h: headingDeg };
      this.to = { x, z, h: headingDeg };
      this.at = now;
    }

    current(now = performance.now()) {
      if (!this.to) return null;
      const t = Math.min(1, (now - this.at) / 110);
      let dh = this.to.h - this.from.h;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      return {
        x: this.from.x + (this.to.x - this.from.x) * t,
        z: this.from.z + (this.to.z - this.from.z) * t,
        h: this.from.h + dh * t,
      };
    }
  }

  // Kartenstile und Ebenen-Zeichnen: maplayers.js (auch im Hintergrund-Zeichner)
  const { STYLES, isDarkGround } = CarMapLayers;

  // Ortssymbole als kleine Piktogramme (24er-Raster wie icons.js): fill = gefüllt, stroke = Linie; Text nur für P und €
  // (Path2D erst beim ersten Zeichnen – die Tests laden map.js ohne Canvas)
  const pict = (fill, stroke) => ({ d: [fill, stroke], fill: null, stroke: null });
  const POI_STYLE = {
    g: { color: '#1a73e8', icon: pict('M5.5 4.5A1.5 1.5 0 0 1 7 3h6a1.5 1.5 0 0 1 1.5 1.5V20.5h-9zM7.5 5.5v4h5v-4z', 'M14.5 9.5h1.2a1.6 1.6 0 0 1 1.6 1.6v5a1.3 1.3 0 0 0 2.6 0V8.5L17.6 6') },
    p: { color: '#5f6368', glyph: 'P' },
    // Werkstatt: Schraubenschlüssel
    s: { color: '#e8710a', icon: pict('M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z') },
    // Händler: Lkw
    d: { color: '#9334e6', icon: pict('M2 6.5A1.5 1.5 0 0 1 3.5 5h9A1.5 1.5 0 0 1 14 6.5V9h3.3a2 2 0 0 1 1.6.8l2.7 3.6a2 2 0 0 1 .4 1.2V17a1 1 0 0 1-1 1h-1.1a2.9 2.9 0 0 1-5.8 0H9.9a2.9 2.9 0 0 1-5.8 0H3a1 1 0 0 1-1-1z') },
    // Waage
    w: { color: '#5f6368', icon: pict(null, 'M12 4v16M6 20h12M4.5 8.5h15M7.5 8.5l-3 6.5h6zM16.5 8.5l-3 6.5h6z') },
    // Fähre
    f: { color: '#1a73e8', icon: pict('M4.5 10.5h15l-1.6 5H6.1zM8 10.5v-4h8v4z', 'M3 19c1.5 1.3 3 1.3 4.5 0s3-1.3 4.5 0 3 1.3 4.5 0 3-1.3 4.5 0M12 3.5v3') },
    // Zug
    t: { color: '#5f6368', icon: pict('M7.5 3h9A2.5 2.5 0 0 1 19 5.5v9a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 14.5v-9A2.5 2.5 0 0 1 7.5 3zM7 6v4.5h10V6zM8.5 13a1.2 1.2 0 1 0 0 .1zM15.5 13a1.2 1.2 0 1 0 0 .1z', 'M8.5 21l1.8-3.5M15.5 21l-1.8-3.5') },
    // Bushaltestelle: Bus von vorn
    b: { color: '#1967d2', icon: pict('M6.5 3h11A2.5 2.5 0 0 1 20 5.5V17a1 1 0 0 1-1 1h-.5v1.5a1 1 0 0 1-2 0V18h-9v1.5a1 1 0 0 1-2 0V18H5a1 1 0 0 1-1-1V5.5A2.5 2.5 0 0 1 6.5 3zM6 6.5v5h12v-5zM7.6 13.6a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2zM16.4 13.6a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z') },
    c: { color: '#e0312b', glyph: 'cam' },
    m: { color: '#e8a400', glyph: '€' },
  };

  // Zoomstufen in Metern pro Pixel (bei 600 px Kartenhöhe); 0 = automatisch nach Tempo
  const ZOOM_LEVELS = [null, 0.35, 0.6, 1.0, 1.8, 3.2];
  // 3D: Die Karte wird in Fahrtrichtung gestaucht (geneigte Ansicht) – direkt beim Zeichnen,
  // ohne CSS-Transformation. Das bleibt scharf und kostet in der Software-Darstellung nichts extra.
  const TILT_SQUASH = 0.5;
  const TILT_TRUCK_Y = 0.76;
  // Weiche Kamerafahrt: Zeitkonstanten in Sekunden
  const SMOOTH_POSITION = 0.12;
  const SMOOTH_HEADING = 0.2;
  const SNAP_DISTANCE = 45; // m – näher an der Route wird der Pfeil auf die Route gesetzt
  const ROUTE_CELL = 250;   // m – Raster für "liegt dieser Ort an der Route?"

  // Kartendaten, Orte und Route sind global – alle Kartenansichten teilen sie
  let mapData = null;
  let places = null;
  let extraPois = [];   // gemeldete/gelernte Blitzer: ['c', x, z]
  let extraVersion = 0;
  // Fahrtenbuch: alle gefahrenen Strecken, in Stücke zu höchstens 256 Punkten mit Rahmen (nur Sichtbares zeichnen)
  let drivenChunks = [];
  let drivenVersion = 0;
  function buildDriven(track) {
    drivenChunks = [];
    drivenVersion++;
    if (!track || track.length < 4) return;
    let cur = null;
    const close = () => {
      if (cur && cur.n > 1) drivenChunks.push({ pts: cur.pts.subarray(0, cur.n * 2), x0: cur.x0, x1: cur.x1, z0: cur.z0, z1: cur.z1 });
      cur = null;
    };
    for (let i = 0; i + 1 < track.length; i += 2) {
      const x = track[i];
      const z = track[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        close();
        continue;
      }
      if (!cur) cur = { pts: new Float32Array(512), n: 0, x0: x, x1: x, z0: z, z1: z };
      cur.pts[cur.n * 2] = x;
      cur.pts[cur.n * 2 + 1] = z;
      cur.n++;
      if (x < cur.x0) cur.x0 = x;
      if (x > cur.x1) cur.x1 = x;
      if (z < cur.z0) cur.z0 = z;
      if (z > cur.z1) cur.z1 = z;
      if (cur.n === 256) {
        close();
        cur = { pts: new Float32Array(512), n: 1, x0: x, x1: x, z0: z, z1: z }; // nahtlos weiter
        cur.pts[0] = x;
        cur.pts[1] = z;
      }
    }
    close();
  }
  let lightIcons = [];  // Ampel-Kreuzungen an der Route bzw. auf unserer Straße: { x, z }
  let lightsKey = '';
  let trailerSpot = null; // abgekuppelter Anhänger { x, z } – wie im Navi des Spiels
  let routePoints = null;
  let routeCum = null;   // zurückgelegte Meter bis Punkt i
  let routeStopCache = new Map(); // Buslinie: Stadt -> Haltestelle an der Route { x, y, i } oder null (je Route neu)
  let routeStopMarks = [];        // Buslinie: Zwischenhalte, die auf der Karte markiert werden: [{ id, name }]
  let routeGrid = null;  // Rasterzelle -> Punktindizes
  let routeCities = [];  // Städte entlang der Route, nach Index sortiert
  let routePlaces = [];  // Städte und kleine Orte entlang der Route (Abgleich mit Wegweisern)
  let routeSigns = [];   // Wegweiser an der Route: { cum, names }
  let routeShields = []; // Straßennummern an der Route: { cum, label, kind }
  let routeCurves = [];  // enge Kurven der Route (Rampen, Schleifen): { start, end, radius } in Routenmetern
  let routeIndex = -1;   // Segment, auf dem der Truck zuletzt lag
  let lastSnap = null;
  let lastTruck = null; // letzte Truckposition beim Einrasten (für die aktuelle Spur)
  let lastLaneNow = null; // zuletzt erkannte Spur (Hysterese beim Spurwechsel)
  let laneHold = null; // zuletzt gezeigter Spurhinweis { route, k, la } – bleibt über Rastplatz-Zusatzspuren (01-route.js)
  let lastMetersPerPx = 1.2; // Zoom bleibt beim Neuzeichnen der Oberfläche erhalten

  function prepareRoute() {
    routeCum = null;
    routeStopCache = new Map();
    routeGrid = null;
    routeCities = [];
    routePlaces = [];
    if (!routePoints) return;
    const n = routePoints.length;
    routeCum = new Float64Array(n);
    routeGrid = new Map();
    for (let i = 0; i < n; i++) {
      const p = routePoints[i];
      const prev = i > 0 ? routePoints[i - 1] : null;
      routeCum[i] = i === 0 ? 0 : routeCum[i - 1] + (p && prev ? Math.hypot(p.x - prev.x, p.y - prev.y) : 0);
      if (!p) continue;
      const key = `${Math.floor(p.x / ROUTE_CELL)}|${Math.floor(p.y / ROUTE_CELL)}`;
      if (!routeGrid.has(key)) routeGrid.set(key, []);
      routeGrid.get(key).push(i);
    }
    prepareRouteCities();
    computeRouteTurns();
    computeRouteCurves();
  }

  // Enge Kurven entlang der Route aus dem Radius durch drei Punkte (je 15 m davor/danach). Für die Kurvenwarnung
  // (Einstellung curveWarn): Kurven unter 150 m Radius, zusammengefasst mit dem kleinsten Radius.
  function computeRouteCurves() {
    routeCurves = [];
    if (!routePoints || !routeCum) return;
    const n = routePoints.length;
    let lo = 0;
    let hi = 0;
    let cur = null;
    for (let i = 0; i < n; i++) {
      const b = routePoints[i];
      if (!b) { cur = null; continue; }
      while (lo < i && routeCum[i] - routeCum[lo] > 15) lo++;
      while (hi < n - 1 && routeCum[hi] - routeCum[i] < 15) hi++;
      const a = routePoints[lo];
      const c = routePoints[hi];
      let radius = Infinity;
      if (a && c && lo < i && hi > i) {
        const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), ca = Math.hypot(a.x - c.x, a.y - c.y);
        const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
        if (area2 > 1e-6) radius = (ab * bc * ca) / (2 * area2);
      }
      if (radius < 150) {
        if (cur && routeCum[i] - cur.end < 20) { cur.end = routeCum[i]; cur.radius = Math.min(cur.radius, radius); }
        else routeCurves.push((cur = { start: routeCum[i], end: routeCum[i], radius }));
      } else if (cur && routeCum[i] - cur.end > 20) cur = null;
    }
    // Ausreißer (ein einzelner Knick an einem Stoß der Linie) zählen nicht: mindestens 20 m Kurve
    routeCurves = routeCurves.filter((k) => k.end - k.start >= 20);
  }

  function prepareRouteCities() {
    routeCities = [];
    routePlaces = [];
    if (!routePoints || !places) return;
    // Nächster Routenpunkt (jeder vierte, Manhattan-Abstand unter maxD) – über ein grobes Raster statt über alle Punkte:
    // bei langen Routen (Hunderttausende Punkte) mal Tausende Orte hing die Oberfläche sonst sekundenlang
    const CELL = 1000;
    const grid = new Map();
    for (let i = 0; i < routePoints.length; i += 4) {
      const p = routePoints[i];
      if (!p) continue;
      const key = `${Math.floor(p.x / CELL)}|${Math.floor(p.y / CELL)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
    const nearest = (x, y, maxD) => {
      let best = null;
      const r = Math.ceil(maxD / CELL);
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          for (const i of grid.get(`${cx + dx}|${cy + dy}`) || []) {
            const p = routePoints[i];
            const d = Math.abs(p.x - x) + Math.abs(p.y - y);
            if (d < maxD && (!best || d < best.d || (d === best.d && i < best.i))) best = { d, i };
          }
        }
      }
      return best;
    };
    for (const [name, x, y] of places.cities) {
      const best = nearest(x, y, 3500);
      if (best) routeCities.push({ name, index: best.i });
    }
    routeCities.sort((a, b) => a.index - b.index);
    // Kleine Orte (Schildziele, Dörfer) an der Route – nur für den Abgleich mit den Wegweisern: steht ein Ort vom
    // Schild vor der Abbiegung weiter auf der Route, ist das unsere Richtung. Ziel und „nächste Stadt“ bleiben Städte.
    routePlaces = routeCities.slice();
    for (const [name, x, y] of places.towns || []) {
      const best = nearest(x, y, 2000);
      if (best) routePlaces.push({ name, index: best.i, town: true });
    }
    routePlaces.sort((a, b) => a.index - b.index);
    // Wegweiser und Straßennummern an der Route (für „Ausfahrt rechts · A9 München“), nach Routenmeter sortiert
    routeSigns = [];
    routeShields = [];
    if (!routeCum || !routeGrid) return;
    // Schilder, die klar entgegen der Fahrtrichtung blicken (Gegenfahrbahn, die gerade verlassene Autobahn), gehören nicht
    // zu unserer Richtung (signDirs, neuere Kartendaten) – quer stehende (Kreuzungen, Rampen) bleiben
    const dirs = Array.isArray(places.signDirs) && places.signDirs.length === (places.signs || []).length ? places.signDirs : null;
    (places.signs || []).forEach(([x, y, ...names], k) => {
      const hit = nearestOnRoute(x, y, 35);
      if (!hit) return;
      const deg = dirs ? dirs[k] : null;
      if (deg != null) {
        const a = routePoints[Math.max(0, hit.i - 3)];
        const b = routePoints[Math.min(routePoints.length - 1, hit.i + 3)];
        if (a && b && (a.x !== b.x || a.y !== b.y)) {
          const off = Math.abs(angleDelta(Math.atan2(b.y - a.y, b.x - a.x), (deg * Math.PI) / 180));
          if (off > (120 * Math.PI) / 180) return;
        }
      }
      routeSigns.push({ cum: routeCum[hit.i], names });
    });
    for (const [label, x, y, kind] of places.shields || []) {
      const hit = nearestOnRoute(x, y, 30);
      if (hit) routeShields.push({ cum: routeCum[hit.i], label, kind });
    }
    routeSigns.sort((a, b) => a.cum - b.cum);
    routeShields.sort((a, b) => a.cum - b.cum);
    for (const t of routeTurns) delete t.sign;
  }

  // Wegweiser zu einer Abbiegung. Schilder davor zeigen alle Richtungen; unsere ist die, deren Ziele auch auf den
  // Schildern hinter der Abbiegung stehen (Bestätigungstafeln der neuen Straße) – sonst ein Ziel, das als Stadt auf
  // der weiteren Route liegt. Straßennummer: erstes Kartenschild bis 1,5 km dahinter, nur bei Ausfahrten/Gabelungen
  // und nur Autobahn/Europastraße (in der Stadt läge sonst die Nummer einer nahen Autobahn daneben).
  // Ergebnis (zwischengespeichert an der Abbiegung): { towards, road, roadKind } oder null
  function turnSign(t) {
    if (t.sign !== undefined) return t.sign;
    // Himmelsrichtungen und Schilderwörter sind kein Ziel („I-25 SOUTH“ – sonst hieß es „Richtung SOUTH“)
    // dazu Wörter der US-Verkehrsschilder (EXIT, LANE, SPEED, MINIMUM, ENTERING …) – sonst hieß es „Richtung MAXIMUM“
    const NOT_TOWARDS = /^(north|south|east|west|[nsew]b|nord|süd|ost|jct|junction|exits?|to|only|truck route|business|bus|miles?|right|left|lanes?|next|ramp|road|ahead|trucks?|entering|st|ave|rd|blvd|bridge|no|pop|lodging|food|gas|speed( limit)?|limit|elev|vehicles|turn|stop|ends?|for|emergency|before|signal|entry|minimum|maximum|slow|ices|area|traffic|highway|station|not|over|or|and|begin|reduced|keep|yield|merge|use|all|loop|frontage|rest area|weigh station|scale|open|closed|night|day|tons?|limits|city limits)$/i;
    // Bundesstaaten auf US-Schildern („NEW MEXICO“, Willkommensschild) sind auch kein Ziel
    const STATES = /^(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)$/i;
    // Schilder auf Firmengeländen (MAIN OFFICE, P.S. BUILDING, Wareneingang) sind kein Ziel
    const YARD = /\b(office|building|entrance|gate|docks?|warehouse|shipping|receiving|visitors?|employees?|deliveries|loading|maintenance|parking)\b/i;
    // Ziele beginnen nie mit einer Zahl (Durchfahrtshöhe „19 FT. 8 IN.“, Entfernungen)
    const split = (n) => n.split('/').map((p) => p.trim())
      .filter((p) => p.length > 1 && !/^\d/.test(p) && !NOT_TOWARDS.test(p) && !YARD.test(p) && !(p === p.toUpperCase() && STATES.test(p)));
    const before = new Map(); // klein -> Schreibweise auf dem Schild
    for (const s of routeSigns) {
      if (s.cum < t.cum - 1500) continue;
      if (s.cum > t.cum + 30) break;
      for (const n of s.names) for (const p of split(n)) before.set(p.toLowerCase(), p);
    }
    let towards = '';
    if (before.size) {
      for (const s of routeSigns) {
        if (s.cum <= t.cum + 30) continue;
        if (s.cum > t.cum + 10000) break;
        const hit = s.names.flatMap(split).find((p) => before.has(p.toLowerCase()));
        if (hit) { towards = before.get(hit.toLowerCase()); break; }
      }
      if (!towards) {
        const same = (sign, city) => {
          const c = city.toLowerCase();
          const k = Math.min(c.length, 6);
          return sign.startsWith(c.slice(0, k)) || c.startsWith(sign.slice(0, k));
        };
        for (const c of routePlaces) {
          if (c.index <= t.index) continue;
          const hit = [...before.keys()].find((n) => same(n, c.name));
          if (hit) { towards = before.get(hit); break; }
        }
      }
    }
    const motorwayTurn = t.kind === 'exit' || t.kind === 'slight';
    const sh = motorwayTurn ? routeShields.find((s) => s.cum > t.cum + 10 && s.cum < t.cum + 1500 && s.kind !== 'n') : null;
    t.sign = towards || sh ? { towards, road: sh ? sh.label : '', roadKind: sh ? sh.kind : '' } : null;
    return t.sign;
  }

  // Nächster Routenpunkt zu (x, y) über das Raster; null, wenn weiter als maxDist entfernt
  function nearestOnRoute(x, y, maxDist = ROUTE_CELL) {
    if (!routeGrid) return null;
    const cx = Math.floor(x / ROUTE_CELL);
    const cy = Math.floor(y / ROUTE_CELL);
    let best = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of routeGrid.get(`${cx + dx}|${cy + dy}`) || []) {
          const p = routePoints[i];
          const d = Math.hypot(p.x - x, p.y - y);
          if (d <= maxDist && (!best || d < best.d)) best = { i, d };
        }
      }
    }
    return best;
  }

  // Fahrtrichtung aus der Bewegung (nur bei Fahrt: 15 m in unter 3 s, also über ~18 km/h)
  let motionRef = null;
  let motion = null;
  function updateMotion(x, y) {
    const now = performance.now();
    if (!motionRef) { motionRef = { x, y, at: now }; return; }
    const d = Math.hypot(x - motionRef.x, y - motionRef.y);
    if (d >= 15) {
      motion = now - motionRef.at < 3000 ? { dx: (x - motionRef.x) / d, dy: (y - motionRef.y) / d } : null;
      motionRef = { x, y, at: now };
    } else if (now - motionRef.at > 3000) {
      motion = null;
      motionRef = { x, y, at: now };
    }
  }

  // Nächsten Punkt auf der Route finden (bevorzugt in der Nähe des letzten Treffers)
  function snapToRoute(x, y) {
    if (!routePoints) return null;
    updateMotion(x, y);
    const n = routePoints.length;
    // Zuletzt gegen die Fahrtrichtung zugeordnet (vor dem ersten Bewegungswert): wieder auf der ganzen Route suchen
    if (motion && routeIndex >= 0 && routePoints[routeIndex] && routePoints[routeIndex + 1]) {
      const a = routePoints[routeIndex];
      const b = routePoints[routeIndex + 1];
      if (motion.dx * (b.x - a.x) + motion.dy * (b.y - a.y) < -0.5 * Math.hypot(b.x - a.x, b.y - a.y)) routeIndex = -1;
    }
    const from = routeIndex >= 0 ? Math.max(0, routeIndex - 40) : 0;
    const to = routeIndex >= 0 ? Math.min(n - 1, routeIndex + 600) : n - 1;
    let best = null;
    for (let i = from; i < to; i++) {
      const a = routePoints[i];
      const b = routePoints[i + 1];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      // In Fahrt nie auf ein Stück gegen die Fahrtrichtung setzen: Fährt man nach dem Laden in die falsche Richtung,
      // führt die neue Route bis zur nächsten Wendemöglichkeit und auf der Gegenfahrbahn zurück – dieser Rückweg
      // liegt direkt neben dem Lkw und zeigte sonst „Der Route folgen“ mit wachsender Entfernung
      if (motion && (motion.dx * dx + motion.dy * dy) < -0.5 * Math.hypot(dx, dy)) continue;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const d = Math.hypot(x - px, y - py);
      // Unter Brücken liegt eine spätere Stelle der Route (die Brücke darüber) genauso nah: Sprünge entlang der Route
      // kosten – 100 m weiter zählen wie 5 m daneben
      const jump = routeIndex >= 0 && routeCum ? Math.abs(routeCum[i] - routeCum[routeIndex]) * 0.05 : 0;
      if (!best || d + jump < best.score) best = { x: px, y: py, d, i, t, score: d + jump };
    }
    if (best) lastTruck = { x, y };
    if (best && best.d < SNAP_DISTANCE) {
      routeIndex = best.i;
      lastSnap = best;
      return best;
    }
    if (routeIndex >= 0 && best && best.d > SNAP_DISTANCE * 4) routeIndex = -1; // abgebogen → später neu suchen
    lastSnap = null;
    return null;
  }

  // Kürzester Winkelabstand (Radiant)
  function angleDelta(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // ------------------------------------------------------------------ Abbiegehinweise
  // Einmal pro Route berechnet, auf einem festen 10-m-Raster entlang der Strecke. Früher wurde ab der
  // Truckposition neu abgetastet – das Raster wanderte mit, und kleine Zickzacks in Kreuzungen
  // (Knoten auf verschiedenen Spuren) wechselten ständig zwischen „links“ und „rechts“.
  const SAMPLE_M = 10;
  const LOOKAHEAD_M = 12000;
  const NEAR = 5;  // Stützstellen (50 m): Richtung direkt am Knick
  const FAR = 12;  // Stützstellen (120 m): Richtung der Straße vor und nach dem Knick
  // Routenpunkte liegen auf Straßen höchstens 600 m auseinander (längere Stücke bleiben gerade); weiter nur über eine Fähre
  const JUMP_M = 600;
  // Fährlinie: beide Enden an einem Fährhafen (places.ferries: [Art, x0, y0, …, x1, y1])
  function ferryBetween(a, b) {
    const ends = [];
    for (const f of (places && places.ferries) || []) ends.push([f[1], f[2]], [f[f.length - 2], f[f.length - 1]]);
    const atPort = (p) => ends.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 60);
    return atPort(a) && atPort(b);
  }
  let routeTurns = [];

  function classify(delta) {
    const a = Math.abs(delta) * 180 / Math.PI;
    const side = delta > 0 ? 'left' : 'right'; // 修正：原角度判定的左右是反的（与游戏数据一致）
    if (a < 28) return null;
    if (a < 55) return { kind: 'slight', side };
    if (a < 130) return { kind: 'turn', side };
    if (a < 165) return { kind: 'sharp', side };
    return { kind: 'uturn', side: 'left' };
  }

  // Route in zusammenhängende Stücke teilen (Lücken = unbekannte Knoten) und gleichmäßig abtasten
  function sampleRoute() {
    const runs = [];
    let run = null;
    for (let i = 0; i < routePoints.length; i++) {
      const p = routePoints[i];
      if (!p) { run = null; continue; }
      if (!run) {
        run = [{ x: p.x, y: p.y, cum: routeCum[i], i }];
        runs.push(run);
        continue;
      }
      const last = run[run.length - 1];
      const a = routePoints[i - 1];
      const segStart = routeCum[i - 1];
      const segLen = routeCum[i] - segStart;
      // Fähre (oder Sprung): neue Linie – der Knick zwischen Straße und Fährlinie ist keine Abbiegung
      if (segLen > JUMP_M) {
        run = [{ x: p.x, y: p.y, cum: routeCum[i], i }];
        runs.push(run);
        continue;
      }
      // nächste Rasterstelle nach der letzten Stützstelle
      for (let c = last.cum + SAMPLE_M; c <= routeCum[i] + 1e-6; c += SAMPLE_M) {
        const t = segLen > 0 ? (c - segStart) / segLen : 1;
        run.push({ x: a.x + (p.x - a.x) * t, y: a.y + (p.y - a.y) * t, cum: c, i });
      }
    }
    return runs;
  }

  // Kreuzung an der Abbiegung: genaue Spurregel (welche Einfahrspuren in die Ausfahrt führen)
  function junctionAt(index) {
    for (let j = index; j >= 0 && routeCum[index] - routeCum[j] < 120; j--) if (routePoints[j]?.junction) return routePoints[j].junction;
    for (let j = index + 1; j < routePoints.length && routeCum[j] - routeCum[index] < 60; j++) if (routePoints[j]?.junction) return routePoints[j].junction;
    return null;
  }

  // Spuren der Straße kurz vor einer Abbiegung
  function lanesBefore(index) {
    for (let j = index; j >= 0 && routeCum[index] - routeCum[j] < 300; j--) {
      const p = routePoints[j];
      if (p && p.lanes) return p.lanes;
    }
    return 0;
  }

  function routeSlice(fromCum, toCum) {
    const out = [];
    let lo = 0;
    let hi = routeCum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (routeCum[mid] < fromCum) lo = mid + 1;
      else hi = mid;
    }
    for (let i = Math.max(1, lo); i < routePoints.length && routeCum[i - 1] <= toCum; i++) {
      const a = routePoints[i - 1];
      const b = routePoints[i];
      if (!a || !b) { if (out.length) break; continue; }
      const segLen = routeCum[i] - routeCum[i - 1] || 1;
      const t0 = Math.max(0, (fromCum - routeCum[i - 1]) / segLen);
      const t1 = Math.min(1, (toCum - routeCum[i - 1]) / segLen);
      if (t1 < 0 || t0 > 1) continue;
      if (!out.length) out.push({ x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 });
      out.push({ x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 });
    }
    return out;
  }

  // Geometrie + Kreuzungsdaten zusammenführen:
  // - Geben die Spuren der Kreuzung nur eine Seite frei, gilt diese Seite (Ausfahrt rechts, deren Rampe danach
  //   nach links schwenkt, ist „rechts halten“ – nicht „links abbiegen“).
  // - Leichte Richtungswechsel ohne Kreuzung sind nur Kurven der Straße und werden nicht angesagt.
  function decide(type, junction) {
    if (!type) return null;
    if (!junction) return type.kind === 'slight' ? null : type;
    const [count, mask] = junction;
    const all = (1 << count) - 1;
    if (count < 2 || !mask || (mask & all) === all) return type;
    const left = (mask & 1) !== 0;
    const right = (mask & (1 << (count - 1))) !== 0;
    const laneSide = left && !right ? 'left' : right && !left ? 'right' : null;
    // Spuren widersprechen der Geometrie: nur bei Schleifen (Kleeblatt: rechts raus, dann links herum) und leichten Knicken
    // der Spur folgen. Eine normale Abbiegung (55–130°, z. B. Stadtkreuzung) zeigt immer die echte Richtung.
    if (laneSide && laneSide !== type.side && type.kind !== 'turn') return { kind: 'slight', side: laneSide };
    return type;
  }

  // Wert eines Merkmals der Routenpunkte (rb: Ausfahrt im Kreisverkehr, cont: Fortsetzung) im Umkreis der Stelle
  function flagNear(index, key, before, after) {
    for (let j = index; j >= 0 && routeCum[index] - routeCum[j] < before; j--) if (routePoints[j]?.[key]) return routePoints[j][key];
    for (let j = index + 1; j < routePoints.length && routeCum[j] - routeCum[index] < after; j++) if (routePoints[j]?.[key]) return routePoints[j][key];
    return 0;
  }

  // Abbiegen laut Kreuzungsdaten (Feld jt) an der nächstgelegenen Kreuzung im Umkreis: [Art, Seite], 'none' oder ''
  function junctionTurnNear(index, before, after) {
    let best = '';
    let bestD = Infinity;
    for (let j = index; j >= 0 && routeCum[index] - routeCum[j] < before; j--) {
      const v = routePoints[j]?.jt;
      if (v && routeCum[index] - routeCum[j] < bestD) { best = v; bestD = routeCum[index] - routeCum[j]; }
    }
    for (let j = index + 1; j < routePoints.length && routeCum[j] - routeCum[index] < after; j++) {
      const v = routePoints[j]?.jt;
      if (v && routeCum[j] - routeCum[index] < bestD) { best = v; bestD = routeCum[j] - routeCum[index]; }
    }
    return best;
  }

  // Liegt eine Kreuzung mit Abzweigung höchstens 80 m vor oder 60 m nach dieser Stelle?
  function branchNear(index, before = 80, after = 60) {
    for (let j = index; j >= 0 && routeCum[index] - routeCum[j] < before; j--) if (routePoints[j]?.branch) return true;
    for (let j = index + 1; j < routePoints.length && routeCum[j] - routeCum[index] < after; j++) if (routePoints[j]?.branch) return true;
    return false;
  }

  function computeRouteTurns() {
    routeTurns = [];
    if (!routePoints || !routeCum) return;
    // Mit Kreuzungsdaten: Knicke ohne Abzweigung in der Nähe sind Kurven der Straße, keine Abbiegungen
    const knowsBranches = routePoints.some((p) => p?.branch);
    const knowsTurns = routePoints.some((p) => p?.jt); // Abbiegedaten der Kreuzungen (neuere Karten)
    const dir = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
    for (const s of sampleRoute()) {
      if (s.length < FAR * 2 + 1) continue;
      const near = new Float64Array(s.length);
      for (let k = NEAR; k < s.length - NEAR; k++) near[k] = angleDelta(dir(s[k - NEAR], s[k]), dir(s[k], s[k + NEAR]));
      for (let k = FAR; k < s.length - FAR; k++) {
        const d = Math.abs(near[k]);
        if (d < (20 * Math.PI) / 180) continue;
        // nur das Maximum im Umkreis von ±8 Stützstellen
        let isPeak = true;
        for (let j = Math.max(NEAR, k - 8); j <= Math.min(s.length - NEAR - 1, k + 8) && isPeak; j++) {
          if (Math.abs(near[j]) > d || (Math.abs(near[j]) === d && j < k)) isPeak = false;
        }
        if (!isPeak) continue;
        // Richtung der Straße 120–40 m vor und 40–120 m nach dem Knick: Spurwechsel heben sich auf
        const total = angleDelta(dir(s[k - FAR], s[k - 4]), dir(s[k + 4], s[k + FAR]));
        if (Math.sign(total) !== Math.sign(near[k])) continue;
        const j = junctionAt(s[k].i);
        // nur an Kreuzungen, durch die die Route führt – Spurdaten einer Kreuzung bis 120 m zurück reichen nicht
        // (sonst wird die Kurve einer Auffahrt-Schleife zum Abbiegen)
        if (knowsBranches && !branchNear(s[k].i)) continue;
        // Kreisverkehr: eigene Ansage (unten); Fortsetzung: die Straße geht an der Kreuzung einfach weiter
        if (flagNear(s[k].i, 'rb', 40, 120)) continue;
        if (!j && flagNear(s[k].i, 'cont', 80, 60)) continue;
        // Blinker der KI an dieser Kreuzung (aus den Spieldaten): keiner = die Straße geht weiter, kein Abbiegen.
        // Blinkt sie zur anderen Seite als der Knick (Kleeblatt: rechts raus, dann links herum), gilt der Blinker.
        const bl = flagNear(s[k].i, 'bl', 80, 60);
        if (bl === '-') continue;
        // Kreuzungsdaten: „weiter der Straße nach“ – kein Abbiegen, auch wenn die Linie knickt
        let jt = junctionTurnNear(s[k].i, 80, 60);
        // Knick neben einer Kreuzung (die Straße biegt kurz davor oder danach ab, der Knick selbst liegt in keiner
        // Kreuzung): sagt die nächste Kreuzung bis 160 m davor / 100 m danach „weiter der Straße nach“, ist es nur die
        // Kurve der Straße. Eine echte Abbiegung dort ergänzen die Kreuzungsdaten weiter unten ohnehin.
        if (!jt && !routePoints[s[k].i]?.branch && junctionTurnNear(s[k].i, 160, 100) === 'none') jt = 'none';
        if (jt === 'none') continue;
        // Mit Abbiegedaten: ein Knick außerhalb jeder Kreuzung ohne Abbiegung in der Nähe ist eine Kurve von Straße oder
        // Rampe (Kleeblatt-Schleife: sonst „Wenden“ mitten in der Rampe) – die Abbiegung kommt aus den Kreuzungsdaten
        // In einer Kreuzung ohne Wahl (keine Abbiegedaten für diesen Weg) bleibt nur ein normales Abbiegen (Rampenende mit
        // nur einer Richtung) – eine Schleife (Auffahrt im Kleeblatt) braucht keine Ansage
        if (knowsTurns && !Array.isArray(jt) && (!routePoints[s[k].i]?.branch || Math.abs(total) > (130 * Math.PI) / 180)) continue;
        // Knick außerhalb einer Kreuzung: nur, wenn die abbiegende Kreuzung direkt daneben liegt (±40 m) – eine Rampe, die
        // in eine Kreuzung mündet, wäre sonst „Wenden“ kurz vor dem eigentlichen Abbiegen
        if (knowsTurns && !routePoints[s[k].i]?.branch && !Array.isArray(junctionTurnNear(s[k].i, 40, 40))) continue;
        let type = decide(classify(total), j);
        if (type && (bl === 'l' || bl === 'r') && type.side !== (bl === 'r' ? 'right' : 'left')) type = { kind: 'slight', side: bl === 'r' ? 'right' : 'left' };
        if (!type) continue;
        const prev = routeTurns[routeTurns.length - 1];
        if (prev && s[k].cum - prev.cum < 60) {
          // zwei Knicke dicht hintereinander (z. B. Kreisverkehr): den stärkeren behalten
          if (Math.abs(total) > Math.abs(prev.angle)) routeTurns[routeTurns.length - 1] = { ...decide(classify(total), prev.junction || j), cum: s[k].cum, index: s[k].i, angle: total, lanes: prev.lanes, junction: prev.junction || j };
          continue;
        }
        routeTurns.push({ ...type, cum: s[k].cum, index: s[k].i, angle: total, lanes: lanesBefore(s[k].i), junction: j });
      }
    }
    // Abbiegungen aus den Kreuzungsdaten, die die Linie nicht zeigt (kurze Stücke, Lücken, Routenende auf Firmengelände):
    // je Kreuzung einmal, in der Mitte des Kreuzungsstücks, wenn dort noch keine Abbiegung erkannt ist
    const jtPieces = []; // [Anfang, Ende (Routenmeter), erster Punkt, letzter Punkt, Abbiegung]
    for (let i = 1; i < routePoints.length; i++) {
      const jt = routePoints[i]?.jt;
      if (!Array.isArray(jt) || routePoints[i - 1]?.jt === jt) continue;
      let end = i;
      while (end + 1 < routePoints.length && routePoints[end + 1]?.jt === jt) end++;
      jtPieces.push([routeCum[i - 1], routeCum[end], i, end, jt]);
    }
    const inPiece = (t) => jtPieces.some(([from, to]) => t.cum >= from - 5 && t.cum <= to + 5);
    // Knicke neben einer Kreuzung, die eine Kreuzung schon übernommen hat: Abbiegung -> [Mitte, Punkt] dieses Kreuzungsstücks
    const claimed = new Map();
    for (const [from, to, i, end, jt] of jtPieces) {
      const mid = (routeCum[i] + routeCum[end]) / 2;
      let at = i;
      while (at < end && routeCum[at] < mid) at++;
      if (routePoints[at]?.rb) continue; // Kreisverkehr: eigene Ansage
      // schon erkannt: eine Abbiegung innerhalb dieses Kreuzungsstücks (nicht „in der Nähe“ – in der Stadt liegen
      // Kreuzungen oft keine 50 m auseinander, „links, dann gleich rechts“ sind zwei Abbiegungen). Dazu ein Knick bis
      // 40 m davor oder danach, der in keinem Kreuzungsstück liegt (Rampe, die in die Kreuzung mündet) – sonst hieße es
      // „Wenden“ und gleich danach noch einmal „rechts abbiegen“
      const inside = routeTurns.find((t) => t.cum >= from - 5 && t.cum <= to + 5);
      let near = inside || routeTurns.find((t) => t.kind !== 'roundabout' && t.cum >= from - 40 && t.cum <= to + 40 && !inPiece(t));
      // Derselbe Knick liegt zwischen zwei abbiegenden Kreuzungen (zweimal rechts um einen Block: die Linie sieht nur einen
      // großen Knick, „Wenden“): er gehört der ersten – an ihre Stelle gesetzt –, diese Kreuzung bekommt eine eigene Abbiegung.
      // Vorher übernahmen beide denselben Knick, die zweite Abbiegung fehlte (Antwerpen, Deurne-Noord: nach dem ersten
      // Rechts stand schon die übernächste Abbiegung da)
      if (!inside && near && claimed.has(near)) {
        const [c, idx] = claimed.get(near);
        near.cum = c;
        near.index = idx;
        near = null;
      }
      if (near && !inside) claimed.set(near, [mid, at]);
      if (near) {
        // erkannt: Art und Seite aus den Kreuzungsdaten (Fahrkurven, Abzweigwinkel, Blinker der KI) – die Linie sieht
        // nur den Knick, bei Kleeblatt-Ausfahrten also „scharf rechts“ statt „Ausfahrt rechts“
        // piece: Kreuzungsstück (Routenmeter) – der Spurhinweis dort gehört zu dieser Abbiegung, auch wenn der Knick daneben liegt
        if (near.kind !== 'roundabout') Object.assign(near, { kind: jt[0], side: jt[1], lanes: Math.max(near.lanes || 0, lanesBefore(Math.max(0, i - 1))), piece: [from, to] });
        continue;
      }
      routeTurns.push({ kind: jt[0], side: jt[1], cum: mid, index: at, angle: 0, lanes: lanesBefore(Math.max(0, i - 1)), junction: junctionAt(at), piece: [from, to] }); // Spuren vor der Kreuzung, nicht mittendrin
    }
    routeTurns.sort((a, b) => a.cum - b.cum);
    // Abzweigungen, die kaum knicken (Ausfahrt nach rechts, Gabelung): die Geometrie sieht sie nicht, die Spuren schon.
    // Nur bei mindestens 3 Spuren, von denen höchstens die Hälfte (alle am Rand) in unsere Richtung führt –
    // so wird Geradeausfahren neben einer Abbiegespur in der Stadt nicht zu „halten“.
    for (let i = 1; i < routePoints.length; i++) {
      const p = routePoints[i];
      if (!p?.junction) continue;
      const [count, mask] = p.junction;
      if (count < 3 || !mask) continue;
      let used = 0;
      for (let b = 0; b < count; b++) if (mask & (1 << b)) used++;
      if (used * 2 > count) continue;
      const left = (mask & 1) !== 0;
      const right = (mask & (1 << (count - 1))) !== 0;
      if (left === right) continue;
      const cum = routeCum[i];
      if (routeTurns.some((t) => Math.abs(t.cum - cum) < 120) || flagNear(i, 'rb', 40, 120)) continue;
      routeTurns.push({ kind: 'slight', side: right ? 'right' : 'left', cum, index: i, angle: 0, lanes: lanesBefore(i), junction: p.junction });
    }
    // Kreisverkehre aus den Kreuzungsdaten (nicht aus Knicken – geradeaus hindurch knickt die Route kaum):
    // Ansage an der Einfahrt mit der Nummer der Ausfahrt, Pfeil zur Seite, in die es insgesamt weitergeht
    for (let i = 1; i < routePoints.length; i++) {
      const p = routePoints[i];
      if (!p?.rb || routePoints[i - 1]?.rb === p.rb) continue;
      let end = i;
      while (end + 1 < routePoints.length && routePoints[end + 1]?.rb === p.rb) end++;
      const at = (cum) => {
        let k = i;
        while (k > 0 && routeCum[k] > cum) k--;
        while (k < routePoints.length - 1 && routeCum[k] < cum) k++;
        return routePoints[k];
      };
      const a = at(routeCum[i - 1] - 40), b = routePoints[i - 1], c = routePoints[end], d = at(routeCum[end] + 40);
      const total = a && b && c && d ? angleDelta(Math.atan2(b.y - a.y, b.x - a.x), Math.atan2(d.y - c.y, d.x - c.x)) : 0;
      const side = Math.abs(total) < (25 * Math.PI) / 180 ? 'straight' : total > 0 ? 'left' : 'right';
      // endCum: Ausfahrt – die Anzeige bleibt im Kreisverkehr stehen und zählt bis dorthin herunter
      routeTurns.push({ kind: 'roundabout', side, exit: p.rb, cum: routeCum[i - 1], endCum: routeCum[end], index: i - 1, angle: total, lanes: 0, junction: null });
    }
    // Fähre: eigene Ansage am Anleger („Fähre nehmen“); Knicke dort davor gehören zur Auffahrt auf die Fähre
    for (let i = 1; i < routePoints.length; i++) {
      const a = routePoints[i - 1];
      const b = routePoints[i];
      if (!a || !b || routeCum[i] - routeCum[i - 1] <= JUMP_M || !ferryBetween(a, b)) continue;
      for (let k = routeTurns.length - 1; k >= 0; k--) if (Math.abs(routeTurns[k].cum - routeCum[i - 1]) < 40) routeTurns.splice(k, 1);
      routeTurns.push({ kind: 'ferry', side: '', cum: routeCum[i - 1], index: i - 1, angle: 0, lanes: 0, junction: null });
    }
    // Spuren und Kreuzung einer Abbiegung nicht über die vorige Abbiegung hinweg suchen: Abbiegungen dicht hintereinander
    // (Stadt: links, 70 m später rechts) bekamen sonst die Spuren der Kreuzung davor – an einer einspurigen Straße standen
    // drei Spurpfeile (Antwerpen, Rückmeldung 15.11.). Ohne eigene Angaben: keine Spurpfeile
    routeTurns.sort((a, b) => a.cum - b.cum);
    for (let k = 1; k < routeTurns.length; k++) {
      const t = routeTurns[k];
      if (t.kind === 'roundabout' || t.kind === 'ferry') continue;
      // Kreuzungsangaben stehen am Ausgang des Kreuzungsstücks (Knoten „Einfahrt|Ausfahrt“): ab dem Ende der vorigen Kreuzung
      const prevTurn = routeTurns[k - 1];
      const since = (prevTurn.piece ? Math.max(prevTurn.piece[1], prevTurn.cum) : prevTurn.cum) + 5;
      if (routeCum[t.index] - since > 300) continue; // vorige Abbiegung weit weg: die üblichen Suchweiten reichen nicht hin
      if (t.junction) {
        let own = null;
        for (let j = t.index; j >= 0 && routeCum[t.index] - routeCum[j] < 120 && routeCum[j] >= since && !own; j--) own = routePoints[j]?.junction || null;
        for (let j = t.index + 1; j < routePoints.length && routeCum[j] - routeCum[t.index] < 60 && !own; j++) own = routePoints[j]?.junction || null;
        t.junction = own;
      }
      if (t.lanes) {
        let lanes = 0;
        const from = t.piece ? Math.max(0, t.index - 1) : t.index;
        for (let j = from; j >= 0 && routeCum[from] - routeCum[j] < 300 && routeCum[j] >= since && !lanes; j--) lanes = routePoints[j]?.lanes || 0;
        t.lanes = lanes;
      }
    }
    // Ausfahrt statt „halten“ (wie die Navi-Stimme des Spiels: exit vs. keep): von einer mehrspurigen Straße seitlich
    // auf eine einspurige Rampe. Gabelungen auf mehrspurige Straßen bleiben „halten“.
    for (const t of routeTurns) if (t.kind === 'slight' && t.lanes >= 2 && lanesAfter(t.index) <= 1) t.kind = 'exit';
    // Ausfahrt laut Kreuzungsdaten, aber von einer einspurigen Straße: dort heißt das „rechts halten“
    for (const t of routeTurns) if (t.kind === 'exit' && !(t.lanes >= 2)) t.kind = 'slight';
    routeTurns.sort((a, b) => a.cum - b.cum);
  }

  // Spuren der Straße kurz nach einer Abzweigung (60–250 m danach; unbekannt = einspurig)
  function lanesAfter(index) {
    for (let j = index; j < routePoints.length && routeCum[j] - routeCum[index] < 250; j++) {
      if (routeCum[j] - routeCum[index] < 60) continue;
      const p = routePoints[j];
      if (p && p.lanes) return p.lanes;
    }
    return 1;
  }

  // Nächste Abbiegungen ab der aktuellen Position (nur Nachschlagen – stabil von Bild zu Bild)
  // headingDeg: Fahrtrichtung des Trucks (Grad wie Pose.h) – für die erste Abbiegung direkt am Start
  function computeManeuvers(headingDeg) {
    if (!routePoints || !lastSnap || !routeCum) return null;
    const base = routePoints[lastSnap.i];
    const here = routeCum[lastSnap.i] + Math.hypot(lastSnap.x - base.x, lastSnap.y - base.y);
    // Steht der Truck quer zur Route (Start am Firmengelände, Parkplatz, Tankstelle), liegt die erste Abbiegung
    // vor dem Anfang der Routenlinie und fehlt in den berechneten Abbiegungen: aus der Fahrtrichtung ergänzen.
    let startTurn = null;
    if (Number.isFinite(headingDeg) && here < 150 && !routeTurns.some((t) => t.cum > here - 20 && t.cum <= here + 100)) {
      const hr = (headingDeg / 180) * Math.PI;
      const fx = -Math.sin(hr);
      const fy = -Math.cos(hr);
      // erster Abschnitt der nächsten 100 m, der deutlich von der Fahrtrichtung abweicht (zwei Abschnitte in Folge)
      let prev = null;
      for (let k = lastSnap.i; k + 1 < routePoints.length && routePoints[k + 1] && routeCum[k] - here < 100; k++) {
        const a0 = routePoints[k];
        const a1 = routePoints[k + 1];
        const dx = a1.x - a0.x;
        const dy = a1.y - a0.y;
        if (Math.hypot(dx, dy) < 1) continue;
        const angle = Math.atan2(fx * dy - fy * dx, fx * dx + fy * dy); // > 0: rechts
        const deg = Math.abs((angle * 180) / Math.PI);
        if (deg > 45 && prev && prev.deg > 45 && Math.sign(prev.angle) === Math.sign(angle)) {
          startTurn = { kind: deg > 150 ? 'uturn' : deg > 120 ? 'sharp' : 'turn', side: angle > 0 ? 'left' : 'right', distance: Math.max(10, prev.cum - here), index: k, lanes: 0, junction: null, start: true }; // Wenden/Abbiegen beim Losfahren (nicht aus der Route)
          break;
        }
        prev = { deg, angle, cum: routeCum[k] };
      }
    }
    // nur bis zur nächsten Lücke voraus – dahinter ist die Route unbekannt
    let gapCum = Infinity;
    for (let i = lastSnap.i + 1; i < routePoints.length; i++) if (!routePoints[i]) { gapCum = routeCum[i - 1]; break; }
    const turns = startTurn ? [startTurn] : [];
    for (const t of routeTurns) {
      // Im Kreisverkehr (nach der Einfahrt) gilt er bis kurz vor der Ausfahrt, die Entfernung bis zur Ausfahrt
      const inside = t.kind === 'roundabout' && t.endCum > t.cum && t.cum <= here + 10 && here < t.endCum - 15;
      if ((!inside && t.cum <= here + 10) || t.cum > gapCum) continue;
      if (t.cum - here > LOOKAHEAD_M) break;
      const sign = t.kind === 'roundabout' || t.kind === 'ferry' ? null : turnSign(t);
      turns.push({ kind: t.kind, side: t.side, exit: t.exit, distance: inside ? t.endCum - here : t.cum - here, inside, index: t.index, lanes: t.lanes, junction: t.junction, piece: t.piece || null, towards: sign?.towards || '', road: sign?.road || '', roadKind: sign?.roadKind || '' });
      if (turns.length >= 2) break;
    }
    const end = routeCum[routeCum.length - 1];
    const remaining = Math.max(0, end - here);
    const turnAt = turns[0] ? here + turns[0].distance : Infinity;
    const lanesAhead = (n) => {
      if (!(n >= 2)) return Infinity;
      for (let k = lastSnap.i; k < routePoints.length && routePoints[k]; k++) {
        if (routeCum[k] - here > 1600 || routeCum[k] > turnAt + 40) break;
        if (routePoints[k].lanes === n) return Math.max(0, routeCum[k] - here);
      }
      return Infinity;
    };
    const nextCity = (afterIndex) => routeCities.find((c) => c.index > afterIndex)?.name || '';
    // Stelle etwa d Meter nach einem Routenpunkt (die Punkte liegen je nach Straße unterschiedlich dicht)
    const indexAfter = (index, d) => {
      let j = index;
      while (j < routePoints.length - 1 && routeCum[j] - routeCum[index] < d) j++;
      return j;
    };
    // Nächster Spurhinweis (vorausschauende Spurwahl, Feld la der Routenpunkte): vor der nächsten Abbiegung bis 1,5 km,
    // an Kreuzungen, an denen es geradeaus weitergeht und sich die Spuren teilen, ab 800 m
    let laneHint = null;
    const turnCum = turns[0] ? here + turns[0].distance : Infinity;
    let laneNow = null;
    const pa = routePoints[lastSnap.i];
    const pb = routePoints[lastSnap.i + 1];
    if (lastTruck && pa && pb && pa.own >= 2 && pa.lo != null) {
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
      const side = ((pb.x - pa.x) * (lastTruck.y - lastSnap.y) - (pb.y - pa.y) * (lastTruck.x - lastSnap.x)) / len; // > 0: rechts
      // Lage in Spurbreiten (0 = Mitte der linken Spur). Beim Spurwechsel erst umspringen, wenn der Truck deutlich
      // in der neuen Spur ist (sonst flackert der Punkt auf der Linie zwischen zwei Spuren)
      const pos = (pa.lo + side) / 4.5 + (pa.own - 1) / 2;
      let lane = Math.max(0, Math.min(pa.own - 1, Math.round(pos)));
      if (lastLaneNow && lastLaneNow.own === pa.own && Math.abs(pos - lastLaneNow.lane) < 0.7) lane = lastLaneNow.lane;
      laneNow = { lane, own: pa.own, pos }; // pos: Lage in Spurbreiten (0 = Mitte der linken Spur)
    }
    lastLaneNow = laneNow;
    // Nur, solange die Spuren des Hinweises ohne Unterbrechung bis zum Truck zurückreichen (Feld lz, planLanes):
    // auf Rampe, Rastplatz-Ausfahrt oder Beschleunigungsstreifen mit anderer Spurzahl noch nicht
    const zoneHere = pa?.lz ?? -1;
    const piece = turns[0]?.piece;
    // Spuren gehören zur angesagten Abbiegung: nahe an ihr oder im selben Kreuzungsstück (lange Kleeblätter)
    const atTurnK = (k) => Math.abs(routeCum[k] - turnCum) < 60 || (!!turns[0] && routePoints[turns[0].index]?.la === routePoints[k].la) || (!!piece && routeCum[k] >= piece[0] - 5 && routeCum[k] <= piece[1] + 5);
    const hintAt = (k) => {
      const la = routePoints[k].la;
      // ohne abzweigende Randspur gespeichert (07c planLanes): ist sie schon da (Truck fährt auf so vielen Spuren), voll zeigen
      const full = la[7] && laneNow && laneNow.own === la[7][0] ? la[7] : null;
      if (full) return { distance: Math.max(0, routeCum[k] - here), lanes: full[0], mask: full[1], atTurn: !!atTurnK(k), arrows: full[2] || null, view: null, laneNow, key: la[5] || null, own: false, at: { x: routePoints[k].x, y: routePoints[k].y } };
      return { distance: Math.max(0, routeCum[k] - here), lanes: la[0], mask: la[1], atTurn: !!atTurnK(k), arrows: la[3] || null, view: la[4] || null, laneNow, key: la[5] || null, own: la[6] !== 0, at: { x: routePoints[k].x, y: routePoints[k].y } };
    };
    let hintK = -1;
    for (let k = lastSnap.i; k < routePoints.length && routePoints[k]; k++) {
      const cum = routeCum[k];
      if (cum - here > 1500 || cum > turnCum + 40) break;
      const la = routePoints[k].la;
      if (!la || !la[2] || cum < here - 5) continue;
      if (zoneHere < 0 || routePoints[k].lz !== zoneHere) break;
      if (!atTurnK(k) && cum - here > 800) break;
      laneHint = hintAt(k);
      hintK = k;
      break;
    }
    // Rastplatz oder Ausfahrt, an der es geradeaus weitergeht und Spuren am Rand abzweigen (Issue #8): der Hinweis „nicht
    // abbiegen“ sagt nichts, ersetzte aber den für die Abbiegung danach – die Anzeige sprang an jedem Rastplatz zwischen
    // ⬆⇧ und ⬆⬆⇧. Weg damit, wenn nichts zu tun ist:
    //  – die abzweigenden Spuren kommen erst noch dazu (die Straße hier hat so viele Spuren wie die durchgehenden),
    //  – der Truck fährt schon auf einer durchgehenden Spur (Straße so breit wie an der Ausfahrt),
    //  – Spur unbekannt und nur eine abzweigende Spur (zwei oder mehr: könnte eine echte Teilung sein – Hinweis bleibt).
    // Fährt der Truck auf einer abzweigenden Spur, bleibt der Hinweis – dann muss er rüber.
    const onlyExtraLane = (h) => {
      if (!h || h.atTurn || !h.own || h.lanes < 3) return false; // zweispurige Teilung (eine links, eine rechts) bleibt
      let n = 0;
      for (let i = 0; i < h.lanes; i++) n += (h.mask >> i) & 1;
      const ex = h.lanes - n; // abzweigende Spuren
      const full = (1 << n) - 1;
      if (n < 1 || ex < 1 || (h.mask !== full && h.mask !== full << ex)) return false; // durchgehende zusammen am Rand
      if (laneNow && laneNow.own === h.lanes) return !!((h.mask >> laneNow.lane) & 1);
      if (laneNow && laneNow.own === n) return true;
      return ex === 1;
    };
    if (onlyExtraLane(laneHint)) {
      laneHint = null;
      hintK = -1;
    }
    // Kurz vor der Abbiegung (300 m) gleich deren Spuren zeigen, auch wenn die Abbiegespur erst noch dazukommt – wie bei
    // Google/Apple. Vorher standen bis zum Beginn der Verzögerungsspur die zwei Spuren der Strecke davor („rechts halten“)
    // und die dritte Spur erschien erst rund 100 m vor der Ausfahrt (Calais, 16.11.2026)
    if (turns[0] && turnCum - here <= 300 && !laneHint?.atTurn) {
      for (let k = lastSnap.i; k < routePoints.length && routePoints[k]; k++) {
        const cum = routeCum[k];
        if (cum > turnCum + 40) break;
        const la = routePoints[k].la;
        if (!la || !la[2] || cum < here - 5) continue;
        if (zoneHere < 0 || routePoints[k].lz !== zoneHere) break;
        if (!atTurnK(k)) continue;
        laneHint = hintAt(k);
        hintK = k;
        break;
      }
    }
    // Gezeigten Hinweis halten, solange seine Kreuzung vor dem Truck liegt: auf der Verzögerungs- und
    // Beschleunigungsspur am Rastplatz (anderer Spurbereich) verschwindet er sonst kurz
    const held = laneHold && laneHold.route === routePoints && routePoints[laneHold.k]?.la === laneHold.la ? laneHold : null;
    if (!laneHint && held && routeCum[held.k] >= here - 5 && routeCum[held.k] - here <= 1500 && routeCum[held.k] <= turnCum + 40
      && !onlyExtraLane(hintAt(held.k))) { // nicht den eben unterdrückten Rastplatz-Hinweis zurückholen
      laneHint = hintAt(held.k);
      hintK = held.k;
    }
    laneHold = hintK >= 0 ? { route: routePoints, k: hintK, la: routePoints[hintK].la } : null;
    return {
      turns,
      laneHint,
      laneNow, // { lane, own }: Spur des Trucks (0 = links) und Spuren seiner Fahrtrichtung – oder null
      remaining,
      arriving: !turns.length && remaining < LOOKAHEAD_M,
      // Wie weit voraus hat die Straße so viele Spuren wie die Kreuzung bzw. die Straße vor der Abbiegung (0 = schon jetzt)?
      // Eine Abbiegespur, die erst kurz vor der Ausfahrt dazukommt, zeigt die Oberfläche erst dort – nicht schon 1,5 km
      // vorher über Tankstellen und andere Ausfahrten hinweg
      turnLanesAt: lanesAhead(turns[0]?.junction?.[0]),
      guessLanesAt: lanesAhead(turns[0]?.lanes),
      towards: turns[0]?.towards || nextCity(turns[0] ? indexAfter(turns[0].index, 200) : indexAfter(lastSnap.i, 500)),
      road: turns[0]?.road || '', // Straßennummer nach der Abbiegung (Kartenschild)
      roadKind: turns[0]?.roadKind || '',
      // nächste enge Kurve bis 700 m voraus: Entfernung und Radius (Empfehlung rechnet die Oberfläche)
      curve: (() => {
        const k = routeCurves.find((c) => c.end > here && c.start - here < 700);
        return k ? { distance: Math.max(0, k.start - here), radius: k.radius, start: Math.round(k.start) } : null;
      })(),
      destination: routeCities.length ? routeCities[routeCities.length - 1].name : '',
    };
  }

  // ------------------------------------------------------------------ Kartenansicht
  class MapView {
    constructor(canvas, trail, pose) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.trail = trail;
      this.pose = pose;
      this.metersPerPx = lastMetersPerPx;
      this.view = null; // geglättete Kamera {x, z, heading}
      this.lastFrame = 0;
    }

    // Kamera folgt dem Truck gedämpft – Messrauschen und Sprünge beim Einrasten verschwinden
    smoothView(target, heading) {
      const now = performance.now();
      const dt = this.lastFrame ? Math.min(0.25, (now - this.lastFrame) / 1000) : 1;
      this.lastFrame = now;
      if (!this.view || Math.hypot(target.x - this.view.x, target.z - this.view.z) > 150) {
        this.view = { x: target.x, z: target.z, heading };
        return this.view;
      }
      const kp = 1 - Math.exp(-dt / SMOOTH_POSITION);
      const kh = 1 - Math.exp(-dt / SMOOTH_HEADING);
      this.view.x += (target.x - this.view.x) * kp;
      this.view.z += (target.z - this.view.z) * kp;
      this.view.heading += angleDelta(this.view.heading, heading) * kh;
      return this.view;
    }

    // options: { zoom: 0..5 (0 = auto), tilt, style, highways, labels, pois, truckY }
    draw(speedKmh, themeName, options = {}) {
      const { canvas, ctx } = this;
      const theme = (STYLES[options.style] || STYLES.google)[themeName === 'light' ? 'light' : 'dark'];
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      // Automatisch: bei höherem Tempo weiter herauszoomen (geglättet)
      let target = ZOOM_LEVELS[options.zoom || 0] ?? Math.min(3.2, 0.8 + speedKmh / 45);
      if (!options.zoom && options.turnNear) target = Math.min(target, 0.75); // vor dem Abbiegen näher ran
      this.metersPerPx += (target - this.metersPerPx) * (options.zoom ? 0.2 : 0.05);
      if (options.metersPerPx) this.metersPerPx = options.metersPerPx; // Test-Ansicht (mapview-test.html): fester Maßstab
      lastMetersPerPx = this.metersPerPx;
      const scale = (1 / this.metersPerPx) * (h / 600);
      const squash = options.tilt ? TILT_SQUASH : 1;

      const pose = this.pose.current();
      // Übersicht wie bei Google Maps: ganze restliche Route, Norden oben, flach
      if (options.overview && pose && routePoints) return this.drawOverview(pose, themeName, theme, options, w, h);
      const cx = w / 2 + (options.insetX || 0) / 2; // Mitte des sichtbaren Bereichs (ohne Seitenleiste)
      // Leiste oben/unten (insetY: + oben, − unten): Lage im sichtbaren Teil des Kartenbilds
      const iy = options.insetY || 0;
      const cy = Math.max(0, iy) + (h - Math.abs(iy)) * (options.truckY || (options.tilt ? TILT_TRUCK_Y : options.north ? 0.5 : 0.66));
      // Map Matching: auf der Route liegt der Pfeil auf der Linie statt auf der Fahrspur daneben
      const snapped = pose ? snapToRoute(pose.x, pose.z) : null;
      const view = pose ? this.smoothView(snapped ? { x: snapped.x, z: snapped.y } : pose, headingRadians(pose)) : null;
      const mapRotation = view && !options.north ? view.heading : 0;

      // Nur neu zeichnen, wenn sich sichtbar etwas geändert hat – spart im Stand fast die ganze CPU-Last
      this.showAreas = options.areas !== false;
      this.showBuildings = options.buildings !== false && this.metersPerPx < 3;
      this.showWater = options.water !== false;
      this.showInland = options.inland !== false;
      this.showForest = options.forest !== false;
      this.showMeadow = options.meadow !== false;
      this.showGround = options.ground !== false;
      this.showSites = options.sites !== false;
      this.showHiddenRoads = options.hiddenRoads === true;
      this.showLaneMarkings = options.laneMarkings === true;
      this.showSecretRoads = options.secretRoads === true;
      this.showRails = options.rails === true;
      this.showRoadClasses = options.roadClasses === true;
      const styleKey = [options.busStops !== false, options.hiddenRoads === true, options.laneMarkings === true, options.secretRoads === true, options.sites !== false, options.siteNames !== false, options.style, themeName, options.highways, options.labels, options.pois, options.radar, this.showAreas, options.shields, options.lights, this.showBuildings, this.showWater, this.showInland, this.showForest, this.showMeadow, this.showGround, options.buildings3d === true, options.viewpoints === true, options.towns === true, options.rails === true, options.roadClasses === true, options.driven ? drivenVersion : 0].join(',');
      const signature = view
        ? [view.x.toFixed(2), view.z.toFixed(2), view.heading.toFixed(4), mapRotation.toFixed(4), scale.toFixed(4), styleKey, squash, w, h, cy,
           routePoints ? routePoints.length : 0, snapped ? snapped.i : -1, mapData ? 1 : 0, places ? 1 : 0, extraVersion, lightsKey].join('|')
        : `none|${styleKey}|${w}|${h}`;
      if (signature === this.lastSignature) return;
      this.lastSignature = signature;

      ctx.fillStyle = theme.ground;
      ctx.fillRect(0, 0, w, h);

      if (pose) {
        // gestauchte Ansicht zeigt nach vorne mehr Strecke → größerer Ausschnitt
        const reach = 1 / squash;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, squash);   // 3D-Eindruck: Fahrtrichtung (oben) gestaucht
        ctx.rotate(mapRotation); // Fahrtrichtung zeigt nach oben (oder Norden im Norden-Modus)
        ctx.scale(scale, scale);
        ctx.translate(-view.x, -view.z);
        const toScreen = ctx.getTransform();
        if (mapData) {
          this.drawRoadsCached(view, w, h, scale, squash, theme, options.highways, styleKey);
          // 3D-Gebäude (Option): nur geneigt und nah – flach von oben gäbe es nichts zu sehen
          if (options.buildings3d && options.tilt && this.showBuildings && this.metersPerPx < 1.5) this.draw3dBuildings(ctx.getTransform(), view, w, h, scale, theme);
          if (options.driven) this.drawDriven(view, w, h, scale, squash);
          if (routePoints) this.drawRoute(scale, snapped ? snapped.i : 0, snapped, theme);
          else if (options.trail) this.drawTrail(scale, theme); // gefahrene Strecke nur auf Wunsch
        } else {
          this.drawGrid(view, w, h, scale, theme);
          if (options.driven) this.drawDriven(view, w, h, scale, squash);
          if (options.trail) this.drawTrail(scale, theme);
        }
        ctx.restore();
        if (places) this.drawPlaces(toScreen, view, w, h, scale, theme, options, reach);
        if (trailerSpot) this.drawTrailerMarker(toScreen, w, h);
      }
      this.drawTruck(cx, cy, Math.min(w, h * 1.4), squash, theme, view ? mapRotation - view.heading : 0);
    }

    drawOverview(pose, themeName, theme, options, w, h) {
      const { ctx } = this;
      const snapped = snapToRoute(pose.x, pose.z);
      const from = snapped ? snapped.i : 0;
      // Ausdehnung der restlichen Route (zwischengespeichert, ändert sich nur langsam)
      const bucket = Math.floor(from / 100);
      if (!this.overviewBounds || this.overviewBounds.route !== routePoints || this.overviewBounds.bucket !== bucket) {
        let x0 = pose.x, x1 = pose.x, y0 = pose.z, y1 = pose.z;
        for (let i = from; i < routePoints.length; i += 3) {
          const p = routePoints[i];
          if (!p) continue;
          if (p.x < x0) x0 = p.x;
          if (p.x > x1) x1 = p.x;
          if (p.y < y0) y0 = p.y;
          if (p.y > y1) y1 = p.y;
        }
        this.overviewBounds = { route: routePoints, bucket, x0, x1, y0, y1 };
      }
      const b = this.overviewBounds;
      const span = Math.max(b.x1 - b.x0, (b.y1 - b.y0) * (w / h), 400);
      const scale = Math.min(((w - Math.abs(options.insetX || 0)) * 0.78) / span, ((h - Math.abs(options.insetY || 0)) * 0.72) / Math.max(b.y1 - b.y0, 300));
      const center = { x: (b.x0 + b.x1) / 2, z: (b.y0 + b.y1) / 2, heading: 0 };
      this.showAreas = options.areas !== false;
      const styleKey = ['overview', options.style, themeName, options.highways, this.showAreas].join(',');
      const signature = ['ov', center.x.toFixed(0), center.z.toFixed(0), scale.toFixed(5), styleKey, w, h, from, pose.x.toFixed(0), pose.z.toFixed(0), pose.h.toFixed(0)].join('|');
      if (signature === this.lastSignature) return;
      this.lastSignature = signature;
      ctx.fillStyle = theme.ground;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2 + (options.insetX || 0) / 2, h / 2 + (options.insetY || 0) / 2);
      ctx.scale(scale, scale);
      ctx.translate(-center.x, -center.z);
      const toScreen = ctx.getTransform();
      // Straßen nur bis etwa 40 km Ausdehnung – darüber wäre das Zeichnen zu teuer und nur Gewimmel
      if (mapData && span < 40000) this.drawRoadsCached(center, w, h, scale, 1, theme, options.highways, styleKey);
      this.drawRoute(scale, from, snapped, theme);
      ctx.restore();
      if (places) this.drawPlaces(toScreen, center, w, h, scale, theme, { ...options, pois: false }, 1);
      const sx = toScreen.a * pose.x + toScreen.c * pose.z + toScreen.e;
      const sy = toScreen.b * pose.x + toScreen.d * pose.z + toScreen.f;
      this.drawTruck(sx, sy, Math.min(w, h * 1.4) * 0.8, 1, theme, -headingRadians(pose));
    }

    drawGrid(pose, w, h, scale, theme) {
      const { ctx } = this;
      const step = 250;
      const radius = Math.hypot(w, h) / scale;
      const x0 = Math.floor((pose.x - radius) / step) * step;
      const z0 = Math.floor((pose.z - radius) / step) * step;
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1.5 / scale;
      ctx.beginPath();
      for (let x = x0; x <= pose.x + radius; x += step) {
        ctx.moveTo(x, pose.z - radius);
        ctx.lineTo(x, pose.z + radius);
      }
      for (let z = z0; z <= pose.z + radius; z += step) {
        ctx.moveTo(pose.x - radius, z);
        ctx.lineTo(pose.x + radius, z);
      }
      ctx.stroke();
    }
  }

  // weitere Methoden der Kartenansicht (in eigenen Teilen) an MapView anhängen
  function extendMapView(source) {
    for (const key of Object.getOwnPropertyNames(source.prototype)) {
      if (key !== 'constructor') Object.defineProperty(MapView.prototype, key, Object.getOwnPropertyDescriptor(source.prototype, key));
    }
  }

  // ------------------------------------------------------------------ Hintergrund-Zeichner
  // Straßen, Flächen und Wasser zeichnet ein Worker (map-worker.js) auf einer OffscreenCanvas; die Oberfläche blendet
  // nur fertige Kachelbilder ein. Geht das nicht (kein Worker möglich), zeichnet die Oberfläche selbst – wie früher.
  const MAX_IN_FLIGHT = 4; // so viele Kacheln gleichzeitig beim Worker – neue Wünsche (aktuelle Position) kommen schnell dran
  const layers = { worker: null, ready: false, inFlight: 0, nextId: 1, requests: new Map(), gen: 0, views: new Set() };

  // Kartendatei laden: mit Worker behält die Oberfläche nur die Knoten (Route), die Datei geht an den Worker
  function loadMap(bytes) {
    stopLayerWorker();
    let worker = null;
    if (typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && !/[?&]noworker\b/.test(location.search)) {
      try {
        worker = new Worker('map-worker.js');
      } catch (e) {
        worker = null;
      }
    }
    if (!worker) {
      setMapData(CarMapData.create(bytes));
      return;
    }
    // Erst wenn der Worker sich meldet, bekommt er die Datei; meldet er sich nicht, zeichnet die Oberfläche selbst
    mapData = CarMapData.create(bytes, { nodesOnly: true });
    layers.gen++;
    const fallback = () => {
      if (layers.worker !== worker) return;
      console.warn('Karten-Worker nicht verfügbar – Karte wird in der Oberfläche gezeichnet');
      stopLayerWorker();
      setMapData(CarMapData.create(bytes));
    };
    const timer = setTimeout(fallback, 4000);
    worker.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (!layers.ready) {
        clearTimeout(timer);
        fallback();
      } else console.warn('Karten-Worker:', e && e.message);
    };
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'hello') {
        clearTimeout(timer);
        worker.postMessage({ type: 'map', buffer: bytes.buffer, byteOffset: bytes.byteOffset, byteLength: bytes.byteLength }, [bytes.buffer]);
        sendPlaces();
      } else if (msg.type === 'ready') {
        layers.ready = true;
        redrawViews();
      } else if (msg.type === 'tile') {
        layers.inFlight = Math.max(0, layers.inFlight - 1);
        const req = layers.requests.get(msg.id);
        layers.requests.delete(msg.id);
        const tc = req && req.view.tileCache;
        if (req) req.cache.pending.delete(req.key);
        if (msg.bitmap && tc === req.cache) {
          tc.tiles.set(req.key, { img: msg.bitmap, used: tc.tick });
        } else if (msg.bitmap) {
          msg.bitmap.close(); // veraltet (anderer Stil/Zoom)
        }
        if (req) req.view.lastSignature = ''; // neu einblenden
      } else if (msg.type === 'boxes') {
        buildingBoxes.set(msg.key, msg.shapes ? { shapes: msg.shapes, heights: msg.heights } : null);
        redrawViews();
      } else if (msg.type === 'lines') {
        const done = linesWaiting.get(msg.id);
        linesWaiting.delete(msg.id);
        if (done) done(msg.lines);
      } else if (msg.type === 'error') {
        console.warn('Karten-Worker:', msg.message);
      }
    };
    layers.worker = worker;
  }

  function stopLayerWorker() {
    if (layers.worker) layers.worker.terminate();
    layers.worker = null;
    layers.ready = false;
    layers.inFlight = 0;
    layers.requests.clear();
  }

  function setMapData(data) {
    stopLayerWorker();
    mapData = data;
    layers.gen++;
  }

  // Orte (Ortsflächen, Gelände, Fähren) gehören mit in die Kacheln
  function sendPlaces() {
    if (!layers.worker) return;
    layers.worker.postMessage({ type: 'places', cityAreas: places && places.cityAreas, sites: places && places.sites, ferries: places && places.ferries, arrows: places && places.arrows });
  }

  // Straßen mit Spuren um (x, y): vom Worker (der hat die ganze Karte) oder direkt, wenn ohne Worker gezeichnet wird
  const linesWaiting = new Map();
  let linesId = 1;
  function linesNear(x, y, r, scenery = false) {
    return new Promise((resolve) => {
      if (layers.worker && layers.ready) {
        const id = linesId++;
        linesWaiting.set(id, resolve);
        layers.worker.postMessage({ type: 'lines', id, x, y, r, scenery });
        setTimeout(() => { if (linesWaiting.delete(id)) resolve(null); }, 3000);
      } else resolve(mapData && mapData.linesNear ? mapData.linesNear(x, y, r, scenery) : null);
    });
  }

  // Kreisverkehre um (x, y) – gleicher Weg wie die Straßen
  function roundaboutsNear(x, y, r) {
    return new Promise((resolve) => {
      if (layers.worker && layers.ready) {
        const id = linesId++;
        linesWaiting.set(id, resolve);
        layers.worker.postMessage({ type: 'rbs', id, x, y, r });
        setTimeout(() => { if (linesWaiting.delete(id)) resolve(null); }, 3000);
      } else resolve(mapData && mapData.roundaboutsNear ? mapData.roundaboutsNear(x, y, r) : null);
    });
  }

  // Kreuzungsumrisse um (x, y) – gleicher Weg wie die Straßen (Karten ab Version 19, sonst leer)
  function junctionsNear(x, y, r) {
    return new Promise((resolve) => {
      if (layers.worker && layers.ready) {
        const id = linesId++;
        linesWaiting.set(id, resolve);
        layers.worker.postMessage({ type: 'jns', id, x, y, r });
        setTimeout(() => { if (linesWaiting.delete(id)) resolve(null); }, 3000);
      } else resolve(mapData && mapData.junctionsNear ? mapData.junctionsNear(x, y, r) : null);
    });
  }

  // Gebäude um (x, y) – gleicher Weg wie die Straßen (Antwort kommt als 'lines' mit eigener id)
  function buildingsNear(x, y, r) {
    return new Promise((resolve) => {
      if (layers.worker && layers.ready) {
        const id = linesId++;
        linesWaiting.set(id, resolve);
        layers.worker.postMessage({ type: 'blds', id, x, y, r });
        setTimeout(() => { if (linesWaiting.delete(id)) resolve(null); }, 3000);
      } else resolve(mapData && mapData.buildingsNear ? mapData.buildingsNear(x, y, r) : null);
    });
  }

  function redrawViews() {
    for (const view of layers.views) view.lastSignature = '';
  }

  extendMapView(class {
    // Straßen und Flächen nicht jedes Bild neu zeichnen: nordausgerichtet in Kacheln (512 px) zwischenspeichern und pro
    // Bild nur die sichtbaren Kacheln gedreht/verschoben einblenden. Neue Kacheln entstehen nach und nach (im Worker
    // oder höchstens zwei pro Bild) – so gibt es beim Fahren keinen großen Neuaufbau, der das Bild kurz anhält.
    // Zoomstufen sind in Viertel-Oktaven gerastert; beim Wechsel bleibt die alte Stufe sichtbar, bis die neue fertig ist.
    drawRoadsCached(view, w, h, scale, squash, theme, highways, styleKey) {
      const { ctx } = this;
      layers.views.add(this);
      const TPX = 512; // Kachelgröße in Pixeln
      const BLEED = 2; // Rand gegen feine Nahtlinien zwischen Kacheln
      const radiusW = Math.hypot(w / 2, h / squash) / scale; // sichtbarer Radius in Metern (nach vorne gestreckt)
      // Geneigt erscheint die Ferne ohnehin gestaucht – dort reicht eine geringere Auflösung
      const level = Math.round(Math.log2(scale * (squash < 1 ? 0.7 : 1)) * 4) / 4;
      const cs = 2 ** level; // Pixel pro Meter in den Kacheln
      const tw = TPX / cs; // Kachelgröße in Metern
      const renderScale = cs / (squash < 1 ? 0.7 : 1); // einheitliche Linienbreiten innerhalb einer Stufe
      const remote = !!mapData.nodesOnly; // Kartendaten liegen im Worker
      const key = `${styleKey}|${layers.gen}`;
      let tc = this.tileCache;
      if (!tc || tc.key !== key || tc.cs !== cs) {
        // alte Stufe als Platzhalter behalten (nur bei reinem Zoomwechsel desselben Stils)
        if (this.prevTileCache && this.prevTileCache !== tc) this.recycle(this.prevTileCache);
        this.prevTileCache = tc && tc.key === key ? tc : null;
        if (tc && !this.prevTileCache) this.recycle(tc);
        tc = this.tileCache = { key, cs, tw, tiles: new Map(), pending: new Set(), tick: 0 };
      }
      tc.tick++;
      const t = { cs, tw, renderScale, size: TPX, bleed: BLEED };
      const o = {
        theme, highways, areas: this.showAreas, water: this.showWater, inland: this.showInland, forest: this.showForest, meadow: this.showMeadow, ground: this.showGround,
        sites: this.showSites, buildings: this.showBuildings, hiddenRoads: this.showHiddenRoads, laneMarkings: this.showLaneMarkings, secretRoads: this.showSecretRoads, rails: this.showRails, roadClasses: this.showRoadClasses,
      };
      const render = (tx, ty) => {
        const canvas = this.spareTiles && this.spareTiles.length ? this.spareTiles.pop() : document.createElement('canvas');
        if (canvas.width !== TPX + 2 * BLEED) canvas.width = canvas.height = TPX + 2 * BLEED;
        CarMapLayers.drawTile(canvas.getContext('2d'), mapData, places, { ...t, tx, ty }, o);
        const tile = { img: canvas, used: tc.tick };
        tc.tiles.set(`${tx},${ty}`, tile);
        return tile;
      };
      const request = (tx, ty) => {
        const k = `${tx},${ty}`;
        if (tc.pending.has(k)) return true;
        if (!layers.ready || layers.inFlight >= MAX_IN_FLIGHT) return false;
        const id = layers.nextId++;
        layers.requests.set(id, { view: this, cache: tc, key: k });
        tc.pending.add(k);
        layers.inFlight++;
        layers.worker.postMessage({ type: 'tile', id, t: { ...t, tx, ty }, o });
        return true;
      };
      const tx0 = Math.floor((view.x - radiusW) / tw);
      const tx1 = Math.floor((view.x + radiusW) / tw);
      const ty0 = Math.floor((view.z - radiusW) / tw);
      const ty1 = Math.floor((view.z + radiusW) / tw);
      // fehlende sichtbare Kacheln: mit Worker nach Nähe zur Mitte anfragen; sonst selbst zeichnen –
      // ohne Platzhalter sofort, mit Platzhalter (Zoomwechsel) nur zwei pro Bild und höchstens ~8 ms
      const prev = this.prevTileCache;
      const t0 = performance.now();
      let made = 0;
      const inBudget = (ms) => !prev || (made < 2 && performance.now() - t0 < ms);
      const visible = [];
      const wanted = [];
      for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = ty0; ty <= ty1; ty++) {
          let tile = tc.tiles.get(`${tx},${ty}`);
          if (!tile && !remote && inBudget(8)) { tile = render(tx, ty); made++; }
          if (tile) { tile.used = tc.tick; visible.push([tx, ty, tile]); } else wanted.push([tx, ty]);
        }
      }
      const missing = wanted.length;
      if (remote && missing) {
        const dist = ([tx, ty]) => Math.hypot((tx + 0.5) * tw - view.x, (ty + 0.5) * tw - view.z);
        wanted.sort((a, b) => dist(a) - dist(b));
        for (const [tx, ty] of wanted) if (!request(tx, ty)) break;
      }
      const blit = (cache, tx, ty, tile) => {
        const s = cache.tw;
        ctx.drawImage(tile.img, BLEED - 0.5, BLEED - 0.5, TPX + 1, TPX + 1, tx * s - 0.5 / cache.cs, ty * s - 0.5 / cache.cs, s + 1 / cache.cs, s + 1 / cache.cs);
      };
      if (missing && prev) {
        // alte Zoomstufe darunter, bis alles neu gezeichnet ist
        for (const [k, tile] of prev.tiles) {
          const [tx, ty] = k.split(',').map(Number);
          if ((tx + 1) * prev.tw < view.x - radiusW || tx * prev.tw > view.x + radiusW || (ty + 1) * prev.tw < view.z - radiusW || ty * prev.tw > view.z + radiusW) continue;
          blit(prev, tx, ty, tile);
        }
      } else if (prev && !missing) {
        this.recycle(prev);
        this.prevTileCache = null;
      }
      for (const [tx, ty, tile] of visible) blit(tc, tx, ty, tile);
      // im Voraus: Ring um den sichtbaren Bereich – mit Worker zwei Anfragen, sonst eine Kachel und nur wenn dieses Bild noch Zeit hat
      if (!missing) {
        let ahead = remote ? 2 : made === 0 && performance.now() - t0 < 6 ? 1 : 0;
        for (let tx = tx0 - 1; tx <= tx1 + 1 && ahead > 0; tx++) {
          for (let ty = ty0 - 1; ty <= ty1 + 1 && ahead > 0; ty++) {
            if (tx >= tx0 && tx <= tx1 && ty >= ty0 && ty <= ty1) continue;
            const k = `${tx},${ty}`;
            if (tc.tiles.has(k) || tc.pending.has(k)) continue;
            if (remote) {
              if (!request(tx, ty)) ahead = 0;
              else ahead--;
            } else {
              render(tx, ty).used = tc.tick;
              ahead--;
            }
          }
        }
      } else if (!remote) {
        this.lastSignature = ''; // nächstes Bild sicher neu zeichnen, damit die restlichen Kacheln folgen
      }
      // Speicher begrenzen: am längsten unbenutzte Kacheln freigeben (je ~1 MB)
      const MAX = Math.max(48, visible.length * 2 + 16);
      if (tc.tiles.size > MAX) {
        const old = [...tc.tiles.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, tc.tiles.size - MAX);
        for (const [k, tile] of old) {
          tc.tiles.delete(k);
          this.spare(tile.img);
        }
      }
    }

    // Kachelbild freigeben: Zeichenflächen wiederverwenden, Bilder aus dem Worker sofort schließen
    spare(img) {
      if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
        img.close();
        return;
      }
      if (!this.spareTiles) this.spareTiles = [];
      if (this.spareTiles.length < 16) this.spareTiles.push(img);
    }

    recycle(cache) {
      for (const tile of cache.tiles.values()) this.spare(tile.img);
      cache.tiles.clear();
    }

    // Neue Leinwand nach dem Neuaufbau der Oberfläche: Kacheln und Kamera behalten (kein Neuzeichnen aller Kacheln)
    attach(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.lastSignature = '';
    }

    // Ansicht wird nicht mehr gebraucht: Kacheln freigeben und abmelden (sonst bleibt sie samt Kacheln im Speicher)
    dispose() {
      layers.views.delete(this);
      if (this.tileCache) this.recycle(this.tileCache);
      if (this.prevTileCache) this.recycle(this.prevTileCache);
      this.tileCache = this.prevTileCache = null;
      this.spareTiles = [];
    }
  });

  // ------------------------------------------------------------------ 3D-Gebäude (Option)
  // Bei geneigter Karte und nahem Zoom werden die Gebäude wie bei Apple/Google Karten als Klötze hochgezogen: Wände
  // (dunkler) und Dach (Gebäudefarbe), passend zur Blickrichtung pro Bild in Bildschirmkoordinaten gezeichnet.
  // Höhen aus der Kartendatei (ab Version 15). Mit Worker liegen die Gebäude dort – kachelweise anfragen.
  const buildingBoxes = new Map(); // "tx,ty" -> { pts, heights } | null (keine) | 'pending'
  function getBuildingBoxes(tx, ty) {
    const key = `${tx},${ty}`;
    if (!layers.worker) return mapData && mapData.tileBuildingBoxes ? mapData.tileBuildingBoxes(tx, ty) : null;
    const have = buildingBoxes.get(key);
    if (have !== undefined) return have === 'pending' ? null : have;
    if (!layers.ready) return null;
    if (buildingBoxes.size > 400) buildingBoxes.clear(); // grob begrenzen – neu angefragt wird, was sichtbar ist
    buildingBoxes.set(key, 'pending');
    layers.worker.postMessage({ type: 'boxes', key, tx, ty });
    return null;
  }
  // neue Kartendatei: alte Klötze verwerfen
  const loadMapPlain = loadMap;
  loadMap = function (bytes) {
    buildingBoxes.clear();
    return loadMapPlain(bytes);
  };

  // Sichtbare Neigung: TILT_SQUASH staucht die Tiefe, Höhen erscheinen mit dem Sinus desselben Winkels
  const HEIGHT_FACTOR = Math.sqrt(1 - TILT_SQUASH * TILT_SQUASH);

  extendMapView(class {
    draw3dBuildings(m, view, w, h, scale, theme) {
      const { ctx } = this;
      const tile = mapData && mapData.tileSize;
      if (!tile) return;
      // Ausschnitt in Weltmetern (großzügig, die gestauchte Ansicht reicht weiter nach vorn)
      const reach = Math.hypot(w, h) / scale / TILT_SQUASH;
      const t0x = Math.floor((view.x - reach) / tile), t1x = Math.floor((view.x + reach) / tile);
      const t0y = Math.floor((view.z - reach) / tile), t1y = Math.floor((view.z + reach) / tile);
      const lift = scale * HEIGHT_FACTOR; // Pixel je Höhenmeter
      const list = [];
      for (let tx = t0x; tx <= t1x; tx++) {
        for (let ty = t0y; ty <= t1y; ty++) {
          const b = getBuildingBoxes(tx, ty);
          if (!b) continue;
          for (let i = 0, n = b.heights.length; i < n; i++) {
            const hm = b.heights[i];
            if (hm < 2 || !b.shapes[i]) continue;
            // Umrisse (echte Grundfläche ab Kartenversion 16, sonst Rechteck) in Bildschirmkoordinaten
            const rings = [];
            let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
            for (const r of b.shapes[i]) {
              const s = new Float32Array(r.length);
              for (let k = 0; k < r.length; k += 2) {
                const sx = m.a * r[k] + m.c * r[k + 1] + m.e;
                const sy = m.b * r[k] + m.d * r[k + 1] + m.f;
                s[k] = sx;
                s[k + 1] = sy;
                if (sx < minX) minX = sx;
                if (sx > maxX) maxX = sx;
                if (sy < minY) minY = sy;
                if (sy > maxY) maxY = sy;
              }
              rings.push(s);
            }
            // Höhe gedeckelt: Silos, Kräne und Türme sind im Spiel 40–70 m hoch – als Klotz in voller Höhe verdeckten
            // sie Straßen und Route. Wie bei Google bleiben Gebäude ruhig: bis 24 m echt, darüber nur noch etwas mehr
            const shown = hm <= 24 ? hm : 24 + (hm - 24) * 0.15;
            const up = shown * lift;
            if (maxX < -20 || minX > w + 20 || maxY < -20 || minY - up > h + 20) continue;
            list.push({ rings, up, depth: maxY });
          }
        }
      }
      if (!list.length) return;
      // Maler-Reihenfolge: hinten (oben im Bild) zuerst
      list.sort((a, b) => a.depth - b.depth);
      const roof = theme.building ? theme.building[0] : '#e8e9ec';
      const wall = theme.building3d || (theme.building ? theme.building[1] : '#c9ccd2');
      const edge = theme.buildingEdge || 'rgba(0,0,0,0.08)';
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 1;
      ctx.strokeStyle = edge;
      for (const { rings, up } of list) {
        // Wände aller Ringe: hintere zuerst, damit die vorderen darüber liegen
        const faces = [];
        for (const s of rings) {
          const n = s.length / 2;
          for (let k = 0; k < n; k++) {
            const j = (k + 1) % n;
            faces.push({ s, k, j, mid: (s[k * 2 + 1] + s[j * 2 + 1]) / 2 });
          }
        }
        faces.sort((a, b) => a.mid - b.mid);
        ctx.fillStyle = wall;
        for (const { s, k, j } of faces) {
          ctx.beginPath();
          ctx.moveTo(s[k * 2], s[k * 2 + 1]);
          ctx.lineTo(s[j * 2], s[j * 2 + 1]);
          ctx.lineTo(s[j * 2], s[j * 2 + 1] - up);
          ctx.lineTo(s[k * 2], s[k * 2 + 1] - up);
          ctx.closePath();
          ctx.fill();
        }
        // Dach: alle Ringe als eine Fläche (Innenhöfe bleiben offen)
        ctx.fillStyle = roof;
        ctx.beginPath();
        for (const s of rings) {
          ctx.moveTo(s[0], s[1] - up);
          for (let k = 2; k < s.length; k += 2) ctx.lineTo(s[k], s[k + 1] - up);
          ctx.closePath();
        }
        ctx.fill('evenodd');
        ctx.stroke();
      }
      ctx.restore();
    }
  });
  extendMapView(class {
    // Nur der Teil vor dem Truck – die gefahrene Strecke wird ausgeblendet
    drawRoute(scale, fromIndex, snapped, theme) {
      const { ctx } = this;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const [casing, fill] = theme.route;
      for (const [px, meters, color] of [[18, 15, casing], [12.5, 10, fill]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(px / scale, meters);
        ctx.beginPath();
        let started = false;
        if (snapped) {
          ctx.moveTo(snapped.x, snapped.y);
          started = true;
        }
        for (let i = fromIndex + 1; i < routePoints.length; i++) {
          const p = routePoints[i];
          if (!p) { started = false; continue; }
          if (started) ctx.lineTo(p.x, p.y);
          else { ctx.moveTo(p.x, p.y); started = true; }
        }
        ctx.stroke();
      }
      this.drawTurnArrow(scale, theme);
    }

    // Wie Google Maps: an der nächsten Abbiegung ein weißer Pfeil direkt auf der Route
    drawTurnArrow(scale, theme) {
      if (!lastSnap || !routeCum || !routeTurns.length) return;
      const base = routePoints[lastSnap.i];
      const here = routeCum[lastSnap.i] + Math.hypot(lastSnap.x - base.x, lastSnap.y - base.y);
      const turn = routeTurns.find((t) => t.cum > here + 10);
      if (!turn || turn.cum - here > 1200) return;
      // Ende: bis die Route nach dem Abbiegen wieder geradeaus läuft – bei Schleifen-Ausfahrten folgt der Pfeil der
      // ganzen Kurve (32–150 m nach der Abbiegung; je Abbiegung einmal berechnet)
      if (turn.arrowEnd === undefined) {
        const dirAt = (c) => {
          const s = routeSlice(c, c + 12);
          return s.length < 2 ? null : Math.atan2(s[s.length - 1].y - s[0].y, s[s.length - 1].x - s[0].x);
        };
        let end = turn.cum + 32;
        let prev = dirAt(turn.cum);
        for (let c = turn.cum + 8; prev !== null && c <= turn.cum + 150; c += 8) {
          const d = dirAt(c);
          if (d === null) break;
          const change = Math.abs(Math.atan2(Math.sin(d - prev), Math.cos(d - prev)));
          prev = d;
          if (change > 0.09) end = Math.max(end, c + 12);
          else if (c > end + 16) break;
        }
        turn.arrowEnd = Math.min(end, turn.cum + 150);
      }
      const pts = routeSlice(Math.max(here, turn.cum - 45), turn.arrowEnd);
      if (pts.length < 2) return;
      const { ctx } = this;
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      const head = Math.max(22 / scale, 11);
      const width = Math.max(7 / scale, 4.5);
      const tip = { x: b.x + ux * head * 0.6, y: b.y + uy * head * 0.6 };
      const shaft = pts.slice(0, -1).concat([{ x: b.x - ux * head * 0.3, y: b.y - uy * head * 0.3 }]);
      for (const [color, extra] of [[theme.route[0], Math.max(4 / scale, 2.5)], ['#ffffff', 0]]) {
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = width + extra * 2;
        ctx.beginPath();
        shaft.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        // Pfeilspitze
        const h = head + extra * 2;
        ctx.beginPath();
        ctx.moveTo(tip.x + ux * extra, tip.y + uy * extra);
        ctx.lineTo(b.x - ux * h * 0.55 - uy * h * 0.62, b.y - uy * h * 0.55 + ux * h * 0.62);
        ctx.lineTo(b.x - ux * h * 0.55 + uy * h * 0.62, b.y - uy * h * 0.55 - ux * h * 0.62);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Zwischenhalte einer Buslinie wie bei Apple Karten: weißer Punkt mit blauem Rand und Nummer, nur noch vor dem Truck.
    // Nach den Ortsnamen gezeichnet, damit der Stadtname den Punkt nicht verdeckt
    drawRouteStops(onScreen, unit) {
      if (!routePoints) return;
      if (routeStopMarks.length && routeCum && lastSnap) {
        const { ctx } = this;
        const here = routeCum[lastSnap.i];
        routeStopMarks.forEach((s, n) => {
          const key = `${s.id || ''}|${s.name || ''}`;
          if (!routeStopCache.has(key) && places) routeStopCache.set(key, findRouteStop(s.id, s.name)); // erst mit Ortsdaten merken
          const hit = routeStopCache.get(key);
          if (!hit || routeCum[hit.i] < here - 30) return;
          const p = onScreen(hit.x, hit.y, 40);
          if (!p) return;
          const r = unit * 1.15;
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.35)';
          ctx.shadowBlur = unit * 0.5;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.lineWidth = r * 0.28;
          ctx.strokeStyle = '#0a84ff';
          ctx.stroke();
          ctx.fillStyle = '#0a84ff';
          ctx.font = `700 ${Math.round(r * 1.15)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(n + 1), p.x, p.y + r * 0.05);
          ctx.restore();
        });
      }
    }

    // Ziel wie bei Google Maps: rote Nadel am Ende der Route (aufrecht, Bildschirmkoordinaten)
    drawDestination(onScreen, unit) {
      if (!routePoints) return;
      let end = null;
      for (let i = routePoints.length - 1; i >= 0 && !end; i--) end = routePoints[i];
      const p = end && onScreen(end.x, end.y, 60);
      if (!p) return;
      const { ctx } = this;
      const r = unit * 1.5;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = unit * 0.6;
      ctx.fillStyle = '#ea4335';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.bezierCurveTo(p.x - r * 0.25, p.y - r * 1.0, p.x - r, p.y - r * 1.35, p.x - r, p.y - r * 2.1);
      ctx.arc(p.x, p.y - r * 2.1, r, Math.PI, 0);
      ctx.bezierCurveTo(p.x + r, p.y - r * 1.35, p.x + r * 0.25, p.y - r * 1.0, p.x, p.y);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#a50e0e';
      ctx.beginPath();
      ctx.arc(p.x, p.y - r * 2.1, r * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Fahrtenbuch: alle gefahrenen Strecken lila und halb durchsichtig – oft Gefahrenes wird durch Überlagerung kräftiger
    drawDriven(view, w, h, scale, squash) {
      if (!drivenChunks.length) return;
      const { ctx } = this;
      const r = Math.hypot(w, h / Math.max(squash, 0.3)) / scale; // Radius des Sichtbereichs in der Spielwelt
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(175, 82, 222, 0.35)';
      ctx.lineWidth = Math.max(5 / scale, 6);
      // je Stück ein eigener Strich: mehrfach Gefahrenes liegt übereinander und wirkt kräftiger
      for (const c of drivenChunks) {
        if (c.x1 < view.x - r || c.x0 > view.x + r || c.z1 < view.z - r || c.z0 > view.z + r) continue;
        const p = c.pts;
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
        ctx.stroke();
      }
    }

    drawTrail(scale, theme) {
      const { ctx } = this;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const [width, color] of [[16, 'rgba(66,133,244,0.25)'], [7, theme.route[1]]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width / scale;
        for (const seg of this.trail.segments) {
          if (seg.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(seg[0].x, seg[0].z);
          for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i].x, seg[i].z);
          ctx.stroke();
        }
      }
    }

    drawTruck(cx, cy, size, squash = 1, theme = {}, rotation = 0) {
      const { ctx } = this;
      const s = size / 30;
      ctx.save();
      ctx.translate(cx, cy);
      if (rotation) ctx.rotate(rotation); // Norden-Modus: Pfeil zeigt in Fahrtrichtung
      ctx.scale(1, 0.55 + 0.45 * squash); // in 3D liegt der Pfeil flach auf der Straße
      if (theme.puck === 'arrow') {
        // Apple Karten: blaue Scheibe mit weißem Ring, darin ein weißer Pfeil
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = s * 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, s * 1.25, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(0, 0, s * 1.02, 0, Math.PI * 2);
        ctx.fillStyle = '#0a84ff';
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.66);
        ctx.lineTo(s * 0.5, s * 0.52);
        ctx.lineTo(0, s * 0.24);
        ctx.lineTo(-s * 0.5, s * 0.52);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
        return;
      }
      // Google Maps: große, leicht durchsichtige Scheibe (Größe und Deckkraft an Google Maps in CarPlay gemessen)
      const g = s * 1.6;
      const r = g * 1.15;
      // Schatten nur außerhalb der Scheibe – sonst schiene er durch die durchsichtige Fläche und färbte sie grau
      ctx.save();
      ctx.beginPath();
      ctx.rect(-r * 3, -r * 3, r * 6, r * 6);
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.clip('evenodd');
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = g * 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = theme.puckBg || 'rgba(255,255,255,0.82)';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -g * 0.75);
      ctx.lineTo(g * 0.55, g * 0.55);
      ctx.lineTo(0, g * 0.25);
      ctx.lineTo(-g * 0.55, g * 0.55);
      ctx.closePath();
      ctx.fillStyle = theme.puckArrow || '#1a73e8';
      ctx.fill();
      ctx.restore();
    }
  });

  extendMapView(class {
    // Abgekuppelter Anhänger: orangefarbene Marke mit Anhänger-Symbol (bleibt aufrecht, Bildschirmkoordinaten)
    drawTrailerMarker(m, w, h) {
      const { ctx } = this;
      const x = m.a * trailerSpot.x + m.c * trailerSpot.z + m.e;
      const y = m.b * trailerSpot.x + m.d * trailerSpot.z + m.f;
      if (x < -30 || y < -30 || x > w + 30 || y > h + 30) return;
      const r = h / 42;
      ctx.save();
      ctx.translate(x, y);
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = r * 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ff9500';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = r * 0.16;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      // Anhänger: Kasten mit zwei Rädern und Deichsel
      const u = r / 10;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(-5.5 * u, -4.5 * u, 10 * u, 6 * u, 1 * u);
      ctx.fill();
      ctx.fillRect(4.5 * u, -0.6 * u, 2.5 * u, 1.2 * u);
      for (const wx of [-3 * u, 0.6 * u]) {
        ctx.beginPath();
        ctx.arc(wx, 3 * u, 1.5 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Städtenamen und Orte bleiben aufrecht und unverzerrt (Bildschirmkoordinaten)
    drawPlaces(m, view, w, h, scale, theme, options, reach) {
      const { ctx } = this;
      const radius = (Math.hypot(w, h) / scale) * reach;
      const onScreen = (x, y, margin = 40) => {
        const sx = m.a * x + m.c * y + m.e;
        const sy = m.b * x + m.d * y + m.f;
        return sx > -margin && sx < w + margin && sy > -margin && sy < h + margin ? { x: sx, y: sy } : null;
      };
      const unit = h / 60; // ~1rem

      if (options.sites !== false && options.siteNames !== false && places.siteList && this.metersPerPx < 1.3) {
        const size = unit * 1.2;
        ctx.font = `600 ${size}px "Inter", "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        const dark = isDarkGround(theme.ground);
        const placed = [];
        for (const s of places.siteList) {
          if (!s.n || Math.abs(s.cx - view.x) > radius || Math.abs(s.cy - view.z) > radius) continue;
          const p = onScreen(s.cx, s.cy, 0);
          if (!p) continue;
          const tw = ctx.measureText(s.n).width;
          if (placed.some((q) => Math.abs(q.x - p.x) < (q.w + tw) / 2 + 6 && Math.abs(q.y - p.y) < size * 1.4)) continue;
          placed.push({ x: p.x, y: p.y, w: tw });
          ctx.lineWidth = unit * 0.3;
          ctx.strokeStyle = theme.halo;
          ctx.strokeText(s.n, p.x, p.y);
          ctx.fillStyle = s.k === 3 ? (dark ? '#d9c39a' : '#7a5f2e') : dark ? '#c3b8d8' : '#5e5373';
          ctx.fillText(s.n, p.x, p.y);
        }
      }

      if (options.pois && this.metersPerPx < 2.2) {
        const r = unit * 1.15;
        for (const poi of extraPois.length ? places.pois.concat(extraPois) : places.pois) {
          const [type, x, y] = poi;
          if ((type === 'c' || type === 'm') && !options.radar) continue;
          if (type === 'p' && this.metersPerPx > 1.1) continue; // Parkplätze nur nah
          if (type === 'b' && (options.busStops === false || this.metersPerPx > 1.1)) continue; // Bushaltestellen nur nah
          if (Math.abs(x - view.x) > radius || Math.abs(y - view.z) > radius) continue;
          const p = onScreen(x, y);
          if (!p) continue;
          const style = POI_STYLE[type] || POI_STYLE.p;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = style.color;
          ctx.fill();
          ctx.lineWidth = unit * 0.25;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          if (style.glyph === 'cam') {
            // Blitzer: Kamera mit Linse
            ctx.fillRect(p.x - r * 0.55, p.y - r * 0.32, r * 0.8, r * 0.64);
            ctx.beginPath();
            ctx.moveTo(p.x + r * 0.25, p.y);
            ctx.lineTo(p.x + r * 0.6, p.y - r * 0.3);
            ctx.lineTo(p.x + r * 0.6, p.y + r * 0.3);
            ctx.fill();
            ctx.fillStyle = style.color;
            ctx.beginPath();
            ctx.arc(p.x - r * 0.15, p.y, r * 0.17, 0, Math.PI * 2);
            ctx.fill();
          } else if (style.icon) {
            const icon = style.icon;
            if (icon.d) {
              icon.fill = icon.d[0] && new Path2D(icon.d[0]);
              icon.stroke = icon.d[1] && new Path2D(icon.d[1]);
              icon.d = null;
            }
            const k = (r * 1.3) / 24;
            ctx.save();
            ctx.translate(p.x - 12 * k, p.y - 12 * k);
            ctx.scale(k, k);
            if (style.icon.fill) ctx.fill(style.icon.fill, 'evenodd');
            if (style.icon.stroke) {
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 2.3;
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              ctx.stroke(style.icon.stroke);
            }
            ctx.restore();
          } else {
            ctx.font = `700 ${r * 1.2}px "Inter", "Segoe UI", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(style.glyph, p.x, p.y + r * 0.05);
          }
        }
      }

      // Straßennummern wie bei Google Maps: kleine Schilder, nicht zu dicht (gleiche Nummer erst wieder mit Abstand)
      if (options.shields && places.shields && this.metersPerPx < 8) {
        const SHIELD = { e: ['#0b7a3e', '#ffffff'], mb: ['#1f5fbf', '#ffffff'], mr: ['#c7302b', '#ffffff'], mg: ['#0b7a3e', '#ffffff'], n: ['#ffd23f', '#1d1d1f'] };
        const size = unit * 1.25;
        ctx.font = `700 ${size}px "Inter", "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const placed = [];
        const minGap = unit * (this.metersPerPx > 3 ? 14 : 9);
        for (const [label, x, y, kind] of places.shields) {
          if (Math.abs(x - view.x) > radius || Math.abs(y - view.z) > radius) continue;
          if ((kind === 'n' || kind === 's') && this.metersPerPx > 3) continue; // Landstraßen (ATS: State Routes) nur nah
          const p = onScreen(x, y, 20);
          if (!p) continue;
          if (placed.some((q) => Math.abs(q.x - p.x) < (q.label === label ? minGap * 2.5 : minGap * 0.45) && Math.abs(q.y - p.y) < (q.label === label ? minGap * 2.5 : size * 1.6))) continue;
          placed.push({ x: p.x, y: p.y, label });
          const hBox = size * 1.45;
          if (kind === 'i' || kind === 'u' || kind === 's') {
            // ATS: Interstate (blaues Wappen, rote Kappe), US-Highway (weißes Wappen), State Route (weißes Oval)
            const w = Math.max(hBox * 1.05, ctx.measureText(label).width + size * 0.7);
            const x0 = p.x - w / 2;
            const y0 = p.y - hBox / 2;
            ctx.beginPath();
            if (kind === 's') ctx.ellipse(p.x, p.y, w / 2, hBox / 2, 0, 0, Math.PI * 2);
            else {
              ctx.moveTo(x0, y0);
              ctx.lineTo(x0 + w, y0);
              ctx.lineTo(x0 + w, y0 + hBox * 0.62);
              ctx.quadraticCurveTo(x0 + w, y0 + hBox * 0.98, p.x, y0 + hBox * 1.12);
              ctx.quadraticCurveTo(x0, y0 + hBox * 0.98, x0, y0 + hBox * 0.62);
              ctx.closePath();
            }
            ctx.fillStyle = kind === 'i' ? '#1d4fa3' : '#ffffff';
            ctx.fill();
            if (kind === 'i') {
              ctx.save();
              ctx.clip();
              ctx.fillStyle = '#c7302b';
              ctx.fillRect(x0, y0, w, hBox * 0.24);
              ctx.restore();
            }
            ctx.strokeStyle = kind === 'i' ? 'rgba(255,255,255,0.95)' : '#1d1d1f';
            ctx.lineWidth = unit * 0.18;
            ctx.stroke();
            ctx.fillStyle = kind === 'i' ? '#ffffff' : '#1d1d1f';
            ctx.fillText(label, p.x, p.y + size * (kind === 's' ? 0.04 : 0.14));
            continue;
          }
          const [bg, fg] = SHIELD[kind] || SHIELD.mb;
          const wBox = ctx.measureText(label).width + size * 0.8;
          ctx.fillStyle = bg;
          ctx.strokeStyle = 'rgba(255,255,255,0.95)';
          ctx.lineWidth = unit * 0.18;
          ctx.beginPath();
          ctx.roundRect(p.x - wBox / 2, p.y - hBox / 2, wBox, hBox, size * 0.32);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = fg;
          ctx.fillText(label, p.x, p.y + size * 0.04);
        }
      }

      // Ampeln wie bei Google Maps: ein kleines Symbol je Kreuzung, alle drei Lampen an (Rot, Gelb, Grün)
      if (options.lights && lightIcons.length && this.metersPerPx < 2.6) {
        const LAMPS = ['#ff3b30', '#ffcc00', '#34c759'];
        const bw = unit * 0.95;
        const bh = unit * 2.2;
        for (const l of lightIcons) {
          const p = onScreen(l.x, l.z, 20);
          if (!p) continue;
          ctx.fillStyle = '#3c4043';
          ctx.strokeStyle = 'rgba(255,255,255,0.95)';
          ctx.lineWidth = unit * 0.18;
          ctx.beginPath();
          ctx.roundRect(p.x - bw / 2, p.y - bh / 2, bw, bh, bw * 0.38);
          ctx.fill();
          ctx.stroke();
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(p.x, p.y - bh * 0.3 + i * bh * 0.3, bw * 0.26, 0, Math.PI * 2);
            ctx.fillStyle = LAMPS[i];
            ctx.fill();
          }
        }
      }

      this.drawDestination(onScreen, unit);

      if (options.labels) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        for (const [english, x, y, population, , token] of places.cities) {
          const name = cityLabel(english, token);
          if (Math.abs(x - view.x) > radius * 1.2 || Math.abs(y - view.z) > radius * 1.2) continue;
          const p = onScreen(x, y, 80);
          if (!p) continue;
          const size = unit * (population > 500000 ? 2.3 : population > 100000 ? 2 : 1.75);
          ctx.font = `600 ${size}px "Inter", "Segoe UI Variable Display", "Segoe UI", sans-serif`;
          ctx.lineWidth = size * 0.28;
          ctx.strokeStyle = theme.halo;
          ctx.strokeText(name, p.x, p.y);
          ctx.fillStyle = theme.label;
          ctx.fillText(name, p.x, p.y);
        }
        // Kleine Orte (Kulissenorte, Option): kleiner und blasser, erst bei näherem Zoom
        if (options.towns && places.towns && this.metersPerPx < 3.5) {
          const size = unit * 1.3;
          ctx.font = `500 ${size}px "Inter", "Segoe UI Variable Display", "Segoe UI", sans-serif`;
          ctx.lineWidth = size * 0.28;
          for (const [name, x, y] of places.towns) {
            if (Math.abs(x - view.x) > radius * 1.2 || Math.abs(y - view.z) > radius * 1.2) continue;
            const p = onScreen(x, y, 60);
            if (!p) continue;
            ctx.strokeStyle = theme.halo;
            ctx.strokeText(name, p.x, p.y);
            ctx.fillStyle = theme.labelMinor || theme.label;
            ctx.globalAlpha = theme.labelMinor ? 1 : 0.75;
            ctx.fillText(name, p.x, p.y);
            ctx.globalAlpha = 1;
          }
        }
      }
      // Aussichtspunkte (Option): violetter Punkt mit Fernglas, nah herangezoomt mit Beschriftung
      if (options.viewpoints && places.viewpoints && this.metersPerPx < 6) {
        const r = unit * 1.15;
        for (const [x, y, near] of places.viewpoints) {
          if (Math.abs(x - view.x) > radius * 1.2 || Math.abs(y - view.z) > radius * 1.2) continue;
          const p = onScreen(x, y, 40);
          if (!p) continue;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = '#8e5bd8';
          ctx.fill();
          ctx.lineWidth = r * 0.18;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
          // Fernglas: zwei Linsen mit Steg
          ctx.fillStyle = '#ffffff';
          for (const dx of [-0.36, 0.36]) {
            ctx.beginPath();
            ctx.arc(p.x + dx * r, p.y + 0.12 * r, 0.3 * r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillRect(p.x - 0.18 * r, p.y - 0.3 * r, 0.36 * r, 0.32 * r);
          if (this.metersPerPx < 1.2 && near) {
            const size = unit * 1.15;
            ctx.font = `600 ${size}px "Inter", "Segoe UI", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = size * 0.28;
            ctx.strokeStyle = theme.halo;
            const label = `Aussicht · ${near}`;
            ctx.strokeText(label, p.x, p.y + r * 2.1);
            ctx.fillStyle = '#7a45c8';
            ctx.fillText(label, p.x, p.y + r * 2.1);
          }
        }
      }
      this.drawRouteStops(onScreen, unit);
    }

  });

  function headingRadians(pose) {
    return (pose.h / 360) * Math.PI * 2;
  }

  // Kompass als eigenes Overlay (verschiebbar); Nadel zeigt nach Norden
  function drawCompass(canvas, pose) {
    const size = canvas.clientWidth;
    if (!size) return;
    // nur neu zeichnen, wenn sich die Richtung merklich geändert hat
    const key = `${size}|${pose ? pose.h.toFixed(1) : '-'}|${document.body.dataset.mapstyle}|${window.CarI18n?.lang}|${document.body.dataset.theme}`;
    if (canvas.dataset.key && canvas.dataset.key.startsWith(key)) return;
    canvas.dataset.key = key;
    if (canvas.width !== size) canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const r = size / 2;
    ctx.clearRect(0, 0, size, size);
    if (document.body.dataset.mapstyle === 'apple') {
      // Fahrtrichtung als Himmelsrichtung (Spiel: 0° = Norden, gegen den Uhrzeigersinn)
      const bearing = pose ? (360 - pose.h + 360) % 360 : 0;
      const lang = window.CarI18n?.lang || 'de';
      const NAMES = lang === 'de' ? ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'] : lang === 'zh' ? ['北', '东北', '东', '东南', '南', '西南', '西', '西北'] : lang === 'zh-hant' ? ['北', '東北', '東', '東南', '南', '西南', '西', '西北'] : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      const name = NAMES[Math.round(bearing / 45) % 8];
      ctx.fillStyle = getComputedStyle(canvas).color || '#fff';
      ctx.font = `700 ${Math.round(size * (name.length > 1 ? 0.34 : 0.42))}px -apple-system, "SF Pro Text", "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, r, r + size * 0.02);
      canvas.dataset.key = key + '|' + name + '|' + ctx.fillStyle;
      return;
    }
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(pose ? headingRadians(pose) : 0);
    for (const [dir, color] of [[-1, '#ff453a'], [1, '#e5e5ea']]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, dir * r * 0.72);
      ctx.lineTo(r * 0.24, 0);
      ctx.lineTo(-r * 0.24, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Orte in der Nähe (für "Tanken & Rasten"): an der Route liegende zuerst, nach Strecke sortiert
  function nearbyPlaces(types, x, y, limit = 8) {
    if (!places) return [];
    const here = routeCum && lastSnap ? routeCum[lastSnap.i] : null;
    const out = [];
    for (const [type, px, py, label] of places.pois) {
      if (!types.includes(type)) continue;
      const air = Math.hypot(px - x, py - y);
      if (air > 120000) continue;
      const on = here != null ? nearestOnRoute(px, py) : null;
      const along = on && on.i > lastSnap.i ? routeCum[on.i] - here : null;
      out.push({ type, x: px, y: py, label, air, along, onRoute: along != null });
    }
    out.sort((a, b) => (a.onRoute !== b.onRoute ? (a.onRoute ? -1 : 1) : (a.along ?? a.air) - (b.along ?? b.air)));
    return out.slice(0, limit);
  }

  // Buslinie: Haltestelle (Kartenpunkt „b“) der Stadt, durch die die Spiel-Route führt. Die Route des Spiels geht durch
  // alle Halte bis zur Endhaltestelle. Haltestellen der Stadt (bis 3,6 km von der Stadtmitte, Kartenmaß – Joensuu 3,5), an denen die
  // Route vorbeiführt; bei mehreren die nächste an der Stadtmitte (Nachbarstädte liegen oft nur wenige km weiter).
  // id: Stadt-Kennung vom Spiel (z. B. osnabruck), name als Ersatz (englischer Kartenname). null = nicht gefunden
  function findRouteStop(id, name) {
    if (!places || !routePoints) return null;
    const city = places.cities.find((c) => (id && c[5] === id) || (!id && name && c[0] === name));
    if (!city) return null;
    let best = null;
    for (const [type, px, py] of places.pois) {
      if (type !== 'b') continue;
      const fromCity = Math.hypot(px - city[1], py - city[2]);
      if (fromCity > 3600) continue;
      const on = nearestOnRoute(px, py, 150);
      if (on && (!best || fromCity < best.fromCity)) best = { x: px, y: py, i: on.i, fromCity };
    }
    return best;
  }

  // Straße an einem Ort: nächstes Straßenschild (Nummernschild an der Strecke) im Umkreis. Landesstraßen vor E-Straßen
  // (an der A8 steht auch E52 – angezeigt wird, was auf den Wegweisern zuerst steht). Ohne Schild in der Nähe: null.
  function roadAt(x, y, radius = 1500) {
    if (!places || !places.shields) return null;
    let best = null;
    for (const [text, sx, sy, kind] of places.shields) {
      if (Math.abs(sx - x) > radius || Math.abs(sy - y) > radius) continue;
      const d = Math.hypot(sx - x, sy - y) * (kind === 'e' ? 1.6 : 1);
      if (d <= radius && (!best || d < best.d)) best = { d, text };
    }
    return best ? best.text : null;
  }

  // Land an einer Position (nächste Stadt) – für Spritpreis und Anzeige
  function countryAt(x, y) {
    if (!places) return null;
    let best = null;
    for (const [, cx, cy, , country] of places.cities) {
      const d = Math.abs(cx - x) + Math.abs(cy - y);
      if (!best || d < best.d) best = { d, country };
    }
    return best ? places.countries[best.country] || null : null;
  }

  function nearestCity(x, y) {
    if (!places) return null;
    let best = null;
    let token = '';
    for (const [name, cx, cy, , , t] of places.cities) {
      const d = Math.hypot(cx - x, cy - y);
      if (!best || d < best.d) {
        best = { d, name, en: name };
        token = t;
      }
    }
    if (best) best.name = cityLabel(best.en, token); // name: zum Anzeigen, en: für Wetterdienst und Meldungen
    return best;
  }

  // Kandidaten fürs Wetter: nächster Ort, dann die nächste Stadt ab 50 000 und ab 200 000 Einwohnern
  // (kleine Orte kennt der Wetterdienst oft nicht)
  function nearbyWeatherCities(x, y) {
    if (!places) return [];
    const byDist = places.cities.map(([name, cx, cy, pop]) => ({ name, pop: pop || 0, d: Math.hypot(cx - x, cy - y) })).sort((a, b) => a.d - b.d);
    const out = [byDist[0], byDist.find((c) => c.pop >= 50000), byDist.find((c) => c.pop >= 200000)].filter(Boolean).map((c) => c.name);
    return [...new Set(out)];
  }

  window.CarMap = {
    Trail,
    Pose,
    MapView,
    drawCompass,
    setMapData,
    // Kartendatei (Uint8Array) laden – zeichnet wenn möglich im Hintergrund (Worker)
    loadMap,
    hasMapData: () => !!mapData,
    setPlaces: (data) => {
      places = data && Array.isArray(data.cities) ? data : null;
      routeStopCache = new Map(); // Bushalte mit den neuen Ortsdaten neu suchen
      // Gelände vorbereiten: Begrenzungsrahmen und Mitte (Path2D erst beim Zeichnen)
      if (places) places.siteList = CarMapLayers.siteList(places.sites);
      // Ortsflächen, Gelände und Fähren stecken in den Kartenkacheln – neu zeichnen
      layers.gen++;
      sendPlaces();
      prepareRouteCities();
    },
    hasPlaces: () => !!places,
    // Abgekuppelter Anhänger (oder null): Symbol auf der Karte
    setTrailer: (spot) => {
      trailerSpot = spot && Number.isFinite(spot.x) && Number.isFinite(spot.z) ? { x: spot.x, z: spot.z } : null;
    },
    // Ampeln aus dem Spiel (Plugin) als Kartensymbole: nahe beieinander stehende (eine Kreuzung) werden zusammengefasst
    setLights: (list) => {
      const groups = [];
      for (const l of list || []) {
        const g = groups.find((q) => Math.hypot(q.sx / q.n - l.x, q.sz / q.n - l.z) < 60);
        if (g) {
          g.sx += l.x;
          g.sz += l.z;
          g.n++;
        } else groups.push({ sx: l.x, sz: l.z, n: 1 });
      }
      lightIcons = groups.map((g) => ({ x: g.sx / g.n, z: g.sz / g.n }));
      lightsKey = lightIcons.map((g) => `${Math.round(g.x)},${Math.round(g.z)}`).join(';');
    },
    setDriven: (track) => buildDriven(track),
    setExtraPois: (list) => {
      extraPois = list || [];
      extraVersion++;
    },
    // Orte bestimmter Arten in der Nähe (roh, für die Blitzer-App)
    poisNear: (types, x, y, radius) => {
      if (!places) return [];
      const out = [];
      for (const list of [places.pois, extraPois]) {
        for (const poi of list) {
          if (!types.includes(poi[0]) || Math.abs(poi[1] - x) > radius || Math.abs(poi[2] - y) > radius) continue;
          out.push(poi);
        }
      }
      return out;
    },
    nodePosition: (uid) => (mapData ? mapData.nodePosition(uid) : null),
    // Buslinie: Haltestelle an der Route mit Strecke ab Truck (along, negativ = schon vorbei) und bis zum Routenende
    // (remaining), beides in Metern entlang der Route; null ohne Route, Position oder passende Haltestelle
    routeStop: (id, name) => {
      if (!routePoints || !routeCum || !lastSnap) return null;
      const key = `${id || ''}|${name || ''}`;
      if (!routeStopCache.has(key) && places) routeStopCache.set(key, findRouteStop(id, name)); // erst mit Ortsdaten merken
      const hit = routeStopCache.get(key);
      if (!hit) return null;
      const base = routePoints[lastSnap.i];
      const here = routeCum[lastSnap.i] + Math.hypot(lastSnap.x - base.x, lastSnap.y - base.y);
      return { x: hit.x, y: hit.y, along: routeCum[hit.i] - here, remaining: routeCum[routeCum.length - 1] - here };
    },
    // Buslinie: Zwischenhalte, die auf der Karte als Punkte an der Route stehen ([{ id, name }], leer = keine)
    setRouteStops: (list) => {
      const next = Array.isArray(list) ? list : [];
      if (JSON.stringify(next) === JSON.stringify(routeStopMarks)) return;
      routeStopMarks = next;
      extraVersion++; // Karte neu zeichnen
    },
    // points: Array von {x, y} (null = Lücke, z. B. unbekannter Knoten)
    setRoute: (points) => {
      routePoints = points && points.length > 1 ? points : null;
      routeIndex = -1;
      lastSnap = null;
      prepareRoute();
    },
    hasRoute: () => !!routePoints,
    onRoute: () => !!lastSnap,
    // Position auf der Route auch dann verfolgen, wenn gerade keine Karte sichtbar ist
    track: (x, y) => snapToRoute(x, y),
    maneuvers: (headingDeg) => computeManeuvers(headingDeg),
    // Arme der Kreuzung beim Abbiegepunkt index (für das Abbiegesymbol): { straight, opposite } – ob es geradeaus bzw. zur
    // anderen Seite weitergeht. Straßen und Kulissenstraßen außerhalb der Kreuzung – die Fahrspuren in der Kreuzung
    // selbst (Abbiegespuren der anderen Richtungen) sähen sonst wie Arme aus; null ohne Daten
    junctionLegs: async (index) => {
      if (!routePoints || !routePoints[index]) return null;
      // Punkt der Route d Meter vor (dir -1) bzw. nach (dir +1) Punkt j – entlang der Linie, ohne über Lücken zu springen
      const walk = (j, dir, d) => {
        let k = j, done = 0;
        while (done < d) {
          const n = k + dir;
          if (!routePoints[n]) return null;
          done += Math.hypot(routePoints[n].x - routePoints[k].x, routePoints[n].y - routePoints[k].y);
          k = n;
        }
        return routePoints[k];
      };
      const unit = (from, to) => {
        const l = Math.hypot(to.x - from.x, to.y - from.y);
        return l > 1 ? [(to.x - from.x) / l, (to.y - from.y) / l] : null;
      };
      // Kreuzungsmitte: der Punkt (±15 um den Abbiegepunkt) mit dem größten Winkel zwischen Zu- und Ausfahrt (je 20 m)
      let c = null, best = -1;
      for (let j = Math.max(1, index - 15); j <= index + 15 && j < routePoints.length - 1; j++) {
        if (!routePoints[j]) continue;
        const pa = walk(j, -1, 20), pb = walk(j, 1, 20);
        if (!pa || !pb) continue;
        const u = unit(pa, routePoints[j]), v = unit(routePoints[j], pb);
        if (!u || !v) continue;
        const turn = 1 - (u[0] * v[0] + u[1] * v[1]);
        if (turn > best) { best = turn; c = j; }
      }
      if (c === null) return null;
      const C = routePoints[c];
      const pin = walk(c, -1, 30), pout = walk(c, 1, 30);
      const inDir = pin && unit(pin, C), outDir = pout && unit(C, pout);
      if (!inDir || !outDir) return null;
      const lines = await linesNear(C.x, C.y, 70, true);
      if (!Array.isArray(lines)) return null;
      // Stücke der eigenen Route zählen nicht als Arm
      const own = [];
      for (let j = Math.max(0, c - 40); j < Math.min(routePoints.length, c + 40); j++) if (routePoints[j]) own.push(routePoints[j]);
      const onRoute = (x, y) => {
        for (let j = 0; j + 1 < own.length; j++) {
          const a1 = own[j], b1 = own[j + 1];
          const vx = b1.x - a1.x, vy = b1.y - a1.y, l2 = vx * vx + vy * vy || 1;
          const u = Math.max(0, Math.min(1, ((x - a1.x) * vx + (y - a1.y) * vy) / l2));
          if (Math.hypot(a1.x + vx * u - x, a1.y + vy * u - y) < 8) return true;
        }
        return false;
      };
      // Arm in Richtung (ux, uy): Straße (Klasse 0–2) oder Kulissenstraße mit Fahrspuren (5) 18–60 m von der Mitte, höchstens
      // 8 m neben dieser Richtung – wie Apple auch Straßen, die man nicht befahren kann
      const arm = (ux, uy) => lines.some((l) => {
        if (l.c > 2 && l.c !== 5) return false;
        for (let i = 0; i < l.p.length; i += 2) {
          const dx = l.p[i] - C.x, dy = l.p[i + 1] - C.y;
          const along = dx * ux + dy * uy;
          if (along < 18 || along > 60 || Math.abs(dx * uy - dy * ux) > 8) continue;
          if (!onRoute(l.p[i], l.p[i + 1])) return true;
        }
        return false;
      });
      return { straight: arm(inDir[0], inDir[1]), opposite: arm(-outDir[0], -outDir[1]) };
    },
    debugTurns: () => ({ points: routePoints, turns: routeTurns.map((t) => ({ ...t, sign: t.kind === 'roundabout' || t.kind === 'ferry' ? null : turnSign(t) })), snap: lastSnap }), // Test: --dumpturns
    nearbyPlaces,
    roadAt,
    // Liegt (x, y) höchstens maxDist neben der Route und noch vor dem Truck? → Meter entlang der Route, sonst null
    routeAhead: (x, y, maxDist) => {
      if (!routePoints || !lastSnap || !routeCum) return null;
      const near = nearestOnRoute(x, y, ROUTE_CELL);
      if (!near) return null;
      // Abstand zu den Strecken um den nächsten Knoten (Knoten liegen teils 100 m auseinander)
      let best = null;
      for (let i = Math.max(0, near.i - 30); i < Math.min(routePoints.length - 1, near.i + 30); i++) {
        const a = routePoints[i];
        const b = routePoints[i + 1];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
        const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
        if (!best || d < best.d) best = { d, cum: routeCum[i] + Math.sqrt(len2) * t, i };
      }
      if (!best || best.d > Math.abs(maxDist)) return null;
      const base = routePoints[lastSnap.i];
      const along = best.cum - routeCum[lastSnap.i] - Math.hypot(lastSnap.x - base.x, lastSnap.y - base.y);
      return along > 0 ? along : null;
    },
    // Wie routeAhead, zusätzlich Fahrtrichtung der Route an der Stelle (Einheitsvektor) und seitlicher Abstand
    routeAheadDetail: (x, y, maxDist) => {
      if (!routePoints || !lastSnap || !routeCum) return null;
      const near = nearestOnRoute(x, y, ROUTE_CELL);
      if (!near) return null;
      let best = null;
      for (let i = Math.max(0, near.i - 30); i < Math.min(routePoints.length - 1, near.i + 30); i++) {
        const a = routePoints[i];
        const b = routePoints[i + 1];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
        const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
        // side: > 0 rechts der Fahrtrichtung, < 0 links (Kreuzprodukt; y zeigt nach Süden)
        const side = Math.sign(dx * (y - a.y) - dy * (x - a.x)) * d;
        if (!best || d < best.d) best = { d, side, cum: routeCum[i] + Math.sqrt(len2) * t, dir: [dx / Math.sqrt(len2), dy / Math.sqrt(len2)] };
      }
      if (!best || best.d > Math.abs(maxDist)) return null; // negativ: auch hinter uns (wie routeAhead) – die Grenze ist der Betrag
      const base = routePoints[lastSnap.i];
      const along = best.cum - routeCum[lastSnap.i] - Math.hypot(lastSnap.x - base.x, lastSnap.y - base.y);
      return along > 0 || maxDist < 0 ? { along, dir: best.dir, lateral: best.d, side: best.side } : null;
    },
    routeActive: () => !!(routePoints && lastSnap),
    linesNear: (x, y, r) => linesNear(x, y, r),
    buildingsNear: (x, y, r) => buildingsNear(x, y, r),
    roundaboutsNear: (x, y, r) => roundaboutsNear(x, y, r),
    junctionsNear: (x, y, r) => junctionsNear(x, y, r),
    // Baustellen-Objekte um (x, y): [x, y, Art] – null ohne Daten
    worksNear: (x, y, r) => {
      const list = places && places.works;
      if (!Array.isArray(list)) return null;
      const out = [];
      for (const w of list) if (Math.abs(w[0] - x) < r && Math.abs(w[1] - y) < r) out.push(w);
      // die nächsten zuerst – das Instrument bekommt nur eine begrenzte Zahl (dichte Baustellen in ATS)
      return out.sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));
    },
    // Tempolimit-Schilder um (x, y): [x, y, Blickrichtung °, Wert] – null, wenn die Ortsdaten keine haben (ältere Karte)
    limitsNear: (x, y, r) => {
      const list = places && places.limits;
      if (!Array.isArray(list)) return null;
      const out = [];
      for (const l of list) if (Math.abs(l[0] - x) < r && Math.abs(l[1] - y) < r) out.push(l);
      return out;
    },
    // Route vom Truck aus etwa ahead Meter voraus (ein paar Punkte dahinter dazu) als [[x, y], …] – oder null
    routeAheadPoints: (ahead = 260) => {
      if (!routePoints || !lastSnap || !routeCum) return null;
      const start = routePoints[lastSnap.i];
      if (!start) return null;
      const here = routeCum[lastSnap.i] + Math.hypot(lastSnap.x - start.x, lastSnap.y - start.y);
      const out = [];
      // der Punkt direkt hinter dem Truck immer (das Kombiinstrument setzt die Route am Truck an); weitere bis 40 m zurück.
      // Auf langen Geraden liegt er oft weit hinten – ohne ihn verschwand die blaue Spur, bis der nächste Punkt erreicht war
      out.push([start.x, start.y]);
      for (let k = lastSnap.i - 1; k >= 0 && routePoints[k] && here - routeCum[k] < 40; k--) out.unshift([routePoints[k].x, routePoints[k].y]);
      for (let k = lastSnap.i + 1; k < routePoints.length && routePoints[k]; k++) {
        out.push([routePoints[k].x, routePoints[k].y]);
        if (routeCum[k] - here > ahead) break;
      }
      return out.length >= 2 ? out : null;
    },
    countryAt,
    nearestCity,
    nearbyWeatherCities,
  };
})();
