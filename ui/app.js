// Erzeugt aus ui/src mit tools/build-ui.js – hier nicht bearbeiten, Änderungen in ui/src.
(function () {
  const catalog = window.CarPlayCatalog;
  const ICONS = window.CarPlayIcons;
  const APP_ICONS = window.CarPlayAppIcons || {};
  const APP_NAMES = window.CarPlayAppNames || {};
  const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const params = new URLSearchParams(location.search);
  const role = params.get('role') || 'game'; // game = Bildschirm im Truck, editor = sichtbares Fenster
  const api = window.carplay;
  const demoMode = !api || params.has('demo');
  let clusterNote = null; // letzte Mitteilung für die Hinweis-Karten im Kombiinstrument (Einstellung clusterNotes)
  let clusterNoteId = 0;

  const shell = document.getElementById('shell');
  const stage = document.getElementById('stage');
  // Nach einem Neuladen keine alte Scrollposition der Seite wiederherstellen (die Oberfläche scrollt nie als Ganzes)
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  const dock = document.getElementById('dock');
  const homeButton = document.getElementById('home-button');
  const toastEl = document.getElementById('toast');

  // ------------------------------------------------------------------ Zustand
  let settings = catalog.sanitize(null);
  let customWallpaper = null;
  let wallpaperFiles = {}; // Bilder aus app/data/wallpapers
  let customIcons = {};
  let screen = null; // 'home' | App-ID
  let previousScreen = null;
  let settingsStack = ['main'];
  let settingsReturn = null; // Einstellungen aus einer App geöffnet (Karten-Menü „Mehr …“): Zurück führt dorthin
  let settingsShown = ''; // Einstellungsseite, die gerade im DOM steht (Scrollposition beim Neuzeichnen behalten)
  let telemetry = null;
  let media = null;
  let mediaReceivedAt = 0;
  let theme = 'dark';
  let connection = false;
  let hotkeys = {};
  let pluginHotkeys = null;
  let capturing = null; // Aktion, deren Tastenkürzel gerade aufgenommen wird
  let captureError = '';
  let mapStatus = null;
  let mapStatusOther = null; // Karte des anderen installierten Spiels (Einstellungen › Kartendaten)
  let appVersion = '';
  let appDataDir = '';
  let homePage = 0;
  let musicTab = 'now';
  let stopsTab = 'g';
  let artColor = '';
  let pluginInfo = null; // Version des Plugins im Spiel (Handshake)
  // Laufendes Spiel (main.js: ets2 oder ats) mit seinen Einheiten aus dem Spielprofil – für „Wie im Spiel“,
  // die Währung, US-Schilder und Bundesstaaten
  let currentGame = { id: params.get('game') === 'ats' ? 'ats' : 'ets2', units: null };
  const isAts = () => currentGame.id === 'ats';
  document.body.dataset.game = currentGame.id;
  let libTab = 'start'; // Spotify: start | recent | search | playlists (Bibliothek)
  let spotifyStatus = null;
  let spotifyLib = null;
  let videoStopped = false;
  let videoPip = false;
  // laufendes Video: Position, Länge, Geschwindigkeit, Live-Stream (aus dem Player, alle 0,5 s)
  let videoTime = 0;
  let videoDuration = 0;
  let videoRate = 1;
  let videoLive = false; // Video läuft klein in einer Ecke weiter (Bild im Bild), während eine andere App offen ist

  const trail = new CarMap.Trail();
  const pose = new CarMap.Pose();
  let maps = [];
  let compasses = [];

  const nav = createCarNav(document.body);
  const editor = createCarEditor({
    root: document.body,
    ghost: document.getElementById('drag-ghost'),
    popover: document.getElementById('popover'),
    catalog,
    getSettings: () => settings,
    commit: (next) => applySettings(next, true),
    icons: {
      has: (id) => !!customIcons[id],
      pick: (id) => pickIcon(id),
      reset: (id) => resetIcon(id),
      available: !!api && role === 'editor', // Datei-Dialog nur im Fenster am PC
    },
    // Ziehen über den Seitenrand: zur Nachbarseite des Home-Bildschirms blättern (nicht zum Dashboard)
    pages: {
      canTurn: (dir) => screen === 'home' && homePage + dir >= 0 && homePage + dir < homePages().length,
      turn: (dir) => setHomePage(homePage + dir),
    },
  });

  // ------------------------------------------------------------------ Hilfen
  const escape = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const pad = (n) => String(n).padStart(2, '0');
  // Uhrzeit 24 h oder 12 h (AM/PM); clockU hängt im 24-h-Format „Uhr“ an
  // Uhr und Einheiten: Einstellung, bei „Wie im Spiel“ (auto) aus dem Spielprofil (ohne Profil: 24 h, metrisch)
  const clockMode = () => (settings?.clock && settings.clock !== 'auto' ? settings.clock : currentGame.units?.clock || '24');
  const unitMode = () => (settings?.units && settings.units !== 'auto' ? settings.units : currentGame.units?.units || 'metric');
  const clock = (min) => {
    const h = Math.floor(min / 60) % 24;
    const m = pad(Math.floor(min) % 60);
    return clockMode() === '12' ? `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}` : `${pad(h)}:${m}`;
  };
  const clockU = (min) => (clockMode() === '12' ? clock(min) : `${clock(min)} Uhr`);
  const dayClock = (min) => `${DAYS[Math.floor(min / 1440) % 7]} ${clock(min)}`;
  const dayClockU = (min) => (clockMode() === '12' ? dayClock(min) : `${dayClock(min)} Uhr`);
  // Einheiten: metrisch, US oder UK (Spieldaten sind immer metrisch)
  const imperial = () => unitMode() === 'us' || unitMode() === 'uk';
  const spd = (kmh) => Math.round(imperial() ? kmh * 0.621371 : kmh);
  const zhUnits = () => !!window.CarI18n?.chinese; // Chinesisch (vereinfacht/traditionell): Einheiten ausgeschrieben (KloseY)
  const zhT = (simp, trad) => (window.CarI18n?.hant ? trad : simp); // feste Texte: vereinfacht / traditionell
  const spdUnit = () => (imperial() ? 'mph' : zhUnits() ? zhT('公里/小时', '公里/小時') : 'km/h');
  // Tempo-Differenz in der eingestellten Einheit (Tempo-Warnung „ab +5“) in km/h – bei mph also +5 mph
  const spdDeltaKmh = (v) => (imperial() ? v * 1.609344 : v);
  const temp = (c) => Math.round(unitMode() === 'us' ? c * 1.8 + 32 : c);
  const GALLON = () => (unitMode() === 'uk' ? 4.54609 : 3.78541);
  const volume = (l) => (imperial() ? `${Math.round(l / GALLON())} gal` : `${Math.round(l)} ${zhUnits() ? '升' : 'l'}`);
  const MPG = () => (unitMode() === 'uk' ? 282.481 : 235.215);
  const consumption = (l100) => (imperial() ? `${MPG() / l100 >= 10 ? Math.round(MPG() / l100) : (MPG() / l100).toFixed(1).replace('.', ',')} mpg` : `${l100.toFixed(1).replace('.', ',')} ${zhUnits() ? 'L/100 公里' : 'l/100 km'}`);
  // unter einer Tonne in kg (Kurierladungen im Auto, Road Trip) – sonst stünde dort „0 t“
  const mass = (kg) => (imperial() ? `${Math.round(kg * 2.20462).toLocaleString('de-DE')} lb` : kg < 1000 ? `${Math.max(1, Math.round(kg))} kg` : `${(kg / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} t`);
  // Geld in der Währung des Spiels (Telemetrie: ETS2 Euro, ATS Dollar) – Tausender wie überall mit Punkt („$12.345“),
  // damit die Übersetzungen (z. B. Polnisch „12 345“) und das Vorlesen die Zahl richtig lesen
  const money = (v) => (isAts() ? `${v < 0 ? '-' : ''}$${Math.round(Math.abs(v)).toLocaleString('de-DE')}` : `${Math.round(v).toLocaleString('de-DE')} €`);
  // Tempolimit aus den Kartendaten (km/h, bei mph-Ländern und ATS mph) in den eingestellten Einheiten
  const limitIn = (v, mph) => (!v ? 0 : imperial() ? (mph ? v : Math.round(v * 0.621371)) : mph ? Math.round(v * 1.609344) : v);
  const signedMoney = (v) => (v > 0 ? `+${money(v)}` : v < 0 ? `−${money(-v)}` : '');
  const gear = (g) => (g === 0 ? (zhUnits() ? '—' : 'N') : g < 0 ? `R${-g}` : String(g));
  const percent = (f) => `${Math.round(Math.max(0, Math.min(1, f)) * 100)} %`;
  const num = (v) => (Number.isFinite(v) ? v : 0);
  function duration(min) {
    if (!(min > 0)) return '–';
    // erst auf ganze Minuten runden – sonst wurde aus 119,6 Minuten „1 Std. 60 Min.“
    const total = Math.round(min);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? `${h} Std. ${m} Min.` : `${Math.max(1, m)} Min.`;
  }
  // Maßstab des Spiels: ETS2 staucht die Welt (Land etwa 1:19, Städte 1:3). Kilometer im Spiel (Navi, Reichweite,
  // Auftrag) sind „Spielkilometer“ – Abstände aus der Karte sind echte Weltmeter. Für Angaben, die man mit dem Spiel
  // vergleicht (Tankstellen, Rastplätze, Werkstatt), umrechnen. Der Faktor kommt live aus dem Verhältnis von
  // Spiel-Restkilometern zur Routenlänge (07c-navi-route.js), ohne Route der Landmaßstab.
  let worldScale = 19;
  const gameMeters = (worldM) => worldM * worldScale;
  function distance(km) {
    if (!(km > 0)) return '–';
    const v = imperial() ? km * 0.621371 : km;
    const unit = imperial() ? 'mi' : 'km';
    return v >= 10 ? `${Math.round(v).toLocaleString('de-DE')} ${unit}` : `${v.toFixed(1).replace('.', ',')} ${unit}`;
  }
  function meters(m) {
    if (imperial()) {
      // unter 0,1 Meilen in Fuß (US) bzw. Yards (UK), darüber in Meilen
      if (m >= 161) return distance(m / 1000);
      if (unitMode() === 'uk') return `${Math.max(10, Math.round((m * 1.09361) / 10) * 10)} yd`;
      return `${Math.max(50, Math.round((m * 3.28084) / 50) * 50)} ft`;
    }
    // auf 50 m gerundet ergibt 980 m schon „1000 m“ – dann lieber „1 km“
    if (m < 975) return `${Math.max(10, Math.round(m / (m < 300 ? 10 : 50)) * (m < 300 ? 10 : 50))} m`;
    return distance(m / 1000);
  }
  function mmss(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${pad(s % 60)}`;
  }

  // Die Telemetrie liefert Städtenamen teils in Landesschrift ("Мостар") – wie im HUD lateinisch anzeigen
  const TRANSLIT = {
    а: 'a', б: 'b', в: 'v', г: 'g', ґ: 'g', д: 'd', ђ: 'đ', е: 'e', є: 'je', ё: 'jo', ж: 'ž', з: 'z', и: 'i', і: 'i', ї: 'ji',
    й: 'j', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ћ: 'ć',
    у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'č', џ: 'dž', ш: 'š', щ: 'šč', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'ju', я: 'ja',
    α: 'a', ά: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', έ: 'e', ζ: 'z', η: 'i', ή: 'i', θ: 'th', ι: 'i', ί: 'i', ϊ: 'i',
    κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', ό: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', ύ: 'y',
    φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o', ώ: 'o',
  };
  function latin(text) {
    if (!text || !/[Ͱ-ϿЀ-ӿ]/.test(text)) return text || '';
    return [...text].map((ch) => {
      const lower = ch.toLowerCase();
      const out = TRANSLIT[lower];
      if (out === undefined) return ch;
      return ch !== lower && out ? out[0].toUpperCase() + out.slice(1) : out;
    }).join('');
  }

  function appInfo(id) {
    const base = catalog.APPS[id];
    const custom = settings.apps[id] || {};
    const [c1, c2] = catalog.COLORS[custom.color || base.color];
    const themed = (APP_NAMES[settings.iconTheme] || {})[id];
    return { id, name: custom.name || themed || base.name, c1, c2, image: customIcons[id] || null };
  }

  // Farbiges Quadrat mit Symbol (Einstellungen, Mitteilungen, Orte)
  const badge = (icon, color) => {
    const [c1, c2] = catalog.COLORS[color] || catalog.COLORS.gray;
    return `<span class="badge" style="--c1:${c1};--c2:${c2}">${ICONS[icon] || ''}</span>`;
  };

  // ------------------------------------------------------------------ Bausteine
  function iconHtml(id) {
    const a = appInfo(id);
    // Kalender zeigt wie auf dem iPhone Wochentag und Tag (echtes Datum)
    if (id === 'calendar' && !a.image) {
      const now = new Date();
      return `<div class="icon cal-icon"><span>${DAYS[(now.getDay() + 6) % 7]}</span><b>${now.getDate()}</b></div>`;
    }
    // Fahrzeug: Logo der gefahrenen Marke (eigenes Bild und eigene Farbe haben Vorrang)
    if (id === 'truck' && !a.image && !(settings.apps[id] || {}).color) {
      const brand = brandLogoId();
      if (brand) return `<div class="icon art-icon brand-icon${MONO_LOGOS.includes(brand) ? ' mono' : ''}${FLAT_LOGOS.includes(brand) ? ' flat' : ''}" style="--tint:${a.c1}">${brandIconSvg(brand)}</div>`;
    }
    // Vollflächige Icons im Stil der echten Apps (Google Maps, Spotify …), außer eigene Farbe gewählt
    const iconStyle = params.get('icons') || settings.iconStyle;
    const art = !a.image && !(settings.apps[id] || {}).color
      ? (APP_ICONS[`${settings.iconTheme}-${iconStyle}`] || {})[id] || (APP_ICONS[settings.iconTheme] || {})[id] : null;
    // --tint: Farbe der App – im Symbolstil „Dunkel“ wird die weiße Glyphe damit eingefärbt
    if (art) return `<div class="icon art-icon" style="--tint:${a.c1}">${uniqueIds(art)}</div>`;
    const image = a.image ? `background-image:url('${a.image}')` : '';
    return `<div class="icon ${a.image ? 'custom' : ''}" style="--c1:${a.c1};--c2:${a.c2};${image}">${a.image ? '' : ICONS[id]}</div>`;
  }

  // Marke aus der Telemetrie („Mercedes-Benz“, „Western Star“ …) -> Logo in main/brand-logos.js
  const BRAND_LOGOS = ['scania', 'volvo', 'man', 'daf', 'mercedes', 'renault', 'iveco', 'peterbilt', 'kenworth', 'freightliner', 'mack', 'westernstar', 'international', 'ford'];
  // Gemessen an den Logo-Pixeln: einfarbig schwarz (über 95 % dunkel) – in Dunkel und Klar weiß statt unsichtbar;
  // flach und dunkel ohne helle Innenflächen (DAF) – in Klar ebenfalls als weiße Silhouette
  const MONO_LOGOS = ['volvo', 'renault', 'iveco', 'mack', 'international'];
  const FLAT_LOGOS = [...MONO_LOGOS, 'daf'];
  function brandLogoId() {
    if (!settings.brandIcon || !api) return '';
    const raw = String(telemetry?.truckBrand || '').toLowerCase().replace(/[^a-z]/g, '');
    const id = raw.startsWith('mercedes') ? 'mercedes' : raw.startsWith('renault') ? 'renault' : raw;
    return BRAND_LOGOS.includes(id) && brandLogoReady(id) ? id : '';
  }
  // Logo erst zeigen, wenn es wirklich geladen ist: ohne Internet oder mit gesperrtem Wikimedia (China, Issue #9/#10) zeigte
  // das Symbol sonst das Platzhalterbild für fehlende Bilder. Bis dahin und danach das normale Fahrzeug-Symbol; nach
  // einem Fehler in 10 Minuten neu versuchen
  const brandLogoState = new Map(); // Marke -> 'ok' | 'failed' | 'loading'
  function brandLogoReady(id) {
    const state = brandLogoState.get(id);
    if (state) return state === 'ok';
    brandLogoState.set(id, 'loading');
    const img = new Image();
    img.onload = () => {
      brandLogoState.set(id, img.naturalWidth > 0 ? 'ok' : 'failed');
      if (img.naturalWidth > 0) render();
    };
    img.onerror = () => {
      brandLogoState.set(id, 'failed');
      setTimeout(() => brandLogoState.delete(id), 600000);
    };
    img.src = `cpdata://brands/${id}.png`;
    return false;
  }
  // Logo auf hellem Grund (Symbolstil Farbe); Dunkel/Klar blenden den Grund aus und machen das Logo weiß
  const brandIconSvg = (id) => `<svg viewBox="0 0 60 60" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="bi-bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe5ec"/></linearGradient></defs>
    <rect class="ai-bg" width="60" height="60" fill="url(#bi-bg)"/>
    <image class="ai-glyph ai-logo" href="cpdata://brands/${id}.png" x="5" y="8" width="50" height="44" preserveAspectRatio="xMidYMid meet"/></svg>`;

  // Jede Kopie eines Icons bekommt eigene Verlaufs-IDs – sonst verweisen alle auf die erste Kopie,
  // und liegt die auf einer ausgeblendeten Seite, fehlen Farben (z. B. im Symbolstil „Dunkel“)
  let iconInstance = 0;
  function uniqueIds(svg) {
    const k = (++iconInstance).toString(36);
    return svg.replace(/(id="|url\(#)(ai-[\w-]+)/g, (_, prefix, id) => `${prefix}${id}-${k}`);
  }

  function appIcon(id) {
    const a = appInfo(id);
    return `<button class="app" data-app="${id}" data-open="${id}" data-focus>${iconHtml(id)}<span class="app-badge" data-app-badge="${id}" hidden></span><span class="label">${escape(a.name)}</span></button>`;
  }

  // Kartenstil (--mapstyle=… übersteuert nur zum Testen)
  const mapStyle = () => params.get('mapstyle') || settings.mapStyle;

  // Karten-Menü wie in CarPlay: Raster aus großen Kacheln (Schalter leuchten blau, die anderen öffnen eine Unterseite)
  let mapSheetOpen = false;
  let mapSheetPage = 'main';
  const onOff = (v) => (v ? 'An' : 'Aus');
  function mapSheet() {
    const tile = (icon, label, value, attrs, on = false) => `<button class="mm-tile ${on ? 'on' : ''}" data-focus ${attrs}>
        <span class="mm-icon">${ICONS[icon] || ''}</span><b>${label}</b><small>${escape(value)}</small></button>`;
    const check = (key, value, label) => `<button class="mm-row" data-focus data-choose="${key}" data-value="${value}"><span>${escape(label)}</span>
        <span class="row-check">${String(getOption(key)) === String(value) ? ICONS.check : ''}</span></button>`;
    const sw = (key, label, tag = '') => `<button class="mm-row" data-focus data-toggle="${key}"><span>${label}${tag ? `<em class="tag-beta">${tag}</em>` : ''}</span><span class="switch ${settings[key] ? 'on' : ''}"></span></button>`;
    // Lautstärke: Schieberegler (Ziehen zeigt den Wert, Loslassen speichert – 10-bedienung.js)
    const vol = (key, label, step = 1) => `<div class="mm-row static mm-slider"><span>${label}</span>
        <input type="range" class="vol-range" min="0" max="100" step="${step}" value="${settings[key]}" data-focus data-volume-range="${key}" style="--v:${settings[key]}%">
        <em class="vol-val">${settings[key]} %</em></div>`;
    const list = (rows) => `<div class="mm-list">${rows}</div>`;
    const pages = {
      main: ['Einstellungen', `<div class="mm-grid">
          ${tile('layers', 'Kartenstil', OPTIONS.mapStyle[settings.mapStyle], 'data-sheet-page="style"')}
          ${tile('appearance', 'Kartenfarben', `${OPTIONS.mapTheme[settings.mapTheme]} · jetzt ${mapThemeName() === 'dark' ? 'dunkel' : 'hell'}`, 'data-sheet-page="colors"')}
          ${tile('cube', '3D-Ansicht', onOff(settings.mapTilt), 'data-toggle="mapTilt"', settings.mapTilt)}
          ${tile('north', 'Norden oben', onOff(settings.mapNorth), 'data-toggle="mapNorth"', settings.mapNorth)}
          ${tile('radar', 'Blitzer', onOff(settings.radar), 'data-toggle="radar"', settings.radar)}
          ${tile('parking', 'Rastplätze', `An der Route: ${onOff(settings.mapAlong)}`, 'data-toggle="mapAlong"', settings.mapAlong)}
          ${tile('sliders', 'Karteninhalt', 'Orte, Straßen, Ampeln', 'data-sheet-page="content"')}
          ${tile('speaker', 'Lautstärke', settings.voice ? `Ansagen ${settings.volumeVoice} %` : 'Ansagen aus', 'data-sheet-page="volume"')}
        </div>
        <div class="mm-foot"><button class="mm-report" data-focus data-sheet-page="report">${ICONS.warning || ""}<span>Fehler auf der Karte melden</span><small>Für die Stelle, an der du gerade bist</small></button></div>`],
      report: ['Was ist hier falsch?', list(`<div class="mm-group">
          <button class="mm-row" data-focus data-action="map-report" data-kind="land"><span>Karte zeigt Wasser – im Spiel ist hier Land</span></button>
          <button class="mm-row" data-focus data-action="map-report" data-kind="water"><span>Karte zeigt Land – im Spiel ist hier Wasser</span></button>
          <button class="mm-row" data-focus data-action="map-report" data-kind="other"><span>Etwas anderes (Straße, Ort, Symbol)</span></button>
        </div><p class="group-note">Gemeldet wird die Stelle, an der dein Truck gerade steht, mit einem Bild der Karte. Beim nächsten Erneuern der Karte wird sie geprüft und korrigiert.</p>`)],
      style: ['Kartenstil', list(`<div class="mm-group">${Object.entries(OPTIONS.mapStyle).map(([v, l]) => check('mapStyle', v, l)).join('')}</div>`)],
      colors: ['Kartenfarben', list(`<div class="mm-group">${Object.entries(OPTIONS.mapTheme).map(([v, l]) => check('mapTheme', v, l)).join('')}</div>`)],
      content: ['Karteninhalt', list(`<div class="mm-group">${sw('mapLabels', 'Städtenamen')}${sw('mapPois', 'Tankstellen & Rastplätze')}${sw('mapAreas', 'Grünflächen & Orte')}${sw('mapBuildings', 'Gebäude')}${sw('map3dBuildings', '3D-Gebäude')}${sw('mapTowns', 'Kleine Orte')}${sw('mapViewpoints', 'Aussichtspunkte')}${sw('mapWater', 'Meer')}${sw('mapInlandWater', 'Flüsse & Seen', 'Experimentell')}${sw('mapForest', 'Wälder')}${sw('mapMeadow', 'Wiesen & Büsche')}${sw('mapGround', 'Felder, Fels & Sand')}${sw('mapSites', 'Firmengelände & Steinbrüche')}${sw('mapSiteNames', 'Firmennamen')}${sw('mapBusStops', 'Bushaltestellen')}${sw('mapTrail', 'Gefahrene Strecke')}${sw('mapDriven', 'Alle gefahrenen Strecken')}${sw('mapLaneMarkings', 'Fahrbahnmarkierungen')}${sw('mapHiddenRoads', 'Versteckte Straßen')}${sw('mapSecretRoads', 'Geheime Abkürzungen')}${sw('mapRails', 'Bahnlinien')}${sw('mapShields', 'Straßennummern')}${sw('mapLightIcons', 'Ampeln auf der Karte')}${sw('mapHighways', 'Autobahnen farbig')}${sw('mapRoadClasses', 'Straßen nach Art einfärben')}${sw('mapLights', 'Ampeln voraus')}</div>`)],
      volume: ['Lautstärke', list(`<div class="mm-group">${sw('voice', 'Ansagen')}${vol('volumeVoice', 'Sprachansagen')}${isBus(telemetry) ? vol('volumeAnnounce', 'Durchsagen im Bus') : ''}</div>
          <div class="mm-group">${sw('radarSound', 'Blitzer-Warnton')}${vol('volumeAlerts', 'Warntöne')}</div>
          <div class="mm-group">${vol('volumeRadio', 'Radio', 1)}</div>`)],
    };
    const [title, body] = pages[mapSheetPage] || pages.main;
    return `<div class="map-menu" data-bind="map-sheet" ${mapSheetOpen ? '' : 'hidden'}>
        <div class="mm-head">
          <button class="mm-back" data-focus data-action="sheet-back">${ICONS.back}<span>${mapSheetPage === 'main' ? 'Karte' : 'Zurück'}</span></button>
          <h2>${title}</h2>
          ${mapSheetPage === 'main' ? '<button class="mm-all" data-focus data-action="map-settings">Mehr …</button>' : ''}
        </div>
        ${body}
      </div>`;
  }
  // Nur das Menü neu zeichnen (die Karte darunter bleibt)
  function rerenderMapSheet() {
    const tpl = document.createElement('template');
    tpl.innerHTML = mapSheet().trim();
    const next = tpl.content.firstElementChild;
    for (const el of stage.querySelectorAll('[data-bind="map-sheet"]')) {
      el.hidden = next.hidden;
      if (!morph(el, next)) el.innerHTML = next.innerHTML;
    }
    nav.reset();
  }
  // Gleich aufgebaute Elemente in place angleichen (Attribute, Text); false, wenn der Aufbau anders ist
  function sameShape(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName || a.childNodes.length !== b.childNodes.length) return false;
    for (let i = 0; i < a.childNodes.length; i++) if (!sameShape(a.childNodes[i], b.childNodes[i])) return false;
    return true;
  }
  function morph(a, b) {
    if (a.childNodes.length !== b.childNodes.length || ![...a.childNodes].every((c, i) => sameShape(c, b.childNodes[i]))) return false;
    const walk = (x, y) => {
      if (x.nodeType === 3) {
        if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue;
        return;
      }
      if (x.nodeType !== 1) return;
      for (const { name, value } of [...y.attributes]) if (name !== 'class' && x.getAttribute(name) !== value) x.setAttribute(name, value);
      for (const { name } of [...x.attributes]) if (name !== 'class' && !y.hasAttribute(name)) x.removeAttribute(name);
      if (typeof y.className === 'string' && x.className.replace(/ ?(pressed|focused)/g, '') !== y.className) {
        const keep = ['pressed', 'focused'].filter((c) => x.classList.contains(c));
        x.className = y.className;
        for (const c of keep) x.classList.add(c);
      }
      for (let i = 0; i < x.childNodes.length; i++) walk(x.childNodes[i], y.childNodes[i]);
    };
    for (let i = 0; i < a.childNodes.length; i++) walk(a.childNodes[i], b.childNodes[i]);
    return true;
  }

  function mapView(mode) {
    const o = settings.overlays;
    // Google/Apple: in eine Ecke gelegt statt fest wie im Original (03-ios-stil.css, [data-free])
    const free = (k) => ((mapStyle() === 'google' || mapStyle() === 'apple') && settings.overlayFree?.[k] ? ' data-free' : '');
    const controls = mode === 'full'
      ? `<div class="map-controls">
          <div class="zoom-pill glass ${zoomVisible ? 'show' : ''}" data-bind="zoom-pill">
            <button data-map-cmd="in" data-focus aria-label="Näher">${ICONS.plus}</button>
            <button data-map-cmd="out" data-focus aria-label="Weiter weg">${ICONS.minus2}</button>
          </div>
          <button class="map-btn glass auto-btn" data-map-cmd="auto" data-focus data-bind="auto-btn" ${settings.mapZoom ? '' : 'hidden'}>Auto</button>
          <button class="map-btn glass ${mapOverview ? 'active' : ''}" data-map-cmd="overview" data-focus data-bind="overview-btn" aria-label="Übersicht der Route">${ICONS.route}</button>
          <button class="map-btn glass" data-map-cmd="sheet" data-focus aria-label="Karteneinstellungen">${ICONS.more}</button>
        </div>
`
      : '';
    return `<div class="map map-${mode}">
      <canvas data-map></canvas>
      <div class="map-note glass" data-bind="map-note" hidden></div>
      <div class="ov maneuver glass idle" data-ov="banner" data-pos="${o.banner}"${free('banner')} data-bind="maneuver">
        <div class="mv-main">
          <div class="mv-arrow" data-bind="mv-arrow"></div>
          <div class="mv-text">
            <div class="mv-dist" data-bind="mv-dist"></div>
            <div class="mv-road" data-bind="mv-road"></div>
          </div>
        </div>
        <div class="mv-lanes" data-bind="mv-lanes"></div>
        <div class="mv-light" data-bind="mv-light" hidden></div>
        <div class="mv-curve" data-bind="mv-curve" hidden></div>
        <div class="mv-then" data-bind="mv-then"><span>Dann</span><div class="mv-then-arrow" data-bind="mv-then-arrow"></div></div>
        <div class="road-notice" data-bind="road-notice" hidden></div>
      </div>
      ${mode === 'full' ? mapSheet() : ''}
      ${mode === 'full' ? '<div class="along glass" data-bind="along" hidden><div class="along-head">Entlang der Route</div><div class="along-rows" data-list="along"></div></div>' : ''}
      ${mapStyle() === 'apple'
        ? `<div class="ov eta apple-eta glass" data-ov="eta" data-pos="${o.eta}" data-bind="eta">
            <div><b data-bind="eta-arrive">–</b><small data-bind="eta-label">Ankunft</small></div>
            <div><b data-bind="eta-num">–</b><small data-bind="eta-unit">Min.</small></div>
            <div><b data-bind="eta-kmnum">–</b><small>km</small></div>
          </div>`
        : mapStyle() === 'google'
          ? `<div class="ov eta google-eta glass" data-ov="eta" data-pos="${o.eta}" data-bind="eta">
            <div class="ge-top"><b data-bind="eta-arrive">–</b><span data-bind="eta-label">Ankunft</span></div>
            <div class="ge-sub"><span class="ge-min" data-bind="eta-duration">–</span><span class="dot">·</span><span data-bind="eta-km"></span></div>
          </div>`
          : `<div class="ov eta glass" data-ov="eta" data-pos="${o.eta}" data-bind="eta">
            <div class="eta-duration" data-bind="eta-duration">–</div>
            <div class="eta-meta"><span data-bind="eta-km"></span><span class="dot">·</span><span data-bind="eta-clock"></span><span data-bind="eta-to"></span></div>
          </div>`}
      <div class="ov speedo glass ${settings.mapNextLimitStyle === 'below' || mode !== 'full' ? 'nl-below' : ''}" data-ov="speed" data-pos="${o.speed}"${free('speed')}>
        <div class="next-limit" data-bind="next-limit" hidden><span class="nl-sign" data-bind="nl-sign"></span><small data-bind="nl-dist"></small></div>
        <div class="limit" data-bind="limit">–</div>
        <div class="speed"><span data-bind="speed">0</span><small>${spdUnit()}</small></div>
      </div>
      <button class="ov compass glass" data-ov="compass" data-pos="${o.compass}" data-map-cmd="north" aria-label="Norden oben / Fahrtrichtung"><canvas data-compass></canvas></button>
      ${controls}
    </div>`;
  }

  function mediaControls(size) {
    return `<div class="controls controls-${size}">
      <button data-cmd="previous" data-focus aria-label="Zurück">${ICONS.previous}</button>
      <button data-cmd="toggle" data-focus class="play" data-bind="play" aria-label="Wiedergabe">${ICONS.play}</button>
      <button data-cmd="next" data-focus aria-label="Weiter">${ICONS.next}</button>
    </div>`;
  }

  const meter = (label, bind, extra = '') => `
    <div class="meter"><label>${label}<em data-bind="${bind}-text"></em></label><div class="bar"><div class="bar-fill" data-bind="${bind}-bar"></div></div>${extra}</div>`;

  // ------------------------------------------------------------------ Dashboard-Widgets
  const WIDGET_APP = { map: 'maps', nav: 'maps', places: 'stops', music: 'music', calendar: 'calendar', weather: 'weather', radar: 'radar', truck: 'truck', job: 'job', messages: 'messages', stops: 'stops', trip: 'logbook', sport: 'sports' };

  function widgetBody(type) {
    switch (type) {
      case 'map':
        return mapView('dash');
      case 'music':
        // wie das CarPlay-Widget: Cover, Titel, Fortschritt, drei Knöpfe
        return `<div class="wm-bg" data-bind="np-bg"></div>
          <div class="wm" data-focus data-open="music" data-music-now="1">
            <div class="art" data-bind="art"></div>
            <div class="wm-info" data-no-names><div class="t-title" data-bind="title"></div><div class="t-artist" data-bind="artist"></div></div>
          </div>
          <div class="progress"><div class="progress-fill" data-bind="progress"></div></div>
          ${mediaControls('small')}
          <div class="wm-bg rd-wbg" data-bind="rd-wbg"></div>
          <div class="wr" data-focus data-open="radio">
            <div class="art wr-art" data-bind="wr-art"></div>
            <div class="wm-info"><div class="t-title" data-bind="wr-title"></div><div class="t-artist" data-bind="wr-name"></div></div>
          </div>
          <div class="controls controls-small wr-controls">
            <button data-focus data-action="radio-prev" aria-label="Vorheriger Sender">${ICONS.previous}</button>
            <button data-focus class="play" data-action="radio-toggle" data-bind="wr-play" aria-label="Abspielen / Stopp">${ICONS.play}</button>
            <button data-focus data-action="radio-next" aria-label="Nächster Sender">${ICONS.next}</button>
          </div>
          <div class="wv" data-focus data-open="video">
            <div class="art wv-art" data-bind="wv-art"></div>
            <div class="wm-info"><div class="t-title" data-bind="wv-title"></div><div class="t-artist" data-bind="wv-kind"></div></div>
          </div>
          <div class="controls controls-small wv-controls">
            <button data-focus data-action="video-seek" data-step="-15" aria-label="15 Sekunden zurück">${seekIcon(-1, 15)}</button>
            <button data-focus class="play" data-action="video-toggle" aria-label="Pause / Weiter">${videoPaused ? ICONS.play : ICONS.pause}</button>
            <button data-focus data-action="video-seek" data-step="15" aria-label="15 Sekunden vor">${seekIcon(1, 15)}</button>
          </div>`;
      case 'nav':
        // nächstes Manöver wie im Banner der Karte (gleiche Datenbindung)
        return `<div class="wn idle" data-bind="maneuver">
            <div class="wn-active">
              <div class="mv-main">
                <div class="mv-arrow" data-bind="mv-arrow"></div>
                <div class="mv-text"><div class="mv-dist" data-bind="mv-dist"></div><div class="mv-road" data-bind="mv-road"></div></div>
              </div>
              <div class="mv-lanes hidden" data-bind="mv-lanes"></div>
              <div class="mv-light" data-bind="mv-light" hidden></div>
              <div class="mv-curve" data-bind="mv-curve" hidden></div>
              <div class="road-notice" data-bind="road-notice" hidden></div>
            </div>
            <div class="wn-idle">${badge('maps', 'blue')}<b>Keine Route</b><small>Ziel in Karten oder im Spiel wählen</small></div>
          </div>`;
      case 'places':
        // wie die Ziel-Vorschläge von Apple Karten (Privat, Parkplatz …)
        return `<div class="places">
            <button data-focus data-stops-open="g"><span class="pl-ic" style="--c:#0a84ff">${ICONS.fuel}</span><small>Tanken</small></button>
            <button data-focus data-stops-open="p"><span class="pl-ic" style="--c:#0a84ff">${ICONS.parking}</span><small>Rasten</small></button>
            <button data-focus data-stops-open="s"><span class="pl-ic" style="--c:#ff9f0a">${ICONS.service}</span><small>Werkstatt</small></button>
          </div>
          <div class="places-next" data-bind="places-next"></div>`;
      case 'weather':
        return `<div class="ww">
            <div class="ww-city" data-bind="wx-city">Wetter</div>
            <div class="ww-row"><b data-bind="wx-temp">–</b><span class="wx-icon" data-bind="wx-icon"></span></div>
            <div class="ww-cond" data-bind="wx-cond"></div>
            <div class="ww-hl" data-bind="wx-hl"></div>
          </div>`;
      case 'radar':
        // wie Blitzer-Apps: Tempo, Limit und ob die Strecke frei ist
        return `<div class="widget-title">${badge('radar', 'red')}Blitzer</div>
          <div class="wr"><div class="limit" data-bind="limit">–</div><div class="speed"><span data-bind="speed">0</span><small>${spdUnit()}</small></div></div>
          <div class="wr-status" data-bind="radar-mini">Strecke frei</div>`;
      case 'calendar':
        return `<div class="wc-head"><span data-bind="cal-weekday">–</span><b data-bind="cal-time">--:--</b></div>
          <div class="mini-list" data-list="agenda-mini"></div>`;
      case 'truck':
        return `<div class="widget-title">${badge('truck', 'orange')}Fahrzeug</div>
          <div class="wt-speed"><span data-bind="speed">0</span><small>${spdUnit()}</small><b class="wt-gear" data-bind="gear">N</b></div>
          ${meter('Tank', 'fuel')}`;
      case 'job':
        // Buslinie: Fahrerdisplay statt Auftrag (05-telemetrie.js füllt es)
        return `<div class="wj-bus" data-bind="wj-bus" hidden></div>
          <div class="widget-title">${badge('job', 'purple')}Auftrag</div>
          <div class="wj-route"><span data-bind="from">–</span><span class="arrow">→</span><span data-bind="to">–</span></div>
          <div class="wj-left" data-bind="job-left">Kein Auftrag</div>
          <div class="bar"><div class="bar-fill blue" data-bind="job-bar"></div></div>
          <div class="wj-meta"><span data-bind="cargo">–</span><span data-bind="deadline">–</span></div>`;
      case 'sport':
        // Live-Ticker: verfolgtes Spiel bzw. Spiel der Lieblingsteams (09d-sport.js füllt die Liste)
        return `<div class="widget-title"><span class="wt-app">${iconHtml('sports')}</span>Live-Ticker</div><div class="sw-body" data-list="sport-widget"></div>`;
      case 'messages':
        return `<div class="widget-title">${badge('messages', 'red')}Mitteilungen</div><div class="mini-list" data-list="messages-mini"></div>`;
      case 'stops':
        return `<div class="widget-title">${badge('stops', 'teal')}Tanken & Rasten</div><div class="mini-list" data-list="stops-mini"></div>`;
      default:
        return `<div class="widget-title">${badge('logbook', 'yellow')}Diese Fahrt</div>
          <div class="trip-mini">
            <div><b data-bind="trip-km">0 km</b><small>gefahren</small></div>
            <div><b data-bind="trip-time">0 Min.</b><small>Fahrzeit</small></div>
            <div><b data-bind="trip-money">${money(0)}</b><small>Bilanz</small></div>
          </div>`;
    }
  }

  function widget(type, slot, extra = '') {
    const cls = type === 'map' ? 'card map-card' : `card glass widget w-${type}`;
    // Musik und Ziele haben eigene Knöpfe – das Widget selbst öffnet die App nicht
    const open = type === 'music' || type === 'places' ? '' : `data-focus data-open="${WIDGET_APP[type]}"`;
    return `<div class="${cls} ${extra}" data-widget="${type}" data-slot="${slot}" ${open}>${widgetBody(type)}</div>`;
  }

  // ------------------------------------------------------------------ Widget-Stapel
  const stackIndex = [0, 0, 0];
  // Buslinie aktiv (05-telemetrie.js): das Auftrags-Widget zeigt das Fahrerdisplay. Liegt es nicht auf dem Dashboard,
  // kommt es für die Dauer der Linie vorn in einen Stapel – nicht neben die Karte, Musik oder Navigation, wenn es geht.
  // Die gespeicherte Anordnung bleibt unverändert.
  let busDashboard = false;
  const userHasJob = () => [0, 1, 2].some((s) => settings.dashboard.widgets[s] === 'job' || ((settings.dashboard.stacks || [])[s] || []).includes('job'));
  function busSlot() {
    const w = settings.dashboard.widgets;
    const free = [1, 2, 0].filter((s) => w[s] !== 'map');
    return free.find((s) => !['music', 'nav'].includes(w[s])) ?? free[0] ?? 1;
  }
  function stackFor(slot) {
    const primaries = settings.dashboard.widgets;
    const extra = (settings.dashboard.stacks || [])[slot] || [];
    const list = [primaries[slot], ...extra.filter((t) => !primaries.includes(t))];
    if (busDashboard && slot === busSlot() && !userHasJob()) list.unshift('job');
    return list;
  }
  let busOffTimer = 0;
  function setBusDashboard(on) {
    // Abschalten erst nach 15 s ohne Linie: fällt der Auftrag beim Laden kurz weg, wird nicht zweimal neu aufgebaut
    if (on) {
      clearTimeout(busOffTimer);
      busOffTimer = 0;
    } else if (busDashboard && !busOffTimer) {
      busOffTimer = setTimeout(() => {
        busOffTimer = 0;
        applyBusDashboard(false);
      }, 15000);
    }
    if (on) applyBusDashboard(true);
  }
  function applyBusDashboard(on) {
    if (on === busDashboard) return;
    busDashboard = on;
    if (userHasJob()) return; // liegt schon da – der Stapel holt es bei Bedarf nach vorn
    stackIndex[busSlot()] = 0;
    setTimeout(render, 0); // nicht mitten in der Telemetrie neu aufbauen
  }
  // Alle Widgets, die irgendwo auf dem Dashboard liegen (auch verdeckt im Stapel)
  const dashboardWidgets = () => [0, 1, 2].flatMap(stackFor);

  function slotHtml(type, slot) {
    const list = stackFor(slot);
    if (list.length === 1) return widget(type, slot);
    const index = Math.min(stackIndex[slot], list.length - 1);
    return `<div class="stack" data-stack="${slot}">
        ${list.map((t, i) => widget(t, slot, i === index ? '' : 'stack-hidden')).join('')}
        <div class="stack-dots">${list.map((_, i) => `<button data-stack-dot="${slot}:${i}" class="${i === index ? 'on' : ''}" aria-label="Widget ${i + 1}"></button>`).join('')}</div>
      </div>`;
  }

  function setStack(slot, index) {
    const el = stage.querySelector(`[data-stack="${slot}"]`);
    if (!el) return;
    const cards = [...el.querySelectorAll(':scope > [data-widget]')];
    stackIndex[slot] = (index + cards.length) % cards.length;
    cards.forEach((c, i) => c.classList.toggle('stack-hidden', i !== stackIndex[slot]));
    el.querySelectorAll('[data-stack-dot]').forEach((d, i) => d.classList.toggle('on', i === stackIndex[slot]));
  }

  // Intelligenter Stapel: bei Ereignissen das passende Widget nach vorne holen
  function surfaceWidget(type) {
    for (const slot of [0, 1, 2]) {
      const i = stackFor(slot).indexOf(type);
      if (i > 0 || (i === 0 && stackIndex[slot] !== 0)) setStack(slot, i);
    }
  }

  // ------------------------------------------------------------------ Home (Seiten wie bei CarPlay)
  function homePages() {
    const per = settings.iconSize === 'large' ? 8 : 10;
    const pages = [];
    const apps = settings.home.filter((id) => id !== 'dashboard');
    for (let i = 0; i < apps.length; i += per) pages.push(apps.slice(i, i + per));
    return pages;
  }

  function homeHtml() {
    const pages = homePages();
    homePage = Math.min(homePage, pages.length - 1);
    const dots = `<div class="page-dots glass"><button data-open="dashboard" class="dash-dot" aria-label="Dashboard"></button>${pages.map((_, i) => `<button data-page-dot="${i}" class="${i === homePage ? 'on' : ''}" aria-label="Seite ${i + 1}"></button>`).join('')}</div>`;
    return `<div class="home-pages">${pages.map((p, i) => `<div class="home-grid ${i === homePage ? 'active' : ''}" data-home-page="${i}">${p.map(appIcon).join('')}</div>`).join('')}</div>${dots}`;
  }

  function setHomePage(index, slide = true) {
    const count = homePages().length;
    if (index < 0) return showScreen('dashboard', { slide: 'right' });
    const before = homePage;
    homePage = Math.min(index, count - 1);
    if (slide && before !== homePage) slideIn(stage.querySelector(`[data-home-page="${homePage}"]`), homePage > before ? 'left' : 'right');
    for (const el of stage.querySelectorAll('[data-home-page]')) el.classList.toggle('active', Number(el.dataset.homePage) === homePage);
    for (const el of stage.querySelectorAll('[data-page-dot]')) el.classList.toggle('on', Number(el.dataset.pageDot) === homePage);
    nav.reset();
  }

  // ------------------------------------------------------------------ Einstellungen (wie CarPlay: gruppierte Listen)
  const OPTIONS = {
    language: { auto: 'Automatisch (wie Windows)', de: 'Deutsch', en: 'English', pl: 'Polski', tr: 'Türkçe', zh: '简体中文', 'zh-hant': '繁體中文' },
    units: { auto: 'Wie im Spiel', metric: 'Metrisch (km/h, km, °C, l, t)', us: 'Imperial US (mph, mi, °F, gal, lb)', uk: 'Imperial UK (mph, mi, °C, gal, lb)' },
    clock: { auto: 'Wie im Spiel', 24: '24 Stunden', 12: '12 Stunden (AM/PM)' },
    appearance: { auto: 'Nach Uhrzeit', lights: 'Nach Scheinwerfer', light: 'Hell', dark: 'Dunkel' },
    mapTheme: { system: 'Wie Darstellung', light: 'Hell', dark: 'Dunkel', auto: 'Nach Uhrzeit', lights: 'Nach Scheinwerfer' },
    volumeVoice: { 0: 'Aus', 10: '10 %', 20: '20 %', 30: '30 %', 40: '40 %', 50: '50 %', 60: '60 %', 70: '70 %', 80: '80 %', 90: '90 %', 100: '100 %' },
    volumeAnnounce: { 0: 'Aus', 10: '10 %', 20: '20 %', 30: '30 %', 40: '40 %', 50: '50 %', 60: '60 %', 70: '70 %', 80: '80 %', 90: '90 %', 100: '100 %' },
    volumeAlerts: { 0: 'Aus', 10: '10 %', 20: '20 %', 30: '30 %', 40: '40 %', 50: '50 %', 60: '60 %', 70: '70 %', 80: '80 %', 90: '90 %', 100: '100 %' },
    volumeSiri: { 0: 'Aus', 10: '10 %', 20: '20 %', 30: '30 %', 40: '40 %', 50: '50 %', 60: '60 %', 70: '70 %', 80: '80 %', 90: '90 %', 100: '100 %' },
    volumeRadio: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i * 5, i ? `${i * 5} %` : 'Aus'])),
    volumeVideo: { 0: 'Aus', 10: '10 %', 20: '20 %', 30: '30 %', 40: '40 %', 50: '50 %', 60: '60 %', 70: '70 %', 80: '80 %', 90: '90 %', 100: '100 %' },
    appearanceAuto: { off: 'Aus', auto: 'Nach Uhrzeit im Spiel', lights: 'Nach Scheinwerfer' },
    gradeMin: { 5: 'Ab 5 %', 6: 'Ab 6 %', 8: 'Ab 8 %', 10: 'Ab 10 %' },
    // in der eingestellten Einheit (bei mph „Ab +5 mph“, so wird auch gerechnet)
    get radarTolerance() {
      const u = spdUnit();
      return { 0: 'Ab dem Limit', 3: `Ab +3 ${u}`, 5: `Ab +5 ${u}`, 10: `Ab +10 ${u}`, 15: `Ab +15 ${u}`, '-1': 'Aus' };
    },
    glass: { full: 'Normal', clear: 'Klar', reduced: 'Sparsam', off: 'Weniger Transparenz' },
    iconTheme: { brands: 'Google Maps & Spotify', apple: 'Apple (Karten, Musik)', classic: 'Klassisch' },
    iconStyle: { color: 'Farbig', dark: 'Dunkel', clear: 'Klar' },
    textScale: { small: 'Klein', normal: 'Normal', large: 'Groß', xlarge: 'Sehr groß' },
    displayFormat: { auto: 'Automatisch', '16:9': '16:9', '16:10': '16:10', '4:3': '4:3', '5:4': '5:4', '2:1': '2:1 (breit)', '8:3': '8:3 (sehr breit)' },
    gamma: { off: 'Aus', light: 'Leicht', balanced: 'Ausgewogen (empfohlen)', dim: 'Gedämpft (helles Display)', strong: 'Stark', custom: 'Eigene Einstellung' },
    gammaValue: { 1.2: 'Sehr schwach (1,2)', 1.3: 'Schwach (1,3)', 1.4: '1,4', 1.5: '1,5', 1.6: 'Mittel (1,6)', 1.8: '1,8', 2: 'Kräftig (2,0)', 2.2: 'Sehr kräftig (2,2)' },
    whiteLevel: { 100: '100 % (volles Weiß)', 95: '95 %', 90: '90 %', 86: '86 %', 82: '82 %', 78: '78 %', 74: '74 %', 70: '70 % (stark gedimmt)' },
    sidebar: { left: 'Links', right: 'Rechts', top: 'Oben', bottom: 'Unten' },
    sidebarMode: { auto: 'Zuletzt benutzt', fixed: 'Feste Apps' },
    sidebarCount: { auto: 'Automatisch (nach Bildschirm)', 3: '3 Apps', 4: '4 Apps' },
    phoneBattery: { off: 'Aus', on: 'Anzeigen', charging: 'Lädt (Ladekabel)' },
    logoStore: { save: 'Auf dem PC speichern', stream: 'Nur laden (braucht Internet)' },
    phoneSignal: { auto: 'Dynamisch (nach Ort)', '5g': 'Immer 5G', off: 'Aus' },
    musicArt: { right: 'Cover rechts (CarPlay)', left: 'Cover links (Spotify)' },
    dispatcher: { calls: 'Anrufe und Nachrichten', messages: 'Nur Nachrichten', off: 'Aus' },
    mirrorView: { wide: 'Weitwinkel', main: 'Hauptspiegel' },
    mirrorFps: { 20: 'Standard (20 Bilder/s)', 30: 'Flüssig (30 Bilder/s)', 60: 'Sehr flüssig (60 Bilder/s)' },
    clusterDesign: { dials: 'Rundinstrumente', bars: 'Balken', music: 'Musik (großes Cover)', map: 'Karte (ganzes Display)', mapdials: 'Karte mit Rundinstrumenten', service: 'Service (Fahrzeugzustand)', trip: 'Bordcomputer', job: 'Auftrag', tesla: 'Fahrassistenz (Verkehr ringsum)' },
    clusterAccent: { blue: 'Blau', green: 'Grün', orange: 'Orange', red: 'Rot', teal: 'Türkis', white: 'Weiß', yellow: 'Gelb', pink: 'Pink', purple: 'Violett', multi: 'Bunt (je Anzeige)' },
    clusterBackground: { black: 'Schwarz', blue: 'Nachtblau', graphite: 'Graphit', light: 'Hell (nachts dunkel)', solid: 'Farbfläche', gradient: 'Farbverlauf', mountains: 'Berge', waves: 'Wellen', aurora: 'Polarlicht', stars: 'Sternenhimmel', topo: 'Höhenlinien', wallpaper: 'Hintergrundbild (wie im Navi)' },
    clusterTint: { accent: 'Wie die Farbe', copper: 'Kupfer', teal: 'Petrol', olive: 'Oliv', red: 'Rot', gold: 'Gold', sand: 'Sand', slate: 'Taubenblau', rose: 'Rosé', midnight: 'Mitternacht' },
    clusterGauge: { standard: 'Standard', thin: 'Dünn', thick: 'Breit', needle: 'Mit Zeiger', classic: 'Klassisch', sport: 'Sportlich' },
    clusterBootStyle: { logo: 'Logo der Marke', hello: '„hello“ in Schreibschrift' },
    clusterCenter: { auto: 'Automatisch (Navi, sonst Musik)', nav: 'Nur Navi', media: 'Nur Musik', map: 'Kleine Karte', off: 'Nichts' },
    clusterArrows: { small: 'Klein', large: 'Groß' },
    clusterBlinkers: { auto: 'Automatisch', on: 'An', off: 'Aus' },
    clusterWidgetMode: { auto: 'Automatisch wechseln', fixed: 'Immer das erste' },
    clusterDialRight: { water: 'Kühlwasser', adblue: 'AdBlue', air: 'Luftdruck' },
    clusterInfoStyle: { classic: 'Klassisch', apple: 'Wie CarPlay Ultra' },
    clusterFocus: { nav: 'Navi', media: 'Musik' },
    clusterFps: { 10: 'Sparsam (10 Bilder/s)', 15: 'Standard (15 Bilder/s)', 20: 'Flüssig (20 Bilder/s)', 30: 'Sehr flüssig (30 Bilder/s)' },
    mirrorTarget: { gps: 'Navi', cluster: 'Kombiinstrument', both: 'Navi und Kombiinstrument' },
    mapNextLimitStyle: { side: 'Neben dem Schild', below: 'Als Leiste darunter' },
    // Sprache der Ansagen – unabhängig von der Oberfläche (06a-disponent.js speechLang)
    voiceLang: { ui: 'Wie die Oberfläche', de: 'Deutsch', en: 'English', pl: 'Polski', tr: 'Türkçe', zh: '简体中文', 'zh-hant': '繁體中文' },
    // Chinesische Stimme: Kokoro-Sprecher nach Prüfung mit Spracherkennung (17.11.2026: zf_044 am besten verständlich)
    voiceZh: { K28: 'Xiaoyu (AI-Stimme, empfohlen)', K13: 'Xiaoqing (AI-Stimme)', K70: 'Yunzhe (AI-Stimme)', K90: 'Yunfeng (AI-Stimme)', win: 'Windows-Stimme' },
    voiceName: { 'st-F4': 'Olivia (AI-Stimme, empfohlen)', 'st-F1': 'Sarah (AI-Stimme)', 'st-F2': 'Lily (AI-Stimme)', 'st-F3': 'Jessica (AI-Stimme)', 'st-F5': 'Emily (AI-Stimme)', 'st-M1': 'Alex (AI-Stimme)', 'st-M2': 'James (AI-Stimme)', 'st-M3': 'Robert (AI-Stimme)', 'st-M4': 'Sam (AI-Stimme)', 'st-M5': 'Daniel (AI-Stimme)', 'Microsoft Katja': 'Katja (Windows)', 'Microsoft Stefan': 'Stefan (Windows)', 'Microsoft Hedda': 'Hedda (Windows, älter)', system: 'Einfache Browser-Stimme' },
    iconSize: { normal: 'Normal', large: 'Groß' },
    startScreen: { last: 'Zuletzt geöffnet', dashboard: 'Dashboard', home: 'Home', maps: 'Karten', music: 'Musik' },
    mapStyle: catalog.MAP_STYLES,
    mapFps: { 30: 'Flüssig (30 Bilder/s)', 20: 'Ausgewogen (20 Bilder/s)', 15: 'Sparsam (15 Bilder/s)' },
    'dashboard.0': catalog.WIDGETS,
    'dashboard.1': catalog.WIDGETS,
    'dashboard.2': catalog.WIDGETS,
  };
  for (const [key, values] of Object.entries(catalog.OVERLAYS)) {
    OPTIONS[`overlays.${key}`] = Object.fromEntries(values.map((v) => [v, catalog.POSITION_NAMES[v]]));
    // Kartenstil Google/Apple: Position fest, aber ein- und ausblendbar (gezeigt wird nur der aktuelle Stil und „Aus“)
    // Abbiegehinweis und Tempo-Anzeige lassen sich dort auch in eine Ecke legen (Aussehen bleibt wie im Stil, Issue #9)
    const free = ['banner', 'speed'].includes(key) ? Object.fromEntries(values.filter((v) => v !== 'hidden').map((v) => [v, catalog.POSITION_NAMES[v]])) : {};
    OPTIONS[`overlayShow.${key}`] = { google: 'Fest wie bei Google', apple: 'Fest wie bei Apple Karten', ...free, hidden: catalog.POSITION_NAMES.hidden };
  }
  const TITLES = {
    mirrorTarget: 'Zeigen im', mapNextLimitStyle: 'Position', clusterDesign: 'Design', clusterAccent: 'Farbe', clusterBackground: 'Hintergrund', clusterTint: 'Hintergrundfarbe', clusterGauge: 'Instrumente', clusterBootStyle: 'Begrüßung', clusterCenter: 'Mitte', clusterFps: 'Bildrate', clusterArrows: 'Blinkerpfeile', clusterBlinkers: 'Blinker im Display', clusterWidgetMode: 'Wechsel', clusterDialRight: 'Rechts unten', clusterInfoStyle: 'Stil der Leiste', clusterFocus: 'Größer anzeigen',
    displayFormat: 'Displayformat', language: 'Sprache', units: 'Einheiten', clock: 'Uhrzeit', appearance: 'Darstellung', appearanceAuto: 'Automatisch', radarTolerance: 'Tempo-Warnung', gradeMin: 'Steigungen', glass: 'Liquid Glass', iconTheme: 'Symbol-Set', iconStyle: 'Symbolstil', textScale: 'Textgröße', gamma: 'Bildkorrektur', mapTheme: 'Farbschema', volumeVoice: 'Sprachansagen', volumeAnnounce: 'Durchsagen im Bus', volumeAlerts: 'Warntöne', volumeSiri: 'Sprachbefehl-Töne', volumeVideo: 'Video', volumeRadio: 'Radio', gammaValue: 'Kontrast (Gamma)', whiteLevel: 'Weißpunkt',
    sidebar: 'Position', sidebarCount: 'Anzahl Apps', phoneBattery: 'Handy-Akku', logoStore: 'Logos', phoneSignal: 'Mobilfunk', musicArt: 'Musik-Ansicht', dispatcher: 'Disponent', mirrorView: 'Spiegel', mirrorFps: 'Bildrate', voiceName: 'Stimme', voiceLang: 'Sprache der Ansagen', voiceZh: 'Chinesische Stimme', sidebarMode: 'Apps in der Seitenleiste', iconSize: 'Symbolgröße', startScreen: 'Startbildschirm',
    mapStyle: 'Kartenstil', mapFps: 'Bildrate der Karte', 'overlays.banner': 'Abbiegehinweis', 'overlays.eta': 'Ankunftszeit', 'overlays.speed': 'Tempo-Anzeige',
    'overlays.compass': 'Kompass', 'dashboard.0': 'Großes Widget', 'dashboard.1': 'Widget oben', 'dashboard.2': 'Widget unten',
  };
  const NOTES = {
    clusterBlinkers: 'Automatisch: wie das Display im Lkw. MAN TGX, Lion\'s Coach, DAF, Iveco S-Way, Kenworth T680, Volvo VNL und Ford Bronco haben echte Blinkerleuchten neben dem Display – dort bleiben die Pfeile aus.',
    voiceZh: 'Empfohlen: Xiaoyu. Mit Spracherkennung geprüft – sie wird am besten verstanden. Die Windows-Stimme braucht das chinesische Sprachpaket von Windows.',
    voiceLang: 'Navi, Disponent, Blitzer und Durchsagen kommen in dieser Sprache – auch wenn die Oberfläche eine andere hat. Antworten des AI-Sprachassistenten bleiben in der Sprache, in der du fragst.',
    voiceName: 'Empfohlen: Olivia. Für sie ist die Aussprache gemacht und mit Spracherkennung geprüft – Zahlen, Kilometer, Geld, Städte und Firmen klingen bei ihr am natürlichsten. Die anderen AI-Stimmen nutzen dieselben Regeln, sprechen aber nicht alles so sauber.',
    glass: 'Normal passt sich dem Hintergrund an. Klar ist durchsichtiger und dunkelt dafür ab (gut über Fotos). Sparsam spart über der Karte und im Dashboard Rechenzeit. Weniger Transparenz macht alles deckend.',
    iconTheme: 'Wie die echten Apps. Nachbauten – die Original-Icons kannst du als eigenes Bild festlegen.',
    gamma: 'Das Spiel lässt den Bildschirm im Truck leuchten und legt Bloom darüber – er wirkt überbelichtet. „Ausgewogen“ dunkelt die Mitteltöne etwas ab und dimmt Weiß, damit helle Flächen nicht überstrahlen. „Stark“ macht Farben dunkel und satt, Weiß strahlt aber weiter. Gilt nur im Truck, nicht im Editor.',
    sidebarMode: 'Zuletzt benutzt: oben die letzte Navi-App, in der Mitte die letzte Audio-App, unten die zuletzt geöffnete andere App.',
    iconStyle: 'Farbig, dunkel (farbiges Symbol auf Schwarz) oder klar aus Glas. Gilt für alle Symbol-Sets und auch für eigene Bilder.',
    appearanceAuto: 'Nach Uhrzeit: dunkel von 20 bis 6 Uhr Spielzeit. Nach Scheinwerfer: dunkel, sobald das Abblendlicht an ist – wie im echten Auto.',
    radarTolerance: 'Ab dieser Geschwindigkeit über dem Limit piept die App alle paar Sekunden. Vor Blitzern warnt sie immer.',
  };
  const HOTKEY_NAMES = {
    toggle: 'Wiedergabe / Pause', next: 'Nächster Titel', previous: 'Vorheriger Titel', up: 'Fokus hoch', down: 'Fokus runter',
    left: 'Fokus links', right: 'Fokus rechts', select: 'Auswählen', back: 'Zurück', home: 'Home / Dashboard', voice: 'Sprachbefehl', standby: 'Display aus / an', editor: 'Editor öffnen',
  };

  // Vorschau des Kombiinstruments (Einstellungen): auf die Breite der Karte skalieren
  const clusterPreviewSize = new ResizeObserver((entries) => {
    for (const e of entries) {
      const frame = e.target.querySelector('.cl-frame');
      if (frame) frame.style.transform = `scale(${e.contentRect.width / 1440})`;
    }
  });
  document.addEventListener('load', (e) => {
    if (e.target instanceof HTMLIFrameElement && e.target.classList.contains('cl-frame')) {
      clusterPreviewSize.observe(e.target.parentElement);
      e.target.classList.add('loaded'); // weich einblenden (darunter liegt der Hintergrund als Platzhalter)
    }
  }, true);

  // Lkw, in dem du gerade sitzt (wie in der Telemetrie: „scania.r“) – leer ohne Spiel
  const truckKey = () => String(telemetry?.truckId || '').toLowerCase().replace(/^vehicle\./, '');

  // Sichtbarer Bereich für den Lkw, in dem du sitzt: Rand oben/unten/links/rechts mit −/+ (1 %).
  // kind 'display': Navi-Display (displayAreas), 'cluster': Kombiinstrument (clusterAreas)
  const AREA_KINDS = { display: ['displayAreas', 'DISPLAY_AREAS'], cluster: ['clusterAreas', 'CLUSTER_AREAS'] };
  // Voreinstellung: erst je erkannter Innenausstattung („lkw@familie“, Plugin ab 1.18.6), dann je Lkw
  window.CarAreaDefault = (def, id) => {
    const table = catalog[def] || {};
    const family = String(telemetry?.dashboard || '');
    return (family && table[`${id}@${family}`]) || table[id] || null;
  };
  const areaNow = (kind = 'display') => {
    const id = truckKey();
    const [key, def] = AREA_KINDS[kind];
    const own = (settings[key] || {})[id];
    return own || window.CarAreaDefault(def, id) || { l: 0, t: 0, r: 0, b: 0 };
  };
  function displayAreaGroup(kind = 'display') {
    if (!truckKey()) return '';
    const a = areaNow(kind);
    const step = (k, label) => `<div class="row static area-row"><span class="row-label">${label}</span>
        <span class="area-step"><button data-focus data-area-kind="${kind}" data-area-step="${k}:-1" aria-label="Weniger">${ICONS.minus2}</button>
        <b>${a[k]} %</b><button data-focus data-area-kind="${kind}" data-area-step="${k}:1" aria-label="Mehr">${ICONS.plus}</button></span></div>`;
    const custom = Object.prototype.hasOwnProperty.call(settings[AREA_KINDS[kind][0]] || {}, truckKey());
    const note = kind === 'cluster'
      ? 'Gilt für das Fahrzeug, in dem du gerade sitzt. Fehlt im Kombiinstrument oben, unten oder an der Seite etwas, hier den Rand einstellen, bis alles zu sehen ist. Bei 0 % überall: ganze Fläche.'
      : 'Zeigt das Display im Cockpit nur einen Teil des Bildes (oben, unten oder an der Seite fehlt etwas), hier den fehlenden Rand einstellen, bis alles zu sehen ist. CabPlay zeichnet dann genau in den sichtbaren Teil. Bei 0 % überall: ganzes Bild.';
    return groupTitle('Sichtbarer Bereich')
      + `<div class="group">${step('t', 'Rand oben')}${step('b', 'Rand unten')}${step('l', 'Rand links')}${step('r', 'Rand rechts')}`
      + (custom ? srow({ icon: 'reset', color: 'gray', label: 'Zurücksetzen', attrs: `data-action="area-reset" data-area-kind="${kind}"`, chevron: false }) : '')
      + `</div><p class="group-note">${note}</p>`;
  }

  // Hinweis zum Displayformat: für welchen Lkw es gilt
  function displayFormatNote() {
    const id = truckKey();
    const name = [telemetry?.truckBrand, telemetry?.truckName].filter(Boolean).join(' ');
    return id
      ? `Gilt für den Lkw, in dem du gerade sitzt (${escape(name || id)}). Wirkt das Bild auf dem Display im Cockpit verzerrt, abgeschnitten oder mit Rand, hier das Format des Displays wählen – vor allem bei älteren Lkw wie Scania R oder MAN TGX. Automatisch: aus den Spieldateien, sonst 16:9.`
      : 'Gilt je Lkw – im Spiel einsteigen, dann hier das Format des Displays wählen, falls das Bild im Cockpit verzerrt oder abgeschnitten wirkt.';
  }

  function getOption(key) {
    if (key.startsWith('dashboard.')) return settings.dashboard.widgets[Number(key.split('.')[1])];
    if (key.startsWith('overlays.')) return settings.overlays[key.split('.')[1]];
    if (key.startsWith('overlayShow.')) {
      const k = key.split('.')[1];
      if (settings.overlays[k] === 'hidden') return 'hidden';
      return settings.overlayFree?.[k] ? settings.overlays[k] : settings.mapStyle;
    }
    if (key === 'appearanceAuto') return settings.appearance === 'auto' || settings.appearance === 'lights' ? settings.appearance : 'off';
    if (key === 'displayFormat') return (settings.displayFormats || {})[truckKey()] || 'auto';
    return settings[key];
  }

  function setOption(s, key, value) {
    if (key.startsWith('dashboard.')) {
      const w = s.dashboard.widgets;
      const slot = Number(key.split('.')[1]);
      const other = w.indexOf(value);
      if (other >= 0) w[other] = w[slot]; // schon woanders → Plätze tauschen
      w[slot] = value;
    } else if (key.startsWith('overlays.')) s.overlays[key.split('.')[1]] = value;
    else if (key.startsWith('overlayShow.')) {
      const k = key.split('.')[1];
      // wieder einblenden: Position ab Werk (im Stil Standard frei wählbar); eine Ecke: eigene Position, Aussehen wie im Stil
      if (value === 'hidden') s.overlays[k] = 'hidden';
      else if (value === 'google' || value === 'apple') {
        s.overlayFree = { ...(s.overlayFree || {}), [k]: false };
        if (s.overlays[k] === 'hidden') s.overlays[k] = catalog.DEFAULTS.overlays[k];
      } else {
        s.overlayFree = { ...(s.overlayFree || {}), [k]: true };
        s.overlays[k] = value;
      }
    }
    else if (key === 'appearanceAuto') s.appearance = value === 'off' ? theme : value; // aus: aktuelles Aussehen behalten
    else if (key === 'displayFormat') {
      // je Lkw: der, in dem du gerade sitzt
      const id = truckKey();
      if (!id) return;
      s.displayFormats = { ...(s.displayFormats || {}) };
      if (value === 'auto') delete s.displayFormats[id];
      else s.displayFormats[id] = value;
    }
    else if (key === 'radarTolerance' || key === 'gradeMin' || key === 'gammaValue' || key === 'whiteLevel' || key === 'clusterFps' || key.startsWith('volume')) s[key] = Number(value);
    else s[key] = value;
    // Kartenstil und Symbol-Set gehören zusammen: Apple Karten ↔ Apple-Symbole, Google ↔ Google Maps & Spotify
    if (key === 'mapStyle' && value === 'apple') s.iconTheme = 'apple';
    else if (key === 'mapStyle' && value === 'google') s.iconTheme = 'brands';
    else if (key === 'iconTheme' && value === 'apple') s.mapStyle = 'apple';
    else if (key === 'iconTheme' && value === 'brands') s.mapStyle = 'google';
  }

  function prettyAccelerator(acc) {
    if (!acc) return 'Aus';
    const names = { Control: 'Strg', Shift: 'Umschalt', Up: '↑', Down: '↓', Left: '←', Right: '→', PageUp: 'Bild↑', PageDown: 'Bild↓', Backspace: 'Rücktaste', Space: 'Leertaste' };
    return acc.split('+').map((k) => names[k] || k).join(' + ');
  }

  function srow({ icon, color, label, value = '', attrs = '', chevron = true, sw = null, cls = '' }) {
    const lead = icon ? (icon.startsWith('<') ? icon : badge(icon, color)) : '';
    const tail = sw !== null ? `<span class="switch ${sw ? 'on' : ''}"></span>` : `<span class="row-value">${value}</span>${chevron ? `<span class="row-chevron">${ICONS.chevron}</span>` : ''}`;
    return `<button class="row ${cls}" data-focus ${attrs}>${lead}<span class="row-label">${label}</span>${tail}</button>`;
  }
  // Lautstärke als Schieberegler (wie in iOS): Ziehen zeigt den Wert, Loslassen speichert (10-bedienung.js)
  const volumeRow = (key, icon, color) => {
    const v = Number(settings[key]) || 0;
    // alle Regler in 1er-Schritten – Radio, Video, Ansagen und Töne gleich (Rückmeldung 16.11.)
    return `<div class="row slider-row">${badge(icon, color)}<span class="row-label">${TITLES[key]}</span>`
      + `<input type="range" class="vol-range" min="0" max="100" step="1" value="${v}" data-focus data-volume-range="${key}" style="--v:${v}%">`
      + `<em class="vol-val">${v} %</em></div>`;
  };
  const groupTitle = (t) => `<p class="group-title">${t}</p>`;
  const group = (rows, note = '') => `<div class="group">${rows.join('')}</div>${note ? `<p class="group-note">${note}</p>` : ''}`;
  const link = (page, icon, color, label, value = '') => srow({ icon, color, label, value: escape(value), attrs: `data-page="${page}"` });
  // Bearbeiten-Modus (wackelnde Icons) starten – nur im Editor-Fenster, dort wo man es sucht: Home-Bildschirm, Dashboard
  const editRow = (note) => (role === 'editor' && api ? group([srow({ icon: 'widgets', color: 'blue', label: 'Home-Bildschirm & Dashboard bearbeiten', attrs: 'data-action="edit-start"' })], note) : '');
  // Chinesische Oberfläche: Ansagen liest die chinesische Windows-Stimme (06a-disponent.js) – hier zeigen, welche, oder dass
  // keine installiert ist (dann Englisch mit der gewählten Stimme). null = noch nicht gefragt, undefined = Frage läuft
  let zhVoiceList = null;
  const ZH_VOICE_NOTE = 'Auf Chinesisch liest die chinesische Windows-Stimme vor. Ist keine installiert, wird auf Englisch vorgelesen – mit der Stimme oben. Nachinstallieren: Windows-Einstellungen › Zeit und Sprache › Sprache und Region › Chinesisch › Sprachoptionen › Sprachausgabe.';
  const ZH_AI_NOTE = 'Chinesische Ansagen liest die AI-Stimme Kokoro vor – direkt in der App, ohne Internet. Orts- und Straßennamen werden dafür ins Chinesische übertragen.';
  function zhVoiceRows() {
    const hant = speechLang() === 'zh-hant';
    if (!speechLang().startsWith('zh')) return [];
    if (aiStatus?.kokoro && settings.voiceZh !== 'win') return []; // die AI-Stimme spricht
    if (zhVoiceList === null) {
      if (!api?.ttsVoices) zhVoiceList = [];
      else {
        zhVoiceList = undefined;
        // traditionell zuerst Taiwan, sonst jede chinesische Stimme (so wählt sie auch tools/tts.ps1)
        Promise.all([api.ttsVoices('zh-TW'), api.ttsVoices('zh-CN')]).then(([tw, cn]) => {
          zhVoiceList = hant ? [...(tw || []), ...(cn || [])] : [...(cn || []), ...(tw || [])];
          if (screen === 'settings') rerenderSettings();
        }, () => {
          zhVoiceList = [];
          if (screen === 'settings') rerenderSettings();
        });
      }
    }
    const preferred = hant ? 'Microsoft Hanhan' : 'Microsoft Huihui';
    const name = Array.isArray(zhVoiceList) ? (zhVoiceList.includes(preferred) ? preferred : zhVoiceList[0]) : null;
    const value = name ? `${name.replace(/^Microsoft /, '')} (Windows)` : Array.isArray(zhVoiceList) ? 'Nicht installiert – Englisch' : '…';
    return [infoRow('Chinesische Stimme', value, 'speaker', name ? 'green' : 'orange')];
  }
  // Sprachen: zuerst der Name in der Sprache der Oberfläche (bei Chinesisch mit „vereinfacht“/„traditionell“), in Klammern
  // der eigene Name der Sprache – „Chinesisch, vereinfacht (简体中文)“. Die Sprache der Oberfläche selbst nur mit ihrem Namen.
  // Die Tabelle steht schon in der Zielsprache (keine Übersetzung nötig, data-no-names; Freigabe in test/i18n-known.txt)
  const LANG_SUB = {
    de: { en: 'Englisch', pl: 'Polnisch', tr: 'Türkisch', zh: 'Chinesisch, vereinfacht', 'zh-hant': 'Chinesisch, traditionell' },
    en: { de: 'German', pl: 'Polish', tr: 'Turkish', zh: 'Chinese, Simplified', 'zh-hant': 'Chinese, Traditional' },
    pl: { de: 'niemiecki', en: 'angielski', tr: 'turecki', zh: 'chiński uproszczony', 'zh-hant': 'chiński tradycyjny' },
    tr: { de: 'Almanca', en: 'İngilizce', pl: 'Lehçe', zh: 'Basitleştirilmiş Çince', 'zh-hant': 'Geleneksel Çince' },
    zh: { de: '德语', en: '英语', pl: '波兰语', tr: '土耳其语', 'zh-hant': '繁体中文' },
    'zh-hant': { de: '德語', en: '英語', pl: '波蘭語', tr: '土耳其語', zh: '簡體中文' },
  };
  const langChoiceLabel = (code, label) => {
    const sub = LANG_SUB[CarI18n.lang]?.[code];
    if (!sub) return escape(label);
    const paren = CarI18n.chinese ? `（${escape(label)}）` : ` (${escape(label)})`;
    return `<span data-no-names>${escape(sub)}<span class="row-sub-lang">${paren}</span></span>`;
  };
  // Stimme, die wirklich spricht: Die deutschen Windows-Stimmen (Katja, Stefan, Hedda) gelten nur für deutsche Ansagen – in
  // anderen Ansage-Sprachen spricht die Windows-Stimme der Sprache (06a-disponent.js WIN_VOICE), auf Chinesisch die chinesische
  const voiceShown = () => {
    const name = settings.voiceName || '';
    const vl = speechLang();
    if (vl.startsWith('zh')) return aiStatus?.kokoro && settings.voiceZh !== 'win' ? OPTIONS.voiceZh[settings.voiceZh].replace(/ \(.*\)$/, '') : 'Chinesische Windows-Stimme';
    if (name.startsWith('Microsoft ') && vl !== 'de' && WIN_VOICE[vl]) return WIN_VOICE[vl].replace(/^Microsoft /, '');
    return (OPTIONS.voiceName[name] || name).replace(/ \(.*\)$/, '');
  };
  const choiceRow = (key, icon, color, label = TITLES[key]) => link(`choice:${key}`, icon, color, label,
    // Sprachen als Wert: Name in der Sprache der Oberfläche („Chinesisch, vereinfacht“), die eigene Sprache mit ihrem Namen
    ((key === 'language' || key === 'voiceLang') && LANG_SUB[CarI18n.lang]?.[getOption(key)]) || OPTIONS[key][getOption(key)] || (key.startsWith('volume') ? `${getOption(key)} %` : ''));
  // tag: kleiner Hinweis hinter dem Namen (z. B. „Experimentell“ bei unsicheren Daten)
  const toggleRow = (key, icon, color, label, tag = '') => srow({ icon, color, label: tag ? `${label}<em class="tag-beta">${tag}</em>` : label, sw: !!settings[key], attrs: `data-toggle="${key}"` });
  const infoRow = (label, value, icon, color) => srow({ icon, color, label, value: escape(value), chevron: false, cls: 'static' });
  // Changelog: Stichpunkte als Liste in einer Gruppe
  // Release-Notizen sind Markdown: **fett** und `Dateinamen` darstellen statt die Zeichen zu zeigen (nach escape – sicher)
  const notesMarkup = (t) => escape(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<span class="cl-code">$1</span>');
  const notesGroup = (items) => `<div class="group cl-list">${items.map((t) => `<div class="cl-item">${notesMarkup(t)}</div>`).join('')}</div>`;
  // Stichpunkte aus Release-Notizen (Deutsch vor "---", Englisch danach)
  const notesBullets = (text) => {
    const [de, en = ''] = String(text || '').split(/\r?\n-{3,}\r?\n/);
    const part = CarI18n.lang !== 'de' && en.trim() ? en : de;
    return part.split(/\r?\n/).filter((l) => /^\s*-\s+/.test(l)).map((l) => l.replace(/^\s*-\s+/, '').trim());
  };
  const changelogFor = (v) => {
    const e = (window.CarPlayChangelog || []).find((x) => x.v === v);
    return e ? (CarI18n.lang !== 'de' && e.en.length ? e.en : e.de) : [];
  };

  // Kombiinstrument: Farben und Hintergründe aus ui/cluster-bg.js – die Kacheln zeigen genau das Bild des Instruments
  const clusterTintHex = () => window.ClusterBg.TINTS[settings.clusterTint] || (settings.clusterAccent === 'multi' ? '#0a84ff' : window.ClusterBg.ACCENTS[settings.clusterAccent] || '#0a84ff');
  function clusterBgPreview(value) {
    const B = window.ClusterBg, tint = clusterTintHex();
    switch (value) {
      case 'blue': return 'radial-gradient(120% 140% at 50% 120%, #0d2a52 0%, #06101f 55%, #000 100%)';
      case 'graphite': return 'radial-gradient(120% 140% at 50% 120%, #2b2d33 0%, #111216 60%, #000 100%)';
      case 'light': return 'linear-gradient(#f4f5f8, #e3e5ea)';
      case 'solid': return B.solidCss(tint);
      case 'gradient': return B.gradientCss(tint);
      case 'topo': return B.topoCss(tint);
      case 'mountains': return B.mountainCss(tint);
      case 'waves': return B.wavesCss(tint);
      case 'aurora': return B.auroraCss(tint);
      case 'stars': return B.starsCss(tint);
      case 'wallpaper': {
        const name = String(settings.wallpaper || '');
        if (name === 'custom' && customWallpaper) return `url("${customWallpaper}") center / cover`;
        if (name.startsWith('file:') && wallpaperFiles[name.slice(5)]) return `url("${wallpaperFiles[name.slice(5)]}") center / cover`;
        const e = catalog.WALLPAPERS[name] || catalog.WALLPAPERS[catalog.DEFAULTS.wallpaper];
        return e.dark || e.css;
      }
      default: return '#000';
    }
  }
  // Instrument-Andeutung in der Kachel: zwei Ringe in der Farbe
  const miniGauges = () => {
    const acc = settings.clusterAccent === 'multi' ? '#0a84ff' : window.ClusterBg.ACCENTS[settings.clusterAccent] || '#0a84ff';
    const acc2 = settings.clusterAccent === 'multi' ? '#ff9f0a' : acc;
    // 270°-Ring wie im Instrument (Umfang 2π·22 ≈ 138, davon 104 Skala), innen eine Zahl
    const ring = (x, c, f, text) => `<circle cx="${x}" cy="34" r="22" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="5" stroke-dasharray="104 138" transform="rotate(135 ${x} 34)" stroke-linecap="round"/><circle cx="${x}" cy="34" r="22" fill="none" stroke="${c}" stroke-width="5" stroke-dasharray="${Math.round(104 * f)} 138" transform="rotate(135 ${x} 34)" stroke-linecap="round"/><text x="${x}" y="40" text-anchor="middle" font-size="16" font-weight="700" fill="#fff">${text}</text>`;
    return `<svg class="cl-mini" viewBox="0 0 160 64" aria-hidden="true">${ring(32, acc, 0.56, '78')}${ring(128, acc2, 0.5, 'A')}</svg>`;
  };
  function clusterChoicePage(key) {
    const current = String(getOption(key));
    if (key === 'clusterBackground') {
      const tiles = Object.entries(OPTIONS.clusterBackground).map(([value, label]) =>
        `<button class="wp cl-bg ${value === current ? 'selected' : ''} ${value === 'light' ? 'is-light' : ''}" data-focus data-choose="${key}" data-value="${value}" style="background:${escape(clusterBgPreview(value))}">${miniGauges()}<span>${escape(label)}</span></button>`);
      return { title: TITLES[key], body: `<div class="wallpapers cl-bgs">${tiles.join('')}</div><p class="group-note">Farbfläche, Farbverlauf, Berge, Wellen, Polarlicht, Sternenhimmel und Höhenlinien in der Hintergrundfarbe. In der Fahrassistenz nur als ruhiger Farbton.</p>` };
    }
    // Farbe / Hintergrundfarbe: Farbkreise wie Apples Farbwahl
    const B = window.ClusterBg;
    const colorOf = (value) => key === 'clusterAccent'
      ? (value === 'multi' ? 'conic-gradient(#0a84ff 0 33%, #ff9f0a 0 66%, #30d158 0)' : B.ACCENTS[value])
      : (B.TINTS[value] || (settings.clusterAccent === 'multi' ? 'conic-gradient(#0a84ff 0 33%, #ff9f0a 0 66%, #30d158 0)' : B.ACCENTS[settings.clusterAccent] || '#0a84ff'));
    const dots = Object.entries(OPTIONS[key]).map(([value, label]) =>
      `<button class="cl-swatch ${value === current ? 'selected' : ''}" data-focus data-choose="${key}" data-value="${value}" aria-label="${escape(label)}"><i style="background:${colorOf(value)}"></i><span>${escape(label)}</span></button>`);
    return { title: TITLES[key], body: `<div class="group cl-swatches">${dots.join('')}</div>` + (NOTES[key] ? `<p class="group-note">${escape(NOTES[key])}</p>` : '') };
  }
  function settingsPage(id) {
    if (id === 'search') return settingsSearchPage();
    if (id.startsWith('choice:')) {
      const key = id.slice(7);
      if (['clusterBackground', 'clusterAccent', 'clusterTint'].includes(key) && window.ClusterBg) return clusterChoicePage(key);
      const current = getOption(key);
      // AI-Stimmen nur anbieten, wenn sie geladen sind (Einstellungen › Sprachassistent)
      const rows = Object.entries(OPTIONS[key]).filter(([value]) => !(key === 'clusterCenter' && value === 'map' && settings.clusterDesign !== 'dials')) // kleine Karte nur bei Rundinstrumenten
        .filter(([value]) => !key.startsWith('overlayShow.') || value === settings.mapStyle || (value !== 'google' && value !== 'apple'))
        .filter(([value]) => key !== 'voiceName' || value === current
        || (value.startsWith('st-') ? aiStatus?.supertonic : true)).map(([value, label]) =>
        `<button class="row" data-focus data-choose="${key}" data-value="${value}"><span class="row-label">${key === 'language' || key === 'voiceLang' ? langChoiceLabel(value, label) : escape(label)}</span><span class="row-check">${String(value) === String(current) ? ICONS.check : ''}</span></button>`);
      return { title: TITLES[key] || TITLES[key.replace('overlayShow.', 'overlays.')], body: group(rows, NOTES[key]) };
    }
    if (id.startsWith('stack:')) {
      const slot = Number(id.slice(6));
      const primaries = settings.dashboard.widgets;
      const extra = settings.dashboard.stacks[slot] || [];
      const rows = Object.entries(catalog.WIDGETS)
        .filter(([type]) => !primaries.includes(type))
        .map(([type, name]) => srow({ label: escape(name), sw: extra.includes(type), attrs: `data-stack-toggle="${slot}:${type}"` }));
      return {
        title: `Stapel ${['groß', 'oben', 'unten'][slot]}`,
        body: `<p class="group-note" style="padding-top:0">Oben liegt immer „${escape(catalog.WIDGETS[primaries[slot]])}“. Darunter:</p>` + group(rows),
      };
    }
    if (id.startsWith('app:')) {
      const appId = id.slice(4);
      const a = appInfo(appId);
      const color = (settings.apps[appId] || {}).color || catalog.APPS[appId].color;
      const swatches = Object.entries(catalog.COLORS).map(([key, [c1, c2]]) =>
        `<button class="swatch ${key === color ? 'selected' : ''}" data-focus data-app-color="${key}" data-id="${appId}" style="--c1:${c1};--c2:${c2}" aria-label="${key}"></button>`).join('');
      const rows = [];
      if (role === 'editor' && api) rows.push(srow({ icon: 'wallpaper', color: 'cyan', label: 'Eigenes Bild wählen …', attrs: `data-action="pick-icon" data-id="${appId}"`, chevron: false }));
      if (a.image) rows.push(srow({ icon: 'reset', color: 'gray', label: 'Standard-Icon', attrs: `data-action="reset-icon" data-id="${appId}"`, chevron: false }));
      if (settings.apps[appId]) rows.push(srow({ icon: 'reset', color: 'gray', label: 'Name und Farbe zurücksetzen', attrs: `data-action="reset-app" data-id="${appId}"`, chevron: false }));
      return {
        title: a.name,
        body: `<div class="app-preview">${iconHtml(appId)}<span>${escape(a.name)}</span></div>
          <div class="group swatch-grid">${swatches}</div>
          ${rows.length ? group(rows) : ''}
          <p class="group-note">${role === 'editor' ? 'PNG, JPG, WEBP oder SVG, am besten quadratisch. Den Namen änderst du mit „Anpassen“ unten.' : 'Eigene Bilder wählst du im Editor-Fenster am PC.'}</p>`,
      };
    }
    switch (id) {
      case 'wallpaper': {
        const tiles = Object.entries(catalog.WALLPAPERS).map(([key, wp]) =>
          `<button class="wp ${settings.wallpaper === key ? 'selected' : ''}" data-focus data-wallpaper="${key}" style="background:${theme === 'dark' && wp.dark ? wp.dark : wp.css}"><span>${wp.name}${wp.dark ? ' ◐' : ''}</span></button>`);
        for (const [name, url] of Object.entries(wallpaperFiles)) {
          tiles.push(`<button class="wp ${settings.wallpaper === `file:${name}` ? 'selected' : ''}" data-focus data-wallpaper="file:${escape(name)}" style="background-image:url('${url}')"><span>${escape(name)}</span></button>`);
        }
        if (customWallpaper) {
          tiles.push(`<button class="wp ${settings.wallpaper === 'custom' ? 'selected' : ''}" data-focus data-wallpaper="custom" style="background-image:url('${customWallpaper}')"><span>Eigenes Bild</span></button>`);
        }
        if (role === 'editor' && api) tiles.push('<button class="wp add" data-focus data-action="pick-wallpaper"><span>+ Eigenes Bild …</span></button>');
        return { title: 'Hintergrund', body: `<div class="wallpapers">${tiles.join('')}</div><p class="group-note">◐ wechselt mit Hell/Dunkel. Weitere Bilder: in den Ordner „wallpapers“ im Datenordner legen (Pfad unter Einstellungen › Info).</p>` };
      }
      // ---- Anzeige & Helligkeit: wie iOS mit zwei Vorschau-Kacheln und „Automatisch“
      case 'display': {
        const tile = (value, label) => `<button class="ap-tile ${theme === value ? 'selected' : ''}" data-focus data-choose="appearance" data-value="${value}">
            <span class="ap-preview ap-${value}"><i></i><i></i><i></i><i></i></span><b>${label}</b>
            <span class="ap-radio">${theme === value ? ICONS.check : ''}</span></button>`;
        return {
          title: 'Anzeige & Helligkeit',
          body: `<p class="group-title">Darstellung</p><div class="group ap-group">${tile('light', 'Hell')}${tile('dark', 'Dunkel')}</div>`
            + group([choiceRow('appearanceAuto', 'appearance', 'indigo')], NOTES.appearanceAuto)
            + group([toggleRow('nightDim', 'sun', 'indigo', 'Nachts dunkler')], 'Dimmt das Display wie ein echtes Auto, solange es im Spiel Nacht ist oder das Licht brennt.')
            + group([choiceRow('glass', 'glass', 'blue', 'Liquid Glass'), choiceRow('textScale', 'textsize', 'gray')], NOTES.glass)
            + group([link('truck-display', 'display', 'orange', 'Display im Truck', OPTIONS.gamma[settings.gamma] ? '' : '')], 'Format, sichtbarer Bereich und Bildkorrektur des Navi-Displays im Cockpit.'),
        };
      }
      // ---- Display im Truck: Format, sichtbarer Bereich, Bildkorrektur (Unterseite von Anzeige & Helligkeit)
      case 'truck-display':
        return {
          title: 'Display im Truck',
          body: group([choiceRow('displayFormat', 'display', 'orange')], displayFormatNote())
            + displayAreaGroup()
            + group([
              choiceRow('gamma', 'display', 'teal', 'Bildkorrektur im Truck'),
              ...(settings.gamma === 'custom' ? [choiceRow('gammaValue', 'appearance', 'indigo'), choiceRow('whiteLevel', 'sun', 'yellow')] : []),
            ], NOTES.gamma),
        };
      case 'homescreen':
        return {
          title: 'Home-Bildschirm & App-Icons',
          body: editRow('Beim Bearbeiten wackeln die Icons: ziehen zum Verschieben, antippen für Name, Farbe und Icon. Änderungen erscheinen sofort im Truck.') + group([
            choiceRow('iconTheme', 'home', 'green'),
            choiceRow('iconStyle', 'palette', 'pink'),
          ], `${NOTES.iconStyle} ${NOTES.iconTheme}`)
            + `<div class="group icon-preview">${['maps', 'music', 'radar', 'weather', 'settings'].map((id) => `<span class="row-app big">${iconHtml(id)}</span>`).join('')}</div>`
            + group([
              choiceRow('iconSize', 'home', 'blue'),
              toggleRow('showLabels', 'textsize', 'gray', 'App-Namen'),
              choiceRow('startScreen', 'dashboard', 'purple'),
              link('icons', 'palette', 'orange', 'Icons und Namen ändern'),
            ])
            + `<p class="group-title">Seitenleiste</p>` + group([
              choiceRow('sidebarMode', 'sidebar', 'orange'),
              choiceRow('sidebarCount', 'home', 'blue'),
              choiceRow('sidebar', 'sidebar', 'gray'),
            ], `${NOTES.sidebarMode} Automatisch: vier Apps auf hohen Displays, drei auf breiten.`)
            + `<p class="group-title">Statusleiste</p>` + group([
              choiceRow('phoneSignal', 'phone', 'blue'),
              choiceRow('phoneBattery', 'phone', 'green'),
            ], 'Empfang und Akku des „Handys“ oben in der Seitenleiste – nur zur Optik.'),
        };
      case 'maps':
        return {
          title: 'Karten',
          body: group([
            choiceRow('mapStyle', 'layers', 'green'),
            choiceRow('mapTheme', 'appearance', 'indigo'),
            toggleRow('mapTilt', 'layers', 'indigo', '3D-Ansicht'),
            toggleRow('mapNorth', 'maps', 'red', 'Norden oben'),
            choiceRow('mapFps', 'display', 'teal'),
          ])
            + group([
              link('map-content', 'layers', 'green', 'Karteninhalt', 'Landschaft, Straßen, Orte'),
              link('navigation', 'turn-turn', 'blue', 'Navigation & Hinweise', 'Ampeln, Spuren, Grenzen'),
            ])
            // Apple Karten und Google legen einige Anzeigen fest wie im Original (Issue #9: Position schien ignoriert) –
            // dort steht statt der Auswahl „Fest wie im Stil“
            + `<p class="group-title">Auf der Karte</p>` + group([
              ...[['banner', 'turn-turn', 'green'], ['eta', 'clock', 'green'], ['speed', 'truck', 'red'], ['compass', 'maps', 'gray']].map(([k, icon, color]) => {
                const fixed = { apple: ['eta', 'speed'], google: ['banner', 'eta', 'speed', 'compass'] }[settings.mapStyle] || [];
                if (!fixed.includes(k)) return choiceRow(`overlays.${k}`, icon, color);
                // Kompass gibt es bei Google gar nicht – sonst fest, aber ausblendbar (Ausblenden wirkt in jedem Stil)
                if (settings.mapStyle === 'google' && k === 'compass') return infoRow(TITLES[`overlays.${k}`], 'Aus wie bei Google', icon, color);
                return choiceRow(`overlayShow.${k}`, icon, color, TITLES[`overlays.${k}`]);
              }),
              srow({ icon: 'reset', color: 'gray', label: 'Positionen zurücksetzen', chevron: false, attrs: 'data-action="overlay-reset"' }),
            ], settings.mapStyle === 'apple' || settings.mapStyle === 'google' ? 'Fest: wie im Original. Wählst du eine Ecke, bleibt das Aussehen und nur die Position ändert sich. Zoom, Auto und 2D/3D gibt es nur in der Karten-App im Vollbild.' : 'Zoom, Auto und 2D/3D gibt es nur in der Karten-App im Vollbild.')
            + group([link('data', 'route', 'purple', 'Fahrdaten & Kartenfehler')]),
        };
      // ---- Karteninhalt: was die Karte zeigt, in drei Gruppen
      case 'map-content':
        return {
          title: 'Karteninhalt',
          body: `<p class="group-title">Landschaft</p>` + group([
              toggleRow('mapAreas', 'layers', 'green', 'Grünflächen & Orte'),
              toggleRow('mapForest', 'maps', 'green', 'Wälder'),
              toggleRow('mapMeadow', 'maps', 'mint', 'Wiesen & Büsche'),
              toggleRow('mapGround', 'maps', 'orange', 'Felder, Fels & Sand'),
              toggleRow('map3dBuildings', 'maps', 'gray', '3D-Gebäude'),
              toggleRow('mapTowns', 'maps', 'gray', 'Kleine Orte'),
              toggleRow('mapViewpoints', 'maps', 'purple', 'Aussichtspunkte'),
              toggleRow('mapWater', 'waves', 'blue', 'Meer'),
              toggleRow('mapInlandWater', 'river', 'cyan', 'Flüsse & Seen', 'Experimentell'),
              toggleRow('mapBuildings', 'cube', 'gray', 'Gebäude'),
            ], 'Flüsse & Seen sind experimentell – stimmt etwas nicht, im Kartenmenü „Fehler auf der Karte melden“.')
            + `<p class="group-title">Straßen</p>` + group([
              toggleRow('mapHighways', 'palette', 'yellow', 'Autobahnen farbig'),
              toggleRow('mapRoadClasses', 'palette', 'gray', 'Straßen nach Art einfärben'),
              toggleRow('mapShields', 'square', 'blue', 'Straßennummern (A1, E45 …)'),
              toggleRow('mapLaneMarkings', 'turn-straight', 'gray', 'Fahrbahnmarkierungen (nah)'),
              toggleRow('mapTrail', 'route', 'blue', 'Gefahrene Strecke'),
              toggleRow('mapDriven', 'route', 'purple', 'Alle gefahrenen Strecken (Fahrtenbuch)'),
            ], 'Farbige Autobahnen können an Kreuzen fleckig wirken.')
            + `<p class="group-title">Orte & Beschriftungen</p>` + group([
              toggleRow('mapLabels', 'textsize', 'gray', 'Städtenamen'),
              toggleRow('mapPois', 'fuel', 'blue', 'Tankstellen & Rastplätze'),
              toggleRow('mapSites', 'job', 'purple', 'Firmengelände & Steinbrüche'),
              toggleRow('mapSiteNames', 'textsize', 'purple', 'Firmennamen'),
              toggleRow('mapBusStops', 'stops', 'blue', 'Bushaltestellen'),
              toggleRow('mapLightIcons', 'warning', 'green', 'Ampeln auf der Karte'),
            ])
            + `<p class="group-title">Erweitert</p>` + group([
              toggleRow('mapHiddenRoads', 'layers', 'gray', 'Versteckte Straßen'),
              toggleRow('mapSecretRoads', 'search', 'purple', 'Geheime Abkürzungen'),
              toggleRow('mapRails', 'route', 'gray', 'Bahnlinien'),
              toggleRow('mapModNames', 'quote', 'purple', 'Namen aus Mods (Firmen, Städte)'),
            ], 'Versteckte Straßen zeigt das Spiel auf seiner Karte nicht – meist Kulisse oder nur für den KI-Verkehr.'),
        };
      // ---- Navigation & Hinweise: was während der Fahrt angezeigt und angesagt wird
      case 'navigation':
        return {
          title: 'Navigation & Hinweise',
          body: `<p class="group-title">Navigation</p>` + group([
              toggleRow('mapLights', 'warning', 'yellow', 'Ampeln voraus'),
              toggleRow('mapAlong', 'parking', 'gray', 'Rastplätze entlang der Route'),
              toggleRow('laneMarker', 'turn-straight', 'blue', 'Aktuelle Spur markieren'),
              toggleRow('curveWarn', 'warning', 'yellow', 'Vor engen Kurven warnen'),
              toggleRow('mapNextLimit', 'clock', 'red', 'Nächstes Tempolimit'),
              ...(settings.mapNextLimit ? [choiceRow('mapNextLimitStyle', 'clock', 'red')] : []),
              toggleRow('navVoice', 'speaker', 'green', 'Abbiegungen ansagen'),
              ...(isBus(telemetry) ? [toggleRow('busVoice', 'speaker', 'purple', 'Haltestellen ansagen')] : []), // nur im Bus
            ], isBus(telemetry) ? 'Abbiegungen ansagen ist sinnvoll, wenn die Navi-Stimme des Spiels aus ist. Haltestellen: „Nächster Halt“ beim Losfahren und kurz vor dem Halt, mit Gong. Entfernungen sind echte Meter – das Navi des Spiels rechnet in gestauchten Spielkilometern.'
              : 'Abbiegungen ansagen ist sinnvoll, wenn die Navi-Stimme des Spiels aus ist. Entfernungen sind echte Meter – das Navi des Spiels rechnet in gestauchten Spielkilometern.')
            + `<p class="group-title">Grenzen und Steigungen</p>` + group([
              toggleRow('mapBorder', 'border', 'blue', 'Hinweis vor Grenzen'),
              ...(settings.mapBorder ? [toggleRow('mapBorderVoice', 'speaker', 'blue', 'Grenzen ansagen')] : []),
              toggleRow('mapGrade', 'slope-down', 'orange', 'Steigungen und Gefälle'),
              ...(settings.mapGrade ? [choiceRow('gradeMin', 'slope-up', 'orange'), toggleRow('mapGradeVoice', 'speaker', 'orange', 'Steigungen ansagen')] : []),
            ], 'Grenze: etwa 1 km vorher Tempolimits, Maut und Dieselpreis des nächsten Landes. Steigungen: etwa 2 km vorher, mit Rat je nach Gewicht.'),
        };
      case 'music': {
        const st = spotifyStatus;
        const rows = [choiceRow('musicArt', 'music', 'green'), toggleRow('mediaPauseWithGame', 'pause', 'orange', 'Bei Spielpause anhalten'), toggleRow('spotify', 'library', 'green', 'Spotify-Mediathek')];
        let spotifyGroup = '';
        if (settings.spotify) {
          const sp = [infoRow('Konto', st?.connected ? `verbunden${st.user ? ` (${st.user})` : ''}` : st?.waiting ? 'Anmeldung im Browser …' : 'nicht verbunden', 'music', st?.connected ? 'green' : 'gray')];
          if (st?.error) sp.push(infoRow('Fehler', st.error, 'warning', 'red'));
          if (role === 'editor' && api) {
            sp.push(`<div class="row input-row">${badge('info', 'gray')}<input class="row-input" data-input="spotify-id" placeholder="Client-ID aus dem Spotify-Dashboard" value="${escape(st?.clientId || '')}" spellcheck="false"><button class="pill-button" data-focus data-action="spotify-connect">${st?.connected ? 'Neu verbinden' : 'Verbinden'}</button></div>`);
            if (st?.connected) sp.push(srow({ label: '<span class="danger">Spotify trennen</span>', attrs: 'data-action="spotify-disconnect"', chevron: false }));
          }
          spotifyGroup = group(sp, role === 'editor'
            ? `So geht's: auf developer.spotify.com/dashboard eine App anlegen („Web API“), als Redirect URI <b>${escape(st?.redirect || 'http://127.0.0.1:8724/callback')}</b> eintragen, die Client-ID hier einfügen und „Verbinden“. Abspielen aus der Mediathek braucht Spotify Premium und ein offenes Spotify.`
            : 'Verbinden im Editor-Fenster am PC (Einstellungen › Musik).');
        }
        return { title: 'Musik', body: group(rows, 'Die Mediathek zeigt in der Musik-App deine Playlists und zuletzt gehörte Titel (Knopf unten).') + spotifyGroup };
      }
      case 'radar': {
        const own = gameCameras().length;
        return {
          title: 'Blitzer',
          body: group([
            toggleRow('radar', 'radar', 'red', 'Vor Blitzern warnen'),
            toggleRow('radarSound', 'speaker', 'orange', 'Warnton'),
            choiceRow('radarTolerance', 'truck', 'red'),
          ], NOTES.radarTolerance)
            + group([
              toggleRow('radarWeigh', 'scale', 'orange', 'Waagen & Kontrollen'),
              toggleRow('radarToll', 'toll', 'yellow', 'Mautstellen'),
              toggleRow('radarBorder', 'border', 'blue', 'Grenzübertritt melden'),
            ])
            + group([
              infoRow('Eigene Blitzer', `${own} gespeichert`, 'camera', 'red'),
              ...(own ? [srow({ label: '<span class="danger">Eigene Blitzer löschen</span>', attrs: 'data-action="radar-clear"', chevron: false })] : []),
            ], 'Das Spiel hat keine Blitzerliste. Bekannt sind Kameras und Mautstellen aus den Kartendaten; dazu lernt die App jeden Blitzer, der dich erwischt, und alle, die du in der Blitzer-App meldest.'),
        };
      }
      case 'video': {
        const v = settings.video;
        const rows = v.items.map((item, i) => srow({
          icon: 'video', color: item.kind.startsWith('tw') ? 'purple' : 'red',
          label: escape(item.title), value: i === v.current ? 'aktiv' : '', chevron: false,
          attrs: `data-video-remove="${i}"`, cls: 'removable',
        }));
        const add = role === 'editor' && api
          ? group([`<div class="row input-row">${badge('plus', 'blue')}<input class="row-input" data-input="video-link" placeholder="YouTube-, Twitch- oder TikTok-Link einfügen" spellcheck="false"><button class="pill-button" data-focus data-action="video-add">Hinzufügen</button></div>`],
            videoError ? `<b class="error">${escape(videoError)}</b>` : 'z. B. youtube.com/watch?v=…, youtu.be/…, eine Playlist oder twitch.tv/kanal')
          : '';
        return {
          title: 'Video',
          body: add
            + group([srow({ icon: 'truck', color: 'orange', label: 'Bild beim Fahren zeigen', sw: v.driving, attrs: 'data-action="video-driving"' })],
              'Aus: beim Fahren bleibt nur der Ton (wie Radio), das Bild erscheint erst im Stand.')
            + group([srow({ icon: 'layers', color: 'gray', label: 'Andere Webseiten', sw: v.web, attrs: 'data-action="video-web"' })],
              'Auch Links zu anderen Seiten mit eingebautem Player öffnen. Die Seite läuft dann wie im Browser, mit ihrer Werbung und ihren Hinweisen. Pause bei Anrufen, Spulen und Lautstärke klappen nur, wenn die Seite einen normalen Video-Player hat. Pop-ups sind gesperrt.')
            + group([
              srow({ icon: 'cancelled', color: 'red', label: videoClearArmed.history ? 'Wirklich Verlauf löschen? Nochmal tippen' : 'Verlauf löschen', chevron: false, attrs: 'data-action="video-clear-history"' }),
              ...(api?.webClear ? [srow({ icon: 'cancelled', color: 'red', label: videoClearArmed.cookies ? 'Wirklich Cookies löschen? Nochmal tippen' : 'Cookies löschen', chevron: false, attrs: 'data-action="video-clear-cookies"' })] : []),
            ], 'Verlauf: gespeicherte Videos und gemerkte Stellen. Cookies: Anmeldungen, Cookie-Banner, Altersabfragen und andere Daten der Video-Seiten – Einstellungen und Daten der App bleiben.')
            + group([srow({ icon: 'phone', color: 'green', label: 'Bei Anrufen anhalten', sw: v.pauseOnCall, attrs: 'data-action="video-pause-call"' })],
              'Ruft jemand an, hält das Video an und läuft nach dem Auflegen weiter. Videos machen außerdem dort weiter, wo du aufgehört hast.')
            + group([
              srow({ icon: 'video', color: 'indigo', label: 'Bild im Bild', sw: v.pip, attrs: 'data-action="video-pip"' }),
              ...(v.pip ? [srow({ icon: 'grid9', color: 'indigo', label: 'Größe', value: { s: 'Klein', m: 'Mittel', l: 'Groß' }[v.pipSize], chevron: false, attrs: 'data-action="video-pip-size-next"' })] : []),
            ], 'Wechselst du in eine andere App, läuft das Video klein in einer Ecke weiter. Ziehen schiebt es in eine andere Ecke, Antippen öffnet die Video-App, ✕ beendet es. Die Größe lässt sich auch im Fenster umschalten.')
            + (rows.length ? `<p class="group-title">Gespeichert – antippen zum Entfernen</p>` + group(rows) : ''),
        };
      }
      // ---- Spiegelkamera (Blinker-Kamera): Navi und Kombiinstrument an einer Stelle
      case 'mirror':
        return {
          title: 'Spiegelkamera',
          body: group([
            srow({ icon: 'truck', color: 'blue', label: 'Spiegelkamera beim Blinken', sw: settings.mirrorCam, attrs: 'data-toggle="mirrorCam"' }),
            ...(settings.mirrorCam ? [
              choiceRow('mirrorTarget', 'display', 'teal'),
              choiceRow('mirrorView', 'truck', 'blue'),
              choiceRow('mirrorFps', 'display', 'teal'),
              toggleRow('mirrorArrow', 'car', 'green', 'Blinkerpfeil im Bild'),
              srow({ icon: 'video', color: 'indigo', label: 'Video ersetzen', sw: settings.mirrorReplace, attrs: 'data-toggle="mirrorReplace"' }),
            ] : []),
          ], 'Beim Blinken das Bild der Kameraspiegel dieser Seite – wie eine Totwinkel-Kamera. Nur in Trucks mit Kameraspiegeln (z. B. Volvo FH) und in der Innenansicht. Video ersetzen: Ein Video im Bild-im-Bild macht so lange Platz.')
            // Lkw, die laut Spiel keine Kameraspiegel haben: per Mod nachgerüstet? Dann hier für diesen Lkw erlauben
            + (settings.mirrorCam && stockNoCamMirrors() ? group([srow({ icon: 'truck', color: 'orange', label: 'Kameraspiegel per Mod (dieser Lkw)', sw: modCamMirrors(), attrs: 'data-action="mirror-mod-truck"' })],
              'Nur für Lkw, die im Spiel keine Kameraspiegel haben, aber per Mod welche bekommen.') : ''),
        };
      // ---- Kombiinstrument › Instrumente
      case 'cluster-gauges':
        return {
          title: 'Instrumente',
          body: group([
            choiceRow('clusterGauge', 'clock', 'teal'),
            toggleRow('clusterDialInfo', 'fuel', 'teal', 'Werte im Instrument'),
            ...(settings.clusterDialInfo !== false ? [choiceRow('clusterDialRight', 'fuel', 'teal')] : []),
            choiceRow('clusterBlinkers', 'car', 'green'),
            choiceRow('clusterArrows', 'car', 'green'),
          ], NOTES.clusterBlinkers)
            + group([
              toggleRow('clusterInfo', 'info', 'gray', 'Leiste unten'),
              ...(settings.clusterInfo !== false ? [choiceRow('clusterInfoStyle', 'sliders', 'gray')] : []),
            ], 'Uhrzeit, Temperatur, Reichweite und AdBlue.'),
        };
      // ---- Kombiinstrument › Fahrassistenz
      case 'cluster-assist':
        return {
          title: 'Fahrassistenz',
          body: group([
            toggleRow('clusterLaneWarn', 'car', 'red', 'Spurverlassen-Warnung'),
            toggleRow('clusterBlindSpot', 'warning', 'red', 'Totwinkel-Warnung beim Blinken'),
            toggleRow('clusterLeadDist', 'car', 'blue', 'Abstand zum Vordermann'),
            toggleRow('clusterLeadColor', 'car', 'blue', 'Vordermann blau markieren'),
          ])
            + group([
              toggleRow('clusterLightTimer', 'clock', 'red', 'Restzeit an der Ampel'),
              toggleRow('clusterWorks', 'warning', 'orange', 'Baustellen (Baken, Pylonen)'),
              toggleRow('clusterBuildings', 'home', 'gray', 'Gebäude in der Fahrassistenz'),
            ])
            + group([
              toggleRow('clusterReverseAid', 'truck', 'orange', 'Rangierhilfe beim Rückwärtsfahren'),
              ...(settings.clusterReverseAid !== false ? [toggleRow('clusterReversePath', 'sliders', 'orange', 'Fahrweg nach Lenkeinschlag')] : []),
            ], 'Gilt für das Design Fahrassistenz und die Straßenansicht im Instrument.'),
        };
      case 'cluster-widgets': {
        // Unterseite: welche Widgets im Stapel sind (Reihenfolge fest: Pause, Lieferfrist, Reichweite, Verbrauch)
        const on = settings.clusterWidgetList || [];
        const names = { rest: 'Pause', delivery: 'Lieferfrist', range: 'Reichweite', fuel: 'Verbrauch' };
        const rows = Object.entries(names).map(([id, name]) => srow({ icon: 'dashboard', color: 'teal', label: escape(name), sw: on.includes(id), attrs: `data-action="cluster-widget" data-widget="${id}"` }));
        return { title: 'Widgets', body: group(rows, 'Pause: Lenkzeit bis zur nächsten Pause. Lieferfrist: wie lange noch bis zur Lieferung. Reichweite: Tank und AdBlue. Verbrauch: Durchschnitt. Wird es knapp, springt das Widget nach vorn und leuchtet orange oder rot.') };
      }
      case 'cluster-cycle': {
        // Unterseite: welche Designs die Displaytaste (I) durchschaltet – mindestens eins bleibt an
        const on = settings.clusterCycle || [];
        const rows = Object.entries(OPTIONS.clusterDesign).map(([id, name]) => srow({ icon: 'display', color: 'blue', label: escape(name), sw: on.includes(id), attrs: `data-action="cluster-cycle" data-design="${id}"` }));
        return { title: 'Designs für die Displaytaste', body: group(rows, 'Eingeschaltete Designs kommen beim Drücken der Taste für den Displaymodus der Reihe nach. Mindestens eins bleibt an.') };
      }
      case 'cluster': {
        // Live-Vorschau: das echte Instrument (cluster.html im Vorschaumodus) mit den aktuellen Einstellungen
        const q = clusterPreviewQuery(); // 10b-ultra-app.js
        const preview = `<button class="cl-preview" data-focus data-page="choice:clusterDesign"><iframe class="cl-frame" src="cluster.html?${escape(q.toString())}" tabindex="-1" aria-hidden="true"></iframe><span class="cl-preview-tag">${escape(OPTIONS.clusterDesign[settings.clusterDesign] || '')}</span></button>`;
        const design = settings.clusterDesign;
        const withCenter = design === 'dials' || design === 'bars'; // nur dort gibt es die Mitte mit Navi/Musik
        const center = settings.clusterCenter;
        const centerRows = withCenter ? [
          choiceRow('clusterCenter', 'maps', 'green'),
          ...(center === 'auto' ? [toggleRow('clusterBoth', 'music', 'red', 'Musik unter dem Navi')] : []),
          ...(center === 'auto' && settings.clusterBoth !== false ? [choiceRow('clusterFocus', 'sliders', 'blue')] : []),
          ...(center === 'auto' || center === 'media' ? [toggleRow('clusterCover', 'library', 'pink', 'Albumcover')] : []),
        ] : design === 'music' ? [toggleRow('clusterCover', 'library', 'pink', 'Albumcover')] : [];
        return {
          title: 'Kombiinstrument',
          body: preview
            + group([infoRow('Im Truck', clusterActive ? 'Aktiv' : 'Aus', 'display', clusterActive ? 'green' : 'gray')],
              'Ein- und ausschalten im Ingame-Menü (Strg+F8), auch während der Fahrt. Nur Trucks mit voll digitalem Kombiinstrument.')
            + groupTitle('Aussehen')
            + group([choiceRow('clusterDesign', 'display', 'blue'), link('cluster-cycle', 'sliders', 'teal', 'Designs für die Displaytaste', `${(settings.clusterCycle || []).length} von ${Object.keys(OPTIONS.clusterDesign).length}`), choiceRow('clusterAccent', 'palette', 'orange'), choiceRow('clusterBackground', 'wallpaper', 'indigo'), ...(ULTRA_TINTED.includes(settings.clusterBackground) ? [choiceRow('clusterTint', 'palette', 'pink')] : []), link('cluster-gauges', 'clock', 'teal', 'Instrumente', OPTIONS.clusterGauge[settings.clusterGauge] || '')],
              'Die Taste für den Displaymodus (ab Werk I) schaltet die ausgewählten Designs der Reihe nach durch.')
            + displayAreaGroup('cluster')
            + (centerRows.length ? groupTitle(design === 'music' ? 'Musik' : 'Mitte') + group(centerRows, withCenter && center === 'auto' ? 'Mit Route der Abbiegehinweis, sonst der laufende Titel. „Größer anzeigen“ gilt, wenn beides zu sehen ist.' : '') : '')
            + (['dials', 'bars', 'mapdials', 'tesla'].includes(design) ? groupTitle('Widgets') + group([
              toggleRow('clusterWidgets', 'dashboard', 'teal', 'Widget-Stapel'),
              ...(settings.clusterWidgets !== false ? [link('cluster-widgets', 'sliders', 'teal', 'Widgets', `${(settings.clusterWidgetList || []).length} von 4`), choiceRow('clusterWidgetMode', 'sliders', 'blue')] : []),
            ], 'Kleine Karte in der Mitte wie bei CarPlay Ultra: Pause, Lieferfrist, Reichweite und Verbrauch, der Reihe nach. Wird etwas knapp, springt es nach vorn. Mit Navi und Musik zugleich, in der Fahrassistenz und bei Balken nur bei einer Warnung.') : '')
            + groupTitle('Mehr')
            + group([link('cluster-assist', 'car', 'blue', 'Fahrassistenz'), link('mirror', 'truck', 'green', 'Spiegelkamera', settings.mirrorCam ? OPTIONS.mirrorTarget[settings.mirrorTarget] || '' : 'Aus'), toggleRow('clusterBoot', 'play', 'blue', 'Start-Animation'), ...(settings.clusterBoot !== false ? [choiceRow('clusterBootStyle', 'play', 'blue')] : []), toggleRow('clusterNotes', 'messages', 'red', 'Hinweis-Karten'), toggleRow('clusterShiftHint', 'chevron-up', 'green', 'Schaltempfehlung (Handschaltung)'), toggleRow('clusterNextLimit', 'clock', 'blue', 'Nächstes Tempolimit')],
              'Hinweis-Karten: Mitteilungen des Navis gleiten oben im Instrument ein.')
            + groupTitle('Leistung')
            + group([choiceRow('clusterFps', 'sliders', 'teal')], 'Mehr Bilder pro Sekunde lassen Tacho und Drehzahl ruhiger laufen, kosten aber etwas Rechenzeit.'),
        };
      }
      case 'dispatcher':
        return {
          title: 'Telefon',
          body: group([choiceRow('dispatcher', 'phone', 'green')], 'Der Disponent meldet sich bei Aufträgen, Lieferungen, Strafen und Warnungen – Wichtiges kommt als Anruf.')
            + group([link('assistant', 'speaker', 'pink', 'Stimme & Vorlesen', settings.voice ? voiceShown() : 'Aus')]),
        };
      case 'assistant': {
        const st = aiStatus;
        const gb = (bytes) => `${(bytes / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`;
        const dl = st?.downloading;
        const progress = (d) => {
          const pct = d.total ? Math.floor((d.done / d.total) * 100) : 0;
          return [
            srow({ icon: 'reset', color: 'purple', label: `Lädt: ${d.part || '…'}`, value: `${pct} % · ${gb(d.done)} von ${gb(d.total)}`, chevron: false, cls: 'static' }),
            srow({ icon: 'cancelled', color: 'red', label: 'Download abbrechen', attrs: 'data-action="ai-cancel"', chevron: false }),
          ];
        };
        if (!api?.aiStatus) {
          return { title: 'Sprachassistent', body: group([infoRow('AI-Sprachassistent', 'Nur in der App', 'mic', 'gray')], 'Der AI-Sprachassistent läuft nur in der installierten App.') };
        }
        const aiOn = !!st?.installed && settings.aiAssistant;
        // 1) So sprichst du
        const top = group([
          infoRow('Sprechen', 'Home-Knopf halten · Strg+Alt+V', 'mic', 'purple'),
          infoRow('Modus', aiOn ? 'AI – frei sprechen' : 'Feste Befehle', aiOn ? 'check' : 'list', aiOn ? 'green' : 'gray'),
          link('assistant-help', 'info', 'blue', 'Was kann ich sagen?'),
        ]);
        // 2) AI-Sprachmodell
        let aiRows;
        let aiNote;
        if (dl && dl.model !== 'supertonic' && dl.model !== 'kokoro') { // Stimmen-Downloads zeigen ihren Fortschritt unten bei „Stimme“
          aiRows = progress(dl);
          aiNote = 'Der Download läuft im Hintergrund weiter, auch wenn du diese Seite verlässt.';
        } else if (st?.installed) {
          aiRows = [
            infoRow('Geladen', `${st.modelName || ''} · ${gb(st.sizes[st.model] || 0)}`, 'check', 'green'),
            toggleRow('aiAssistant', 'mic', 'purple', 'Frei sprechen statt fester Befehle'),
            toggleRow('aiCalls', 'phone', 'green', 'Gespräche am Telefon'),
            toggleRow('aiGpu', 'display', 'blue', 'Grafikkarte nutzen'),
          ];
          aiNote = `Grafikkarte: schnelle Antworten, braucht im Spiel etwa ${st.model === 'compact' ? '1,5' : '3'} GB Grafikspeicher. Aus: läuft auf dem Prozessor (langsamer).`;
        } else {
          aiRows = [
            srow({ icon: 'mic', color: 'purple', label: 'Standard laden – beste Antworten', value: st ? gb(st.sizes.standard) : '', attrs: 'data-action="ai-install" data-model="standard"', chevron: false }),
            srow({ icon: 'mic', color: 'indigo', label: 'Kompakt laden – für schwächere PCs', value: st ? gb(st.sizes.compact) : '', attrs: 'data-action="ai-install" data-model="compact"', chevron: false }),
          ];
          aiNote = 'Optional: Mit dem AI-Sprachassistenten sprichst du frei statt fester Befehle, bekommst Antworten aus deinen Spieldaten (Auftrag, Route, Tank, Pause) und führst echte Gespräche am Telefon. Alles läuft auf deinem PC – kostenlos, ohne Konto, nach dem Download ohne Internet. Ohne Download funktionieren weiter die festen Sprachbefehle.';
        }
        if (st?.error) aiRows.push(srow({ icon: 'warning', color: 'red', label: 'Fehler', value: escape(st.error), chevron: false, cls: 'static' }));
        // 3) Stimme: Auswahl, Vorlesen, Olivia laden (Supertonic)
        const voiceRows = [
          link('choice:voiceName', 'speaker', 'pink', 'Stimme', voiceShown()),
          choiceRow('voiceLang', 'chat', 'blue'),
          toggleRow('voice', 'message', 'blue', 'Meldungen vorlesen'),
        ];
        // Chinesische Ansagen: eigene AI-Stimme (Kokoro) – laden oder auswählen
        if (speechLang().startsWith('zh')) {
          if (dl?.model === 'kokoro') voiceRows.push(...progress(dl));
          else if (st?.kokoro) voiceRows.push(choiceRow('voiceZh', 'speaker', 'red'));
          else if (st) voiceRows.push(srow({ icon: 'speaker', color: 'red', label: 'Chinesische AI-Stimme laden', value: gb(st.kokoroSize), attrs: 'data-action="ai-install" data-model="kokoro"', chevron: false }));
        }
        if (dl?.model === 'supertonic') voiceRows.push(...progress(dl));
        else if (!st?.supertonic) voiceRows.push(srow({ icon: 'speaker', color: 'pink', label: 'Stimme Olivia laden', value: st ? gb(st.supertonicSize) : '', attrs: 'data-action="ai-install" data-model="supertonic"', chevron: false }));
        const voiceNote = st?.supertonic
          ? 'Olivia und neun weitere AI-Stimmen lesen Disponent, Navi-Hinweise und Antworten vor – auf Deutsch und Englisch. Sie laufen direkt in der App auf dem Prozessor, ohne Grafikkarte. Empfohlen ist Olivia: Für sie ist die Aussprache gemacht und geprüft.'
          : 'Optional: zehn natürliche AI-Stimmen (Supertonic), darunter Olivia. Laufen lokal auf dem Prozessor, auch auf mittleren PCs, und funktionieren ohne das Sprachmodell.';
        // 4) Verwalten (ganz unten, wie bei iOS)
        const manageRows = [
          ...(st?.installed || st?.supertonic || st?.kokoro ? [srow({ icon: 'library', color: 'blue', label: 'Ordner öffnen', attrs: 'data-action="ai-open"', chevron: false })] : []),
          ...(st?.installed ? [srow({ icon: 'cancelled', color: 'red', label: 'Sprachmodell entfernen', value: gb(st.sizes[st.model] || 0), attrs: 'data-action="ai-remove" data-kind="model"', chevron: false })] : []),
          ...(st?.supertonic ? [srow({ icon: 'cancelled', color: 'red', label: 'AI-Stimmen entfernen', value: gb(st.supertonicSize), attrs: 'data-action="ai-remove" data-kind="supertonic"', chevron: false })] : []),
          ...(st?.kokoro ? [srow({ icon: 'cancelled', color: 'red', label: 'Chinesische AI-Stimme entfernen', value: gb(st.kokoroSize), attrs: 'data-action="ai-remove" data-kind="kokoro"', chevron: false })] : []),
        ];
        return {
          title: 'Sprachassistent',
          body: top
            + groupTitle('AI-Sprachmodell') + group(aiRows, aiNote)
            + groupTitle('Stimme') + group([...voiceRows, ...zhVoiceRows()], speechLang().startsWith('zh') ? (st?.kokoro && settings.voiceZh !== 'win' ? ZH_AI_NOTE : ZH_VOICE_NOTE) : voiceNote)
            + (manageRows.length ? groupTitle('Verwalten') + group(manageRows, 'Entfernen geht jederzeit: ohne Sprachmodell gelten wieder die festen Befehle, ohne AI-Stimme spricht die Windows-Stimme.') : '')
            + `<p class="group-note">Bestandteile: Spracherkennung Whisper (whisper.cpp, MIT), Sprachmodell Qwen3.5 von Alibaba (Apache 2.0) über llama.cpp (MIT), Stimmen Supertonic 3 von Supertone (OpenRAIL-M) über ONNX Runtime (MIT), chinesische Stimme Kokoro (Apache 2.0) über sherpa-onnx (Apache 2.0). Geladen von GitHub, npm und Hugging Face, geprüft per SHA-256, gespeichert unter %APPDATA%\\CabPlay\\ai.</p>`,
        };
      }
      case 'assistant-help': {
        // Beispiele – mit AI geht alles frei formuliert, ohne AI genau diese Sätze
        const ex = (icon, color, label, value) => srow({ icon, color, label, value, chevron: false, cls: 'static' });
        const aiOn = !!aiStatus?.installed && settings.aiAssistant;
        return {
          title: 'Was kann ich sagen?',
          body: groupTitle('Navigation & Pause') + group([
            ex('route', 'blue', '„Wie weit noch?“', 'Ankunft, Abbiegen, Blitzer'),
            ex('fuel', 'orange', '„Nächste Tankstelle“', 'Entfernung, an der Route'),
            ex('rest', 'green', '„Wann muss ich Pause machen?“', 'Lenkzeit, Rastplatz'),
          ]) + groupTitle('Auftrag & Truck') + group([
            ex('job', 'orange', '„Wann muss ich liefern?“', 'Frist, pünktlich?'),
            ex('fuel', 'red', '„Wie viel Diesel habe ich?“', 'Tankinhalt, Reichweite'),
            ex('service', 'gray', '„Wie geht es dem Truck?“', 'Schäden, Werkstatt'),
          ]) + groupTitle('Musik & Telefon') + group([
            ex('next', 'pink', '„Nächstes Lied“', 'auch Pause, Weiter, Zurück'),
            ex('phone', 'green', '„Ruf den Disponenten an“', 'auch Verkehrsfunk, Pannenhilfe'),
            ex('weather', 'cyan', '„Wie wird das Wetter?“', 'am aktuellen Ort'),
          ], aiOn
            ? 'Mit AI musst du dir keine Sätze merken: Frag einfach, wie du willst – z. B. „Schaffe ich es noch vor der Pause nach Calais?“ oder „Spiel was Ruhiges“.'
            : 'Ohne AI versteht die App genau diese und ähnliche feste Sätze. Mit dem AI-Sprachmodell (Einstellungen › Sprachassistent) sprichst du frei.'),
        };
      }
      case 'notifications':
        return {
          title: 'Mitteilungen',
          body: group([
            toggleRow('notifyDispatcher', 'message', 'green', 'Disponent'),
            toggleRow('notifyJobs', 'job', 'orange', 'Aufträge'),
            toggleRow('notifyMoney', 'messages', 'red', 'Strafen, Maut & Fähren'),
            toggleRow('notifyWarnings', 'warning', 'orange', 'Warnungen (Tank, Pause, Werkstatt …)'),
            toggleRow('notifyBorder', 'border', 'blue', 'Grenzübertritt'),
            toggleRow('notifyRadar', 'camera', 'red', 'Blitzer'),
            toggleRow('notifySport', 'sports', 'green', 'Sport-Ticker'),
            toggleRow('notifySystem', 'settings', 'gray', 'App, Karte & Plugin'),
          ], 'Ausgeschaltete Arten erscheinen nicht mehr als Banner auf dem Bildschirm – in der Mitteilungen-App und beim Disponenten stehen sie trotzdem.'),
        };
      case 'sports':
        return {
          title: 'Sport',
          body: group([
            toggleRow('sportsPush', 'sports', 'green', 'Live-Ticker für Lieblingsteams'),
            toggleRow('sportsF1', 'flag', 'red', 'Formel 1: Rennstart und Ergebnis'),
          ], 'Lieblingsteams wählst du in der Sport-App: Tabelle öffnen und den Verein antippen. Bei Anpfiff, Toren, Halbzeit und Abpfiff kommt eine Mitteilung. Einzelne Spiele: Spiel antippen. Daten: OpenLigaDB (deutsche Ligen), ESPN (weitere Ligen, NFL) und Jolpica (Formel 1), ohne Konto.')
            + `<p class="group-title">Ligen</p>` + group(sportOrdered().map(([id, name, short, color]) => {
              const shown = !(settings.sportsHidden || []).includes(id);
              return `<div class="row sx-orow ${shown ? '' : 'off'}" data-sort-id="${id}"><span class="sx-grip" aria-label="Ziehen zum Sortieren"><i></i><i></i><i></i></span><span class="sx-badge" data-no-i18n style="--lc:${color}">${short}</span><span class="row-label">${escape(name)}</span>
                <button class="sx-show" data-focus data-action="sport-hide" data-id="${id}" aria-label="Ein- oder ausblenden"><span class="switch ${shown ? 'on' : ''}"></span></button></div>`;
            }).concat([srow({ icon: 'reset', color: 'gray', label: 'Reihenfolge zurücksetzen', attrs: 'data-action="sport-order-reset"', chevron: false })]), 'Am Griff ≡ ziehen ändert die Reihenfolge – oder in der Sport-App eine Liga kurz halten und ziehen. Der Schalter blendet eine Liga aus.')
            // Lieblingsteams je Verein (Wappen, Name, Wettbewerbe) und einzeln verfolgte Spiele – „Entfernen“ beendet den Ticker
            + (settings.sportsTeams.length ? `<p class="group-title">Lieblingsteams</p>` + group(sportFavTeams().map((e) => srow({
              icon: e.team?.logo ? `<span class="sx-set-crest"><img src="${escape(e.team.logo)}" alt="" loading="lazy"></span>` : 'sports',
              color: 'green',
              label: `${escape(e.team?.name || `Verein ${e.id}`)}<small class="sx-set-sub">${escape(e.leagues.join(' · '))}</small>`,
              value: 'Entfernen', attrs: `data-action="sport-fav-remove" data-id="${escape(e.favs.join(','))}"`, chevron: false,
            })), settings.sportsPush ? 'Live-Ticker: Mitteilung bei Anpfiff, Toren, Halbzeit und Abpfiff.' : 'Der Live-Ticker für Lieblingsteams ist aus (Schalter oben).') : '')
            + ((settings.sportsMatches || []).length ? `<p class="group-title">Verfolgte Spiele</p>` + group(sportFollowedMatches().map((f) => srow({
              icon: 'sports', color: 'orange', label: `${escape(f.label)}<small class="sx-set-sub">${escape(f.league)}</small>`,
              value: 'Entfernen', attrs: `data-action="sport-unfollow" data-id="${escape(f.key)}"`, chevron: false,
            })), 'Einzelne Spiele verfolgst du in der Sport-App: Spiel antippen.') : ''),
        };
      case 'logbook':
        return {
          title: 'Fahrtenbuch',
          body: group([
            toggleRow('tracking', 'logbook', 'yellow', 'Fahrten aufzeichnen'),
          ], 'Merkt sich jede Fahrt mit Strecke – Aufträge und freie Fahrten. Zu sehen in der Fahrtenbuch-App und auf der Karte (Karten › Karteninhalt). Bleibt auf deinem PC.')
            + (api?.tripsClear ? group([srow({ icon: 'cancelled', color: 'red', label: tripsClearArmed ? 'Wirklich alles löschen? Nochmal tippen' : 'Fahrtenbuch löschen', chevron: false, attrs: 'data-action="trips-clear"' })]) : ''),
        };
      case 'weather':
        return {
          title: 'Wetter',
          body: group([toggleRow('weather', 'weather', 'cyan', 'Echtes Wetter (Internet)')],
            'Zeigt das echte Wetter der nächsten Stadt im Spiel (Open-Meteo). Übertragen werden nur Stadt und Land.'),
        };
      case 'icons':
        return {
          title: 'App-Icons',
          body: group([toggleRow('brandIcon', 'truck', 'teal', 'Marke als Fahrzeug-Icon')],
            'Das Fahrzeug-Icon zeigt das Logo der Marke, die du gerade fährst (Scania, Volvo, MAN, DAF, Mercedes-Benz, Renault, Iveco und die US-Marken). Die Logos lädt die App beim ersten Mal von Wikipedia und speichert sie auf deinem PC; sie gehören den jeweiligen Herstellern.')
            // ohne Dashboard: das ist kein App-Symbol mehr (Seite links vom Home-Bildschirm, Punkt mit Raster)
            + group(Object.keys(catalog.APPS).filter((appId) => appId !== 'dashboard').map((appId) =>
            srow({ icon: `<span class="row-app">${iconHtml(appId)}</span>`, label: escape(appInfo(appId).name), value: customIcons[appId] ? 'Eigenes Bild' : '', attrs: `data-page="app:${appId}"` }))),
        };
      case 'dashboard': {
        const stackCount = (slot) => {
          // gespeicherte Widgets – nicht das während einer Buslinie eingeschobene Fahrerdisplay
          const primaries = settings.dashboard.widgets;
          const n = ((settings.dashboard.stacks || [])[slot] || []).filter((t) => !primaries.includes(t)).length;
          return n > 0 ? `+${n}` : 'keine';
        };
        return {
          title: 'Dashboard',
          body: editRow('Widgets verschieben, aufeinanderziehen und austauschen – Änderungen erscheinen sofort im Truck.') + group([choiceRow('dashboard.0', 'widgets', 'purple'), choiceRow('dashboard.1', 'widgets', 'blue'), choiceRow('dashboard.2', 'widgets', 'teal')],
            'Im Editor („Anpassen“) lassen sich Widgets auch aufeinanderziehen.')
            + group([...[0, 1, 2].map((slot) => link(`stack:${slot}`, 'layers', ['purple', 'blue', 'teal'][slot], `Stapel ${['groß', 'oben', 'unten'][slot]}`, stackCount(slot))),
              toggleRow('stackJump', 'messages', 'green', 'Bei Mitteilungen dorthin springen')],
              'Mehrere Widgets übereinander – wischen, Mausrad oder die Punkte am Rand wechseln. Eingeschaltet springt der Stapel bei neuen Mitteilungen (Strafen, Maut, Aufträge) selbst zum Mitteilungen-Widget.'),
        };
      }
      case 'remote': {
        const info = remoteInfo;
        const rows = [toggleRow('remote', 'phone', 'blue', 'Handy-Steuerung')];
        let codes = '';
        if (settings.remote && info) {
          if (info.error) rows.push(infoRow('Fehler', info.error, 'warning', 'red'));
          if (!info.urls?.length && !info.error) rows.push(infoRow('Adresse', 'wird gestartet …', 'maps', 'gray'));
          // ein Code für die beste Adresse (Heimnetz, ohne VPN), weitere nur als Text darunter
          const more = (info.urls || []).slice(1, 3);
          codes = (info.urls || []).slice(0, 1).map((url) => {
            let qr = '';
            try {
              qr = window.CarPlayQR ? CarPlayQR.svg(url, { margin: 1 }) : '';
            } catch {
              qr = '';
            }
            return `<div class="qr-card">
                <div class="qr-code">${qr}</div>
                <div class="qr-text">
                  <b>Mit dem Handy scannen</b>
                  <ol><li>Kamera-App öffnen und auf den Code halten</li><li>Link antippen – das CabPlay-Bild erscheint</li><li>Antippen wie einen Touchscreen</li></ol>
                  <code data-no-i18n>${escape(url)}</code>
                </div>
              </div>`;
          }).join('') + (more.length ? `<p class="group-note">Klappt der Code nicht? Weitere Adressen dieses PCs: ${more.map((u) => `<code data-no-i18n>${escape(u)}</code>`).join(' ')}</p>` : '');
        }
        return {
          title: 'Handy-Steuerung',
          body: group(rows) + codes
            + `<p class="group-note">Handy und PC müssen im selben WLAN sein. Tipp: im Browser „Zum Home-Bildschirm“ wählen. Beim ersten Einschalten fragt die Windows-Firewall – „Private Netzwerke“ erlauben. Über 🔗 auf der Handy-Seite schickst du YouTube- und Twitch-Links an die Video-App.</p>`,
        };
      }
      case 'hotkeys': {
        const rows = Object.keys(HOTKEY_NAMES).map((action) => {
          const value = capturing === action ? 'Taste drücken …' : prettyAccelerator(hotkeys[action]);
          return srow({ label: HOTKEY_NAMES[action], value: escape(value), chevron: false, attrs: role === 'editor' ? `data-hotkey="${action}"` : '', cls: capturing === action ? 'capturing' : role === 'editor' ? '' : 'static' });
        });
        const plugin = pluginHotkeys
          ? group([infoRow('Ingame-Menü', pluginHotkeys.menu, 'settings', 'gray'), infoRow('Touch-Modus', pluginHotkeys.touch, 'display', 'teal')], 'Die Tasten des Plugins änderst du im Ingame-Menü (Bereich „Tastenkürzel“).')
          : '';
        const note = role === 'editor'
          ? `${captureError ? `<b class="error">${escape(captureError)}</b> ` : ''}Zeile antippen, dann die neue Kombination drücken. Esc bricht ab, Entf schaltet das Kürzel aus.`
          : 'Ändern im Editor-Fenster am PC.';
        return { title: 'Tastenkürzel', body: group(rows, note) + plugin };
      }
      case 'sounds':
        return {
          title: 'Töne & Lautstärke',
          body: group([
            volumeRow('volumeVoice', 'message', 'green'),
            ...(isBus(telemetry) ? [volumeRow('volumeAnnounce', 'speaker', 'purple')] : []), // nur im Bus (Lkw-Fahrer brauchen keine Durchsagen)
            volumeRow('volumeAlerts', 'radar', 'red'),
            volumeRow('volumeSiri', 'speaker', 'purple'),
            volumeRow('volumeVideo', 'video', 'red'),
            volumeRow('volumeRadio', 'radio', 'red'),
          ], 'Gilt für die Töne der CabPlay-App. Spotify und das Spiel haben ihre eigene Lautstärke.')
            + group([
              srow({ icon: 'message', color: 'green', label: 'Ansage testen', attrs: 'data-action="test-voice"', chevron: false }),
              srow({ icon: 'radar', color: 'red', label: 'Warnton testen', attrs: 'data-action="test-alert"', chevron: false }),
              ...(isBus(telemetry) ? [srow({ icon: 'speaker', color: 'purple', label: 'Durchsage testen', attrs: 'data-action="test-announce"', chevron: false })] : []), // nur im Bus
            ], 'Getestet wird auf dem Truck-Bildschirm – also im Spiel bzw. über die Lautsprecher des PCs. Ansagen und Warnton schaltest du unter Telefon bzw. Blitzer ein und aus.'),
        };
      case 'general':
        return {
          title: 'Allgemein',
          body: group([
            link('about', 'info', 'gray', 'Info'),
            link('update', 'reset', 'gray', 'Softwareupdate', updateInfo?.state === 'available' || updateInfo?.state === 'ready' ? 'neue Version' : ''),
            choiceRow('language', 'message', 'blue'),
            choiceRow('units', 'truck', 'orange'),
            choiceRow('clock', 'clock', 'gray'),
            link('hotkeys', 'keyboard', 'graphite', 'Tastenkürzel'),
          ])
            + group([choiceRow('logoStore', 'layers', 'gray')], 'Vereinswappen und Lkw-Marken. Gespeichert werden sie nach 30 Tagen ohne Anzeige wieder gelöscht (höchstens 40 MB). Nur laden: nichts bleibt auf dem PC, ohne Internet fehlen die Logos.')
            + group([
              link('mapdata', 'maps', 'green', 'Kartendaten', mapStatus?.stale ? 'veraltet' : ''),
              link('plugin', 'truck', 'orange', 'Plugin & Spiel', pluginFile && pluginFile.state !== 'installed' ? 'fehlt' : ''),
            ])
            + (role === 'editor' && api ? group([
              srow({ icon: 'layers', color: 'blue', label: 'Einstellungen sichern …', attrs: 'data-action="export-settings"', chevron: false }),
              srow({ icon: 'reset', color: 'green', label: 'Einstellungen laden …', attrs: 'data-action="import-settings"', chevron: false }),
            ], 'Eine Datei mit allen Einstellungen, gemeldeten Blitzern und gespeicherten Videos – z. B. vor einer Neuinstallation. Eigene Icons und Hintergründe liegen im Datenordner (Info).') : '')
            + group([
              link('reset-menu', 'reset', 'gray', 'Zurücksetzen'),
              ...(api ? [link('uninstall', 'cancelled', 'red', 'CabPlay deinstallieren')] : []),
            ]),
        };
      // ---- Zurücksetzen (wie iOS „Übertragen/Zurücksetzen“): einzelne Bereiche oder alles
      case 'reset-menu':
        return {
          title: 'Zurücksetzen',
          body: group([
            srow({ icon: 'maps', color: 'green', label: 'Anzeigen auf der Karte', attrs: 'data-action="overlay-reset"', chevron: false }),
            srow({ icon: 'widgets', color: 'purple', label: 'Dashboard-Layout', attrs: 'data-action="dash-reset"', chevron: false }),
            srow({ icon: 'palette', color: 'orange', label: 'Namen und Farben der Apps', attrs: 'data-action="apps-reset"', chevron: false }),
            srow({ icon: 'sports', color: 'green', label: 'Reihenfolge der Ligen', attrs: 'data-action="sport-order-reset"', chevron: false }),
          ], 'Setzt nur diesen Bereich zurück – alles andere bleibt.')
            + group([srow({ label: '<span class="danger">Alles zurücksetzen</span>', attrs: 'data-action="reset"', chevron: false })],
              'Alle Einstellungen und eigenen Icons auf Standard. Gemeldete Blitzer und Videos gehen dabei verloren.'),
        };
      // ---- Softwareupdate (wie iOS: eigene Seite unter Allgemein)
      case 'update': {
        const up = updateInfo;
        const upText = !up || up.state === 'off' ? 'nicht eingerichtet' : {
          idle: 'noch nicht geprüft', checking: 'wird geprüft …', current: 'aktuell', available: `Version ${up.version} verfügbar`,
          downloading: `wird geladen – ${Math.round((up.progress || 0) * 100)} %`, ready: settings.updateInstall ? `Version ${up.version} – wird beim Beenden installiert` : `Version ${up.version} bereit`, error: `Fehler: ${up.error}`,
        }[up.state] || '–';
        const rows = [infoRow('Installiert', appVersion || '–', 'info', 'blue'), infoRow('Status', upText, 'reset', up && ['available', 'ready'].includes(up.state) ? 'green' : 'gray')];
        if (api && up && up.state === 'available') rows.push(srow({ icon: 'plus', color: 'green', label: `Version ${escape(up.version)} laden`, attrs: 'data-action="update-download"', chevron: false }));
        else if (api && up && up.state === 'ready') rows.push(srow({ icon: 'reset', color: 'green', label: 'Jetzt aktualisieren und neu starten', attrs: 'data-action="update-apply"', chevron: false }));
        else if (api && up && ['idle', 'current', 'error'].includes(up.state)) rows.push(srow({ icon: 'reset', color: 'blue', label: 'Nach Updates suchen', attrs: 'data-action="update-check"', chevron: false }));
        // Neuerungen: der neuen Version (aus dem GitHub-Release) bzw. der installierten (mitgeliefert, ui/changelog.js)
        const pending = up && ['available', 'ready'].includes(up.state) && up.notes ? notesBullets(up.notes) : [];
        const mine = changelogFor(appVersion);
        return {
          title: 'Softwareupdate',
          body: group(rows, pending.length ? '' : 'Neue Versionen kommen aus dem GitHub-Release. Einstellungen, Hintergründe und eigene Daten bleiben erhalten; das Plugin im Spiel wird mit erneuert, sobald das Spiel aus ist.')
            + (pending.length ? groupTitle(`Neu in ${escape(up.version)}`) + notesGroup(pending) : '')
            + (mine.length ? groupTitle(`Was ist neu in ${escape(appVersion)}`) + notesGroup(mine) : '')
            + ((window.CarPlayChangelog || []).length > 1 ? group([link('changelog', 'info', 'gray', 'Frühere Versionen')]) : '')
            + group([toggleRow('updateAuto', 'reset', 'green', 'Automatisch suchen'), toggleRow('updateInstall', 'layers', 'blue', 'Automatisch installieren')],
              'Suchen: bei jedem Start der App (höchstens alle paar Stunden). Installieren: lädt das Update im Hintergrund und spielt es beim Beenden der App ein – also nach dem Spielen, ohne Unterbrechung.')
            + (api && desktopShortcut?.available
              ? group([srow({ icon: 'display', color: 'gray', label: 'Verknüpfung auf dem Desktop', sw: !!desktopShortcut.exists, attrs: 'data-action="desktop-shortcut"', chevron: false })],
                'Updates legen keine neue Verknüpfung an – eine gelöschte bleibt weg. Hier anlegen oder entfernen.')
              : ''),
        };
      }
      // ---- Frühere Versionen (Changelog, mitgeliefert)
      case 'changelog':
        return {
          title: 'Frühere Versionen',
          body: (window.CarPlayChangelog || []).filter((e) => e.v !== appVersion)
            .map((e) => groupTitle(`Version ${escape(e.v)}`) + notesGroup(CarI18n.lang !== 'de' && e.en.length ? e.en : e.de)).join(''),
        };
      // ---- Kartendaten
      case 'mapdata': {
        const st = mapStatus;
        const mapText = !st ? '–' : !st.available ? 'fehlen' : st.stale ? 'veraltet' : st.known ? 'aktuell' : 'vorhanden';
        const built = st && st.built ? new Date(st.built).toLocaleDateString('de-DE') : '–';
        // läuft gerade der Kartenbau dieses Spiels oder des anderen?
        const runningHere = mapJob.state === 'running' && (!mapJob.game || mapJob.game === currentGame.id);
        const runningOther = mapJob.state === 'running' && !runningHere;
        const rows = [
          infoRow(currentGame.short || 'Kartendaten', runningHere ? `wird erneuert – ${mapJob.step}` : `${mapText} (${built})`, 'maps', runningHere ? 'orange' : st && st.stale ? 'red' : 'green'),
          infoRow('Orte', CarMap.hasPlaces() ? 'geladen' : 'fehlen', 'fuel', 'teal'),
        ];
        if (api && mapJob.state !== 'running') rows.push(srow({ icon: 'reset', color: 'blue', label: 'Karte jetzt neu erzeugen', value: mapStatusOther?.available ? escape(currentGame.short || '') : '', attrs: 'data-action="update-map"', chevron: false }));
        // Karte des anderen installierten Spiels: Stand und eigener Knopf (wird ohne laufendes Spiel auch selbst erneuert)
        const so = mapStatusOther;
        if (so && so.available) {
          const otherText = so.stale ? 'veraltet' : so.known ? 'aktuell' : 'vorhanden';
          const otherBuilt = so.built ? new Date(so.built).toLocaleDateString('de-DE') : '–';
          rows.push(infoRow(so.name, runningOther ? `wird erneuert – ${mapJob.step}` : `${otherText} (${otherBuilt})`, 'maps', runningOther ? 'orange' : so.stale ? 'red' : 'green'));
          if (api && mapJob.state !== 'running') rows.push(srow({ icon: 'reset', color: 'blue', label: 'Karte jetzt neu erzeugen', value: escape(so.name), attrs: `data-action="update-map" data-value="${escape(so.game)}"`, chevron: false }));
        }
        const note = mapJob.state === 'failed'
          ? `Erneuern fehlgeschlagen: ${escape(mapJob.error)} (Protokoll: ${mapJob.game === 'ats' ? 'map-update-ats.log' : 'map-update.log'} im Datenordner)`
          : st && st.stale
            ? `Seit dem Erzeugen der Karte haben sich Spieldateien geändert (${escape(st.changed.slice(0, 5).join(', '))}).${st.auto ? ' Die App erneuert sie automatisch im Hintergrund.' : ' „Karte jetzt neu erzeugen“ startet das Erneuern.'}`
            : 'Die Karte enthält alle installierten Karten-DLCs. Workshop- und Karten-Mods sind nicht enthalten.';
        return {
          title: 'Kartendaten',
          body: group(rows, note)
            + group([toggleRow('mapAutoUpdate', 'maps', 'green', 'Nach Spiel-Updates erneuern')], 'Erzeugt die Karte nach einem Spiel-Update im Hintergrund neu – nur auf deinem PC, mit niedriger Priorität.')
            + group([link('data', 'route', 'purple', 'Fahrdaten & Kartenfehler')]),
        };
      }
      // ---- Fahrdaten & Kartenfehler: was die App beim Fahren sammelt, um Karte und Navi zu verbessern (bleibt lokal)
      case 'data':
        return {
          title: 'Fahrdaten & Kartenfehler',
          body: group([toggleRow('mapLearn', 'route', 'blue', 'Beim Fahren dazulernen')], 'Merkt sich, wo du gefahren bist. Zeigt die Karte dort Wasser – etwa auf Hafen- oder Firmengelände –, wird es beim nächsten Erneuern der Karte zu Land. Bleibt auf deinem PC.')
            + group([
              toggleRow('laneShare', 'turn-slight', 'purple', 'Navi verbessern (Fahrdaten sammeln)'),
              ...(settings.laneShare && laneStats ? [
                srow({ icon: 'route', color: 'gray', label: 'Kreuzungen mit Spurhinweis', value: String(laneStats.junctions), chevron: false, cls: 'static' }),
                srow({ icon: 'warning', color: 'orange', label: 'Auffällige Stellen', value: String(laneStats.suspicious), chevron: false, cls: 'static' }),
                ...(laneStats.suspicious ? [srow({ icon: 'message', color: 'green', label: 'Auf GitHub teilen (Konto nötig)', attrs: 'data-action="lanes-share"', chevron: false })] : []),
              ] : []),
            ], 'Sammelt Routen, Fahrspur und Abbiegungen, um Navi und Spurempfehlung zu verbessern. Bleibt 90 Tage auf deinem PC – geteilt wird nur, was du per Knopf auf GitHub schickst.')
            + `<p class="group-title">Kartenfehler</p>` + group([
              srow({ icon: 'warning', color: 'orange', label: 'Gespeicherte Meldungen', value: String(mapReports?.count ?? 0), chevron: false, cls: 'static' }),
              ...(mapReports?.applied || mapReports?.rejected ? [srow({ icon: 'check', color: 'green', label: 'In die Karte eingearbeitet', value: `${mapReports.applied} von ${mapReports.applied + mapReports.rejected}`, chevron: false, cls: 'static' })] : []),
              ...(api && mapReports?.count ? [
                srow({ icon: 'reset', color: 'blue', label: 'Meldungen jetzt einarbeiten', value: 'Karte neu erzeugen', attrs: 'data-action="update-map"', chevron: false }),
                srow({ icon: 'library', color: 'blue', label: 'Ordner öffnen', attrs: 'data-action="map-reports-open"', chevron: false }),
                srow({ icon: 'message', color: 'green', label: 'Letzte Meldung auf GitHub melden (Konto nötig)', value: mapReports.latest?.nearestCity || '', attrs: 'data-action="map-report-issue"', chevron: false }),
              ] : []),
            ], 'Stimmt die Karte irgendwo nicht (z. B. Wasser, wo Land ist), im Karten-Menü „Fehler auf der Karte melden“ wählen. Gemeldete Stellen werden geprüft und dauerhaft korrigiert. Beim Melden auf GitHub das Bild aus dem Ordner anhängen.'),
        };
      // ---- Plugin & Spiel
      case 'plugin': {
        const rows = [
          infoRow('Spiel', connection === 'demo' ? 'Demo' : connection ? `verbunden · ${currentGame.short || (isAts() ? 'ATS' : 'ETS2')}` : 'nicht verbunden', 'truck', connection ? 'green' : 'gray'),
          // je gefundenem Spiel (ETS2, ATS) eine Zeile: Plugin-Stand; ohne Spiel: Hinweis
          ...(pluginFile?.games?.length
            ? pluginFile.games.map((g) => infoRow(`Plugin in ${g.id === 'ats' ? 'ATS' : 'ETS2'}`, { installed: 'installiert', missing: 'fehlt', outdated: 'veraltet' }[g.state] || '–', 'settings', g.state !== 'installed' ? 'red' : 'green'))
            : [infoRow('Spiel-Ordner', 'nicht gefunden (Steam)', 'truck', 'red')]),
          infoRow('Plugin-Version', pluginInfo ? `${pluginInfo.version}${pluginInfo.ok ? '' : ' – passt nicht, neu installieren'}` : '–', 'settings', pluginInfo && !pluginInfo.ok ? 'red' : 'gray'),
          infoRow('Navi-Route', CarMap.hasRoute() ? 'aktiv' : 'keine', 'turn-turn', 'green'),
        ];
        if (api && pluginFile && pluginFile.bundled && pluginFile.state !== 'installed') rows.push(srow({ icon: 'plus', color: 'blue', label: 'Plugin ins Spiel installieren', attrs: 'data-action="install-plugin"', chevron: false }));
        return {
          title: 'Plugin & Spiel',
          body: group(rows, 'Das Plugin zeigt CabPlay auf dem Navi-Bildschirm im Truck, liest Route und Kamera aus dem Spiel und startet die App mit dem Spiel. Die App installiert es selbst, wenn das Spiel nicht läuft.')
            + group([toggleRow('gpuTransfer', 'display', 'green', 'GPU-Übertragung')],
              // Status in eigenen Elementen: hinten angehängt passte die Erklärung nicht mehr zum Wörterbuch und blieb deutsch
              `Das Bild geht als Grafikkarten-Textur ans Plugin statt als Pixel – entlastet den Prozessor. Bei Problemen schaltet die App für diese Sitzung selbst auf die normale Übertragung zurück.${gpuStatus ? ` <span>Status</span>: <span>${escape(gpuStatus)}</span>` : ''}`),
        };
      }
      // ---- Deinstallieren
      case 'uninstall':
        return {
          title: 'Deinstallieren',
          body: group([
            srow({ icon: 'cancelled', color: 'red', label: '<span class="danger">Deinstallieren, Einstellungen behalten</span>', attrs: 'data-action="uninstall" data-keep="1"', chevron: false }),
            srow({ icon: 'cancelled', color: 'red', label: '<span class="danger">Alles entfernen, auch Einstellungen</span>', attrs: 'data-action="uninstall"', chevron: false }),
          ], 'Entfernt das Plugin aus dem Spiel, die Platzhalter-Texturen im Ordner „Dokumente\\Euro Truck Simulator 2\\CabPlay-Display“ und den Programmordner; die App beendet sich dabei. Das Spiel selbst, seine Einstellungen und Profile bleiben unverändert. „Alles entfernen“ löscht zusätzlich Einstellungen, Blitzer, Videos und die Karte im Datenordner. Das Spiel muss beendet sein.'),
        };
      case 'about': {
        const st = mapStatus;
        const mapText = !st ? '–' : !st.available ? 'fehlen' : st.stale ? 'veraltet' : st.known ? 'aktuell' : 'vorhanden';
        const built = st && st.built ? new Date(st.built).toLocaleDateString('de-DE') : '–';
        const rows = [
          infoRow('Version', appVersion || '–', 'info', 'blue'),
          infoRow('Datenordner', appDataDir || '–', 'layers', 'gray'),
          infoRow('Spiel', connection === 'demo' ? 'Demo' : connection ? 'verbunden' : 'nicht verbunden', 'truck', 'orange'),
          infoRow('Plugin', pluginInfo ? pluginInfo.version : '–', 'settings', pluginInfo && !pluginInfo.ok ? 'red' : 'gray'),
          infoRow('Kartendaten', `${mapText} (${built})`, 'maps', st && st.stale ? 'red' : 'green'),
        ];
        return {
          title: 'Info',
          body: group(rows, 'Details unter Allgemein › Softwareupdate, Kartendaten und Plugin & Spiel.')
            + (role === 'editor' && api ? group([srow({ icon: 'reset', color: 'blue', label: 'Einrichtung erneut starten', attrs: 'data-action="setup-start"', chevron: false })]) : ''),
        };
      }
      default: {
        // Hauptseite wie in iOS: oben die „Karte“ des Geräts, darunter Gruppen – System, Apps, Verbindungen
        const wpName = settings.wallpaper === 'custom' ? 'Eigenes Bild' : settings.wallpaper.startsWith('file:') ? settings.wallpaper.slice(5) : catalog.WALLPAPERS[settings.wallpaper].name;
        const appRow = (id, page, value = '') => srow({ icon: `<span class="row-app">${iconHtml(id)}</span>`, label: escape(appInfo(id).name), value: escape(value), attrs: `data-page="${page}"` });
        const status = connection === 'demo' ? 'Demo' : connection ? 'Mit dem Spiel verbunden' : 'Nicht verbunden';
        return {
          title: 'Einstellungen',
          body: group([srow({ icon: 'search', color: 'gray', label: 'Suchen', attrs: 'data-action="settings-search"' })])
            + `<button class="group profile" data-focus data-page="about">
              <span class="profile-icon">${ICONS.carplay}</span>
              <span class="profile-text"><b>CabPlay</b><small>${escape(status)}${appVersion ? ` · Version ${escape(appVersion)}` : ''}</small></span>
              <span class="row-chevron">${ICONS.chevron}</span>
            </button>`
            + (mapStatus && mapStatus.stale ? group([link('mapdata', 'warning', 'red', 'Kartendaten veraltet', 'aktualisieren')]) : '')
            + (updateInfo && ['available', 'ready'].includes(updateInfo.state) ? group([link('update', 'reset', 'green', 'Softwareupdate verfügbar', updateInfo.version)]) : '')
            + group([
              link('general', 'settings', 'gray', 'Allgemein'),
              link('display', 'appearance', 'blue', 'Anzeige & Helligkeit', OPTIONS.appearance[settings.appearance]),
              link('wallpaper', 'wallpaper', 'cyan', 'Hintergrundbild', wpName),
              link('homescreen', 'home', 'indigo', 'Home-Bildschirm & App-Icons'),
              link('dashboard', 'widgets', 'purple', 'Dashboard'),
              link('cluster', 'display', 'teal', 'Kombiinstrument', clusterActive ? 'Aktiv' : ''),
            ])
            + group([
              link('notifications', 'messages', 'red', 'Mitteilungen'),
              link('sounds', 'speaker', 'red', 'Töne & Lautstärke'),
              link('assistant', 'mic', 'purple', 'Sprachassistent', aiStatus?.downloading ? 'Wird heruntergeladen …' : aiStatus?.installed && settings.aiAssistant ? 'AI' : 'Feste Befehle'),
              link('mirror', 'truck', 'blue', 'Spiegelkamera', settings.mirrorCam ? 'Ein' : 'Aus'),
            ])
            + `<p class="group-title">Apps</p>` + group([
              appRow('maps', 'maps', catalog.MAP_STYLES[settings.mapStyle]),
              appRow('music', 'music'),
              appRow('radar', 'radar', settings.radar ? 'Ein' : 'Aus'),
              appRow('video', 'video'),
              appRow('logbook', 'logbook', settings.tracking ? 'Ein' : 'Aus'),
              appRow('phone', 'dispatcher', OPTIONS.dispatcher[settings.dispatcher]),
              appRow('weather', 'weather', settings.weather ? 'Ein' : 'Aus'),
              appRow('sports', 'sports', settings.sportsTeams.length ? `${settings.sportsTeams.length} Teams` : ''),
            ])
            + group([link('remote', 'qr', 'blue', 'Handy-Steuerung', settings.remote ? 'Ein' : 'Aus')]),
        };
      }
    }
  }

  function settingsScreen() {
    const id = settingsStack[settingsStack.length - 1];
    const page = settingsPage(id);
    const back = settingsStack.length > 1 ? `<button class="back glass" data-back data-focus aria-label="Zurück">${ICONS.back}</button>` : '';
    return `<div class="settings card surface" data-scroll-host>
      <div class="settings-head">${back}<h1>${escape(page.title)}</h1></div>
      <div class="settings-body" data-scroll-area>${page.body}</div>
      <div class="scroll-arrows"><button class="glass" data-focus data-scroll="-1" aria-label="Nach oben">${ICONS['chevron-up']}</button><button class="glass" data-focus data-scroll="1" aria-label="Nach unten">${ICONS['chevron-down']}</button></div>
    </div>`;
  }

  // ------------------------------------------------------------ Suche in den Einstellungen
  // Durchsucht alle Seiten: sie werden einmal aufgebaut (wie beim Öffnen), jede Zeile mit Namen, Hinweistext der
  // Gruppe und dem Weg dorthin gemerkt. Ein Treffer öffnet die Seite und markiert die Zeile. Im Editor tippt man
  // mit der Tastatur, auf dem Truck-Bildschirm mit einer kleinen Bildschirmtastatur.
  let settingsQuery = '';
  let searchIndex = null;
  let searchHits = [];

  const searchNorm = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss');

  function buildSearchIndex() {
    const entries = [];
    const seen = new Set(['search']);
    const queue = [{ id: 'main', chain: ['main'], titles: [] }];
    const tpl = document.createElement('template');
    while (queue.length && seen.size < 200) {
      const { id, chain, titles } = queue.shift();
      if (seen.has(id) && id !== 'main') continue;
      seen.add(id);
      let page;
      try {
        page = settingsPage(id);
      } catch {
        continue;
      }
      const here = id === 'main' ? titles : [...titles, page.title];
      if (id !== 'main') entries.push({ chain, titles: titles, label: page.title, note: '', sel: null });
      tpl.innerHTML = page.body;
      for (const row of tpl.content.querySelectorAll('.row, .mm-row, button[data-page]')) {
        // Name der Zeile (nicht das Symbol davor): .row-label, sonst fetter Text, sonst der ganze Knopf
        const label = (row.querySelector('.row-label') || row.querySelector('b') || row).textContent.trim();
        if (!label) continue;
        const groupEl = row.closest('.group');
        const noteEl = groupEl && groupEl.nextElementSibling && groupEl.nextElementSibling.classList.contains('group-note') ? groupEl.nextElementSibling : null;
        const d = row.dataset;
        const sel = d.toggle ? `[data-toggle="${d.toggle}"]` : d.choose ? `[data-choose="${d.choose}"][data-value="${d.value}"]`
          : d.page ? `[data-page="${d.page}"]` : d.action ? `[data-action="${d.action}"]` : null;
        const lead = row.querySelector('.badge, .row-app');
        entries.push({ chain, titles: here, label, icon: lead ? lead.outerHTML : '', value: (row.querySelector('.row-value') || {}).textContent || '', note: noteEl ? noteEl.textContent : '', sel });
        if (d.page && !seen.has(d.page) && d.page !== 'search') queue.push({ id: d.page, chain: [...chain, d.page], titles: here });
      }
    }
    for (const e of entries) {
      e.nLabel = searchNorm(e.label);
      // 当前界面语言（中文等）的翻译也加入索引：页面是德文生成、屏幕上再翻译的，否则中文搜索搜不到
      const tr = [e.label, e.note, ...e.titles].map((t) => CarI18n.translate(t)).join(' ');
      e.nAll = searchNorm(`${e.label} ${e.value} ${e.titles.join(' ')} ${e.note} ${tr}`);
    }
    return entries;
  }

  // Treffer: alle Wörter der Suche kommen vor; Name vor Seitenname vor Hinweistext
  function runSettingsSearch() {
    const words = searchNorm(settingsQuery).split(/\s+/).filter(Boolean);
    if (!words.length) return (searchHits = []);
    if (!searchIndex) searchIndex = buildSearchIndex();
    const scored = [];
    const dup = new Set();
    for (const e of searchIndex) {
      if (!words.every((w) => e.nAll.includes(w))) continue;
      const key = `${e.titles.join('/')}|${e.label}`; // Link und Seite mit gleichem Namen nur einmal
      if (dup.has(key)) continue;
      dup.add(key);
      let score = 0;
      for (const w of words) score += e.nLabel.startsWith(w) ? 4 : e.nLabel.includes(w) ? 3 : 1;
      if (!e.sel) score += 0.5; // ganze Seite
      score -= e.titles.length * 0.4; // weiter oben in den Einstellungen zuerst
      scored.push([score, e]);
    }
    searchHits = scored.sort((a, b) => b[0] - a[0] || a[1].label.length - b[1].label.length).slice(0, 40).map(([, e]) => e);
    return searchHits;
  }

  function searchResultsHtml() {
    if (!searchNorm(settingsQuery).trim()) return '<p class="group-note">Zum Beispiel „Stimme“, „Karte“, „Blitzer“ oder „Lautstärke“.</p>';
    if (!searchHits.length) return '<p class="group-note">Keine Treffer.</p>';
    return group(searchHits.map((e, i) => srow({
      icon: e.icon || 'search', color: 'gray', label: escape(e.label),
      value: escape(e.titles.length ? e.titles.join(' › ') : 'Einstellungen'),
      attrs: `data-search-hit="${i}"`,
    })));
  }

  function settingsSearchPage() {
    const typing = role === 'editor';
    const field = typing
      ? `<input class="settings-search-input" data-input="settings-search" placeholder="Einstellungen durchsuchen" spellcheck="false" value="${escape(settingsQuery)}">`
      : `<div class="settings-search-query" data-bind="search-query">${escape(settingsQuery) || '<span>Einstellungen durchsuchen</span>'}</div>`;
    // Truck-Bildschirm: Tastatur unten angedockt, Treffer darüber (Platzhalter am Ende hält sie frei)
    const keys = typing ? '' : `${oskHtml()}<div class="osk-spacer"></div>`;
    return { title: 'Suchen', body: `<div class="settings-search"><span class="settings-search-icon">${ICONS.search}</span>${field}</div><div data-bind="search-results">${searchResultsHtml()}</div>${keys}` };
  }

  function updateSearchResults() {
    runSettingsSearch();
    for (const el of stage.querySelectorAll('[data-bind="search-results"]')) el.innerHTML = searchResultsHtml();
    for (const el of stage.querySelectorAll('[data-bind="search-query"]')) el.innerHTML = escape(settingsQuery) || '<span>Einstellungen durchsuchen</span>';
  }

  function searchKey(k) {
    if (k === 'enter') return openSearchHit(0);
    if (k === 'del') settingsQuery = settingsQuery.slice(0, -1);
    else if (settingsQuery.length < 40) settingsQuery += k;
    updateSearchResults();
  }

  // Treffer öffnen: Weg dorthin als Verlauf (Zurück führt Seite für Seite zurück), Zeile kurz hervorheben
  function openSearchHit(i) {
    const e = searchHits[i];
    if (!e) return;
    settingsStack = [...e.chain];
    rerenderSettings(e.sel || undefined);
    if (!e.sel) return;
    const el = stage.querySelector(`.screen.active ${e.sel}`);
    if (!el) return;
    // Nur die Einstellungsliste scrollen – scrollIntoView verschob auch Bühne und Seite (ganzes Bild verrutscht)
    const area = el.closest('[data-scroll-area]');
    if (area) {
      const a = area.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      area.scrollTop += r.top - a.top - (a.height - r.height) / 2;
    }
    el.classList.add('search-hit');
    setTimeout(() => el.classList.remove('search-hit'), 2200);
  }

  // Suche öffnen: Index neu aufbauen (Werte und Seiten können sich geändert haben)
  function openSettingsSearch() {
    searchIndex = null;
    settingsQuery = '';
    searchHits = [];
    oskTarget = { onKey: searchKey, enter: 'Suchen' };
    oskShift = false;
    oskNumbers = false;
    openSettingsPage('search');
    if (role === 'editor') setTimeout(() => stage.querySelector('.screen.active [data-input="settings-search"]')?.focus(), 120);
  }
  // ------------------------------------------------------------ Bildschirmtastatur (Truck-Bildschirm)
  // Unten angedockt wie bei CarPlay: deutsches QWERTZ mit Umlauten, Umschalt, „123“ für Ziffern und Zeichen,
  // Leertaste, Löschen und eine blaue Eingabetaste. Wer sie nutzt, gibt onKey(text | 'del' | 'enter') mit.
  //   oskHtml({ enter: 'Suchen' }) – Markup; oskKey(k) – Tastendruck (data-osk); oskTarget – wohin die Zeichen gehen
  let oskShift = false;
  let oskNumbers = false;
  let oskTarget = null; // { onKey(k), enter }

  const OSK_LETTERS = ['qwertzuiopü', 'asdfghjklöä', 'yxcvbnm'];
  const OSK_NUMBERS = ['1234567890', '-/:;()€&@"', ".,?!'"];
  const OSK_ICON = {
    shift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 4 4 12.5h4.5V20h7v-7.5H20z"/></svg>',
    shiftOn: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4 4 12.5h4.5V20h7v-7.5H20z"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z"/><path d="m12 9.5 5 5m0-5-5 5"/></svg>',
  };

  function oskHtml() {
    const enter = oskTarget?.enter || 'Fertig';
    const rows = oskNumbers ? OSK_NUMBERS : OSK_LETTERS;
    const key = (k) => {
      const shown = oskShift && !oskNumbers ? k.toUpperCase() : k;
      return `<button class="osk-key" data-osk="${escape(shown)}">${escape(shown)}</button>`;
    };
    const row = (r) => [...r].map(key).join('');
    const left = oskNumbers ? '<span class="osk-gap"></span>'
      : `<button class="osk-key osk-fn ${oskShift ? 'on' : ''}" data-osk="shift" aria-label="Umschalt">${oskShift ? OSK_ICON.shiftOn : OSK_ICON.shift}</button>`;
    return `<div class="osk" data-bind="osk">
      <div class="osk-row">${row(rows[0])}</div>
      <div class="osk-row">${row(rows[1])}</div>
      <div class="osk-row">${left}${row(rows[2])}<button class="osk-key osk-fn" data-osk="del" aria-label="Löschen">${OSK_ICON.del}</button></div>
      <div class="osk-row">
        <button class="osk-key osk-fn osk-mode" data-osk="mode">${oskNumbers ? 'ABC' : '123'}</button>
        <button class="osk-key osk-space" data-osk=" "><span>DE</span></button>
        <button class="osk-key osk-enter" data-osk="enter">${escape(enter)}</button>
      </div>
    </div>`;
  }

  function oskRefresh() {
    const tpl = document.createElement('template');
    tpl.innerHTML = oskHtml().trim();
    for (const el of stage.querySelectorAll('[data-bind="osk"]')) el.replaceWith(tpl.content.firstElementChild.cloneNode(true));
  }

  function oskKey(k) {
    if (k === 'shift') {
      oskShift = !oskShift;
      return oskRefresh();
    }
    if (k === 'mode') {
      oskNumbers = !oskNumbers;
      return oskRefresh();
    }
    oskTarget?.onKey(k);
    // Großbuchstabe gilt nur für den nächsten Buchstaben
    if (oskShift && k.length === 1 && k !== ' ') {
      oskShift = false;
      oskRefresh();
    }
  }
  // ------------------------------------------------------------------ Bildschirme
  function screensHtml() {
    const w = settings.dashboard.widgets;
    return `
      <section class="screen" data-screen="home">${homeHtml()}</section>
      <section class="screen" data-screen="dashboard"><div class="dash">${w.map(slotHtml).join('')}</div></section>
      <section class="screen screen-map" data-screen="maps"><div class="card map-card">${mapView('full')}</div></section>
      <section class="screen nowplaying art-${settings.musicArt}" data-screen="music" data-no-names data-tab="${musicTab}">
        <div class="np-bg" data-bind="np-bg"></div>
        <button class="np-back glass" data-focus data-action="back" aria-label="Zurück">${ICONS.back}</button>
        <div class="np-pills">
          <button class="np-pill np-pill-lyrics glass" data-focus data-music-tab="lyrics">${ICONS.quote}Songtext</button>
          <button class="np-pill glass" data-focus data-music-tab="recent">${settings.spotify ? 'Warteschlange' : 'Zuletzt gehört'}</button>
        </div>
        <div class="np-main">
          <div class="np-info">
            <div class="np-text">
              <div class="t-title" data-bind="title" data-no-names></div>
              <div class="t-artist" data-bind="artist" data-no-names></div>
              <div class="t-album" data-bind="album"></div>
            </div>
            ${mediaControls('big')}
            <div class="np-progress"><span data-bind="elapsed">0:00</span><div class="progress"><div class="progress-fill" data-bind="progress"></div></div><span data-bind="remaining">-0:00</span></div>
            ${settings.spotify ? `<div class="np-extra">
              <button data-focus data-sp-cmd="like" data-bind="sp-like" aria-label="Lieblingssong">${ICONS['add-circle']}</button>
              <button data-focus data-sp-cmd="shuffle" data-bind="sp-shuffle" aria-label="Zufall">${ICONS.shuffle}</button>
              <button data-focus data-sp-cmd="repeat" data-bind="sp-repeat" aria-label="Wiederholen">${ICONS.repeat}</button>
              <button data-focus data-music-tab="library" aria-label="Mediathek">${ICONS.library}</button>
            </div>` : ''}
          </div>
          <div class="art np-art" data-bind="art"></div>
        </div>
        <div class="np-lyrics">
          <div class="np-lyrics-body" data-list="lyrics" data-scroll-area></div>
          <div class="ly-side"><div class="art ly-art" data-bind="art"></div></div>
        </div>
        <div class="np-recent glass">
          <div class="list-head"><h1>${settings.spotify ? 'Als Nächstes' : 'Zuletzt gehört'}</h1></div>
          <div class="list-rows" data-list="${settings.spotify ? 'sp-queue' : 'history'}"></div>
        </div>
        <div class="np-library" data-scroll-host>
          <div class="sp-top">
            <div class="segmented glass sp-tabs">
              ${[['start', 'Start'], ['recent', 'Zuletzt'], ['search', 'Suche'], ['playlists', 'Bibliothek']].map(([id, label]) => `<button data-focus data-lib-tab="${id}" class="${libTab === id ? 'on' : ''}">${label}</button>`).join('')}
            </div>
            <div class="sp-mini glass">
              <button class="sp-mini-open" data-focus data-music-tab="now" aria-label="Wird gespielt"><span class="art sp-mini-art" data-bind="art"></span><b data-bind="title"></b></button>
              <button class="sp-mini-btn" data-focus data-cmd="toggle" data-bind="play" aria-label="Wiedergabe">${ICONS.play}</button>
              <button class="sp-mini-btn" data-focus data-cmd="next" aria-label="Weiter">${ICONS.next}</button>
            </div>
          </div>
          <div class="lib-body" data-list="spotify-lib" data-scroll-area></div>
          <div class="scroll-arrows"><button class="glass" data-focus data-scroll="-1" aria-label="Nach oben">${ICONS['chevron-up']}</button><button class="glass" data-focus data-scroll="1" aria-label="Nach unten">${ICONS['chevron-down']}</button></div>
        </div>
      </section>
      <section class="screen radar-screen" data-screen="radar"><div class="radar-grid">
        <div class="card surface radar-main" data-bind="radar-main">
          <div class="radar-brand"><svg viewBox="0 0 34 30"><path fill="#2fe05a" d="M4 9.5 17 1l13 8.5v5.6L17 6.6 4 15.1zM2 21 17 11.4 32 21v6.4L17 17.8 2 27.4z"/></svg><b>Blitzer</b><span data-bind="radar-mode">Live</span></div>
          <div class="radar-speedo">
            <div class="radar-ring"><div class="speed"><span data-bind="speed">0</span><small>${spdUnit()}</small></div></div>
            <div class="limit" data-bind="limit">–</div>
          </div>
          <div class="radar-state" data-bind="radar-state"></div>
          <div class="radar-actions">
            <button class="radar-report" data-focus data-action="radar-report">${ICONS.camera}<span>Blitzer melden</span></button>
            <button class="round" data-focus data-action="radar-sound" aria-label="Warnton">${settings.radarSound ? ICONS.speaker : ICONS.mute}</button>
          </div>
        </div>
        <div class="card surface list-card">
          <div class="list-head"><h1>Voraus</h1><span class="muted" data-bind="radar-count"></span></div>
          <div class="list-rows" data-list="radar"></div>
        </div>
      </div></section>
      <section class="screen video-screen" data-screen="video" data-no-names><div class="video-grid">
        <div class="card video-card" data-video-slot>${videoPlaceholder()}</div>
        <div class="card surface list-card video-side">
          <div class="list-head"><h1>Video</h1>
            ${settings.video.items.length ? `<button class="edit-button" data-focus data-action="video-edit">${videoEdit ? 'Fertig' : 'Bearbeiten'}</button>` : ''}
            ${currentVideo() ? `<button class="round small" data-focus data-action="video-stop" aria-label="Stopp">${ICONS.cancelled}</button>` : ''}
          </div>
          <div class="video-add">
            ${role === 'editor' && api ? '<input class="row-input" data-input="video-link-app" placeholder="YouTube-, Twitch- oder TikTok-Link" spellcheck="false">' : ''}
            <button class="pill-button paste" data-focus data-action="video-paste">${ICONS.plus}<span>${role === 'editor' && api ? 'Hinzufügen' : 'Link einfügen'}</span></button>
          </div>
          ${currentVideo() ? `<div class="vd-controls">
            <div class="vd-progress" data-bind="vd-progress" ${videoLive || !videoDuration ? 'hidden' : ''}>
              <em data-bind="vd-time">${fmtVideoTime(videoTime)}</em>
              <span class="vd-seek"><i data-bind="vd-pos" style="width:${videoDuration ? Math.min(100, (videoTime / videoDuration) * 100) : 0}%"></i></span>
              <em data-bind="vd-dur">${fmtVideoTime(videoDuration)}</em>
              <button class="vd-rate ${videoRate !== 1 ? 'on' : ''}" data-focus data-action="video-rate" aria-label="Wiedergabegeschwindigkeit">${fmtVideoRate(videoRate)}</button>
            </div>
            <div class="vd-buttons">
              <button class="round" data-focus data-action="video-seek" data-step="-10" aria-label="10 Sekunden zurück" ${currentVideo().kind === 'tw' ? 'disabled' : ''}>${seekIcon(-1, 10)}</button>
              <button class="round big" data-focus data-action="video-toggle" data-bind="vd-play" aria-label="Pause / Weiter">${videoKey && !videoPaused ? ICONS.pause : ICONS.play}</button>
              <button class="round" data-focus data-action="video-seek" data-step="10" aria-label="10 Sekunden vor" ${currentVideo().kind === 'tw' ? 'disabled' : ''}>${seekIcon(1, 10)}</button>
            </div>
            <div class="rd-volume vd-volume">
              <button data-focus data-action="video-vol" data-step="-1" aria-label="Leiser">${ICONS.minus2}</button>
              <span class="vd-bar"><i data-bind="vd-vol" style="width:${settings.volumeVideo}%"></i></span>
              <button data-focus data-action="video-vol" data-step="1" aria-label="Lauter">${ICONS.plus}</button>
              <em data-bind="vd-vol-text">${settings.volumeVideo} %</em>
            </div>
          </div>` : ''}
          <div class="list-rows">${videoRows()}</div>
        </div>
      </div></section>
      <section class="screen phone-screen" data-screen="phone"><div class="phone-wrap">
        <div class="phone-tabs glass">
          <button data-focus data-phone-tab="favorites" class="${phoneTab === 'favorites' ? 'on' : ''}">Favoriten</button>
          <button data-focus data-phone-tab="recents" class="${phoneTab === 'recents' ? 'on' : ''}">Anrufliste<span class="phone-badge" data-bind="phone-missed"></span></button>
          <button data-focus data-phone-tab="contacts" class="${phoneTab === 'contacts' ? 'on' : ''}">Kontakte</button>
          <button data-focus data-phone-tab="keypad" class="icon-tab ${phoneTab === 'keypad' ? 'on' : ''}" aria-label="Ziffernblock">${ICONS.keypad}</button>
          <button data-focus data-phone-tab="voicemail" class="icon-tab ${phoneTab === 'voicemail' ? 'on' : ''}" aria-label="Mailbox">${ICONS.voicemail}</button>
        </div>
        <div class="phone-body">
          <div class="list-rows phone-list" data-list="phone"></div>
          <div class="phone-scroll">
            <button class="glass" data-focus data-scroll="-1" aria-label="Nach oben">${ICONS['chevron-up']}</button>
            <button class="glass" data-focus data-scroll="1" aria-label="Nach unten">${ICONS['chevron-down']}</button>
          </div>
        </div>
      </div></section>
      <section class="screen radio-screen" data-screen="radio" data-no-names>
        <div class="np-bg rd-bg" data-bind="rd-bg"></div>
        <div class="rd-now" data-bind="rd-now">
          <div class="rd-slide" data-bind="rd-slide"></div>
          <div class="rd-info">
            <div class="rd-badge"><b>DAB+</b><span data-bind="rd-state"></span></div>
            <div class="rd-station" data-bind="rd-station">Radio</div>
            <div class="rd-title" data-bind="rd-title"></div>
            <div class="rd-artist" data-bind="rd-artist"></div>
            <div class="rd-controls">
              <button class="round" data-focus data-action="radio-prev" aria-label="Vorheriger Sender">${ICONS.previous}</button>
              <button class="round big" data-focus data-action="radio-toggle" data-bind="rd-play" aria-label="Abspielen / Stopp">${ICONS.play}</button>
              <button class="round" data-focus data-action="radio-next" aria-label="Nächster Sender">${ICONS.next}</button>
            </div>
            <div class="rd-volume">
              <button data-focus data-action="radio-vol" data-step="-1" aria-label="Leiser">${ICONS.minus2}</button>
              <span class="rd-bar"><i data-bind="rd-vol"></i></span>
              <button data-focus data-action="radio-vol" data-step="1" aria-label="Lauter">${ICONS.plus}</button>
              <em data-bind="rd-vol-text"></em>
            </div>
          </div>
        </div>
        <div class="rd-tabbar">
          <div class="segmented glass rd-tabs" data-list="rd-tabs"></div>
          <button class="glass rd-tool" data-focus data-action="radio-view" data-bind="rd-view" aria-label="Kacheln oder Liste">${ICONS.list}</button>
          <button class="glass rd-tool" data-focus data-action="radio-edit" aria-label="Sender bearbeiten">${ICONS.sliders}</button>
        </div>
        <div class="rd-bottom" data-scroll-host>
          <div class="rd-presets" data-list="rd-presets" data-scroll-area></div>
          <div class="rd-side">
            <button class="glass" data-focus data-scroll="-1" aria-label="Nach oben">${ICONS['chevron-up']}</button>
            <button class="glass" data-focus data-scroll="1" aria-label="Nach unten">${ICONS['chevron-down']}</button>
          </div>
        </div>
        <div class="rd-search glass" data-bind="rd-search" hidden>
          <div class="rd-search-head">
            ${role === 'editor' && api ? '<input class="row-input" data-input="radio-search" placeholder="Sender suchen oder Stream-Adresse" spellcheck="false">' : '<b>Sender hinzufügen</b>'}
            <button class="pill-button" data-focus data-action="radio-restore">Liste zurücksetzen</button>
            <button class="round" data-focus data-action="radio-search-close" aria-label="Schließen">${ICONS.cancelled}</button>
          </div>
          <div class="list-rows" data-list="rd-search-list"></div>
        </div>
      </section>
      <section class="screen weather-screen" data-screen="weather" data-bind="wx-sky"><div class="wx-fx" aria-hidden="true"></div>
        <div class="wx-now">
          <div class="wx-city"><span data-bind="wx-city">Wetter</span> ${ICONS.maps}</div>
          <div class="wx-temp" data-bind="wx-temp">–</div>
          <div class="wx-cond" data-bind="wx-cond"></div>
          <div class="wx-hl" data-bind="wx-hl"></div>
          <div class="wx-note" data-bind="wx-note"></div>
        </div>
        <div class="wx-side">
          <div class="wx-card glass"><div class="wx-title">${ICONS.clock}Stündlich</div><div class="wx-hours" data-list="wx-hours"></div></div>
          <div class="wx-card glass"><div class="wx-title">${ICONS.calendar || ICONS.list}6-Tage-Vorhersage</div><div class="wx-days" data-list="wx-days"></div></div>
        </div>
      </section>
      <section class="screen sports-screen" data-screen="sports">
        <nav class="sx-rail" data-list="sx-rail"></nav>
        <div class="sx-main" data-scroll-host>
          <header class="sx-head">
            <div><h2 data-bind="sx-title">Sport</h2><small data-bind="sx-sub"></small></div>
            <div class="segmented glass sx-tabs" data-list="sx-tabs"></div>
          </header>
          <p class="sx-hint hidden" data-bind="sx-hint">Verein antippen = Lieblingsteam mit Live-Ticker (Tore, Halbzeit, Endstand)</p>
          <div class="sx-body" data-list="sx-body"></div>
        </div>
      </section>
      <section class="screen" data-screen="calendar"><div class="cal-grid">
        <div class="card surface cal-today">
          <div class="cal-weekday" data-bind="cal-weekday-long">–</div>
          <div class="cal-time" data-bind="cal-time">--:--</div>
          <div class="cal-sub">Spielzeit</div>
          <div class="cal-real" data-bind="cal-real"></div>
        </div>
        <div class="card surface list-card">
          <div class="list-head"><h1>Als Nächstes</h1></div>
          <div class="list-rows" data-list="agenda"></div>
        </div>
      </div></section>
      <section class="screen" data-screen="truck"><div class="truck-grid">
        <div class="card surface tr-main">
          <div class="tr-speed"><span data-bind="speed">0</span><small>${spdUnit()}</small></div>
          <div class="tr-row">
            <div class="stat"><label>Gang</label><span data-bind="gear">N</span></div>
            <div class="stat"><label>Drehzahl</label><span data-bind="rpm">0</span></div>
            <div class="stat"><label>Tempomat</label><span data-bind="cruise">aus</span></div>
          </div>
          ${meter('Tank', 'fuel')}
          ${meter(zhUnits() ? '尿素' : 'AdBlue', 'adblue')}
          <div class="tr-lamps" data-list="truck-lamps"></div>
          <div class="tr-name"><span data-bind="truck-name" data-no-names></span><span class="pill" data-bind="parking-brake">Feststellbremse</span></div>
        </div>
        <div class="card surface tr-side" data-part="${truckPart}">
          <div class="tr-head">
            <div class="widget-title">${badge('service', 'orange')}Zustand</div>
            <div class="tr-seg">
              <button data-focus data-truck-part="truck" class="${truckPart === 'truck' ? 'on' : ''}"><span data-bind="part-truck">Zugmaschine</span></button>
              <button data-focus data-truck-part="trailer" class="${truckPart === 'trailer' ? 'on' : ''}">Anhänger<i data-bind="trailer-dot"></i></button>
            </div>
          </div>
          <div class="tr-part tr-part-truck">
          ${[['engine', 'Motor'], ['transmission', 'Getriebe'], ['cabin', 'Kabine'], ['chassis', 'Fahrgestell'], ['wheels', 'Räder']].map(([key, label]) =>
            `<div class="wear"><span>${label}</span><div class="bar"><div class="bar-fill" data-bind="wear-${key}"></div></div><b data-bind="wear-${key}-text">–</b></div>`).join('')}
          </div>
          <div class="tr-part tr-part-trailer">
            <div class="trl-name"><b data-bind="trailer-name" data-no-names>Kein Anhänger</b><small data-bind="trailer-info"></small></div>
            ${[['tbody', 'Aufbau'], ['tchassis', 'Fahrgestell'], ['twheels', 'Räder'], ['tcargo', 'Ladung']].map(([key, label]) =>
              `<div class="wear"><span>${label}</span><div class="bar"><div class="bar-fill" data-bind="wear-${key}"></div></div><b data-bind="wear-${key}-text">–</b></div>`).join('')}
          </div>
          <div class="tiles tr-part-truck">
            <div class="tile"><small>Öl</small><b data-bind="oil">–</b></div>
            <div class="tile"><small>Wasser</small><b data-bind="water">–</b></div>
            <div class="tile"><small>Ø Verbrauch</small><b data-bind="consumption">–</b></div>
            <div class="tile"><small>Kilometerstand</small><b data-bind="odometer">–</b></div>
          </div>
        </div>
      </div></section>
      <section class="screen" data-screen="job"><div class="job-grid">
        <div class="card surface job-main">
          <div class="widget-title">${badge('job', 'purple')}<span data-bind="job-title">Auftrag</span><span class="pill job-market" data-bind="job-market"></span></div>
          <div class="job-ends">
            <div><b data-bind="from">–</b><small data-bind="from-company"></small></div>
            <span class="arrow">→</span>
            <div><b data-bind="to">–</b><small data-bind="to-company"></small></div>
          </div>
          <div class="job-cargo"><span data-bind="cargo">Kein Auftrag</span><span class="job-mass" data-bind="cargo-meta"></span></div>
          <div class="job-stops" data-bind="job-stops" hidden></div>
          <dl class="job-list">
            <dt>Lohn</dt><dd data-bind="income">–</dd>
            <dt>Kosten unterwegs</dt><dd data-bind="job-costs">–</dd>
            <dt>Bleibt</dt><dd class="strong" data-bind="job-net">–</dd>
            <dt>Strecke</dt><dd data-bind="planned">–</dd>
            <dt data-bind="damage-label">Ladungsschaden</dt><dd data-bind="cargo-damage">–</dd>
          </dl>
        </div>
        <div class="card surface job-side">
          <div class="widget-title">${badge('turn-straight', 'blue')}Fortschritt</div>
          <div class="job-left" data-bind="job-left">–</div>
          <div class="job-next" data-bind="bus-next" hidden></div>
          <div class="bar big"><div class="bar-fill blue" data-bind="job-bar"></div></div>
          <div class="job-eta"><span data-bind="job-eta">–</span><span class="pill" data-bind="job-status"></span></div>
          <dl class="job-list job-bus-side" data-bind="job-bus-side" hidden>
            <dt>Linie</dt><dd data-bind="bus-progress">–</dd>
            <dt>Fahrgäste</dt><dd data-bind="bus-aboard">–</dd>
            <div class="jl-row" data-bind="bus-punct-row" hidden><dt>Pünktlichkeit</dt><dd data-bind="bus-punct">–</dd></div>
            <dt>Lohn</dt><dd data-bind="income">–</dd>
            <div class="jl-row" data-bind="bus-net-row" hidden><dt>Bleibt</dt><dd class="strong" data-bind="job-net">–</dd></div>
          </dl>
          <div class="job-deadline"><span data-bind="deadline-label">Lieferfrist</span><b data-bind="deadline-at">–</b></div>
          <div class="job-deadline"><span>Puffer</span><b data-bind="job-buffer">–</b></div>
          <div class="job-rest-card">
            <div class="job-rest">${badge('rest', 'orange')}<span>Nächste Pause</span><b data-bind="rest">–</b></div>
            <div class="job-rest-stop" data-bind="rest-stop">–</div>
          </div>
        </div>
      </div></section>
      <section class="screen" data-screen="messages"><div class="card surface list-card" data-scroll-host>
        <div class="list-head"><h1>Mitteilungen</h1></div>
        <div class="list-rows" data-list="messages" data-scroll-area></div>
        <div class="scroll-arrows"><button class="glass" data-focus data-scroll="-1" aria-label="Nach oben">${ICONS['chevron-up']}</button><button class="glass" data-focus data-scroll="1" aria-label="Nach unten">${ICONS['chevron-down']}</button></div>
      </div></section>
      <section class="screen chat-screen" data-screen="chat"><div class="chat-wrap" data-list="chat-app"></div></section>
      <section class="screen" data-screen="stops"><div class="card surface list-card">
        <div class="list-head"><h1>Tanken & Rasten</h1>
          <div class="segmented glass">
            <button data-focus data-stops-tab="g" class="${stopsTab === 'g' ? 'on' : ''}">Tanken</button>
            <button data-focus data-stops-tab="p" class="${stopsTab === 'p' ? 'on' : ''}">Rasten</button>
            <button data-focus data-stops-tab="s" class="${stopsTab === 's' ? 'on' : ''}">Werkstatt</button>
          </div>
          <span class="fuel-price" data-bind="fuel-price"></span>
        </div>
        <div class="list-rows" data-list="stops"></div>
      </div></section>
      <section class="screen" data-screen="logbook"><div class="card surface list-card log-card">
        <div class="list-head"><h1>Fahrtenbuch</h1><div class="segmented log-tabs" data-list="log-tabs"></div></div>
        <div class="log-body" data-list="logbook"></div>
      </div></section>
      <section class="screen ultra-screen" data-screen="ultra">${ultraScreenHtml()}</section>
      <section class="screen" data-screen="settings">${settingsScreen()}</section>`;
  }

  // Wie CarPlay: auf hohen Displays vier Apps, auf breiten/flachen drei
  function sidebarCount() {
    if (settings.sidebarCount !== 'auto') return Number(settings.sidebarCount);
    if (settings.sidebar === 'top' || settings.sidebar === 'bottom') return 4; // waagerecht ist Platz genug
    return window.innerHeight / window.innerWidth >= 0.5 ? 4 : 3;
  }

  function renderSidebar() {
    const apps = catalog.sidebarApps(settings, sidebarCount());
    dock.innerHTML = apps.map(appIcon).join('');
    for (const el of dock.querySelectorAll('.app')) el.classList.toggle('active', el.dataset.app === screen);
    homeButton.innerHTML = screen === 'home' ? ICONS.square : ICONS.grid9;

  }

  // render() baut alles neu auf – was nur im DOM steckt, vorher merken und danach zurückholen:
  // Scrollpositionen in der sichtbaren App (Listen, Sender, Mitteilungen …) und getippter Text in Eingabefeldern
  function pathIn(root, el) {
    const path = [];
    for (let n = el; n && n !== root; n = n.parentElement) path.push([...n.parentElement.children].indexOf(n));
    return path.reverse();
  }
  function captureView() {
    const active = stage.querySelector('.screen.active');
    const view = { screen: active?.dataset.screen, scroll: [], inputs: [], focus: null };
    if (active) for (const el of active.querySelectorAll('*')) if (el.scrollTop || el.scrollLeft) view.scroll.push([pathIn(active, el), el.scrollTop, el.scrollLeft]);
    for (const input of stage.querySelectorAll('input[data-input]')) if (input.value) view.inputs.push([input.dataset.input, input.value]);
    const f = document.activeElement;
    if (f?.dataset?.input && stage.contains(f)) view.focus = { key: f.dataset.input, start: f.selectionStart, end: f.selectionEnd };
    return view;
  }
  function restoreView(view) {
    const active = stage.querySelector('.screen.active');
    if (active && active.dataset.screen === view.screen) {
      for (const [path, top, left] of view.scroll) {
        let el = active;
        for (const i of path) el = el?.children[i];
        if (!el) continue;
        if (top) el.scrollTop = top;
        if (left) el.scrollLeft = left;
      }
    }
    for (const [key, value] of view.inputs) for (const input of stage.querySelectorAll(`input[data-input="${key}"]`)) input.value = value;
    const input = view.focus && stage.querySelector(`.screen.active input[data-input="${view.focus.key}"]`);
    if (input) {
      input.focus({ preventScroll: true });
      try {
        input.setSelectionRange(view.focus.start, view.focus.end);
      } catch {
        // Feldtyp ohne Auswahl
      }
    }
  }

  function render() {
    // Sprache (?lang=en nur zum Testen). Zurück auf Deutsch: kurz neu laden, damit auch feste Texte wieder deutsch sind
    const wasEnglish = CarI18n.lang === 'en';
    if (CarI18n.setLanguage(params.get('lang') || CarI18n.resolve(settings.language)) && wasEnglish) setTimeout(() => location.reload(), 400);
    shell.classList.toggle('sidebar-right', settings.sidebar === 'right');
    shell.classList.toggle('sidebar-top', settings.sidebar === 'top'); // Leiste oben/unten: eigene Zeile (03-ios-stil.css)
    shell.classList.toggle('sidebar-bottom', settings.sidebar === 'bottom');
    const body = document.body;
    body.classList.toggle('icons-large', settings.iconSize === 'large');
    body.classList.toggle('no-labels', !settings.showLabels);
    body.dataset.glass = params.get('glass') || settings.glass; // --glass=… nur zum Testen
    body.dataset.icons = params.get('icons') || settings.iconStyle;
    body.dataset.mapstyle = params.get('mapstyle') || settings.mapStyle;
    document.documentElement.dataset.scale = settings.textScale;
    // Das Spiel hellt das Display auf (Gamma/Leuchten) – nur das Bild für den Truck wird korrigiert
    // Die Bildkorrektur für das Truck-Display rechnet das Plugin (schneller, nur geänderte Bereiche).
    // --gamma=light|strong zeigt sie zum Testen ohne Spiel trotzdem hier an.
    const gamma = params.get('gamma');
    shell.style.filter = role === 'game' && gamma && gamma !== 'off' ? `url(#gamma-${gamma})` : '';
    applyWallpaper();

    const settingsTop = settingsScrollTop();
    const view = captureView();
    resolveTheme();
    stage.innerHTML = screensHtml();
    bound.clear();
    lists.clear();
    lastStopsAt = 0; // Orte-Liste gleich neu füllen (sonst bis zu 1 s leer – und die Scrollposition ginge verloren)
    renderSidebar();
    syncCameras();
    showScreen(screen || (settings.startScreen === 'last' ? settings.lastScreen : settings.startScreen), { keepFocus: true, quiet: true });
    restoreSettingsScroll(settingsTop); // erst wenn die Seite sichtbar ist – vorher wirkt scrollTop nicht

    // Kartenansichten weiterverwenden (gleiche App, gleiche Stelle): behalten ihre Kacheln – sonst baute jede
    // Einstellungsänderung alle Kacheln neu auf, und die alten Ansichten blieben samt Kacheln im Speicher
    const mapKey = (c) => `${c.closest('[data-screen]')?.dataset.screen || ''}|${[...stage.querySelectorAll('canvas[data-map]')].filter((x) => x.closest('[data-screen]') === c.closest('[data-screen]')).indexOf(c)}`;
    const oldMaps = new Map(maps.map((m) => [m.mapKey, m]));
    maps = [...stage.querySelectorAll('canvas[data-map]')].map((c) => {
      const key = mapKey(c);
      const view = oldMaps.get(key) || new CarMap.MapView(c, trail, pose);
      if (oldMaps.get(key)) view.attach(c);
      oldMaps.delete(key);
      view.mapKey = key;
      return view;
    });
    for (const view of oldMaps.values()) view.dispose?.();
    compasses = [...stage.querySelectorAll('canvas[data-compass]')];
    if (telemetry) onTelemetry(telemetry);
    onMedia(media || { available: false }, true);
    applyArtColor();
    renderRadio();
    renderSport();
    renderLists();
    updateTheme();
    updateMapNote();
    restoreView(view); // zuletzt: erst jetzt sind die Listen wieder gefüllt
  }

  // Seite gleitet beim Wischen herein (left = kommt von rechts)
  function slideIn(el, from) {
    if (!el) return;
    el.classList.remove('slide-left', 'slide-right');
    void el.offsetWidth;
    el.classList.add(from === 'left' ? 'slide-left' : 'slide-right');
    setTimeout(() => el.classList.remove('slide-left', 'slide-right'), 300);
  }

  function showScreen(id, { keepFocus = false, quiet = false, slide = '' } = {}) {
    if (callFull && callView) setCallFull(false); // Home-Knopf oder App in der Seitenleiste: Anruf schrumpft zur Pille
    // Seite und Bühne scrollen nie – falls doch (früher durch scrollIntoView), zurück an den Anfang, sonst ist das Bild verschoben
    if (document.documentElement.scrollTop || document.documentElement.scrollLeft) document.documentElement.scrollTo(0, 0);
    if (stage.scrollTop || stage.scrollLeft) stage.scrollTo(0, 0);
    if (id === 'standby') return setStandby(true); // „Display aus“: nur die Uhr, der Bildschirm darunter bleibt
    if (id === 'nowplaying') id = catalog.APPS[settings.recents?.audio] ? settings.recents.audio : 'music'; // „Jetzt läuft“: die laufende Audio-App
    if (!catalog.APPS[id] && id !== 'home') id = 'home';
    // Einstellungen neu betreten: auf der Übersicht beginnen – auch im DOM (sonst stand dort noch die letzte Unterseite)
    if (id === 'settings' && screen !== 'settings' && screen !== null) {
      settingsStack = ['main'];
      if (settingsShown !== 'main') rerenderSettings();
    }
    if (id !== 'settings' || screen !== 'settings') settingsReturn = null;
    if (screen && screen !== id) previousScreen = screen;
    screen = id;
    // App CabPlay Ultra: Vorschau (zweites Kombiinstrument) nur laden, solange die App offen ist – sonst liefe es versteckt mit
    const ultraSection = stage.querySelector('.screen[data-screen="ultra"]');
    if (ultraSection && id === 'ultra' && !ultraSection.querySelector('.cl-frame')) ultraSection.innerHTML = ultraScreenHtml();
    if (id !== 'ultra') ultraSection?.querySelector('.cl-frame')?.remove();
    if (id !== 'settings') stage.querySelector('.screen[data-screen="settings"] .cl-frame')?.remove(); // Vorschau unter Einstellungen › Kombiinstrument ebenso
    if (id === 'home' || id === 'dashboard') lastHub = id;
    if (id === 'phone') renderPhone();
    if (id === 'chat') renderChatApp();
    for (const s of stage.querySelectorAll('.screen')) s.classList.toggle('active', s.dataset.screen === id);
    shell.dataset.screen = id; // App-Hintergrund (unscharfes Hintergrundbild) wie iOS-26-CarPlay
    if (slide) slideIn(stage.querySelector(`.screen[data-screen="${id}"]`), slide);
    rememberRecent(id, quiet);
    renderSidebar();
    if (id === 'stops' || id === 'logbook' || id === 'messages' || id === 'calendar') renderLists();
    if (id === 'logbook') renderLogbook(); // Reiter Fahrten/Länder: sonst erst mit der nächsten Telemetrie
    if (id === 'radar') renderRadar();
    if (id === 'sports') loadSport();
    if (id === 'music' && musicTab === 'library') loadLibrary();
    // Video-App verlassen, während ein Video läuft: als Bild im Bild weiter (Einstellung, Standard an)
    videoPip = id !== 'video' && settings.video.pip && !!videoKey && !videoStopped;
    if (videoPip) videoFull = false;
    if (id !== 'video') videoStopped = false;
    if (id !== 'maps' && mapOverview) setOverview(false);
    // Kartenmenü beim Verlassen der Karte schließen – auch im DOM, sonst ist es beim Zurückkommen sichtbar,
    // gilt aber als zu („Zurück“ sprang dann zum Dashboard, Kacheln schlossen das Menü)
    if (id !== 'maps' && mapSheetOpen) {
      mapSheetOpen = false;
      mapSheetPage = 'main';
      rerenderMapSheet();
    }
    syncVideo();
    if (!keepFocus) nav.reset();
  }

  // CarPlay-Seitenleiste: zuletzt benutzte App je Art merken
  function rememberRecent(id, quiet) {
    // „Zuletzt geöffnet“ als Startbildschirm: nur der Truck-Bildschirm merkt es sich (sonst doppelt)
    if (!quiet && api && (role === 'game') && settings.lastScreen !== id && id !== 'settings') {
      settings.lastScreen = id;
      api.saveSettings(settings);
    }
    const kind = catalog.APPS[id] && catalog.APPS[id].kind;
    if (kind === 'other') {
      // Wie CarPlay: Apps behalten ihren Platz. Neu geöffnet → ersetzt die länger nicht benutzte der beiden unteren
      const r = settings.recents;
      const slot = r.other === id ? 'other' : r.other2 === id ? 'other2' : null;
      const next = slot ? (slot === 'other' ? 'other2' : 'other') : r.next === 'other' ? 'other' : 'other2';
      if (slot && r.next === next) return;
      if (!slot) r[next] = id;
      r.next = slot ? next : next === 'other' ? 'other2' : 'other';
      if (!quiet && api) api.saveSettings(settings);
      return;
    }
    if (!settings.recents[kind] || settings.recents[kind] === id) return;
    settings.recents[kind] = id;
    if (!quiet && api) api.saveSettings(settings);
  }

  // Welche Einstellungsseite gerade im DOM steht: wird dieselbe neu gezeichnet (Schalter, Download-Fortschritt),
  // bleiben Scrollposition und Fokusrahmen erhalten statt nach oben zu springen
  function settingsScrollTop() {
    if (settingsShown !== settingsStack.join('/')) return 0;
    return stage.querySelector('[data-screen="settings"] .settings-body')?.scrollTop || 0;
  }
  function restoreSettingsScroll(top) {
    settingsShown = settingsStack.join('/');
    const area = top && stage.querySelector('[data-screen="settings"] .settings-body');
    if (area) area.scrollTop = top;
  }

  function rerenderSettings(focusSelector) {
    const section = stage.querySelector('[data-screen="settings"]');
    let keep = -1;
    if (section) {
      const top = settingsScrollTop();
      if (settingsShown === settingsStack.join('/')) keep = [...section.querySelectorAll('[data-focus]')].findIndex((el) => el.classList.contains('focused'));
      section.innerHTML = settingsScreen();
      restoreSettingsScroll(top);
    }
    bound.clear();
    const again = keep >= 0 && section.querySelectorAll('[data-focus]')[keep];
    if (focusSelector) nav.focusSelector(`.screen.active ${focusSelector}`);
    else if (again) nav.focusElement(again);
    else nav.reset();
  }

  // Scrollposition je Einstellungsseite: Unterseite öffnen und zurück – die Liste steht wieder da, wo man war
  const settingsScrollMemo = new Map();
  function openSettingsPage(page) {
    if (settingsShown === settingsStack.join('/')) settingsScrollMemo.set(settingsShown, settingsScrollTop());
    settingsStack.push(page);
    rerenderSettings();
    if (page === 'remote') refreshRemoteInfo();
    if (page === 'maps') refreshMapReports();
    if (page === 'assistant') refreshAiStatus();
  }

  // Gesammelte Kartenfehler-Meldungen (Anzahl, letzte) – für Einstellungen › Karten
  let mapReports = null;
  let laneStats = null;
  function refreshMapReports() {
    if (!api || !api.mapReports) return;
    api.laneStats?.().then((info) => {
      laneStats = info;
      if (screen === 'settings' && settingsStack[settingsStack.length - 1] === 'maps') rerenderSettings();
    }).catch(() => {});
    api.mapReports().then((info) => {
      mapReports = info;
      if (screen === 'settings' && settingsStack[settingsStack.length - 1] === 'maps') rerenderSettings();
    }).catch(() => {});
  }

  // Adresse der Handy-Steuerung (kommt vom Hauptprozess; nach dem Einschalten kurz warten)
  let remoteInfo = null;
  function refreshRemoteInfo(delay = 0) {
    if (!api || !api.remoteInfo) return;
    setTimeout(() => api.remoteInfo().then((info) => {
      remoteInfo = info;
      if (screen === 'settings' && settingsStack[settingsStack.length - 1] === 'remote') rerenderSettings('[data-toggle="remote"]');
    }), delay);
  }

  function settingsBack() {
    // Aus dem Karten-Menü gekommen: von dessen Seite direkt zurück zur Karte mit offenem Menü
    if (settingsReturn === 'maps' && settingsStack.length === 2) {
      settingsStack = ['main'];
      capturing = null;
      showScreen('maps');
      mapSheetOpen = true;
      mapSheetPage = 'main';
      return rerenderMapSheet();
    }
    // Aus der App CabPlay Ultra („Alle Einstellungen“): zurück in die App
    if (settingsReturn === 'ultra' && settingsStack.length === 2) {
      settingsStack = ['main'];
      capturing = null;
      return showScreen('ultra');
    }
    const from = settingsStack.length > 1 ? settingsStack.pop() : null;
    capturing = null;
    const path = settingsStack.join('/');
    const top = settingsScrollMemo.get(path);
    settingsScrollMemo.delete(path);
    rerenderSettings();
    // gemerkte Position wiederherstellen und den Eintrag, von dem man kam, auswählen (Lenkrad-Tasten)
    if (top) restoreSettingsScroll(top);
    const back = from && stage.querySelector(`[data-screen="settings"] [data-page="${CSS.escape(from)}"]`);
    if (back) {
      nav.focusElement(back);
      if (top) restoreSettingsScroll(top); // Fokus scrollt evtl. selbst – Position der Liste behalten
    }
  }

  // ------------------------------------------------------------------ Einstellungen anwenden
  const ask = (question) => window.confirm(CarI18n.translate(question));

  function applySettings(next, persist) {
    settings = catalog.sanitize(next);
    render();
    if (persist && api) api.saveSettings(settings);
  }

  function changeSetting(mutator, focusSelector) {
    const next = JSON.parse(JSON.stringify(settings));
    mutator(next);
    applySettings(next, true);
    if (focusSelector && (screen === 'settings' || screen === 'ultra')) nav.focusSelector(`.screen.active ${focusSelector}`);
  }

  // Hintergrund – Paare (◐) wechseln mit Hell/Dunkel
  window.__clusterWallpaper = () => ({ customWallpaper, wallpaperFiles }); // Vorschau des Kombiinstruments (iframe)
  function applyWallpaper() {
    let wp;
    if (settings.wallpaper === 'custom' && customWallpaper) wp = `url("${customWallpaper}") center / cover`;
    else if (settings.wallpaper.startsWith('file:') && wallpaperFiles[settings.wallpaper.slice(5)]) wp = `url("${wallpaperFiles[settings.wallpaper.slice(5)]}") center / cover`;
    else {
      const entry = catalog.WALLPAPERS[settings.wallpaper] || catalog.WALLPAPERS[catalog.DEFAULTS.wallpaper];
      wp = theme === 'dark' && entry.dark ? entry.dark : entry.css;
    }
    if (shell.dataset.wp !== wp) {
      shell.dataset.wp = wp;
      shell.style.setProperty('--wallpaper', wp);
    }
  }

  // Nachts nach Spielzeit?
  // Dämmerung vom Spiel gelernt: Die Lichtautomatik (Armaturenbeleuchtung, Plugin ab 1.7.2) schaltet bei echter
  // Dunkelheit. Wann sie morgens aus- und abends angeht, merkt sich die App (gleitender Mittelwert über die Tage) –
  // die Zeiten stehen nicht in den Spieldateien (dort sind die Sonnenprofile nach Sonnenhöhe, nicht nach Uhrzeit).
  // Ohne gelernte Werte: 20:30 bis 5:00.
  let dusk = { morning: 5 * 60, evening: 20 * 60 + 30 };
  try { dusk = { ...dusk, ...JSON.parse(localStorage.getItem('dusk') || '{}') }; } catch {}
  // Die Armaturenbeleuchtung ist kein Ein/Aus: Mit Lichtautomatik steht sie tagsüber auf 1,0 und wird bei Dunkelheit
  // gedimmt (gemessen im Volvo: 0,94 um 19:30, 0,84 um 20:30, nachts 0,80, morgens 0,85 → 0,95 → 1,0 um 7:00).
  // Früher galt alles über 0,05 als „Licht an“ – damit war es auch mittags immer Nacht.
  const backlightDark = (b) => b > 0.05 && b < 0.9;
  let lastBacklight = null;
  function learnDusk(t) {
    if (!t?.available || typeof t.backlight !== 'number' || t.paused) return;
    const on = backlightDark(t.backlight);
    if (lastBacklight !== null && on !== lastBacklight && !t.lowBeam) {
      const min = Math.floor(t.gameTimeMin) % 1440;
      const blend = (old, now) => Math.round(old * 0.6 + now * 0.4);
      // nur plausible Übergänge (Tunnel und Gewitter am Tag zählen nicht)
      if (!on && min >= 3 * 60 && min <= 9 * 60) dusk.morning = blend(dusk.morning, min);
      else if (on && min >= 17 * 60 && min <= 23 * 60) dusk.evening = blend(dusk.evening, min);
      else { lastBacklight = on; return; }
      try { localStorage.setItem('dusk', JSON.stringify(dusk)); } catch {}
    }
    lastBacklight = on;
  }
  const nightByClock = () => {
    const min = telemetry?.available ? Math.floor(telemetry.gameTimeMin) % 1440 : 22 * 60;
    return min >= dusk.evening || min < dusk.morning;
  };
  // „Nach Scheinwerfer“: dunkel, solange das Abblendlicht an ist (Standlicht zählt nicht – bei Lichtautomatik steht der
  // Schalter dort). Mit automatischem Licht im Spiel zusätzlich nach Dunkelheit (ältere Plugins ohne Lichtdaten: nach Uhrzeit)
  let gameAutoLights = false;
  // Brennt das Licht wirklich? Mit Lichtautomatik meldet das Spiel nur die Schalterstellung (Abblendlicht bleibt
  // „aus“), die Armaturenbeleuchtung (Plugin ab 1.7.2) wird aber bei Dunkelheit gedimmt (backlightDark). Ohne sie: nach Uhrzeit.
  // Kurz entprellt (10 s), damit Tunnel, Brücken und Regen nicht ständig hin und her schalten.
  let lightsState = null;
  let lightsChangeAt = 0;
  function lightsOnNow() {
    const t = telemetry;
    if (!t?.available) return nightByClock();
    if (t.lowBeam || t.highBeam) return true;
    if (!gameAutoLights) return typeof t.lowBeam === 'boolean' ? false : nightByClock();
    if (typeof t.backlight === 'number') return backlightDark(t.backlight);
    return nightByClock();
  }
  function lightsOn() {
    const now = performance.now();
    const raw = lightsOnNow();
    if (lightsState === null) lightsState = raw;
    if (raw === lightsState) lightsChangeAt = 0;
    else if (!lightsChangeAt) lightsChangeAt = now;
    else if (now - lightsChangeAt > 10000) {
      lightsState = raw;
      lightsChangeAt = 0;
    }
    return lightsState;
  }
  const lightsDark = () => lightsOn();
  if (api?.gameAutoLights) {
    const refreshAutoLights = () => api.gameAutoLights().then((on) => (gameAutoLights = !!on)).catch(() => {});
    refreshAutoLights();
    setInterval(refreshAutoLights, 30000); // im Spiel umgestellt: nach spätestens einer halben Minute übernommen
  }

  // Hell oder dunkel aus der Einstellung – render() braucht das schon vor dem Zeichnen (Haken bei Hell/Dunkel)
  function resolveTheme() {
    // --theme=dark|light (nur zum Testen) übersteuert die Einstellung
    let next = params.get('theme') || settings.appearance;
    if (next === 'auto') next = nightByClock() ? 'dark' : 'light'; // nachts dunkel, tagsüber hell – nach Spielzeit
    else if (next === 'lights') next = lightsDark() ? 'dark' : 'light'; // wie im echten Auto
    if (next !== theme || document.body.dataset.theme !== next) {
      theme = next;
      document.body.dataset.theme = next;
    }
    // Option „Nachts dunkler“: wie ein echtes Display gedimmt, solange es Nacht ist (Spielzeit) oder das Licht brennt –
    // in jedem Farbschema (früher nur im dunklen: mit „Hell“ tat der Schalter nichts) und auch im Fenster am PC,
    // damit man sieht, was im Truck passiert
    const dim = settings.nightDim && (nightByClock() || lightsOn());
    if (document.body.classList.contains('night-dim') !== dim) document.body.classList.toggle('night-dim', dim);
  }

  // Option „Bei Spielpause anhalten“: Esc-Menü, Vollbildkarte o. Ä. halten Spotify und Radio an; geht es weiter, läuft
  // wieder, was wir angehalten haben (was du selbst pausiert hast, bleibt aus)
  let lastGamePaused = null;
  let pausedByGame = null;
  function mediaOnGamePause(t) {
    if (role !== 'game' || !t?.available) return;
    const paused = !!t.paused;
    if (lastGamePaused === null || paused === lastGamePaused) {
      lastGamePaused = paused;
      return;
    }
    lastGamePaused = paused;
    if (paused) {
      if (!settings.mediaPauseWithGame) return;
      pausedByGame = { spotify: !!media?.playing, radio: !!radio?.playing };
      if (pausedByGame.spotify) sendMedia('toggle');
      if (pausedByGame.radio) api?.radioStop?.();
    } else if (pausedByGame) {
      if (pausedByGame.spotify && !media?.playing) sendMedia('toggle');
      if (pausedByGame.radio && !radio?.playing) api?.radioPlay?.();
      pausedByGame = null;
    }
  }

  function updateTheme() {
    resolveTheme();
    applyWallpaper();
    updateBattery();
    updateSignal(true);
  }

  // ------------------------------------------------------------------ Plugin-Datei im Spiel (Info-Seite)
  let pluginFile = null;
  function refreshPluginFile() {
    api?.pluginStatus?.().then((st) => {
      pluginFile = st;
      if (screen === 'settings') rerenderSettings();
    });
  }
  refreshPluginFile();
  api?.onPluginInstall?.((r) => {
    if (role !== 'editor') return;
    showToast(r.ok
      ? { kind: 'System', icon: 'check', color: 'green', title: r.wasMissing ? 'Plugin installiert' : 'Plugin aktualisiert', text: 'Beim nächsten Spielstart ist CabPlay im Truck' }
      : { icon: 'warning', color: 'red', title: 'Plugin nicht installiert', text: r.error, open: 'settings' });
    refreshPluginFile();
  });

  // ------------------------------------------------------------------ Karte erneuern (Fortschritt)
  let mapJob = { state: 'idle', step: '', error: '' };
  function onMapJob(info) {
    if (!info) return;
    const was = mapJob.state;
    mapJob = info;
    if (info.state === 'running' && was !== 'running') {
      showToast(info.first
        ? { kind: 'System', icon: 'maps', color: 'blue', title: 'Karte wird erstellt', text: 'Erster Start mit diesem Spiel – CabPlay baut die Karte aus den Spieldateien, dauert ein paar Minuten' }
        : info.game && info.game !== currentGame.id
          ? { kind: 'System', icon: 'maps', color: 'blue', title: 'Karte wird erneuert', text: info.game === 'ats' ? 'Karte für ATS – läuft im Hintergrund, dauert ein paar Minuten' : 'Karte für ETS2 – läuft im Hintergrund, dauert ein paar Minuten' }
          : { kind: 'System', icon: 'maps', color: 'blue', title: 'Karte wird erneuert', text: 'Spiel-Update erkannt – läuft im Hintergrund, dauert ein paar Minuten' });
    }
    if (info.state === 'failed' && was === 'running') showToast({ icon: 'maps', color: 'red', title: 'Karte nicht erneuert', text: info.error || 'Fehler', open: 'settings' });
    // Fortschritt in der Seitenleiste: Ring unter dem Akku, solange die Karte neu entsteht
    const ring = document.getElementById('mapjob');
    if (ring) {
      ring.hidden = info.state !== 'running';
      const m = /^(\d+)\/(\d+)/.exec(info.step || '');
      const done = m ? (Number(m[1]) - 0.5) / Number(m[2]) : 0.08;
      ring.querySelector('.bar').style.strokeDasharray = `${Math.round(done * 100)} 100`;
      ring.title = info.step ? `Karte wird erneuert – ${info.step}` : 'Karte wird erneuert';
    }
    if (info.state !== was) api?.mapStatusOther?.().then((s) => { mapStatusOther = s; if (screen === 'settings') rerenderSettings(); }).catch(() => {});
    if (screen === 'settings') rerenderSettings();
    updateMapNote(); // „Karte wird erstellt“ statt „Kartendaten fehlen“
  }
  api?.mapUpdateInfo?.().then(onMapJob);
  api?.onMapUpdate?.(onMapJob);

  // ------------------------------------------------------------------ App-Updates
  let updateInfo = null;
  let desktopShortcut = null; // { available, exists } – Schalter unter Softwareupdate
  api?.shortcutGet?.().then((s) => (desktopShortcut = s), () => {});
  function onUpdateInfo(info) {
    const before = updateInfo;
    updateInfo = info;
    if (info?.state === 'available' && before?.state !== 'available' && role === 'game' && !settings.updateInstall) {
      showToast({ kind: 'System', icon: 'reset', color: 'green', title: 'Update verfügbar', text: `Version ${info.version} – unter Einstellungen › Softwareupdate laden`, open: 'settings/update' });
    }
    if (info?.state === 'ready' && before?.state !== 'ready' && role === 'game' && settings.updateInstall) {
      showToast({ kind: 'System', icon: 'reset', color: 'green', title: 'Update geladen', text: `Version ${info.version} wird nach dem Spielen installiert` });
    }
    if (screen === 'settings') rerenderSettings();
  }
  api?.updateInfo?.().then(onUpdateInfo);
  api?.onUpdate?.(onUpdateInfo);
  // erster Start nach einem Update: einmal zeigen, was neu ist (Details unter Einstellungen › Softwareupdate)
  api?.onWhatsNew?.((n) => {
    if (role !== 'game') return;
    const first = String(n.notes || '').split(/\r?\n/).map((l) => l.replace(/^[-*\s]+/, '').trim()).find((l) => l && !/^\*\*/.test(l) && !/^Neu in/.test(l));
    showToast({ kind: 'System', icon: 'check', color: 'green', title: `Aktualisiert auf ${n.version}`, text: first || 'Was ist neu: Einstellungen › Softwareupdate', open: 'settings/update' });
  });

  // ------------------------------------------------------------------ GPU-Übertragung (Status für die Einstellungen)
  let gpuStatus = '';
  const GPU_TEXT = { off: '', waiting: 'wartet auf das Spiel', active: 'aktiv', failed: 'aus – ', restart: 'wirkt nach Neustart der App' };
  function setGpuStatus(info) {
    const next = info ? (GPU_TEXT[info.state] ?? '') + (info.state === 'failed' ? info.reason || '' : '') : '';
    if (next === gpuStatus) return;
    gpuStatus = next;
    if (screen === 'settings') rerenderSettings();
  }
  api?.gpuInfo?.().then(setGpuStatus);
  api?.onGpu?.(setGpuStatus);

  // ------------------------------------------------------------------ Mobilfunk (Statusleiste)
  // Wie ein Handy im Truck: in Städten 5G mit vollem Empfang, dazwischen und auf dem Land LTE mit weniger Balken (3G gibt es nicht mehr)
  let netState = { label: '', bars: 4 };
  let netCheckedAt = 0;
  function updateSignal(force = false) {
    const now = performance.now();
    if (!force && now - netCheckedAt < 4000) return;
    netCheckedAt = now;
    const mode = settings.phoneSignal;
    let next = { label: mode === 'off' ? '' : '5G', bars: 4 };
    if (mode === 'auto') {
      const p = pose.current();
      const city = p && CarMap.hasPlaces() ? CarMap.nearestCity(p.x, p.z) : null;
      if (city) {
        const d = city.d;
        next = d < 3500 ? { label: '5G', bars: 4 } : d < 7000 ? { label: '5G', bars: 3 } : d < 12000 ? { label: 'LTE', bars: 3 }
          : d < 25000 ? { label: 'LTE', bars: 2 } : { label: 'LTE', bars: 1 };
      }
    }
    // kleine Verzögerung beim Wechsel, damit es nicht hin und her springt
    if (next.label !== netState.label || next.bars !== netState.bars) {
      netState = next;
      const net = document.getElementById('net');
      if (net) net.textContent = netState.label;
      const link = document.getElementById('link');
      if (link) link.dataset.bars = String(netState.bars);
    }
  }
  setInterval(() => updateSignal(), 4000);

  // ------------------------------------------------------------------ Handy-Akku (Statusleiste)
  let batteryLevel = 82;
  try { batteryLevel = Number(localStorage.getItem('phoneBattery')) || 82; } catch {}
  let batteryAt = Date.now();
  function updateBattery() {
    const el = document.getElementById('battery');
    if (!el) return;
    const mode = settings.phoneBattery;
    const now = Date.now();
    const minutes = (now - batteryAt) / 60000;
    batteryAt = now;
    if (mode === 'charging') batteryLevel = Math.min(100, batteryLevel + minutes * 1.2);
    else if (mode === 'on') batteryLevel = Math.max(4, batteryLevel - minutes * 0.25);
    try { localStorage.setItem('phoneBattery', batteryLevel.toFixed(1)); } catch {}
    el.hidden = mode === 'off';
    if (mode === 'off') return;
    const level = Math.round(batteryLevel);
    const key = `${mode}|${level}`;
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.title = `Handy ${level} %${mode === 'charging' ? ' – lädt' : ''}`;
    const w = Math.max(1.5, (level / 100) * 24);
    const color = mode === 'charging' ? '#34c759' : level <= 20 ? '#ff3b30' : 'currentColor';
    // Ladeblitz wie iOS: mittig im Akku, mit freigestelltem Rand (Maske) statt dunkler Kontur
    const bolt = 'M12.7 1.4 9 7.3h2.6l-.6 4.3 3.9-6.1h-2.6z';
    const knock = mode === 'charging' ? `<mask id="bat-mask" maskUnits="userSpaceOnUse" x="-1" y="-1" width="30" height="15"><rect x="-1" y="-1" width="30" height="15" fill="#fff"/><path d="${bolt}" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></mask>` : '';
    el.innerHTML = `<svg viewBox="0 0 28 13"><defs><clipPath id="bat-clip"><rect x="0" y="0" width="24" height="13" rx="4.2"/></clipPath>${knock}</defs>
      <g${knock ? ' mask="url(#bat-mask)"' : ''}><rect x="0" y="0" width="24" height="13" rx="4.2" fill="currentColor" fill-opacity="0.38"/>
      <rect x="0" y="0" width="${w.toFixed(1)}" height="13" fill="${color}" clip-path="url(#bat-clip)"/></g>
      <path d="M25.3 4.2a2.4 2.4 0 0 1 0 4.6z" fill="currentColor" fill-opacity="0.38"/>
      ${knock ? `<path d="${bolt}" fill="currentColor" stroke="currentColor" stroke-width="0.35" stroke-linejoin="round"/>` : ''}</svg>`;
  }
  setInterval(updateBattery, 30000);

  // ------------------------------------------------------------------ Datenbindung
  const bound = new Map();
  function nodes(name) {
    if (!bound.has(name)) bound.set(name, [...document.querySelectorAll(`[data-bind="${name}"]`)]);
    return bound.get(name);
  }
  // Ausblenden mit Animation (Klasse „leaving“, CSS 03-ios-stil.css), nach 200 ms hidden; done danach. Wird das Element
  // vorher wieder gezeigt, muss cancelLeave den ausstehenden Abschluss abbrechen
  const leaveTimers = new WeakMap();
  function cancelLeave(el) {
    if (!el) return;
    clearTimeout(leaveTimers.get(el));
    leaveTimers.delete(el);
    el.classList.remove('leaving');
  }
  function hideAnimated(el, done) {
    if (!el) return;
    if (el.hidden) { cancelLeave(el); done?.(); return; }
    if (leaveTimers.has(el)) return; // läuft schon
    el.classList.add('leaving');
    leaveTimers.set(el, setTimeout(() => {
      leaveTimers.delete(el);
      el.classList.remove('leaving');
      el.hidden = true;
      done?.();
    }, 200));
  }
  function text(name, value) {
    for (const el of nodes(name)) if (el.textContent !== value) el.textContent = value;
  }
  // Lauftext wie im echten CarPlay: ein zu langer Titel steht linksbündig, läuft nach einer Pause bis zu seinem Ende, wartet,
  // blendet aus und beginnt von vorn (mqRun), statt mit „…“ zu enden. Neu gemessen, wenn sich Text oder Breite ändern (auch beim
  // Einblenden eines Bildschirms – vorher ist die Breite 0)
  const mqObserver = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => { for (const e of entries) marquee(e.target); }) : null;
  // Ablauf eines Durchgangs: einblenden, stehen, bis zum Ende laufen, stehen, ausblenden – dann von vorn
  function mqRun(el, track, shift, speed, fade) {
    const fadeIn = 300, hold = 2200, rest = 1500, fadeOut = 300;
    const move = (shift / speed) * 1000;
    const total = fadeIn + hold + move + rest + fadeOut;
    const at = (ms) => ms / total;
    const timing = { duration: total, iterations: Infinity };
    el._mq = track.animate([
      { transform: 'translateX(0px)', opacity: 0, offset: 0 },
      { transform: 'translateX(0px)', opacity: 1, offset: at(fadeIn) },
      { transform: 'translateX(0px)', opacity: 1, offset: at(fadeIn + hold), easing: 'ease-in-out' },
      { transform: `translateX(${-shift}px)`, opacity: 1, offset: at(fadeIn + hold + move) },
      { transform: `translateX(${-shift}px)`, opacity: 1, offset: at(fadeIn + hold + move + rest) },
      { transform: `translateX(${-shift}px)`, opacity: 0, offset: 1 },
    ], timing);
    // links weich ausblenden nur, solange der Text verschoben ist
    el._mqMask = el.animate([
      { '--mq-l': '0px', offset: 0 },
      { '--mq-l': '0px', offset: at(fadeIn + hold) },
      { '--mq-l': `${fade}px`, offset: at(fadeIn + hold + Math.min(400, move)) },
      { '--mq-l': `${fade}px`, offset: 1 },
    ], timing);
  }
  function marquee(el) {
    if (!el.isConnected) return;
    const text = el.dataset.full ?? el.textContent;
    const key = `${text}|${el.clientWidth}|${getComputedStyle(el).fontSize}`;
    if (el.dataset.mq === key) return;
    el.dataset.mq = key;
    el._mq?.cancel();
    el._mqMask?.cancel();
    el._mq = el._mqMask = null;
    if (el.classList.contains('mq')) {
      // Spur weg: den Ausgangstext zurück und erst nach der Übersetzung (nächstes Bild) neu messen – den schon übersetzten
      // Text einzusetzen hätte ihn ein zweites Mal übersetzt („1,451“ → „1.451“)
      el.classList.remove('mq');
      el.textContent = text;
      el.dataset.mq = '';
      requestAnimationFrame(() => marquee(el));
      return;
    }
    const over = el.scrollWidth - el.clientWidth;
    if (over > 4 && el.clientWidth > 0 && el.animate) {
      const plain = el.textContent;
      el._mqPlain = plain;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
      const fade = rem * 1.6; // weicher Rand
      const shift = over + fade; // bis das Textende ganz sichtbar ist (rechts nicht mehr im ausgeblendeten Rand)
      // Text auf einer Spur, verschoben per transform (weich auch zwischen ganzen Pixeln)
      const track = document.createElement('span');
      track.className = 'mq-track';
      track.dataset.noI18n = ''; // Text ist schon übersetzt – nicht ein zweites Mal (aus „1,451“ wurde wieder „1.451“)
      track.textContent = plain;
      el.textContent = '';
      el.append(track);
      el.classList.add('mq');
      mqRun(el, track, shift, 35, fade);
    }
  }
  const mqWatched = new Set();
  function marqueeText(name, value) {
    // nach einem Neuaufbau der Oberfläche (render) sind die alten Felder abgelöst: nicht weiter beobachten (sonst bleiben sie
    // im Speicher)
    for (const el of mqWatched) {
      if (el.isConnected) continue;
      el._mq?.cancel(); // endlose Animation hielte das abgelöste Feld (und den alten Bildschirm) im Speicher
      el._mqMask?.cancel();
      el._mq = el._mqMask = null;
      mqObserver.unobserve(el);
      mqWatched.delete(el);
    }
    for (const el of nodes(name)) {
      if (mqObserver && !mqWatched.has(el)) { mqWatched.add(el); mqObserver.observe(el); }
      if (el.dataset.full !== value) {
        // neuer Text: Spur weg, Text setzen, erst im nächsten Bild messen (die Übersetzung läuft dazwischen)
        el.dataset.full = value;
        el._mq?.cancel();
        el._mqMask?.cancel();
        el._mq = el._mqMask = null;
        el.classList.remove('mq');
        el.textContent = value;
        el._mqPlain = null;
        el.dataset.mq = '';
        requestAnimationFrame(() => marquee(el));
      } else marquee(el);
    }
  }
  function html(name, key, markup) {
    for (const el of nodes(name)) if (el.dataset.key !== key) { el.dataset.key = key; el.innerHTML = markup; }
  }
  // Ein-/Ausblenden nur bei Änderung (auch gleiche Werte lösen sonst Neuberechnung aus)
  function setHidden(el, hidden) {
    if (el && el.hidden !== hidden) el.hidden = hidden;
  }
  function toggle(name, cls, on) {
    for (const el of nodes(name)) el.classList.toggle(cls, on);
  }
  // Breite auf 0,01 % gerundet: Chromium kürzt längere Kommazahlen im Stil – der Vergleich unten schlüge sonst immer
  // fehl, und jeder Aufruf schriebe den Balken neu (Neuberechnen und Neumalen, obwohl sich nichts ändert)
  function width(name, fraction) {
    const value = `${Math.round(Math.max(0, Math.min(1, fraction)) * 10000) / 100}%`;
    for (const el of nodes(name)) if (el.style.width !== value) el.style.width = value;
  }

  // Listen (Mitteilungen, Orte, Verlauf) nur neu schreiben, wenn sich der Inhalt ändert
  const lists = new Map();
  function list(name, markup) {
    if (lists.get(name) === markup) return;
    lists.set(name, markup);
    for (const el of document.querySelectorAll(`[data-list="${name}"]`)) el.innerHTML = markup;
  }

  // ------------------------------------------------------------------ Telemetrie
  const allEvents = new Map(); // id -> Ereignis (das Plugin hält nur die letzten 30)
  let eventsPrimed = false;
  const activeWarnings = new Set();
  let warningsPrimedAt = 0;
  const session = { started: false, odo0: 0, driveSec: 0, lastAt: 0, fuelUsed: 0, lastFuel: null, maxSpeed: 0 };

  const EVENT_LOOK = {
    'player.fined': ['fine', 'red', 'Strafe'],
    'player.tollgate.paid': ['toll', 'yellow', 'Maut'],
    'player.use.ferry': ['ferry', 'blue', 'Fähre'],
    'player.use.train': ['ferry', 'blue', 'Zug'],
    'job.delivered': ['delivered', 'green', 'Auftrag'],
    'job.cancelled': ['cancelled', 'red', 'Auftrag'],
  };

  // ------------------------------------------------------------------ Zündung: Display aus/an
  const powerEl = document.getElementById('power');
  powerEl.querySelector('.boot-icon').innerHTML = ICONS.carplay;
  if (role === 'game') powerEl.querySelector('.power-hint').remove(); // im Truck einfach schwarz
  let poweredOn = true;
  let bootTimer = 0;

  // ---- Display aus: nur die Uhr (Spielzeit, Wochentag, Temperatur). Die Karte zeichnet solange nicht (07b), das
  // Kombiinstrument und die Spiegelkamera laufen weiter. Antippen, Home/Auswählen oder Tastenkürzel schalten wieder ein.
  const standbyEl = document.getElementById('standby');
  let standby = false;
  let standbyHint = 0;
  standbyEl.addEventListener('click', () => setStandby(false)); // Antippen (auch im Touch-Modus) schaltet wieder ein
  function setStandby(on) {
    on = !!on && role === 'game';
    if (on === standby) return;
    standby = on;
    clearTimeout(standbyHint);
    if (on) {
      renderStandby();
      standbyEl.hidden = false;
      standbyEl.classList.remove('hint-off');
      standbyHint = setTimeout(() => standbyEl.classList.add('hint-off'), 4000);
      requestAnimationFrame(() => standbyEl.classList.add('on'));
    } else {
      standbyEl.classList.remove('on');
      standbyHint = setTimeout(() => (standbyEl.hidden = true), 450);
    }
  }
  function renderStandby() {
    if (!standby) return;
    const t = telemetry;
    const time = t?.available ? clock(t.gameTimeMin) : document.getElementById('clock').textContent;
    const ampm = / ([AP]M)$/.exec(time);
    const html = `${escape(time.replace(/ [AP]M$/, ''))}${ampm ? `<small>${ampm[1]}</small>` : ''}`;
    const timeEl = standbyEl.querySelector('.sb-time');
    if (timeEl.dataset.html !== html) { timeEl.dataset.html = html; timeEl.innerHTML = html; }
    const day = t?.available ? DAY_NAMES[Math.floor(t.gameTimeMin / 1440) % 7] : '';
    const w = settings.weather && weatherData?.current ? `${temp(weatherData.current.temp)}°` : '';
    const sub = [day, w].filter(Boolean).join('  ·  ');
    const subEl = standbyEl.querySelector('.sb-sub');
    if (subEl.textContent !== sub) subEl.textContent = sub;
    standbyEl.classList.toggle('dim', !!t?.lowBeam);
  }

  function setPower(on) {
    if (on === poweredOn) return;
    if (on) setStandby(false); // Zündung wieder an: Display ganz normal
    api?.aiLog?.(`power ${on ? 'an' : 'aus'} (window ${role})`);
    poweredOn = on;
    clearTimeout(bootTimer);
    if (!on) {
      powerEl.hidden = false;
      powerEl.className = 'power off';
      endCall('Zündung aus');
      toastEl.hidden = true;
      syncVideo();
      return;
    }
    // Einschalten: Startlogo, dann einblenden
    powerEl.className = 'power boot';
    bootTimer = setTimeout(() => {
      powerEl.className = 'power fade';
      bootTimer = setTimeout(() => (powerEl.hidden = true), 600);
    }, 1800);
    syncVideo();
  }

  // Abgekuppelter Anhänger auf der Karte: Lage aus dem Spiel (neues Plugin), sonst die Stelle, an der er abgekuppelt wurde
  let trailerBehind = null;
  function updateTrailerSpot(t, attached) {
    if (attached) {
      const hr = ((t.headingDeg || 0) / 180) * Math.PI;
      trailerBehind = { x: t.x + Math.sin(hr) * 9, z: t.z + Math.cos(hr) * 9 }; // etwa 9 m hinter der Zugmaschine
      return CarMap.setTrailer(null);
    }
    if (!t.hasTrailer) {
      trailerBehind = null;
      return CarMap.setTrailer(null);
    }
    CarMap.setTrailer(t.trailerKnown ? { x: t.trailerX, z: t.trailerZ } : trailerBehind);
  }

  let shownBrand = '';
  let etaLabel = 'Ankunft'; // Ankunftsleiste: „Ankunft Osnabrück“, wenn sie bis zum nächsten Bushalt rechnet (auch fürs Kombiinstrument)
  if (demoMode) window.__telemetry = (patch) => telemetry && onTelemetry({ ...telemetry, ...patch(telemetry) }); // Test: Telemetrie abwandeln
  function onTelemetry(t) {
    telemetry = t;
    paLook(t); // Bus-Durchsage: Klang folgt dem Kopf (Innenkamera)
    if (!t.available) {
      setBusDashboard(false); // Spiel weg: eingeblendetes Fahrerdisplay nach der Wartezeit wieder heraus
      return;
    }
    // ältere Plugins liefern keinen Zündungsstatus → immer an
    setPower(t.electric !== false);
    pose.update(t.x, t.z, t.headingDeg);
    trail.add(t.x, t.z);

    // Uhr nur bei neuer Minute schreiben – Telemetrie kommt bis zu 20x pro Sekunde
    const clockEl = document.getElementById('clock');
    const clockText = clock(t.gameTimeMin).replace(/ [AP]M$/, '');
    if (clockEl.textContent !== clockText) {
      clockEl.textContent = clockText;
      clockEl.title = DAYS[Math.floor(t.gameTimeMin / 1440) % 7];
      renderStandby();
    }
    // Farbschema (Licht, Uhrzeit) bei jedem Paket prüfen – billig; Akku und Netz haben eigene Takte (30 s / 4 s),
    // früher hier 20x pro Sekunde mit Speicher-Schreiben und Städtesuche
    resolveTheme();
    applyWallpaper();
    mediaOnGamePause(t);
    learnDusk(t);
    trackSession(t);
    trackEvents(t);

    const speed = Math.round(t.speedKmh);
    const limit = Math.round(t.speedLimitKmh);
    text('speed', String(spd(t.speedKmh)));
    // Zahl in eigenem Element: dreistellige (100, 120, 130 bzw. „105“ in ATS mit km/h) etwas kleiner, sonst bis an den Rand
    const limitText = limit > 0 ? String(spd(t.speedLimitKmh)) : '–';
    html('limit', limitText, `<span class="lv">${limitText}</span>`);
    toggle('limit', 'd3', limitText.length >= 3);
    toggle('limit', 'none', !(limit > 0));
    // Orange ab der eingestellten Tempo-Warnung (Blitzer › Tempo-Warnung); ist sie aus, ab +3 (km/h bzw. mph)
    const tol = spdDeltaKmh(settings.radarTolerance >= 0 ? settings.radarTolerance : 3);
    for (const el of nodes('speed')) el.parentElement.classList.toggle('over', limit > 0 && speed > limit + tol);

    text('gear', gear(t.gear));
    text('rpm', Math.round(t.rpm).toLocaleString('de-DE'));
    text('cruise', t.cruiseKmh > 0 ? `${spd(t.cruiseKmh)} ${spdUnit()}` : zhUnits() ? zhT('关', '關') : 'aus');
    const fuel = t.fuelCapacity > 0 ? t.fuel / t.fuelCapacity : 0;
    width('fuel-bar', fuel);
    toggle('fuel-bar', 'low', fuel < 0.15);
    text('fuel-text', t.fuelRangeKm > 0 ? `${volume(t.fuel)} · ≈ ${distance(t.fuelRangeKm)}` : volume(t.fuel));
    const adblue = num(t.adblueCapacity) > 0 ? num(t.adblue) / t.adblueCapacity : 0;
    width('adblue-bar', adblue);
    toggle('adblue-bar', 'low', t.adblueCapacity > 0 && adblue < 0.1);
    text('adblue-text', t.adblueCapacity > 0 ? volume(t.adblue) : '–');
    text('truck-name', [t.truckBrand, t.truckName].filter(Boolean).join(' '));
    toggle('parking-brake', 'on', !!t.parkingBrake);
    list('truck-lamps', truckLamps(t));

    for (const [key, field] of [['engine', 'wearEngine'], ['transmission', 'wearTransmission'], ['cabin', 'wearCabin'], ['chassis', 'wearChassis'], ['wheels', 'wearWheels']]) {
      const condition = 1 - num(t[field]);
      width(`wear-${key}`, condition);
      toggle(`wear-${key}`, 'low', condition < 0.85);
      text(`wear-${key}-text`, t[field] === undefined ? '–' : percent(condition));
    }
    // Anderer Lkw (andere Marke): Fahrzeug-Icon mit dem neuen Logo neu zeichnen
    if ((t.truckBrand || '') !== shownBrand) {
      shownBrand = t.truckBrand || '';
      if (settings.brandIcon) render();
    }
    // Scania Smartdash (Cockpit scania_2025): das Display zeigt ringsum einen Saum aus den Randpixeln unseres Bildes (er nahm
    // die Farbe des Hintergrunds an) – mit schwarzem Bildrand wird er schwarz wie der Displayrand der Scania-Oberfläche
    if (role === 'game') document.documentElement.classList.toggle('edge-dark', t.dashboard === 'scania_2025');
    // Bus (Coach-DLC): kein Anhänger, Fahrt mit Fahrgästen statt Fracht
    const bus = isBus(t);
    if (bus !== busMode) {
      busMode = bus;
      document.documentElement.classList.toggle('vehicle-bus', bus);
      if (bus && truckPart === 'trailer') truckPart = 'truck';
    }
    // Auto (ATS „Road Trip“): kein Anhänger, Kurieraufträge
    const car = isCar(t);
    if (car !== carMode) {
      carMode = car;
      document.documentElement.classList.toggle('vehicle-car', car);
      if (car && truckPart === 'trailer') truckPart = 'truck';
    }
    text('part-truck', bus ? 'Bus' : car ? 'Pkw' : 'Zugmaschine');
    text('damage-label', bus ? 'Schaden' : 'Ladungsschaden');
    text('deadline-label', bus ? 'Ankunftsfrist' : 'Lieferfrist');
    // Anhänger
    const attached = num(t.trailers) > 0;
    text('trailer-name', !t.hasTrailer ? 'Kein Anhänger' : [t.trailerBrand, t.trailerName].filter(Boolean).join(' ') || 'Anhänger');
    text('trailer-info', !t.hasTrailer ? 'Anhänger ankuppeln, dann erscheint hier sein Zustand.'
      : [attached ? (t.trailers > 1 ? `${t.trailers} Anhänger angekuppelt` : 'angekuppelt') : 'nicht angekuppelt', t.trailerBody ? TRAILER_BODY[t.trailerBody] || t.trailerBody : '', t.trailerPlate ? t.trailerPlate.replace(/<[^>]*>/g, '').trim() : ''].filter(Boolean).join(' · '));
    toggle('trailer-dot', 'on', attached);
    updateTrailerSpot(t, attached);
    for (const [key, field] of [['tbody', 'trailerWearBody'], ['tchassis', 'trailerWearChassis'], ['twheels', 'trailerWearWheels'], ['tcargo', 'cargoDamage']]) {
      const known = t.hasTrailer && t[field] !== undefined;
      const condition = known ? 1 - num(t[field]) : 0;
      width(`wear-${key}`, condition);
      toggle(`wear-${key}`, 'low', known && condition < 0.85);
      text(`wear-${key}-text`, known ? percent(condition) : '–');
    }
    const deg = unitMode() === 'us' ? '°F' : '°C';
    text('oil', t.oilTemp ? `${temp(t.oilTemp)} ${deg}` : '–');
    text('water', t.waterTemp ? `${temp(t.waterTemp)} ${deg}` : '–');
    text('consumption', t.fuelAverage > 0 ? consumption(t.fuelAverage) : '–');
    text('odometer', t.odometerKm > 0 ? `${Math.round(imperial() ? t.odometerKm * 0.621371 : t.odometerKm).toLocaleString('de-DE')} ${imperial() ? 'mi' : 'km'}` : '–');

    // Navigation (ETA-Leiste)
    const navigating = t.navDistanceKm > 0.05 && t.navTimeMin > 0;
    toggle('eta', 'idle', !navigating);
    if (navigating !== gameNavigating) {
      gameNavigating = navigating;
      updateMapNote(); // „Keine Route“ nicht neben einer Ankunftszeit
    }
    // Buslinie: Ankunftsleiste bis zum nächsten Halt (wie Apple Karten mit Zwischenstopps), Halte auf der Karte markieren
    const nextStop = busNextStop(t);
    const toStop = !!nextStop && !nextStop.last;
    const etaMin = toStop ? nextStop.min : t.navTimeMin;
    const etaKm = toStop ? nextStop.km : t.navDistanceKm;
    if (typeof CarMap !== 'undefined' && CarMap.setRouteStops) {
      const b = busLine(t);
      CarMap.setRouteStops(b ? b.line.stages.slice(b.cur, -1).map((s) => ({ id: s.toId || '', name: s.to || '' })) : []);
    }
    // wie in Navis mit Zwischenstopp: die Uhrzeit bleibt „Ankunft“, dazu der Halt („Ankunft Osnabrück“)
    etaLabel = toStop ? `Ankunft ${latin(nextStop.name || '')}` : 'Ankunft';
    text('eta-label', etaLabel);
    text('eta-to', toStop ? ` ${latin(nextStop.name || '')}` : ''); // klassische Leiste: „206 km · 17:01 Osnabrück“
    text('eta-duration', navigating ? duration(etaMin) : '');
    text('eta-km', navigating ? distance(etaKm) : '');
    text('eta-clock', navigating && etaMin > 0 ? `${clockU(t.gameTimeMin + etaMin)}` : '');
    text('eta-arrive', navigating && etaMin > 0 ? clock(t.gameTimeMin + etaMin) : '–');
    if (mapStyle() === 'apple') {
      const mins = Math.max(0, Math.round(etaMin));
      text('eta-num', !navigating ? '–' : mins >= 60 ? `${Math.floor(mins / 60)}:${pad(mins % 60)}` : String(Math.max(1, mins)));
      text('eta-unit', mins >= 60 ? 'Std.' : 'Min.');
      text('eta-kmnum', !navigating ? '–' : etaKm < 10 ? etaKm.toFixed(1).replace('.', ',') : Math.round(etaKm).toLocaleString('de-DE'));
    }

    // Auftrag
    text('cargo', t.hasJob ? t.cargo : lastDelivery ? `Zuletzt geliefert: ${lastDelivery}` : 'Kein Auftrag');
    text('from-company', t.hasJob ? t.sourceCompany || '' : '');
    text('to-company', t.hasJob ? t.destinationCompany || '' : '');
    text('job-market', t.hasJob ? [t.specialJob ? 'Spezialtransport' : '', JOB_MARKETS[t.jobMarket] || ''].filter(Boolean).join(' · ') : '');
    // Buslinie (Bus-DLC): Halte mit geplanten Zeiten und Fahrgästen, der nächste hervorgehoben; Fahrgäste an Bord (geplant)
    const line = t.hasJob && t.bus && Array.isArray(t.bus.stages) && t.bus.stages.length ? t.bus : null;
    for (const el of nodes('job-stops')) setHidden(el, !line);
    if (line) {
      const cur = Math.max(0, Math.min(line.stages.length - 1, Number(line.current) || 0));
      let aboard = 0;
      for (let i = 0; i <= cur; i++) aboard += (Number(line.stages[i].on) || 0) - (i ? Number(line.stages[i - 1].off) || 0 : 0);
      const day = (min) => Math.floor(min / 1440);
      const when = (min) => (min > 0 ? (day(min) === day(t.gameTimeMin) ? clock(min) : dayClock(min)) : '–');
      // actual: tatsächliche Ankunft (Plugin ab 1.12.5, sonst fehlt sie); am Start die tatsächliche Abfahrt
      const stops = [{ name: line.stages[0].from, time: line.stages[0].dep, actual: Number(line.stages[0].depA) || 0, on: line.stages[0].on, off: 0, idx: 0 }];
      line.stages.forEach((s, i) => stops.push({ name: s.to, time: s.arr, actual: Number(s.arrA) || 0, on: i + 1 < line.stages.length ? line.stages[i + 1].on : 0, off: s.off, idx: i + 1 }));
      // Pünktlichkeit wie im Spiel: erreichte Halte nach tatsächlicher Zeit, der nächste nach der Vorhersage (Strecke bis
      // zur Haltestelle auf der Route, siehe busNextStop – ohne gefundene Haltestelle keine Vorhersage)
      const forecast = nextStop && t.gameTimeMin > 0 ? Math.round(t.gameTimeMin + nextStop.min) : 0;
      // Fahrerdisplay im Auftrags-Widget (Issue #8, wie das Gerät am Fahrerplatz): unterwegs der nächste Halt mit Plan und
      // Abweichung, am Halt (noch nicht abgefahren) die geplante Abfahrt mit Restzeit und den Fahrgästen
      // Schon am Ziel des Abschnitts angekommen (tatsächliche Ankunft gesetzt), aber das Spiel zählt erst bei der Abfahrt
      // weiter: dann gilt schon der nächste Abschnitt (Halt mit Abfahrt) bzw. an der Endhaltestelle „Angekommen“
      const arrivedHere = Number(line.stages[cur].arrA) > 0;
      const arrivedEnd = arrivedHere && cur + 1 >= line.stages.length;
      const ci = arrivedHere && !arrivedEnd ? cur + 1 : cur;
      const st = line.stages[ci];
      const atStop = !arrivedEnd && !(Number(st.depA) > 0) && Number(st.dep) > 0;
      const now = t.gameTimeMin > 0 ? t.gameTimeMin : 0;
      const pill = (cls, txt) => `<em class="wb-pill ${cls}">${txt}</em>`;
      let label, name, time, state, pax = '';
      if (atStop) {
        const left = now ? Math.round(st.dep - now) : null;
        [label, name, time] = ['Abfahrt', st.from, when(st.dep)];
        state = left == null ? '' : left > 0 ? pill('wait', `${left} Min.`) : left === 0 ? pill('ok', 'jetzt') : pill('late', `+${-left} Min.`);
        const off = ci > 0 ? Number(line.stages[ci - 1].off) || 0 : 0;
        pax = [st.on ? `+${st.on}` : '', off ? `−${off}` : ''].filter(Boolean).join(' ');
      } else if (arrivedEnd) {
        const late = st.arr > 0 ? Math.round(Number(st.arrA) - st.arr) : null;
        [label, name, time] = ['Angekommen', st.to, when(Number(st.arrA))];
        state = late == null ? '' : late > 0 ? pill('late', `+${late} Min.`) : late < 0 ? pill('early', `−${-late} Min.`) : pill('ok', 'pünktlich');
        pax = st.off ? `−${st.off}` : '';
      } else {
        const late = forecast > 0 && st.arr > 0 && ci === cur ? Math.round(forecast - st.arr) : null; // Vorhersage gilt für Abschnitt cur
        [label, name, time] = ['Nächster Halt', st.to, when(st.arr)];
        state = late == null ? '' : late > 0 ? pill('late', `+${late} Min.`) : late < 0 ? pill('early', `−${-late} Min.`) : pill('ok', 'pünktlich');
      }
      const after = arrivedEnd ? null : atStop ? st : line.stages[ci + 1];
      // Fortschritt der Linie: welcher Halt (ohne den Start) – am Start „Start“
      const total = line.stages.length;
      const k = arrivedEnd ? total : atStop ? ci : ci + 1;
      const progress = k > 0 ? `Halt ${k} von ${total}` : 'Linienstart';
      // fürs Kombiinstrument (10a-kombi.js → cluster.js, Widget-Stapel): dasselbe als Text
      const stateText = state.replace(/<[^>]+>/g, '');
      // Art der Abweichung (late/early/ok/wait) für die Farbe; Rahmen orange erst ab 5 Min. Verspätung
      const kind = (/class="wb-pill (\w+)"/.exec(state) || [])[1] || '';
      const lateMin = kind === 'late' ? Number((/\d+/.exec(stateText) || [0])[0]) : 0;
      busClusterNow = { label, name: latin(name || ''), time, delta: stateText, kind, progress, level: lateMin >= 5 ? 'warn' : '',
        after: after && !atStop ? latin(after.to || '') : '', afterTime: after && !atStop ? when(after.arr) : '', aboard: arrivedEnd ? 0 : aboard };
      html('wj-bus', JSON.stringify([label, name, time, state, pax, aboard, after?.to, after?.arr, progress, t.gameTimeMin > 0 ? day(t.gameTimeMin) : 0]),
        `<div class="widget-title">${badge('job', 'purple')}Buslinie<span class="wb-aboard">${aboard > 0 && !arrivedEnd ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm7.5 0a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM9 13c-4 0-7 2-7 4.5V20h14v-2.5C16 15 13 13 9 13zm7.5 0c-.6 0-1.2.05-1.7.15C16.6 14.3 18 15.8 18 17.5V20h4v-2.5c0-2.5-2.5-4.5-5.5-4.5z"/></svg>${aboard}` : ''}</span></div>
        <div class="wb-main">
          <div class="wb-label"><span>${label}</span><span class="wb-progress">${progress}</span></div>
          <div class="wb-stop">${escape(latin(name || ''))}</div>
          <div class="wb-time"><b>${escape(time)}</b>${state}${pax ? `<small class="wb-pax">${pax}</small>` : ''}</div>
        </div>
        ${after ? `<div class="wb-then"><span>Dann</span><b>${escape(latin(after.to || ''))}</b><small>${escape(when(after.arr))}</small></div>` : ''}`);
      busAnnounce(line, ci, atStop, arrivedEnd, t);
      // Auftrags-App bei Buslinien (wie Bus und Bahn in Apple Karten): oben groß, wo der Bus gerade ist, darunter alle Halte
      // als Zeitleiste – Planzeit, darunter tatsächliche bzw. vorhergesagte Zeit, Abweichung, Ein-/Aussteiger
      const pillOf = (d) => (d == null ? '' : d > 0 ? `<em class="late">+${d} Min.</em>` : d < 0 ? `<em class="early">−${-d} Min.</em>` : '<em class="ok">pünktlich</em>');
      const rows = stops.map((s) => {
        const row = arrivedEnd ? (s.idx === stops.length - 1 ? 'here' : 'done')
          : atStop ? (s.idx < ci ? 'done' : s.idx === ci ? 'here' : s.idx === ci + 1 ? 'next' : '')
            : (s.idx <= ci ? 'done' : s.idx === ci + 1 ? 'next' : '');
        // tatsächliche Zeit; für den nächsten Halt unterwegs die Vorhersage (gilt für Abschnitt cur)
        const second = s.actual > 0 ? s.actual : row === 'next' && !atStop && ci === cur ? forecast : 0;
        const d = second > 0 && s.time > 0 ? Math.round(second - s.time) : null;
        // Ein-/Aussteiger mit Pfeilen statt „+34 −15“
        const pax = (s.on ? `<span class="in">↑${s.on}</span>` : '') + (s.off ? `<span class="out">↓${s.off}</span>` : '');
        // Zeit einzeilig; klein darunter die tatsächliche/vorhergesagte Zeit, wenn sie abweicht, sonst ein anderer Tag
        const weekday = s.time > 0 && t.gameTimeMin > 0 && day(s.time) !== day(t.gameTimeMin) ? dayClock(s.time).slice(0, -clock(s.time).length).trim() : '';
        const sub = d ? clock(second) : weekday;
        return `<div class="jb-row ${row}"><span class="jb-time"><b>${s.time > 0 ? escape(clock(s.time)) : '–'}</b>${sub ? `<small>${escape(sub)}</small>` : ''}</span><i></i>`
          + `<span class="jb-name"><b>${escape(latin(s.name || ''))}</b>${pillOf(d)}</span><small class="jb-pax">${pax}</small></div>`;
      });
      const nowLabel = arrivedEnd ? 'Angekommen in' : atStop ? 'Am Halt' : 'Unterwegs nach';
      html('job-stops', JSON.stringify([ci, atStop, arrivedEnd, stops.map((s) => [s.name, s.time, s.actual, s.on, s.off]), forecast, time, state, t.gameTimeMin > 0 ? day(t.gameTimeMin) : 0]),
        `<div class="jb-now"><small>${nowLabel}</small><b>${escape(latin(name || ''))}</b>`
        + `<span class="jb-sub"><span>${atStop ? 'Abfahrt' : 'Ankunft'}</span> <span>${escape(time)}</span>${state}</span></div>`
        + `<div class="jb-stops">${rows.join('')}</div>`);
      // rechte Spalte: Fortschritt, Fahrgäste, Pünktlichkeit bisher (Mittel der erreichten Halte)
      const reached = stops.filter((s) => s.idx > 0 && s.actual > 0 && s.time > 0);
      const avg = reached.length ? Math.round(reached.reduce((a, s) => a + (s.actual - s.time), 0) / reached.length) : null;
      text('bus-progress', progress);
      // unter „noch … km“ (bis zur Endhaltestelle): Strecke und Zeit bis zum nächsten Halt – unterwegs, nicht am letzten Abschnitt
      const showNext = !atStop && !arrivedEnd && ci === cur && nextStop && !nextStop.last;
      for (const el of nodes('bus-next')) setHidden(el, !showNext);
      if (showNext) {
        html('bus-next', `${name}|${Math.round(nextStop.km * 10)}|${Math.round(nextStop.min)}`,
          `<span>Nächster Halt</span><b>${escape(latin(name || ''))}</b><span>${escape(`${distance(nextStop.km)} · ${duration(nextStop.min)}`)}</span>`);
      }
      text('bus-aboard', aboard > 0 && !arrivedEnd ? String(aboard) : '–');
      text('bus-punct', avg == null ? '–' : avg === 0 ? 'pünktlich' : `Ø ${avg > 0 ? '+' : '−'}${Math.abs(avg)} Min.`);
      for (const el of nodes('bus-punct-row')) setHidden(el, avg == null); // erst nach dem ersten erreichten Halt
      // neuer Abschnitt oder am Halt angekommen: das Widget im Stapel nach vorn holen
      const key = `${line.stages[0].from}|${ci}|${atStop}|${arrivedEnd}`;
      if (key !== busWidgetKey) {
        if (settings.stackJump) surfaceWidget('job'); // auch beim Start der Linie (liegt das Widget schon im Stapel)
        busWidgetKey = key;
      }
    } else {
      busWidgetKey = '';
      busClusterNow = null;
    }
    for (const el of nodes('wj-bus')) setHidden(el, !line);
    for (const el of nodes('job-bus-side')) setHidden(el, !line);
    if (!line) for (const el of nodes('bus-next')) setHidden(el, true);
    text('job-title', line ? 'Buslinie' : 'Auftrag');
    setBusDashboard(!!line);
    text('cargo-meta', t.hasJob && t.cargoMassKg > 0 && !bus ? `${mass(t.cargoMassKg)}${t.cargoLoaded === false ? ' · noch nicht geladen' : ''}` : '');
    const jobCost = jobCosts(t);
    text('job-costs', t.hasJob ? (jobCost ? signedMoney(-jobCost) : money(0)) : '–');
    text('job-net', t.hasJob ? money(t.income - jobCost) : '–');
    for (const el of nodes('bus-net-row')) setHidden(el, !jobCost); // Bus: „Bleibt“ nur, wenn es Kosten gab (sonst = Lohn)
    text('deadline-at', t.hasJob ? dayClockU(t.deliveryTimeMin) : '–');
    const buffer = t.hasJob && navigating && t.navTimeMin > 0 ? t.deliveryTimeMin - (t.gameTimeMin + t.navTimeMin) : null;
    text('job-buffer', buffer == null ? '–' : buffer >= 0 ? duration(buffer) : `${duration(-buffer)} zu spät`);
    toggle('job-buffer', 'late', buffer != null && buffer < 0);
    updateRestStop(t);
    text('from', t.hasJob ? latin(t.sourceCity) : '–');
    text('to', t.hasJob ? latin(t.destinationCity) : '–');
    text('income', t.hasJob ? money(t.income) : '–');
    text('planned', t.hasJob && t.plannedKm ? distance(t.plannedKm) : '–');
    const left = t.deliveryTimeMin - t.gameTimeMin;
    text('deadline', t.hasJob ? (left > 0 ? `noch ${duration(left)}` : 'überfällig') : '–');
    toggle('deadline', 'late', t.hasJob && left <= 0);
    text('cargo-damage', t.hasJob ? percent(num(t.cargoDamage)) : '–');
    const remaining = navigating ? t.navDistanceKm : 0;
    text('job-left', t.hasJob ? (navigating ? `noch ${distance(remaining)}` : 'Ziel im Navi setzen') : 'Kein Auftrag');
    width('job-bar', t.hasJob && t.plannedKm > 0 && navigating ? 1 - remaining / t.plannedKm : 0);
    text('job-eta', t.hasJob && navigating && t.navTimeMin > 0 ? `Ankunft ${dayClock(t.gameTimeMin + t.navTimeMin)}` : '–');
    const late = t.hasJob && navigating && t.gameTimeMin + t.navTimeMin > t.deliveryTimeMin;
    text('job-status', !t.hasJob || !navigating ? '' : late ? 'zu spät' : 'pünktlich');
    toggle('job-status', 'bad', late);
    toggle('job-status', 'good', t.hasJob && navigating && !late);
    text('rest', t.restStopMin > 0 ? duration(t.restStopMin) : 'jetzt');

    checkWarnings(t);
    dispatcherOnTelemetry(t);
    updateVideoCover(t);
    updateMirror(t);
    if (screen === 'logbook' || dashboardWidgets().includes('trip')) updateTrip();
  }

  function trackSession(t) {
    const now = performance.now();
    if (!session.started) {
      Object.assign(session, { started: true, odo0: num(t.odometerKm), lastAt: now, lastFuel: t.fuel });
      return;
    }
    const dt = Math.min(1, (now - session.lastAt) / 1000);
    session.lastAt = now;
    if (!t.paused && t.speedKmh > 2) session.driveSec += dt;
    if (session.lastFuel != null) {
      const used = session.lastFuel - t.fuel;
      if (used > 0 && used < 2) session.fuelUsed += used; // Tanken (Anstieg) zählt nicht
    }
    session.lastFuel = t.fuel;
    session.maxSpeed = Math.max(session.maxSpeed, t.speedKmh || 0);
  }

  // Fahrzeug-App: rechte Karte zeigt Zugmaschine oder Anhänger
  let truckPart = 'truck';
  // Bus erkennen: Marke/Modell typischer Reise- und Linienbusse oder Fahrgäste als Fracht, und kein Auflieger
  let busMode = false;
  const BUS_NAME = /\b(bus|coach|tourismo|travego|tourrider|setra|neoplan|irizar|citaro|intouro|tourliner|cityliner|skyliner|van hool|vdl futura|bova|ikarus|solaris|crossway|evadys|lion'?s coach|tourino|integro|interlink)\b/i;
  const BUS_CARGO = /passag|fahrgast|fahrgäste|reisend|touris/i;
  // Auto aus ATS „Road Trip“ (def/vehicle/car: Bronco, F-150, Mustang, Crown Victoria). Nur diese Kennungen – die Marke
  // allein reicht nicht (Lkw-Mods wie der Ford F-Max in ETS2); ohne Kennung (Plugin vor 1.9.3) nur in ATS nach Marke
  let carMode = false;
  const CAR_IDS = /^(vehicle\.)?ford\.(bronco_24|f150_23|mustang_67|victoria_06)$/i;
  const isCar = (t) => !!t && (t.truckId ? CAR_IDS.test(t.truckId) : isAts() && /^ford$/i.test(t.truckBrand || ''));
  // Busse aus dem Bus-DLC von ETS2 (def/vehicle/bus, 12.11.2026): Scania Touring und Volvo 9700 tragen kein Bus-Wort im Namen
  const BUS_IDS = /^(vehicle.)?(man.lions_24|scania.touring_23|volvo.9700_23)$/i;
  function isBus(t) {
    if (!t) return false;
    if (BUS_IDS.test(t.truckId || '')) return true;
    if (BUS_NAME.test(`${t.truckBrand || ''} ${t.truckName || ''}`)) return true;
    return !!t.hasJob && !t.hasTrailer && BUS_CARGO.test(t.cargo || '');
  }

  // Buslinie (Bus-DLC, Plugin ab 1.12.5): { line, cur } – cur ist die gerade gefahrene Etappe; null ohne Buslinie
  // Ansagen wie im Bus (Einstellung busVoice): beim Losfahren „Nächster Halt: …“, etwa 500 m vorher „Wir erreichen gleich …“.
  // Nur bei einem beobachteten Wechsel – nicht bei jedem Start der App mitten in der Fahrt
  let busVoiceState = null; // { line, ci, atStop, near }
  function busAnnounce(line, ci, atStop, arrivedEnd, t) {
    const id = `${line.stages[0].from}|${line.stages[line.stages.length - 1].to}`;
    const prev = busVoiceState && busVoiceState.line === id ? busVoiceState : null;
    const st = line.stages[ci];
    const last = ci === line.stages.length - 1;
    const state = { line: id, ci, atStop, near: !!(prev && prev.ci === ci && prev.near), due: !!(prev && prev.ci === ci && prev.due) };
    const name = latin(st.to || '');
    if (settings.busVoice && prev && !arrivedEnd && !atStop && name) {
      // „Nächster Halt“ erst, wenn der Bus wirklich fährt: das Spiel meldet die Abfahrt schon beim Schließen der Türen
      // (Rückmeldung 15.11.: kam zu früh, noch am Halt) – vorgemerkt, gesprochen ab 10 km/h
      if (prev.atStop || prev.ci !== ci) state.due = true;
      if (state.due && Number(t?.speedKmh) >= 10) {
        state.due = false;
        speak(`Nächster Halt: ${name}.`, undefined, { pa: true }); // als Durchsage (Gong, Bus-Lautsprecher)
      } else if (!state.due && !state.near && typeof CarMap !== 'undefined' && CarMap.routeStop) {
        // Endhaltestelle = Navi-Ziel: Rest der Route aus der Telemetrie (braucht keine gefundene Haltestelle auf der Karte)
        // Endhaltestelle = Navi-Ziel: Rest der Kartenroute; ohne gefundene Haltestelle aus dem Spiel-Navi, umgerechnet von
        // gestauchten Spielmetern in echte Meter (worldScale, wie rs.along)
        const rs = CarMap.routeStop(st.toId || '', st.to || '');
        const dist = !last ? (rs ? rs.along : null) : rs ? rs.remaining : t && t.navDistanceKm > 0 ? (t.navDistanceKm * 1000) / worldScale : null;
        if (dist != null && dist > 0 && dist < 500) {
          state.near = true;
          speak(last ? `Wir erreichen gleich unsere Endhaltestelle ${name}. Bitte alle aussteigen.` : `Wir erreichen gleich ${name}.`, undefined, { pa: true });
        }
      }
    }
    busVoiceState = state;
  }
  let busWidgetKey = '';
  let busClusterNow = null; // Fahrerdisplay als Text fürs Kombiinstrument: { label, name, side, progress, level } oder null // Linie|Abschnitt|am Halt – Wechsel holt das Fahrerdisplay im Widget-Stapel nach vorn
  // Einstellungen „Durchsage testen“: nächster Halt der laufenden Linie (sonst ein Beispiel), mit Gong und Bus-Klang
  function busAnnounceTest() {
    const b = busLine(telemetry);
    const name = b ? latin(b.line.stages[b.cur].to || '') : '';
    speak(`Nächster Halt: ${name || 'Hauptbahnhof'}.`, undefined, { pa: true });
  }
  function busLine(t) {
    const line = t && t.hasJob && t.bus && Array.isArray(t.bus.stages) && t.bus.stages.length ? t.bus : null;
    return line ? { line, cur: Math.max(0, Math.min(line.stages.length - 1, Number(line.current) || 0)) } : null;
  }
  // Nächster Halt der Buslinie mit Strecke und Fahrzeit dorthin. Die Spiel-Route führt durch alle Halte bis zur
  // Endhaltestelle, Restzeit und -strecke des Spiels gelten also fürs Ende: Lage des Halts aus der Karte (Haltestelle an
  // der Route), Strecke und Zeit anteilig. { name, km, min, planned, last, along } oder null (ohne Route/Karte/Haltestelle)
  function busNextStop(t) {
    const b = busLine(t);
    if (!b || !(t.navDistanceKm > 0.05) || !(t.navTimeMin > 0)) return null;
    const stage = b.line.stages[b.cur];
    const last = b.cur === b.line.stages.length - 1;
    if (last) return { name: stage.to, km: t.navDistanceKm, min: t.navTimeMin, planned: Number(stage.arr) || 0, last, along: t.navDistanceKm * 1000 };
    const s = typeof CarMap !== 'undefined' && CarMap.routeStop ? CarMap.routeStop(stage.toId || '', stage.to || '') : null;
    if (!s || !(s.remaining > 50) || s.along < -100) return null;
    const share = Math.max(0, Math.min(1, s.along / s.remaining));
    return { name: stage.to, km: t.navDistanceKm * share, min: t.navTimeMin * share, planned: Number(stage.arr) || 0, last, along: Math.max(0, s.along) };
  }
  const TRAILER_BODY = { curtainside: 'Planenauflieger', dryvan: 'Kofferauflieger', refrigerated: 'Kühlauflieger', insulated: 'Isolierauflieger', flatbed: 'Pritsche', lowbed: 'Tieflader', lowloader: 'Tieflader', tank: 'Tankauflieger', dumper: 'Kipper', container: 'Container', livestock: 'Viehtransporter', log: 'Holztransporter', car_transporter: 'Autotransporter', gooseneck: 'Schwanenhals', silo: 'Silo', chemtank: 'Chemietank', foodtank: 'Lebensmitteltank', gastank: 'Gastank', fueltank: 'Tankauflieger', overweight: 'Schwertransport' };

  const JOB_MARKETS = { cargo_market: 'Ladungsmarkt', freight_market: 'Frachtmarkt', quick_job: 'Schnellauftrag', external_contracts: 'World of Trucks', external_market: 'World of Trucks' };

  // Kosten unterwegs (Maut, Strafen, Fähre, Zug) seit Beginn des aktuellen Auftrags – bleibt über Neustarts erhalten
  let jobLedger = null;
  try { jobLedger = JSON.parse(localStorage.getItem('jobLedger') || 'null'); } catch {}
  let lastDelivery = '';
  try { lastDelivery = localStorage.getItem('lastDelivery') || ''; } catch {}
  function jobCosts(t) {
    if (!t.hasJob) return 0;
    const key = `${t.cargo}|${t.sourceCity}|${t.destinationCity}|${t.deliveryTimeMin}`;
    let changed = false;
    if (!jobLedger || jobLedger.key !== key) {
      jobLedger = { key, start: t.gameTimeMin, costs: {} };
      changed = true;
    }
    for (const e of allEvents.values()) {
      if (!(e.amount < 0) || e.gameTimeMin < jobLedger.start || String(e.type).startsWith('job.')) continue;
      const id = `${e.gameTimeMin}|${e.type}|${e.amount}`;
      if (jobLedger.costs[id] == null) {
        jobLedger.costs[id] = -e.amount;
        changed = true;
      }
    }
    if (changed) try { localStorage.setItem('jobLedger', JSON.stringify(jobLedger)); } catch {}
    return Object.values(jobLedger.costs).reduce((a, b) => a + b, 0);
  }

  // Rastplatz passend zur Lenkzeit: der letzte an der Route, der vor Ablauf der Lenkzeit noch erreichbar ist
  let restStopAt = 0;
  let restPick = null;
  function findRestStop(t) {
    const p = pose.current();
    if (!p || !CarMap.routeActive() || !(t.restStopMin > 0)) return null;
    const minPerKm = t.navDistanceKm > 1 && t.navTimeMin > 0 ? t.navTimeMin / t.navDistanceKm : 60 / 75;
    const found = [];
    for (const [, x, y] of CarMap.poisNear(['p'], p.x, p.z, 250000)) {
      const along = CarMap.routeAhead(x, y, 220);
      if (along != null && along > 300) found.push({ x, y, along, mins: (gameMeters(along) / 1000) * minPerKm });
    }
    if (!found.length) return null;
    found.sort((a, b) => a.along - b.along);
    const reachable = found.filter((f) => f.mins <= t.restStopMin - 5);
    const f = reachable.length ? reachable[reachable.length - 1] : found[0];
    const city = CarMap.nearestCity(f.x, f.y);
    return { ...f, late: !reachable.length, name: `Rastplatz${city ? ` ${city.d < 4000 ? 'in' : 'bei'} ${city.name}` : ''}` };
  }
  function updateRestStop(t) {
    const now = performance.now();
    if (now - restStopAt < 3000) return;
    restStopAt = now;
    restPick = findRestStop(t);
    text('rest-stop', !(t.restStopMin > 0) ? 'Jetzt Pause machen – nächster Parkplatz' : restPick
      ? `${restPick.name} · ${distance(gameMeters(restPick.along) / 1000)} · ${clockU(t.gameTimeMin + restPick.mins)}${restPick.late ? ' (knapp)' : ''}`
      : CarMap.routeActive() ? 'Kein Rastplatz an der Route gefunden' : 'Ziel im Navi setzen für einen Vorschlag');
  }

  function trackEvents(t) {
    if (!Array.isArray(t.events)) return;
    const fresh = [];
    for (const e of t.events) {
      if (allEvents.has(e.id)) continue;
      allEvents.set(e.id, e);
      fresh.push(e);
    }
    if (!fresh.length) {
      eventsPrimed = true;
      return;
    }
    // Beim ersten Datenpaket nur übernehmen – keine Flut alter Meldungen
    if (eventsPrimed) {
      for (const ev of fresh) {
        dispatcherOnEvent(ev);
        learnCamera(ev);
      }
      const e = fresh[0];
      if (settings.stackJump) surfaceWidget('messages');
      const [icon, color, title] = EVENT_LOOK[e.type] || ['messages', 'gray', 'Mitteilung'];
      let detail = e.text + (e.amount ? ` · ${signedMoney(e.amount)}` : '');
      if (e.type === 'job.delivered') {
        const parts = [signedMoney(e.amount), e.xp ? `${e.xp} XP` : '', e.km ? distance(e.km) : '', e.damage > 0.005 ? `Schaden ${percent(e.damage)}` : ''].filter(Boolean);
        detail = `Geliefert · ${parts.join(' · ')}`;
        lastDelivery = `${parts.join(' · ')} (${dayClock(e.gameTimeMin)})`;
        try { localStorage.setItem('lastDelivery', lastDelivery); } catch {}
      }
      showToast({ icon, color, title, text: detail, open: String(e.type).startsWith('job.') ? 'job' : 'messages', kind: String(e.type).startsWith('job.') ? 'Jobs' : 'Money' });
    }
    eventsPrimed = true;
    renderLists();
  }

  // Kontrollleuchten wie im Kombiinstrument (Plugin ab 1.7): nur was gerade an ist. Ältere Plugins liefern die
  // Felder nicht – dann bleibt die Leiste leer.
  // Warnlampen zählen nur bei laufendem Motor: mit Zündung ohne Motor leuchten Öl und Batterie im Spiel immer
  const truckRunning = (t) => t?.available && !t.paused && t.engine !== false && t.electric !== false;
  const PSI_TO_BAR = 0.0689476;
  function truckLamps(t) {
    if (!t?.available) return '';
    const w = t.warn || {};
    const run = truckRunning(t);
    const lamps = [
      [t.blinkerLeft && !t.hazard, 'green blink', '◀ Blinker'],
      [t.blinkerRight && !t.hazard, 'green blink', 'Blinker ▶'],
      [t.hazard, 'red blink', 'Warnblinker'],
      [lightsOn() && !t.highBeam, 'green', gameAutoLights && !t.lowBeam ? 'Licht (Auto)' : 'Licht'],
      [t.highBeam, 'blue', 'Fernlicht'],
      [t.beacon, 'orange', 'Rundumleuchte'],
      [t.wipers, 'gray', 'Wischer'],
      [num(t.retarder) > 0, 'gray', `Retarder ${t.retarder}`],
      [run && (w.air || w.airEmergency), 'red', `Bremsdruck ${(num(t.airPressure) * PSI_TO_BAR).toFixed(1).replace('.', ',')} bar`],
      [run && w.oil, 'red', 'Öldruck'],
      [run && w.water, 'red', 'Motor heiß'],
      [run && w.battery, 'orange', 'Batterie'],
      [w.adblue, 'orange', 'AdBlue'],
      [w.fuel, 'orange', 'Tank'],
    ];
    return lamps.filter(([on]) => on).map(([, cls, label]) => `<span class="lamp ${cls}">${escape(label)}</span>`).join('');
  }

  function warningsFor(t) {
    const out = [];
    // Warnlampen des Spiels als Mitteilung – nur während der Fahrt (beim Motorstart baut sich der Bremsdruck erst auf)
    const w = t.warn || {};
    if (truckRunning(t) && num(t.speedKmh) > 5) {
      if (w.air || w.airEmergency) out.push({ id: 'air', icon: 'warning', color: 'red', title: w.airEmergency ? 'Bremsdruck kritisch' : 'Bremsdruck niedrig', text: `${(num(t.airPressure) * PSI_TO_BAR).toFixed(1).replace('.', ',')} bar – anhalten und Druck aufbauen lassen`, open: 'truck' });
      if (w.oil) out.push({ id: 'oil', icon: 'warning', color: 'red', title: 'Öldruck zu niedrig', text: 'Motor schonen, Werkstatt anfahren', open: 'truck' });
      if (w.water) out.push({ id: 'water', icon: 'warning', color: 'red', title: 'Motor überhitzt', text: `Kühlwasser ${Math.round(num(t.waterTemp))} °C`, open: 'truck' });
      if (w.battery) out.push({ id: 'battery', icon: 'warning', color: 'orange', title: 'Batterie lädt nicht', text: `${num(t.batteryVoltage).toFixed(1).replace('.', ',')} V`, open: 'truck' });
    }
    if (w.adblue) out.push({ id: 'adblue', icon: 'fuel', color: 'orange', title: 'AdBlue fast leer', text: t.adblueCapacity > 0 ? volume(t.adblue) : 'Bald nachfüllen', open: 'stops' });
    const fuel = t.fuelCapacity > 0 ? t.fuel / t.fuelCapacity : 1;
    if (fuel < 0.15) out.push({ id: 'fuel', icon: 'fuel', color: 'orange', title: 'Tank fast leer', text: t.fuelRangeKm > 0 ? `Reichweite ${distance(t.fuelRangeKm)}` : 'Bald tanken', open: 'stops' });
    if (t.restStopMin <= 0) out.push({ id: 'rest-now', icon: 'rest', color: 'red', title: 'Pause fällig', text: 'Rastplatz anfahren', open: 'stops' });
    else if (t.restStopMin <= 60) out.push({ id: 'rest', icon: 'rest', color: 'orange', title: 'Pause bald nötig', text: `in ${duration(t.restStopMin)}${restPick ? ` · ${restPick.name}, ${distance(gameMeters(restPick.along) / 1000)}` : ''}`, open: 'job' });
    const wear = Math.max(num(t.wearEngine), num(t.wearTransmission), num(t.wearCabin), num(t.wearChassis), num(t.wearWheels));
    if (wear >= 0.15) out.push({ id: 'wear', icon: 'service', color: 'orange', title: 'Werkstatt empfohlen', text: `Zustand ${percent(1 - wear)}`, open: 'truck' });
    if (t.hasJob && t.deliveryTimeMin - t.gameTimeMin <= 0) out.push({ id: 'late', icon: 'clock', color: 'red', title: 'Lieferfrist überschritten', text: latin(t.destinationCity), open: 'job' });
    // Nach Spiel-Updates: Plugin findet Kamera/Route im Spielspeicher nicht mehr (Muster passen nicht zur neuen Version)
    const r = t.reader;
    if (r && (!r.camera || !r.route || r.off)) {
      const missing = [!r.camera || r.off ? 'Kamera (Direkt-Touch)' : '', !r.route || r.off ? 'Navi-Route' : '', !r.truck || r.off ? 'Ampeln' : ''].filter(Boolean);
      out.push({ id: 'reader', always: true, icon: 'warning', color: 'orange', title: 'Spiel-Update erkannt?', text: `Nicht lesbar: ${missing.join(', ')} – bitte CabPlay aktualisieren`, open: 'settings' });
    }
    if (t.hasJob && num(t.cargoDamage) >= 0.05) out.push({ id: 'cargo', icon: 'job', color: 'orange', title: 'Ladung beschädigt', text: percent(t.cargoDamage), open: 'job' });
    return out;
  }

  let currentWarnings = [];
  function checkWarnings(t) {
    const next = warningsFor(t);
    const ids = new Set(next.map((w) => w.id));
    if (!warningsPrimedAt) warningsPrimedAt = performance.now();
    for (const w of next) {
      if (activeWarnings.has(w.id)) continue;
      activeWarnings.add(w.id);
      if (w.always || performance.now() - warningsPrimedAt > 4000) showToast({ ...w, kind: w.id === 'reader' ? 'System' : 'Warnings' });
    }
    for (const id of [...activeWarnings]) if (!ids.has(id)) activeWarnings.delete(id);
    const key = next.map((w) => w.id + w.text).join('|');
    if (key !== currentWarnings.key) {
      currentWarnings = next;
      currentWarnings.key = key;
      renderLists();
    }
  }

  function tripTotals() {
    let income = 0;
    let costs = 0;
    let jobs = 0;
    let fines = 0;
    for (const e of allEvents.values()) {
      if (e.amount > 0) income += e.amount;
      else costs -= e.amount;
      if (e.type === 'job.delivered') jobs++;
      if (e.type === 'player.fined') fines++;
    }
    const t = telemetry || {};
    const km = session.started ? Math.max(0, num(t.odometerKm) - session.odo0) : 0;
    return { income, costs, jobs, fines, km };
  }

  function updateTrip() {
    const totals = tripTotals();
    text('trip-km', distance(totals.km) === '–' ? '0 km' : distance(totals.km));
    text('trip-time', duration(session.driveSec / 60) === '–' ? '0 Min.' : duration(session.driveSec / 60));
    text('trip-money', signedMoney(totals.income - totals.costs) || money(0));
    if (screen === 'logbook' && logTab === 'session') renderLogbook(totals);
  }

  function renderLogbook(totals = tripTotals()) {
    renderLogbookTabs();
    if (logTab !== 'session') return renderTripsTab();
    const t = telemetry || {};
    const hours = session.driveSec / 3600;
    const tile = (label, value, icon, color) => `<div class="log-tile">${badge(icon, color)}<small>${label}</small><b>${escape(value)}</b></div>`;
    list('logbook', '<div class="log-grid">' + [
      tile('Gefahren', totals.km > 0 ? distance(totals.km) : '0 km', 'turn-straight', 'blue'),
      tile('Fahrzeit', session.driveSec > 30 ? duration(session.driveSec / 60) : '–', 'clock', 'indigo'),
      tile('Ø Tempo', hours > 0.01 ? `${spd(totals.km / hours)} ${spdUnit()}` : '–', 'truck', 'orange'),
      tile('Höchsttempo', session.maxSpeed > 1 ? `${spd(session.maxSpeed)} ${spdUnit()}` : '–', 'truck', 'red'),
      tile('Sprit verbraucht', session.fuelUsed > 0.5 ? volume(session.fuelUsed) : '–', 'fuel', 'teal'),
      tile('Ø Verbrauch', t.fuelAverage > 0 ? consumption(t.fuelAverage) : '–', 'fuel', 'green'),
      tile('Einnahmen', money(totals.income), 'delivered', 'green'),
      tile('Ausgaben', money(totals.costs), 'toll', 'yellow'),
      tile('Aufträge', String(totals.jobs), 'job', 'purple'),
      tile('Strafen', String(totals.fines), 'fine', 'red'),
      // in Meilen wie die Fahrzeug-App (vorher immer km, auch in ATS mit Meilen)
      tile('Kilometerstand', t.odometerKm > 0 ? `${Math.round(imperial() ? t.odometerKm * 0.621371 : t.odometerKm).toLocaleString('de-DE')} ${imperial() ? 'mi' : 'km'}` : '–', 'logbook', 'gray'),
      tile('Bilanz', signedMoney(totals.income - totals.costs) || money(0), 'logbook', 'yellow'),
    ].join('') + '</div>');
  }

  // ------------------------------------------------------------------ Listen
  function messageRow(m, attrs = '') {
    return `<div class="list-row" ${attrs}>${badge(m.icon, m.color)}<div class="lr-text"><b>${escape(m.title)}</b><small>${escape(m.text)}</small></div>${m.right ? `<span class="lr-right ${m.rightClass || ''}">${escape(m.right)}</span>` : ''}</div>`;
  }

  function messageItems() {
    const items = currentWarnings.map((w) => ({ ...w, right: 'jetzt', rightClass: 'muted' }));
    const events = [...allEvents.values()].sort((a, b) => b.id - a.id);
    for (const e of events) {
      const [icon, color] = EVENT_LOOK[e.type] || ['messages', 'gray'];
      items.push({ icon, color, title: e.text, text: dayClock(e.gameTimeMin), right: signedMoney(e.amount), rightClass: e.amount > 0 ? 'good' : 'bad' });
    }
    for (const m of chat.slice(0, 20)) items.push({ icon: 'message', color: 'green', title: 'Disponent', text: m.text, right: clock(m.at), rightClass: 'muted' });
    return items;
  }

  function renderLists() {
    const items = messageItems();
    const empty = (textValue) => `<div class="list-empty">${escape(textValue)}</div>`;
    list('messages', items.length ? items.map((m) => messageRow(m)).join('') : empty('Keine Mitteilungen – Strafen, Maut, Fähren und gelieferte Aufträge erscheinen hier.'));
    list('messages-mini', items.length ? items.slice(0, 3).map((m) => messageRow(m)).join('') : empty('Keine Mitteilungen'));
    renderStops();
    renderHistory();
    renderAgenda();
    renderChat();
    renderWeather();
    if (screen === 'logbook') renderLogbook();
  }

  // ------------------------------------------------------------------ Fahrtenbuch: Fahrten mit Strecke (optional)
  // Die Aufzeichnung macht der Hauptprozess (main/trips.js, Einstellung „Fahrten aufzeichnen“, ab Werk aus). Hier: die
  // Reiter Sitzung / Fahrten / Länder der Fahrtenbuch-App, die Mini-Karte einer Fahrt und die Kartenebene „Alle
  // gefahrenen Strecken“.
  let tripsData = null; // { trips, open, points }
  let tripTrack = null; // Float32Array x, z (NaN trennt Abschnitte)
  let tripsLoading = null;
  let tripsLoadedAt = 0;
  let logTab = 'session';
  let tripShown = null; // id der geöffneten Fahrt
  let tripCountryCache = new Map(); // id → [{ country, km }] (Länder je Fahrt, einmal berechnet)
  let tripsClearArmed = 0; // „Fahrtenbuch löschen“ einmal angetippt (zweites Tippen löscht)
  let tripDeleteArmed = 0; // Fahrt löschen: id der einmal angetippten Fahrt
  let tripDeleteTimer = 0;
  let tripAheadSeen = ''; // schon gemeldete Fahrten nach dem Spielstand

  function loadTrips() {
    if (!api?.tripsList) return Promise.resolve();
    if (tripsLoading) return tripsLoading;
    tripsLoadedAt = performance.now();
    tripsLoading = Promise.all([api.tripsList(), api.tripsTrack()])
      .then(([listed, track]) => {
        tripsData = listed || { trips: [], open: null, points: 0 };
        tripTrack = track instanceof Float32Array ? track : new Float32Array(0);
        // Länder abgeschlossener Fahrten bleiben gemerkt (ihre Punkte ändern sich nicht – nur Löschen leert)
        CarMap.setDriven(tripTrack);
        noticeTripsAhead();
        if (screen === 'logbook') renderLogbook();
      })
      .catch(() => {})
      .finally(() => (tripsLoading = null));
    return tripsLoading;
  }
  api?.onTrips?.(() => loadTrips());
  // Älterer Spielstand geladen: einmal melden, entschieden wird im Reiter Fahrten
  function noticeTripsAhead() {
    const key = (tripsData.ahead || []).join();
    if (key && key !== tripAheadSeen) {
      logTab = 'trips';
      tripShown = null;
      showToast({ icon: 'logbook', color: 'yellow', title: 'Älterer Spielstand geladen', text: 'Einige Fahrten liegen nach diesem Spielstand.', open: 'logbook' });
    }
    tripAheadSeen = key;
  }
  // Die Meldung des Hauptprozesses kann vor dem Laden der Seite kommen (App startet mit dem Spiel)
  setTimeout(() => {
    if (settings?.tracking && !tripsData) loadTrips();
  }, 20000);
  // Kartenebene eingeschaltet: Strecke einmal laden (neue Fahrten kommen über onTrips)
  setInterval(() => {
    if (settings?.mapDriven && !tripsData) loadTrips();
  }, 4000);

  const tripKm = (trip) => (trip.km != null ? trip.km : gameMeters(trip.dist || 0) / 1000);
  // Liter auf 100 km (erst ab 5 km, sonst wirkt Rangieren riesig); null ohne Messung (Fahrten vor 1.15.2)
  const tripL100 = (trip) => (trip.fuelUsed > 0 && tripKm(trip) >= 5 ? (trip.fuelUsed / tripKm(trip)) * 100 : null);
  // Verspätung in Spielminuten bei gelieferten Aufträgen mit Frist, sonst null
  const tripLate = (trip) => (trip.kind === 'job' && trip.status === 'delivered' && trip.deadline > 0 ? Math.max(0, trip.gameEnd - trip.deadline) : null);
  const kmText = (km) => (km > 0 ? distance(km) : imperial() ? '0 mi' : '0 km'); // distance(0) wäre „–“
  const tripTitle = (trip) => (trip.kind === 'job' ? `${trip.from || '?'} → ${trip.to || '?'}` : 'Freie Fahrt');
  const tripDate = (trip) => new Date(trip.startedAt).toLocaleDateString(CarI18n.lang === 'de' ? 'de-DE' : CarI18n.lang, { day: 'numeric', month: 'short' });
  const TRIP_STATUS = { delivered: 'Geliefert', cancelled: 'Abgebrochen', ended: 'Beendet', open: 'Läuft gerade' };

  // Länder einer Fahrt: Strecke zwischen den Punkten dem Land der nächsten Stadt zuordnen (alle 8 Punkte neu bestimmt)
  function tripCountries(trip) {
    if (tripCountryCache.has(trip.id)) return tripCountryCache.get(trip.id);
    const byCountry = new Map();
    if (tripTrack) {
      let country = null;
      let px = NaN;
      let pz = NaN;
      const end = Math.min(trip.p1, tripTrack.length / 2);
      for (let i = trip.p0, n = 0; i < end; i++, n++) {
        const x = tripTrack[i * 2];
        const z = tripTrack[i * 2 + 1];
        if (!Number.isFinite(x)) {
          px = NaN;
          continue;
        }
        if (!country || n % 8 === 0) country = CarMap.countryAt(x, z) || country;
        if (Number.isFinite(px) && country) {
          const key = country.iso || country.name;
          const e = byCountry.get(key) || { country, km: 0 };
          e.km += gameMeters(Math.hypot(x - px, z - pz)) / 1000;
          byCountry.set(key, e);
        }
        px = x;
        pz = z;
      }
    }
    const out = [...byCountry.values()].sort((a, b) => b.km - a.km);
    // merken nur mit Ergebnis: ohne geladene Ortsdaten (gleich nach dem Start) wäre es sonst für immer leer
    if (trip.status !== 'open' && out.length) tripCountryCache.set(trip.id, out);
    return out;
  }

  function tripRow(trip) {
    const net = (trip.income || 0) - (trip.costs || 0);
    const sub = [trip.kind === 'job' ? trip.cargo : '', kmText(tripKm(trip)), tripDate(trip), trip.status === 'open' ? TRIP_STATUS.open : trip.status === 'cancelled' ? TRIP_STATUS.cancelled : ''].filter(Boolean);
    // ohne Lieferung beendet (Aufzeichnung aus, Auftrag verschwunden): grau statt grünem Haken
    const [icon, color] = trip.kind !== 'job' ? ['route', 'gray'] : trip.status === 'cancelled' ? ['cancelled', 'red'] : trip.status === 'open' ? ['truck', 'blue']
      : trip.status === 'delivered' ? ['delivered', 'green'] : ['job', 'gray'];
    return `<button class="list-row trip-row ${trip.status === 'open' ? 'now' : ''}" data-focus data-trip="${trip.id}">${badge(icon, color)}
      <div class="lr-text"><b>${escape(tripTitle(trip))}</b><small>${escape(sub.join(' · '))}</small></div>
      ${trip.kind === 'job' && trip.status !== 'open' ? `<span class="lr-right ${net >= 0 ? 'good' : 'bad'}">${escape(signedMoney(net) || money(0))}</span>` : ''}
    </button>`;
  }

  // Aufzeichnung aus und noch nichts aufgezeichnet: kurz erklären, einschalten
  function tripsOffCard() {
    return `<div class="log-off">${badge('logbook', 'yellow')}<b>Fahrten aufzeichnen ist aus</b>
      <small>Schaltest du es ein, merkt sich CabPlay jede Fahrt mit Strecke: Aufträge von der Annahme bis zur Lieferung, Fahrten ohne Auftrag als „Freie Fahrt“. Gespeichert wird nur auf deinem PC.</small>
      <button class="pill-button" data-focus data-toggle="tracking">Einschalten</button></div>`;
  }

  function tripsAheadCard() {
    const n = tripsData?.ahead?.length || 0;
    if (!n) return '';
    return `<div class="log-off trips-ahead">${badge('logbook', 'yellow')}<b>Älterer Spielstand geladen</b>
      <small>Einige Fahrten liegen zeitlich nach diesem Spielstand. Sollen sie aus dem Fahrtenbuch entfernt werden?</small>
      <small><span>Betroffene Fahrten:</span> ${n}</small>
      <div class="trips-ahead-buttons"><button class="pill-button" data-focus data-action="trips-ahead-remove">Entfernen</button>
      <button class="pill-button" data-focus data-action="trips-ahead-keep">Behalten</button></div></div>`;
  }

  function renderTripList() {
    if (!api?.tripsList) return '<div class="list-empty">Das Fahrtenbuch gibt es nur in der App.</div>';
    if (!tripsData) {
      loadTrips();
      return '<div class="list-empty">Lädt …</div>';
    }
    const trips = [...tripsData.trips].reverse();
    if (tripsData.open) trips.unshift(tripsData.open);
    if (!trips.length) return settings.tracking ? '<div class="list-empty">Noch keine Fahrten – die erste erscheint, sobald du losfährst.</div>' : tripsOffCard();
    return tripsAheadCard() + (settings.tracking ? '' : tripsOffCard()) + `<div class="list-rows log-trips">${trips.slice(0, 200).map(tripRow).join('')}</div>`;
  }

  function renderTripDetail(trip) {
    const tile = (label, value, icon, color) => `<div class="log-tile">${badge(icon, color)}<small>${label}</small><b>${escape(value)}</b></div>`;
    const net = (trip.income || 0) - (trip.costs || 0);
    const countries = tripCountries(trip);
    const tiles = [
      tile('Strecke', kmText(tripKm(trip)), 'turn-straight', 'blue'),
      tile('Dauer im Spiel', trip.gameEnd > trip.gameStart ? duration(trip.gameEnd - trip.gameStart) : '–', 'clock', 'indigo'),
      ...(trip.kind === 'job' ? [
        tile('Lohn', trip.status === 'delivered' ? money(trip.income) : trip.status === 'cancelled' ? signedMoney(trip.income) || money(0) : '–', 'delivered', 'green'),
        tile('Maut, Strafen, Fähre', money(trip.costs || 0), 'toll', 'yellow'),
        tile('Gewinn', trip.status === 'open' ? '–' : signedMoney(net) || money(0), 'logbook', 'yellow'),
        tile('Schaden', trip.damage > 0.0005 ? percent(trip.damage) : '–', 'warning', 'red'),
      ] : [tile('Kosten', money(trip.costs || 0), 'toll', 'yellow')]),
      ...(countries.length ? [tile(countries.length === 1 ? 'Land' : 'Länder', countries.map((c) => countryName(c.country)).join(', '), 'border', 'cyan')] : []),
      ...(tripL100(trip) != null ? [tile('Verbrauch', consumption(tripL100(trip)), 'fuel', 'blue')] : []),
      ...(tripLate(trip) != null ? [tripLate(trip) > 0 ? tile('Verspätung', duration(tripLate(trip)), 'clock', 'red') : tile('Lieferung', 'Pünktlich', 'clock', 'green')] : []),
    ];
    const from = trip.kind === 'job' ? [trip.fromCompany, trip.from].filter(Boolean).join(', ') : '';
    const to = trip.kind === 'job' ? [trip.toCompany, trip.to].filter(Boolean).join(', ') : '';
    return `<div class="trip-detail">
      <div class="trip-head"><button class="round small" data-focus data-action="trip-back" aria-label="Zurück">${ICONS.back}</button>
        <div class="lr-text"><b>${escape(tripTitle(trip))}</b><small>${escape([trip.kind === 'job' ? trip.cargo : '', tripDate(trip), TRIP_STATUS[trip.status] || '', trip.truck].filter(Boolean).join(' · '))}</small></div>
        ${trip.status === 'open' ? '' : `<button class="pill-button trip-delete ${tripDeleteArmed === trip.id ? 'armed' : ''}" data-focus data-action="trip-delete">${tripDeleteArmed === trip.id ? 'Wirklich löschen?' : 'Löschen'}</button>`}</div>
      <div class="trip-map-wrap"><canvas class="trip-map" data-trip-map data-from="${escape(from)}" data-to="${escape(to)}"></canvas></div>
      <div class="log-grid trip-tiles">${tiles.join('')}</div>
    </div>`;
  }

  // Mini-Karte: die Fahrt (lila) über allen anderen gefahrenen Strecken (grau), Start grün, Ziel rot
  function drawTripMap(canvas, trip) {
    if (!canvas || !tripTrack) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    const end = Math.min(trip.p1, tripTrack.length / 2);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = trip.p0; i < end; i++) {
      const x = tripTrack[i * 2];
      const z = tripTrack[i * 2 + 1];
      if (!Number.isFinite(x)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    g.fillStyle = theme === 'dark' ? '#17171c' : '#eef0f3';
    g.fillRect(0, 0, w, h);
    if (!Number.isFinite(x0)) return;
    const span = Math.max(x1 - x0, z1 - z0, 500);
    const scale = Math.min((w * 0.84) / Math.max(x1 - x0, span * 0.2), (h * 0.8) / Math.max(z1 - z0, span * 0.2));
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const sx = (x) => w / 2 + (x - cx) * scale;
    const sz = (z) => h / 2 + (z - cz) * scale;
    const path = (from, to) => {
      g.beginPath();
      let pen = false;
      for (let i = from; i < to; i++) {
        const x = tripTrack[i * 2];
        const z = tripTrack[i * 2 + 1];
        if (!Number.isFinite(x)) {
          pen = false;
          continue;
        }
        if (pen) g.lineTo(sx(x), sz(z));
        else g.moveTo(sx(x), sz(z));
        pen = true;
      }
      g.stroke();
    };
    g.lineJoin = 'round';
    g.lineCap = 'round';
    // andere Fahrten als Hintergrund (Straßennetz, das du kennst)
    g.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.12)';
    g.lineWidth = 2 * dpr;
    if (trip.p0 > 0) path(0, trip.p0);
    if (end < tripTrack.length / 2) path(end, tripTrack.length / 2);
    g.strokeStyle = 'rgba(175, 82, 222, 0.35)';
    g.lineWidth = 9 * dpr;
    path(trip.p0, end);
    g.strokeStyle = '#af52de';
    g.lineWidth = 4 * dpr;
    path(trip.p0, end);
    // Start und Ziel: erster und letzter Punkt
    let first = null;
    let last = null;
    for (let i = trip.p0; i < end; i++) {
      if (!Number.isFinite(tripTrack[i * 2])) continue;
      if (!first) first = [tripTrack[i * 2], tripTrack[i * 2 + 1]];
      last = [tripTrack[i * 2], tripTrack[i * 2 + 1]];
    }
    const ends = [[first, '#34c759', canvas.dataset.from], [last, trip.status === 'open' ? '#0a84ff' : '#ff3b30', canvas.dataset.to]];
    for (const [p, color] of ends) {
      if (!p) continue;
      g.beginPath();
      g.arc(sx(p[0]), sz(p[1]), 7 * dpr, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      g.beginPath();
      g.arc(sx(p[0]), sz(p[1]), 4.5 * dpr, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
    }
    // Firma und Stadt neben Start und Ziel, im Bild gehalten (rechts vom Punkt, am rechten Rand links davon)
    g.font = `600 ${13 * dpr}px system-ui, sans-serif`;
    g.textBaseline = 'middle';
    for (const [p, color, label] of ends) {
      if (!p || !label) continue;
      const tw = g.measureText(label).width + 16 * dpr;
      const th = 22 * dpr;
      const px = sx(p[0]);
      const right = px + 12 * dpr;
      const lx = Math.max(4 * dpr, Math.min(w - tw - 4 * dpr, right + tw > w - 4 * dpr ? px - tw - 12 * dpr : right));
      const ly = Math.max(4 * dpr, Math.min(h - th - 4 * dpr, sz(p[1]) - th / 2));
      g.fillStyle = 'rgba(0, 0, 0, 0.6)';
      g.beginPath();
      g.roundRect(lx, ly, tw, th, 8 * dpr);
      g.fill();
      g.fillStyle = color;
      g.fillRect(lx, ly + 5 * dpr, 3 * dpr, th - 10 * dpr);
      g.fillStyle = '#fff';
      g.fillText(label, lx + 9 * dpr, ly + th / 2);
    }
  }

  // Länder: alle Fahrten zusammen, dazu ein paar Zahlen
  function renderTripCountries() {
    if (!api?.tripsList) return '<div class="list-empty">Das Fahrtenbuch gibt es nur in der App.</div>';
    if (!tripsData) {
      loadTrips();
      return '<div class="list-empty">Lädt …</div>';
    }
    const trips = [...tripsData.trips, ...(tripsData.open ? [tripsData.open] : [])];
    if (!trips.length) return settings.tracking ? '<div class="list-empty">Noch keine Fahrten aufgezeichnet.</div>' : tripsOffCard();
    const total = new Map();
    for (const trip of trips) {
      for (const c of tripCountries(trip)) {
        const key = c.country.iso || c.country.name;
        const e = total.get(key) || { country: c.country, km: 0 };
        e.km += c.km;
        total.set(key, e);
      }
    }
    const rows = [...total.values()].sort((a, b) => b.km - a.km);
    const km = trips.reduce((s, t) => s + tripKm(t), 0);
    const jobs = trips.filter((t) => t.kind === 'job' && t.status === 'delivered');
    const cities = new Set(trips.flatMap((t) => (t.kind === 'job' ? [t.from, t.to] : [])).filter(Boolean));
    const net = jobs.reduce((s, t) => s + (t.income || 0) - (t.costs || 0), 0);
    // Verlauf: Verbrauch der letzten Fahrten mit Messung und Pünktlichkeit der Aufträge mit Frist
    const measured = trips.filter((t) => t.status !== 'open' && tripL100(t) != null);
    const fuelSum = measured.reduce((s, t) => s + t.fuelUsed, 0);
    const kmSum = measured.reduce((s, t) => s + tripKm(t), 0);
    const timed = jobs.filter((t) => tripLate(t) != null);
    const onTime = timed.filter((t) => tripLate(t) === 0).length;
    const recent = measured.slice(-14);
    // Höhe zwischen kleinstem und größtem Wert (ab null wären 27 und 39 l kaum zu unterscheiden)
    const lo = recent.length ? Math.min(...recent.map(tripL100)) * 0.85 : 0;
    const hi = Math.max(...recent.map(tripL100), lo + 1);
    const history = recent.length >= 2 ? `<div class="log-history"><small>Verbrauch der letzten Fahrten</small><div class="lh-bars">${recent.map((t) => {
      const v = tripL100(t);
      const late = tripLate(t);
      return `<button class="lh-bar ${late > 0 ? 'late' : ''}" data-focus data-trip="${t.id}"><span style="height:${(12 + ((v - lo) / (hi - lo)) * 88).toFixed(0)}%"></span><b>${escape(consumption(v).replace(/\s.*/, ''))}</b></button>`;
    }).join('')}</div></div>` : '';
    const tile = (label, value, icon, color) => `<div class="log-tile">${badge(icon, color)}<small>${label}</small><b>${escape(value)}</b></div>`;
    const max = rows.length ? rows[0].km : 1;
    return `<div class="log-scroll"><div class="log-grid log-sum">
        ${tile('Gefahren', kmText(km), 'turn-straight', 'blue')}
        ${tile('Aufträge geliefert', String(jobs.length), 'delivered', 'green')}
        ${tile('Länder', String(rows.length), 'border', 'cyan')}
        ${tile('Städte', String(cities.size), 'stops', 'orange')}
        ${tile('Gewinn', signedMoney(net) || money(0), 'logbook', 'yellow')}
        ${kmSum >= 5 ? tile('Ø Verbrauch', consumption((fuelSum / kmSum) * 100), 'fuel', 'blue') : ''}
        ${timed.length ? tile('Pünktlich', `${onTime} / ${timed.length}`, 'clock', 'green') : ''}
      </div>
      ${history}
      <div class="list-rows log-countries">${rows.map((c) => `<div class="list-row country-row"><span class="cr-code">${escape(c.country.code || c.country.iso || '?')}</span>
        <div class="lr-text"><b>${escape(countryName(c.country))}</b><span class="cr-bar"><i style="width:${Math.max(2, (c.km / max) * 100).toFixed(1)}%"></i></span></div>
        <span class="lr-right">${escape(distance(c.km))}</span></div>`).join('')}</div></div>`;
  }

  function renderLogbookTabs() {
    const tabs = [['session', 'Sitzung'], ['trips', 'Fahrten'], ['countries', 'Länder']];
    list('log-tabs', tabs.map(([id, label]) => `<button data-focus data-action="log-tab" data-tab="${id}" class="${id === logTab ? 'on' : ''}">${label}</button>`).join(''));
  }

  // Reiter Fahrten/Länder (Sitzung zeichnet renderLogbook selbst, laufend mit der Telemetrie)
  function renderTripsTab() {
    if (tripsData?.open && performance.now() - tripsLoadedAt > 15000) loadTrips(); // läuft gerade: Strecke nachziehen
    if (logTab === 'trips') {
      const trip = tripShown != null && tripsData ? [...tripsData.trips, tripsData.open].find((t) => t && t.id === tripShown) : null;
      if (trip) {
        list('logbook', renderTripDetail(trip));
        drawTripMap(stage.querySelector('[data-trip-map]'), trip);
        return;
      }
      tripShown = null;
      list('logbook', renderTripList());
    } else list('logbook', renderTripCountries());
  }

  // Einzelne Fahrt: erstes Tippen fragt nach, zweites löscht
  function deleteTrip() {
    const id = tripShown;
    if (id == null) return;
    clearTimeout(tripDeleteTimer);
    if (tripDeleteArmed !== id) {
      tripDeleteArmed = id;
      tripDeleteTimer = setTimeout(() => {
        tripDeleteArmed = 0;
        if (screen === 'logbook') renderLogbook();
      }, 4000);
      renderLogbook();
      return;
    }
    tripDeleteArmed = 0;
    tripShown = null;
    removeTrips([id], 'Fahrt gelöscht');
  }

  function removeTrips(ids, title) {
    for (const id of ids) tripCountryCache.delete(id);
    api?.tripsRemove?.(ids).then(() => {
      showToast({ icon: 'logbook', color: 'yellow', title, text: '' });
      return loadTrips();
    });
  }

  function clearTrips() {
    if (performance.now() - tripsClearArmed > 4000) {
      tripsClearArmed = performance.now();
      rerenderSettings('[data-action="trips-clear"]');
      setTimeout(() => {
        if (tripsClearArmed && performance.now() - tripsClearArmed >= 4000) {
          tripsClearArmed = 0;
          if (screen === 'settings') rerenderSettings();
        }
      }, 4100);
      return;
    }
    tripsClearArmed = 0;
    api?.tripsClear?.().then(() => {
      tripsData = null;
      tripTrack = null;
      tripCountryCache = new Map();
      CarMap.setDriven(null);
      rerenderSettings();
      showToast({ icon: 'logbook', color: 'yellow', title: 'Fahrtenbuch gelöscht', text: 'Alle Fahrten und Strecken sind entfernt.' });
    });
  }
  // ------------------------------------------------------------------ Wetter (echtes Wetter, Open-Meteo)
  const WX = [
    [[0], 'Klar', 'clear'], [[1], 'Überwiegend klar', 'partly'], [[2], 'Teilweise bewölkt', 'partly'], [[3], 'Bedeckt', 'cloud'],
    [[45, 48], 'Nebel', 'fog'], [[51, 53, 55, 56, 57], 'Nieselregen', 'rain'], [[61, 63, 65, 66, 67], 'Regen', 'rain'],
    [[71, 73, 75, 77], 'Schnee', 'snow'], [[80, 81, 82], 'Regenschauer', 'rain'], [[85, 86], 'Schneeschauer', 'snow'], [[95, 96, 99], 'Gewitter', 'storm'],
  ];
  const wxInfo = (code) => {
    const hit = WX.find(([codes]) => codes.includes(code));
    return hit ? { text: hit[1], kind: hit[2] } : { text: '–', kind: 'cloud' };
  };
  function weatherIcon(code, day = true) {
    const { kind } = wxInfo(code);
    const sun = '<circle cx="12" cy="12" r="4.6" fill="#ffd60a"/><g stroke="#ffd60a" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g>';
    const moon = '<path d="M15.5 4.5a7.8 7.8 0 1 0 4 13.6A8.6 8.6 0 0 1 15.5 4.5z" fill="#ffe680"/>';
    const cloud = (y = 0, fill = '#f2f5fa') => `<path transform="translate(0 ${y})" fill="${fill}" d="M7.2 19h10.3a4.3 4.3 0 0 0 .4-8.6 5.6 5.6 0 0 0-10.6 1.5A3.6 3.6 0 0 0 7.2 19z"/>`;
    const svgOf = (body) => `<svg viewBox="0 0 24 24">${body}</svg>`;
    switch (kind) {
      case 'clear': return svgOf(day ? sun : moon);
      case 'partly': return svgOf(`<g transform="translate(-3 -3) scale(0.8)">${day ? sun : moon}</g>${cloud(2)}`);
      case 'fog': return svgOf(`${cloud(-3, '#c9d1dc')}<g stroke="#c9d1dc" stroke-width="1.8" stroke-linecap="round"><path d="M4 19.5h16M6 22h12"/></g>`);
      case 'rain': return svgOf(`${cloud(-3)}<g stroke="#5ac8fa" stroke-width="1.9" stroke-linecap="round"><path d="M8 19l-1 2.6M12 19l-1 2.6M16 19l-1 2.6"/></g>`);
      case 'snow': return svgOf(`${cloud(-3)}<g fill="#fff"><circle cx="8" cy="20.5" r="1.2"/><circle cx="12" cy="21.5" r="1.2"/><circle cx="16" cy="20.5" r="1.2"/></g>`);
      case 'storm': return svgOf(`${cloud(-3, '#c9d1dc')}<path d="M12.5 16 9.5 20.5h2.6L11 24l4-5.2h-2.7z" fill="#ffd60a"/>`);
      default: return svgOf(cloud());
    }
  }

  let weatherData = null;
  let weatherKey = '';
  let weatherAt = 0;
  let weatherBusy = false;
  function updateWeather() {
    if (!settings.weather) return;
    const p = pose.current();
    if (!p || !CarMap.hasPlaces()) return demoMode && !api && !weatherData ? setWeather(DEMO_WEATHER) : undefined;
    const city = CarMap.nearestCity(p.x, p.z);
    const country = CarMap.countryAt(p.x, p.z); // Land der Stadt, nach der der Wetterdienst sucht
    if (!city) return;
    const key = `${city.en}|${country?.code || ''}`;
    if (weatherBusy || (key === weatherKey && performance.now() - weatherAt < 10 * 60 * 1000)) return;
    weatherKey = key;
    weatherAt = performance.now();
    if (!api) return setWeather(DEMO_WEATHER);
    weatherBusy = true;
    const code = country?.iso || '';
    api.weather(CarMap.nearbyWeatherCities(p.x, p.z), code).then((data) => {
      weatherBusy = false;
      if (data) setWeather({ ...data, city: !data.query || data.query === city.en ? city.name : data.query }); // Anzeige in der Sprache der App
      else weatherAt = performance.now() - 9 * 60 * 1000; // fehlgeschlagen: in einer Minute erneut
    }, () => {
      weatherBusy = false;
      weatherAt = performance.now() - 9 * 60 * 1000;
    });
  }
  const DEMO_WEATHER = {
    city: 'Kassel', current: { temp: 14.2, feels: 12.8, code: 2, wind: 18, day: true },
    hourly: Array.from({ length: 12 }, (_, i) => ({ time: `${String((14 + i) % 24).padStart(2, '0')}:00`, temp: 14 - i * 0.6, code: i > 6 ? 61 : 2, day: 14 + i < 20 })),
    daily: Array.from({ length: 6 }, (_, i) => ({ date: new Date(Date.now() + i * 86400000).toISOString().slice(0, 10), max: 16 - i, min: 7 - i / 2, code: [2, 61, 3, 0, 80, 1][i], rain: [10, 70, 30, 0, 60, 20][i] })),
  };

  function setWeather(data) {
    weatherData = data;
    renderWeather();
  }

  function renderWeather() {
    const w = weatherData;
    if (!settings.weather) {
      text('wx-city', 'Wetter aus');
      text('wx-note', 'In den Einstellungen unter „Apps › Wetter“ einschalten.');
      return;
    }
    if (!w) {
      text('wx-note', 'Wird geladen … (braucht Internet und die Position im Spiel)');
      return;
    }
    const info = wxInfo(w.current.code);
    text('wx-city', w.city);
    text('wx-temp', `${temp(w.current.temp)}°`);
    text('wx-cond', info.text);
    text('wx-hl', w.daily[0] ? `H: ${temp(w.daily[0].max)}°  T: ${temp(w.daily[0].min)}°` : '');
    text('wx-note', `Gefühlt ${temp(w.current.feels)}° · Wind ${spd(w.current.wind)} ${spdUnit()} · echtes Wetter in ${w.city}`);
    html('wx-icon', `${w.current.code}-${w.current.day}`, weatherIcon(w.current.code, w.current.day));
    const sky = !w.current.day
      ? (info.kind === 'clear' || info.kind === 'partly' ? 'night' : info.kind === 'rain' || info.kind === 'storm' ? 'night-rain' : 'night-cloud')
      : info.kind;
    for (const el of nodes('wx-sky')) el.dataset.sky = sky;
    list('wx-hours', w.hourly.map((h, i) => `<div class="wx-hour"><small>${i === 0 ? 'Jetzt' : h.time.slice(0, 2)}</small><span class="wx-icon">${weatherIcon(h.code, h.day)}</span><b>${Math.round(h.temp)}°</b></div>`).join(''));
    const lo = Math.min(...w.daily.map((d) => d.min));
    const hi = Math.max(...w.daily.map((d) => d.max));
    const names = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    list('wx-days', w.daily.map((d, i) => {
      const left = ((d.min - lo) / (hi - lo || 1)) * 100;
      const right = 100 - ((d.max - lo) / (hi - lo || 1)) * 100;
      return `<div class="wx-day"><b>${i === 0 ? 'Heute' : names[new Date(d.date).getDay()]}</b><span class="wx-icon">${weatherIcon(d.code)}</span>
        <small class="wx-rain">${d.rain >= 30 ? `${d.rain} %` : ''}</small><small>${Math.round(d.min)}°</small>
        <span class="wx-range"><i style="left:${left}%;right:${right}%"></i></span><b>${Math.round(d.max)}°</b></div>`;
    }).join(''));
  }

  // ------------------------------------------------------------------ Disponent
  // Meldungen aus Auftrag, Ereignissen und Warnungen – als Chat, wichtige als Anruf, auf Wunsch vorgelesen.
  // Gesprochen wird nur auf dem Truck-Bildschirm (bzw. in der Demo), sonst spräche der Editor doppelt.
  const chat = [];
  const dispatcherState = { jobKey: undefined, warned: new Set() };
  const canSpeak = role === 'game' || demoMode;
  const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

  function dispatch(text, { call = false } = {}) {
    if (settings.dispatcher === 'off') return;
    if (!poweredOn) call = false; // bei ausgeschaltetem Truck nur als Nachricht
    chat.unshift({ id: chat.length + 1, seq: ++chatSeq, at: telemetry?.gameTimeMin ?? 0, text });
    chat.length = Math.min(chat.length, 60);
    renderChat();
    if (call && settings.dispatcher === 'calls') showCall(text, { contact: 'dispatcher' });
    else if (screen !== 'chat' || chatOpen !== 'dispatcher') showToast({ icon: 'message', color: 'green', title: 'Disponent', text, open: 'chat', kind: 'Dispatcher' });
  }

  // Fürs Vorlesen aufbereiten: Abkürzungen und Zeichen ausschreiben
  function spoken(text) {
    return String(text)
      .replace(/(\d)\.(\d{3})/g, '$1$2')
      .replace(/\s?€/g, ' Euro')
      .replace(/\$(\d+(?:,\d+)?)/g, '$1 Dollar') // ATS: „$12.345“ (Tausenderpunkt ist oben schon weg)
      .replace(/(\d)\s?km\/h/g, '$1 Kilometer pro Stunde')
      .replace(/(\d)\s?mph\b/g, '$1 Meilen pro Stunde')
      .replace(/(\d)\s?mi\b/g, '$1 Meilen')
      .replace(/(\d)\s?ft\b/g, '$1 Fuß')
      .replace(/(\d)\s?yd\b/g, '$1 Yards')
      .replace(/(\d)\s?km\b/g, '$1 Kilometer')
      .replace(/(\d)\s?m\b/g, '$1 Meter')
      .replace(/\bStd\./g, 'Stunden')
      .replace(/\bMin\./g, 'Minuten')
      .replace(/ · /g, ', ')
      .replace(/→/g, 'nach')
      .replace(/(\d{1,2}):(\d{2}) Uhr/g, (_, h, m) => (m === '00' ? `${Number(h)} Uhr` : `${Number(h)} Uhr ${Number(m)}`))
      .replace(/\b(Mo|Di|Mi|Do|Fr|Sa|So) (?=\d)/g, (d) => ({ Mo: 'Montag ', Di: 'Dienstag ', Mi: 'Mittwoch ', Do: 'Donnerstag ', Fr: 'Freitag ', Sa: 'Samstag ', So: 'Sonntag ' })[d.trim()]);
  }
  // Andere Sprachen: erst den angezeigten Text übersetzen (dafür sind die Satzvorlagen gemacht), dann nur Zeichen und
  // Wochentage ausschreiben – Zahlen und Einheiten spricht die Stimme selbst (main/tts-aussprache.js)
  const DAY_WORDS = {
    en: { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' },
    pl: { Pn: 'poniedziałek', Wt: 'wtorek', Śr: 'środa', Cz: 'czwartek', Pt: 'piątek', So: 'sobota', Nd: 'niedziela' },
    tr: { Pzt: 'Pazartesi', Sal: 'Salı', Çar: 'Çarşamba', Per: 'Perşembe', Cum: 'Cuma', Cmt: 'Cumartesi', Paz: 'Pazar' },
  };
  function spokenForeign(text, lang) {
    const days = DAY_WORDS[lang] || {};
    return String(text)
      .replace(/ · /g, ', ')
      .replace(/\s?→\s?/g, ' – ')
      .replace(new RegExp(`(^|[^\\p{L}])(${Object.keys(days).join('|')}) (?=\\d)`, 'gu'), (m, pre, d) => `${pre}${days[d]} `);
  }
  // Chinesisch: der Text ist schon übersetzt, nur Einheiten, Zahlen und Zeichen ausschreiben – sonst liest die Stimme
  // „800 m“ als Buchstaben und „/“ als Schrägstrich
  function spokenChinese(text, hant = CarI18n.hant) { // hant: traditionelle Schreibweise (speak gibt die der Ansagen-Sprache mit)
    const t = (s, h) => (hant ? h : s);
    return String(text)
      // Zahlen kommen aus der Übersetzung im englischen Format („1,234,567“, „3.4“): Tausenderkommas weg, Dezimalpunkt bleibt
      .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
      .replace(/(^|[\s：:（(])\+(?=\d)/g, '$1') // „+18450欧元“: das Plus läse die Stimme als „加“
      .replace(/(\d)\s?(?:km\/h|公里\/小[时時])/g, `$1${t('公里每小时', '公里每小時')}`)
      .replace(/公里\/小[时時]/g, t('公里每小时', '公里每小時'))
      .replace(/(\d)\s?mph\b/g, `$1${t('英里每小时', '英里每小時')}`)
      .replace(/(?:l|L)\/100\s?(?:km|公里)/g, t('升每百公里', '升每百公里'))
      .replace(/(\d)\s?km\b/g, '$1公里')
      .replace(/(\d)\s?mi\b/g, '$1英里')
      .replace(/(\d)\s?ft\b/g, '$1英尺')
      .replace(/(\d)\s?yd\b/g, `$1${t('码', '碼')}`)
      .replace(/(\d)\s?m\b/g, '$1米')
      .replace(/(\d)\s?t\b/g, `$1${t('吨', '噸')}`)
      .replace(/(\d)\s?kg\b/g, '$1公斤')
      .replace(/(\d)\s?lb\b/g, '$1磅')
      .replace(/€\s?(\d+(?:\.\d+)?)/g, `$1${t('欧元', '歐元')}`)
      .replace(/(\d)\s?€/g, `$1${t('欧元', '歐元')}`)
      .replace(/\$(\d+(?:\.\d+)?)/g, `$1${t('美元', '美元')}`)
      .replace(/\bMin\./g, t('分钟', '分鐘'))
      .replace(/\bStd\./g, t('小时', '小時'))
      .replace(/ · /g, '，')
      .replace(/\s?→\s?/g, t('，前往', '，前往'));
  }
  const LANG_TAG = { de: 'de-DE', en: 'en-US', pl: 'pl-PL', tr: 'tr-TR' };
  // Windows-Stimme je Sprache (Paulina und Tolga nur mit installiertem Sprachpaket – sonst eine andere Stimme der Sprache)
  const WIN_VOICE = { en: 'Microsoft Zira', pl: 'Microsoft Paulina', tr: 'Microsoft Tolga' };

  let currentAudio = null;
  let speakToken = 0;
  function stopSpeaking() {
    speakToken++;
    if (chimeOut) {
      try { chimeOut.disconnect(); } catch { /* schon getrennt */ }
      chimeOut = null;
    }
    if (currentAudio) currentAudio.pause();
    currentAudio = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  // Durchsage wie über die Lautsprecher im Bus (Haltestellen-Ansagen): Gong vorweg, dann die Stimme mit schmalem
  // Lautsprecher-Klang, etwas Raumhall und räumlich hinter/über dem Fahrer (HRTF – mit Kopfhörern deutlich „von hinten“).
  // Ohne Web Audio: normale Wiedergabe
  let paCtx = null;
  function paContext() {
    paCtx = paCtx || new AudioContext();
    if (paCtx.state === 'suspended') paCtx.resume().catch(() => {});
    return paCtx;
  }
  // Raumhall des Fahrgastraums: kurze, gedämpfte Impulsantwort (Rauschen mit exponentiellem Abklingen, ~0,7 s) –
  // klingt natürlich, anders als eine Echo-Schleife (die hallte metallisch)
  const roomIrs = new WeakMap();
  function roomIr(ctx) {
    if (roomIrs.has(ctx)) return roomIrs.get(ctx);
    const len = Math.round(ctx.sampleRate * 0.7);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let low = 0;
      for (let i = 0; i < len; i++) {
        low += ((Math.random() * 2 - 1) - low) * 0.35; // etwas dumpfer (weiche Wände, Sitze)
        d[i] = low * Math.exp((-6 * i) / len) * (i < ctx.sampleRate * 0.008 ? i / (ctx.sampleRate * 0.008) : 1);
      }
    }
    roomIrs.set(ctx, ir);
    return ir;
  }
  // Ausgang der Durchsage: Eingang → (trocken + Hall) → räumlich hinter/über dem Fahrer → Lautstärke
  function paOutput(ctx, volume, wetLevel = 0.22) {
    const input = ctx.createGain();
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1.5;
    // Hörer schaut nach −z: Lautsprecher etwas rechts, oben, hinten im Fahrgastraum
    panner.positionX.value = 0.5;
    panner.positionY.value = 0.8;
    panner.positionZ.value = 2.4;
    const gain = ctx.createGain();
    input.outGain = gain; // fürs Stummschalten im Anruf (toggleCallMute)
    // Ausgleich: Lautsprecher-Filter und Abstand im Raum machen die Stimme ~3 dB leiser als die übrigen Ansagen (gemessen
    // mit Katja: RMS 0,095 statt 0,135) – so klingt die Durchsage bei gleicher Einstellung gleich laut; der Gong bleibt
    // dabei gut 3 dB unter der Stimme
    gain.gain.value = volume * 1.4;
    input.connect(panner);
    const room = ctx.createConvolver();
    room.buffer = roomIr(ctx);
    const wet = ctx.createGain();
    wet.gain.value = wetLevel;
    input.connect(room).connect(wet).connect(panner);
    panner.connect(gain).connect(ctx.destination);
    return input;
  }
  // „Ding-Dong“ wie die Durchsage im Bus: zwei glockige Töne (große Terz abwärts, E5 → C5). Jeder Ton aus Grundton und
  // leisen Obertönen (Oktave, Doppeloktave wie beim Vibrafon), die schneller verklingen als der Grundton – weich angeschlagen
  function chimeNotes(ctx, out, t0) {
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 3200;
    soft.connect(out);
    const PARTIALS = [[1, 1, 1.9], [2, 0.22, 0.9], [4, 0.07, 0.35], [6.27, 0.025, 0.2]]; // [Verhältnis, Lautstärke, Abklingzeit s]
    for (const [at, freq] of [[0, 659.25], [0.62, 523.25]]) {
      for (const [ratio, amp, decay] of PARTIALS) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * ratio;
        const t = t0 + at;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.18 * amp, t + 0.006); // weicher Anschlag (Rückmeldung 15.11.: Gong leiser)
        g.gain.setTargetAtTime(0.0001, t + 0.006, decay / 4.6); // exponentiell auf ~1 % nach „decay“
        osc.connect(g).connect(soft);
        osc.start(t);
        osc.stop(t + decay + 0.1);
      }
    }
    return 2.6; // Länge in Sekunden (mit Ausklang)
  }
  // Kopf drehen (Innenkamera): den Hörer im Fahrgastraum mitdrehen – die Durchsage bleibt an ihrem Lautsprecher (hinten
  // rechts oben), wie in einem echten Bus. Außerhalb der Innenkamera Blick nach vorn. Weich nachgeführt (Telemetrie 20 Hz).
  function paLook(t) {
    if (!paCtx || !paCtx.listener) return;
    const inside = !!t && t.lookInside === true;
    const y = inside ? ((Number(t.lookYawDeg) || 0) * Math.PI) / 180 : 0;
    const p = inside ? ((Number(t.lookPitchDeg) || 0) * Math.PI) / 180 : 0;
    const f = [-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
    const u = [Math.sin(y) * Math.sin(p), Math.cos(p), Math.cos(y) * Math.sin(p)];
    const l = paCtx.listener;
    if (l.forwardX) {
      const now = paCtx.currentTime;
      [l.forwardX, l.forwardY, l.forwardZ, l.upX, l.upY, l.upZ].forEach((param, i) => param.setTargetAtTime(i < 3 ? f[i] : u[i - 3], now, 0.05));
    } else if (l.setOrientation) l.setOrientation(...f, ...u);
  }
  let chimeOut = null; // laufender Gong – bricht eine neue Ansage ab (stopSpeaking)
  function busChime(volume) {
    try {
      const ctx = paContext();
      const t = telemetry;
      console.info(`[Durchsage] head 3D: interior camera ${t?.lookInside === true ? 'yes' : t?.lookInside === false ? 'no' : 'unknown (old plugin)'}, look ${Math.round(Number(t?.lookYawDeg) || 0)}/${Math.round(Number(t?.lookPitchDeg) || 0)} deg`); // englisch wie die Logs
      paLook(t);
      chimeOut = paOutput(ctx, volume, 0.3);
      chimeNotes(ctx, chimeOut, ctx.currentTime + 0.03);
      return 1450; // bis die Stimme beginnt (ms): nach dem zweiten Ton, während er ausklingt
    } catch {
      return 0;
    }
  }
  // Test (Demo): Gong als WAV (Base64) – zum Anhören ohne Spiel
  if (demoMode) {
    window.__busChimeWav = async () => {
      const ctx = new OfflineAudioContext(2, 44100 * 3, 44100);
      chimeNotes(ctx, paOutput(ctx, 0.9, 0.3), 0.05);
      const buf = await ctx.startRendering();
      const n = buf.length, out = new DataView(new ArrayBuffer(44 + n * 4));
      const w = (o, t) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
      out.setUint16(22, 2, true); out.setUint32(24, 44100, true); out.setUint32(28, 44100 * 4, true); out.setUint16(32, 4, true);
      out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 4, true);
      const l = buf.getChannelData(0), r = buf.getChannelData(1);
      for (let i = 0; i < n; i++) {
        out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l[i])) * 32767, true);
        out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r[i])) * 32767, true);
      }
      let bin = '';
      const bytes = new Uint8Array(out.buffer);
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(bin);
    };
  }
  function paRoute(audio, volume) {
    try {
      const ctx = paContext();
      const src = ctx.createMediaElementSource(audio);
      // Bus-Lautsprecher: schmaler Frequenzbereich, etwas Präsenz – dann Raumhall und Lage im Raum (paOutput)
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 220;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5500;
      const presence = ctx.createBiquadFilter();
      presence.type = 'peaking';
      presence.frequency.value = 2000;
      presence.Q.value = 0.7;
      presence.gain.value = 3;
      const out = paOutput(ctx, volume, 0.16);
      src.connect(hp).connect(lp).connect(presence).connect(out);
      audio.volume = 1; // Lautstärke regelt die Kette
      audio._paGain = out.outGain;
      return true;
    } catch {
      return false;
    }
  }

  // Läuft eine Durchsage (Haltestelle), warten andere Ansagen (Navi, Tempo …), bis sie zu Ende ist – vorher brach z. B. „In
  // 20 Metern rechts abbiegen“ beim Losfahren „Nächster Halt: Le Mans“ mitten im Namen ab. Höchstens 15 s (falls das
  // Ende nicht gemeldet wird); wartet schon eine, gilt die neueste.
  let paBusyUntil = 0;
  let afterPa = null;
  function runAfterPa() {
    const next = afterPa;
    afterPa = null;
    paBusyUntil = 0;
    if (next) next();
  }
  // Kokoro lässt lateinische Wörter weg, die es nicht kennt („A12“): Straßennummern als Buchstabe + Zahl, Reste mit Bindestrich trennen
  function kokoroText(zh) {
    return String(zh).replace(/\b([A-Za-z]{1,3})-?(\d{1,4})\b/g, '$1 $2');
  }
  // Sprache der Ansagen: wie die Oberfläche oder fest gewählt (Einstellungen › Sprachassistent › Sprache der Ansagen)
  function speechLang() {
    const v = settings.voiceLang;
    return v && v !== 'ui' ? v : CarI18n.lang;
  }
  // lang: Text ist schon in dieser Sprache (Antworten des AI-Sprachmodells) – so vorlesen, unabhängig von speechLang
  // 播报优先级队列（指南 §3）：P0 紧急 / P1 执行 / P2 准备 / P3 预告
  const speechQueue = [];
  const isSpeaking = () => (currentAudio && !currentAudio.ended) || (typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking);
  function speak(text, onEnd0, { pa = false, lang = null, priority = 2 } = {}) {
    // Durchsagen (Haltestellen) mit eigenem Regler, alles andere mit „Sprachansagen“
    const level = pa ? settings.volumeAnnounce ?? settings.volumeVoice : settings.volumeVoice;
    if (!canSpeak || !settings.voice || level <= 0) return onEnd0 && onEnd0();
    if (!pa && Date.now() < paBusyUntil) {
      const queued = () => speak(text, onEnd0, { lang, priority });
      afterPa = queued;
      setTimeout(() => afterPa === queued && runAfterPa(), paBusyUntil - Date.now() + 50);
      return;
    }
    // 优先级（指南 §3）：P0/P1 打断并清空普通队列；P2/P3 正在播报时排队等待
    if (!pa && isSpeaking()) {
      if (priority >= 2) { speechQueue.push({ text, onEnd0, lang, priority }); return; }
      speechQueue.length = 0;
    }
    stopSpeaking();
    duckRadio(true); // Radio leiser, solange gesprochen wird
    if (pa) paBusyUntil = Date.now() + 15000;
    const startToken = speakToken;
    const onEnd = () => {
      duckRadio(false);
      if (pa && startToken === speakToken) setTimeout(runAfterPa, 300); // kurz Luft nach der Durchsage
      // 播完当前条后，播队列中的下一条
      if (speechQueue.length) {
        const next = speechQueue.shift();
        setTimeout(() => speak(next.text, next.onEnd0, { lang: next.lang, priority: next.priority }), 250);
      }
      onEnd0 && onEnd0();
    };
    const token = speakToken;
    const volume = callMuted && !callEl.hidden ? 0 : Math.max(0, Math.min(1, level / 100)); // Anruf „Ton aus“
    // Durchsage: Gong erst, wenn die Stimme bereitsteht (nach der Sprachsynthese), dann die Stimme – für jede Stimme gleich
    const prelude = pa ? (start) => {
      const ms = busChime(volume);
      setTimeout(() => token === speakToken && start(), ms);
    } : (start) => start();
    speakCtx = { token, volume, prelude };
    const play = (url) => {
      currentAudio = new Audio(url);
      currentAudio.volume = volume;
      if (pa) paRoute(currentAudio, volume);
      currentAudio.onended = () => onEnd && onEnd();
      currentAudio.onerror = () => onEnd && onEnd();
      const audio = currentAudio;
      prelude(() => audio.play().catch(() => onEnd && onEnd()));
    };
    // Chinesisch: mit der chinesischen Windows-Stimme (Huihui, Xiaoxiao, Hanhan …), Einheiten ausgeschrieben (Issue #8 –
    // vorher bekam sie den Text als Deutsch markiert und buchstabierte „m“ & Co.). Ohne chinesische Stimme auf Englisch.
    const vlang = lang || speechLang();
    if (vlang === 'zh' || vlang === 'zh-hant') {
      const hant = vlang === 'zh-hant';
      const zh = spokenChinese(CarI18n.translateTo(text, vlang), hant);
      const zhTag = hant ? 'zh-TW' : 'zh-CN';
      const english = () => token === speakToken && speakIn('en', text, token, play, onEnd);
      // chinesische AI-Stimme (Kokoro, main/tts-kokoro.js) – klappt das nicht, die Windows-Stimme
      const windows = () => {
        if (token !== speakToken) return;
        if (api?.tts) api.tts(zh, hant ? 'Microsoft Hanhan' : 'Microsoft Huihui', zhTag).then((url) => {
          if (token !== speakToken) return;
          if (url) play(url);
          else english();
        }, english);
        else if (browserVoice('zh')) speakBrowser(zh, onEnd, 'zh');
        else english();
      };
      if (aiStatus?.kokoro && /^K\d+$/.test(settings.voiceZh || '') && api?.aiTts) {
        api.aiTts(kokoroText(zh), vlang, settings.voiceZh).then((r) => {
          if (token !== speakToken) return;
          if (r?.url) play(r.url);
          else windows();
        }, windows);
        return;
      }
      if (settings.voiceName === 'system' && browserVoice('zh')) speakBrowser(zh, onEnd, 'zh'); // Systemstimme ausdrücklich gewählt
      else if (api?.tts) {
        api.tts(zh, hant ? 'Microsoft Hanhan' : 'Microsoft Huihui', zhTag).then((url) => {
          if (token !== speakToken) return;
          if (url) play(url);
          else english();
        }, english);
      } else if (browserVoice('zh')) speakBrowser(zh, onEnd, 'zh');
      else english();
      return;
    }
    speakIn(vlang, text, token, play, onEnd);
  }

  function speakIn(lang, text, token, play, onEnd) {
    const german = lang === 'de';
    const say = german ? spoken(text) : spokenForeign(lang === CarI18n.lang ? CarI18n.translate(text) : CarI18n.translateTo(text, lang), lang);
    const tag = LANG_TAG[lang] || 'de-DE';
    // AI-Stimme (Supertonic: Olivia & Co., alle Sprachen der App) – klappt das nicht,
    // die Windows-Stimme
    const stVoice = /^st-([FM][1-5])$/.exec(settings.voiceName || '');
    if (stVoice && aiStatus?.supertonic && api?.aiTts) {
      api.aiTts(say, lang, stVoice ? stVoice[1] : undefined).then((r) => {
        if (token !== speakToken) return;
        if (r?.url) play(r.url);
        else if (api.tts) api.tts(say, WIN_VOICE[lang] || 'Microsoft Katja', tag).then((url) => token === speakToken && (url ? play(url) : speakBrowser(say, onEnd, lang)));
        else speakBrowser(say, onEnd, lang);
      }, () => speakBrowser(say, onEnd, lang));
      return;
    }
    // Natürliche Windows-Stimme (Katja, Stefan …) über den Hauptprozess; sonst die Browser-Stimme. Andere Sprachen: Zira, Paulina, Tolga
    if (api && api.tts && settings.voiceName !== 'system') {
      const winVoice = stVoice ? 'Microsoft Katja' : settings.voiceName; // AI-Stimme gewählt, aber nicht geladen
      api.tts(say, german ? winVoice : WIN_VOICE[lang], tag).then((url) => {
        if (token !== speakToken) return;
        if (!url) return speakBrowser(say, onEnd, lang);
        play(url); // wie die anderen Stimmen (Lautstärke, Durchsage-Klang bei Haltestellen)
      }, () => speakBrowser(say, onEnd, lang));
      return;
    }
    speakBrowser(say, onEnd, lang);
  }

  // Browser-Stimme einer Sprache (Chinesisch: bei traditionellem zuerst zh-TW/zh-HK)
  function browserVoice(lang) {
    if (!('speechSynthesis' in window)) return null;
    const voices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.replace('_', '-').toLowerCase().startsWith(lang));
    if (lang === 'zh' && speechLang() === 'zh-hant') return voices.find((v) => /zh-(tw|hk|hant)/i.test(v.lang.replace('_', '-'))) || voices[0] || null;
    return voices[0] || null;
  }
  // Ansage, die gerade läuft (speak): Lautstärke und Gong vorweg gelten auch für die Browser-Stimme
  let speakCtx = null;
  function speakBrowser(text, onEnd, lang = CarI18n.lang) {
    if (!('speechSynthesis' in window)) return onEnd && onEnd();
    const c = speakCtx && speakCtx.token === speakToken ? speakCtx : null;
    const u = new SpeechSynthesisUtterance(text);
    const voice = browserVoice(lang);
    u.lang = voice?.lang || LANG_TAG[lang] || 'de-DE';
    if (voice) u.voice = voice;
    u.rate = 1.02;
    u.volume = c ? c.volume : Math.max(0, Math.min(1, settings.volumeVoice / 100));
    u.onend = () => onEnd && onEnd();
    u.onerror = () => onEnd && onEnd();
    const start = () => {
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    };
    if (c) c.prelude(start);
    else start();
  }

  // Anruf wie bei CarPlay: kompakt als Pille unten (Annehmen/Ablehnen) – antippen öffnet den vollen Anrufbildschirm
  // mit großem Bild, Dauer, Knöpfen und (bei Gesprächen mit AI) der Mitschrift. Eigene Anrufe starten gleich groß.
  const callEl = document.getElementById('call');
  let callTimer = 0;
  let callView = null; // { text, ongoing, contact, talk }
  let callFull = false;
  let callMuted = false;
  let callStartedAt = 0;
  let callClock = 0;
  const callDuration = () => {
    const s = Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000));
    return `${Math.floor(s / 60)}:${pad(s % 60)}`;
  };
  function showCall(text, { ongoing = false, contact = 'dispatcher', talk = false, full } = {}) {
    if (pendingCall && !ongoing) logCall(pendingCall.contact, 'missed', pendingCall.text); // vorheriger blieb unbeantwortet
    pendingCall = ongoing ? null : { contact, text };
    toastEl.hidden = true; // Anruf hat Vorrang vor Mitteilungen
    if (ongoing && !callView?.ongoing) callStartedAt = Date.now();
    if (!ongoing) callMuted = false;
    if (full !== undefined) callFull = full;
    callView = { text, ongoing, contact, talk };
    callEl.dataset.text = text;
    callEl.dataset.contact = contact;
    cancelLeave(callEl); // Anruf direkt nach dem Auflegen: nicht vom Ausblenden des alten verdecken lassen
    callEl.hidden = false;
    callEl.innerHTML = ''; // neuer Zustand: keine alte Statuszeile übernehmen
    renderCall();
    videoForCall(true);
    clearTimeout(callTimer);
    if (!ongoing) callTimer = setTimeout(endCall, 20000); // nicht angenommen → bleibt als Nachricht
    nav.reset();
  }
  function renderCall() {
    if (!callView) return;
    const { ongoing, contact, talk } = callView;
    const c = CONTACTS[contact] || {};
    const status = callEl.querySelector('.call-state')?.dataset.keep === '1' ? callEl.querySelector('.call-state').textContent : '';
    const state = status || (talk ? 'Antippen zum Sprechen' : ongoing ? 'Anruf läuft …' : escape(c.kind || 'Anruf'));
    const end = `<button class="round red" data-focus data-action="${ongoing ? 'call-end' : 'call-decline'}" aria-label="${ongoing ? 'Auflegen' : 'Ablehnen'}">${ICONS.phone}</button>`;
    const accept = `<button class="round green" data-focus data-action="call-accept" aria-label="Annehmen">${ICONS.phone}</button>`;
    const mic = talk ? `<button class="round mic" data-focus data-action="call-talk" aria-label="Sprechen">${ICONS.mic}</button>` : '';
    callEl.classList.toggle('full', callFull);
    if (callFull) {
      const labeled = (btn, label) => `<div class="call-btn">${btn}<small>${label}</small></div>`;
      const mute = `<button class="round ${callMuted ? 'on' : ''}" data-focus data-action="call-mute" aria-label="Ton aus">${ICONS[callMuted ? 'mute' : 'speaker']}</button>`;
      callEl.innerHTML = `<div class="call-screen" style="--c1:${c.colors?.[0] || '#555'};--c2:${c.colors?.[1] || '#222'}">
          <div class="call-head">${avatarHtml(contact, 'big')}
            <div class="call-name">${escape(c.name || 'Anruf')}</div>
            <div class="call-time">${ongoing ? callDuration() : escape(c.kind || 'Anruf')}</div>
            <div class="call-state">${state}</div></div>
          <div class="call-log"></div>
          <div class="call-actions">
            ${ongoing ? labeled(mute, callMuted ? 'Ton an' : 'Ton aus') : ''}
            ${mic ? labeled(mic, 'Sprechen') : ''}
            ${ongoing ? labeled(end, 'Auflegen') : labeled(end, 'Ablehnen') + labeled(accept, 'Annehmen')}
          </div>
        </div>`;
      renderCallLog();
    } else {
      callEl.innerHTML = `<div class="call-card glass">
          <button class="call-open" data-focus data-action="call-full" aria-label="Anrufbildschirm öffnen">${avatarHtml(contact, 'big')}
          <span class="call-info"><span class="call-name">${escape(c.name || 'Anruf')}</span>
          <span class="call-state">${state}</span></span></button>
          <div class="call-buttons">${mic}${ongoing ? end : end + accept}</div>
        </div>`;
    }
    clearInterval(callClock);
    if (ongoing && callFull) {
      callClock = setInterval(() => {
        const el = callEl.querySelector('.call-time');
        if (el && callView?.ongoing) el.textContent = callDuration();
      }, 1000);
    }
  }
  // Statuszeile („Ich höre zu …“) – bleibt beim Umschalten zwischen Pille und Vollbild erhalten
  function setCallStatus(s) {
    const el = callEl.querySelector('.call-state');
    if (!el) return;
    el.textContent = s;
    el.dataset.keep = s ? '1' : '';
  }
  // Mitschrift im Vollbild: Fahrer rechts, Gesprächspartner links (wie Nachrichten)
  function renderCallLog() {
    const el = callEl.querySelector('.call-log');
    if (!el) return;
    const lines = [...(callChat?.history || []), ...(callChat?.pending ? [{ role: 'user', content: callChat.pending }] : [])].slice(-4);
    el.innerHTML = lines.map((l) => `<div class="call-line ${l.role === 'user' ? 'me' : ''}">${escape(l.content)}</div>`).join('');
  }
  function setCallFull(on) {
    callFull = on;
    renderCall();
  }
  function toggleCallMute() {
    callMuted = !callMuted;
    if (currentAudio?._paGain) currentAudio._paGain.gain.value = callMuted ? 0 : Math.max(0, Math.min(1, (settings.volumeAnnounce ?? settings.volumeVoice) / 100)) * 1.4; // Durchsage
    else if (currentAudio) currentAudio.volume = callMuted ? 0 : Math.max(0, Math.min(1, settings.volumeVoice / 100));
    renderCall();
  }
  function acceptCall() {
    const text = callEl.dataset.text || '';
    const contact = callEl.dataset.contact || 'dispatcher';
    if (pendingCall) logCall(pendingCall.contact, 'in', pendingCall.text);
    pendingCall = null;
    showCall(text, { ongoing: true, contact });
    clearTimeout(callTimer);
    text && speak(text, () => afterGreeting(contact, text));
    if (!canSpeak || !settings.voice) callTimer = setTimeout(() => afterGreeting(contact, text), 4000);
  }
  function endCall(reason) {
    // Protokoll: wer legt auf? (Anrufe brachen im Spiel sofort ab – in der Demo nicht nachvollziehbar)
    if (callView || pendingCall) {
      const caller = typeof reason === 'string' ? reason : ((new Error().stack || '').split('\n')[2] || '?').trim().replace(/\(.*\/([\w.-]+:\d+):\d+\)/, '$1');
      api?.aiLog?.(`call end: ${caller} (${callView?.contact || pendingCall?.contact || '?'}, ${callView?.ongoing ? 'laufend' : 'klingelt'}, ${Math.round((Date.now() - callStartedAt) / 100) / 10} s, window ${role})`);
    }
    clearTimeout(callTimer);
    callChat = null; // freies Gespräch (KI) beenden
    callEl.classList.remove('talking');
    if (recordStop) recordStop();
    if (pendingCall) {
      // nicht angenommen → Anrufliste (verpasst) und Mailbox
      logCall(pendingCall.contact, 'missed', pendingCall.text);
      pendingCall = null;
    }
    stopSpeaking();
    clearInterval(callClock);
    callView = null;
    callFull = false;
    callMuted = false;
    // kompakte Anrufkarte gleitet nach unten hinaus; Vollbild-Anruf und Zündung aus: sofort weg
    const animate = !callEl.classList.contains('full') && !!callEl.querySelector('.call-card') && poweredOn;
    callEl.classList.remove('full');
    if (animate) hideAnimated(callEl, () => { if (!callView) callEl.innerHTML = ''; });
    else {
      cancelLeave(callEl);
      callEl.hidden = true;
      callEl.innerHTML = '';
    }
    videoForCall(false);
  }

  function renderChat() {
    renderPhone();
    renderChatApp();
    const items = messageItems();
    list('messages', items.length ? items.map((m) => messageRow(m)).join('') : '<div class="list-empty">Keine Mitteilungen</div>');
  }

  // ------------------------------------------------------------------ Nachrichten (wie die Nachrichten-App in CarPlay)
  // Unterhaltung mit dem Disponenten (mit Schnellantworten) und das Konto der Spedition (Einnahmen/Ausgaben)
  let chatSeq = 0;
  const chatReplies = []; // { conv, dir: 'in' | 'out', at, text, seq }
  let chatOpen = null;
  const chatSeen = {};
  const QUICK = [
    { text: 'Bin unterwegs.', answer: 'Super, gute Fahrt!' },
    { text: 'Mache gerade Pause.', answer: 'Alles klar, melde dich, wenn es weitergeht.' },
    { text: 'Ich verspäte mich etwas.', answer: 'Danke für die Info, ich gebe dem Kunden Bescheid.' },
    { text: 'Bin gleich da.', answer: 'Perfekt, danke dir!' },
    { text: 'Alles in Ordnung.', answer: 'Sehr gut 👍' },
  ];
  function conversations() {
    const disp = [
      ...chat.map((m) => ({ dir: 'in', at: m.at, text: m.text, seq: m.seq || 0 })),
      ...chatReplies.filter((r) => r.conv === 'dispatcher'),
    ].sort((a, b) => a.seq - b.seq);
    const konto = [...allEvents.values()].filter((e) => e.amount).sort((a, b) => a.id - b.id)
      .map((e) => ({ dir: 'in', at: e.gameTimeMin, text: `${e.text}: ${signedMoney(e.amount)}` }));
    const convs = [{ id: 'dispatcher', name: 'Disponent', initial: 'D', msgs: disp }];
    if (konto.length) convs.push({ id: 'konto', name: 'Spedition · Konto', initial: '€', msgs: konto });
    return convs.sort((a, b) => (b.msgs.length ? b.msgs[b.msgs.length - 1].at : -1) - (a.msgs.length ? a.msgs[a.msgs.length - 1].at : -1));
  }
  const chatAvatar = (c) => `<span class="avatar chat-avatar">${escape(c.initial)}</span>`;

  // Zähler auf den App-Symbolen (roter Kreis wie auf dem iPhone): verpasste Anrufe und ungelesene Nachrichten
  let missedSeen = 0;
  const unreadIn = (x) => Math.max(0, x.msgs.filter((m) => m.dir === 'in').length - (chatSeen[x.id] || 0));
  function appBadgeCounts() {
    const missed = Math.max(0, callLog.filter((c) => c.dir === 'missed').length - missedSeen);
    // wie die blauen Punkte in der Liste: Unterhaltungen mit Ungelesenem (nicht einzelne Nachrichten)
    const unread = conversations().filter((x) => unreadIn(x) > 0).length;
    return { phone: missed, chat: unread };
  }
  function refreshAppBadges() {
    const counts = appBadgeCounts();
    for (const el of document.querySelectorAll('[data-app-badge]')) {
      const n = counts[el.dataset.appBadge] || 0;
      const label = n > 99 ? '99+' : n ? String(n) : '';
      if (el.textContent !== label) el.textContent = label;
      el.hidden = !n;
    }
  }
  setInterval(refreshAppBadges, 2000); // neue Symbole (Home, Leiste) bekommen ihre Zahl spätestens nach 2 s
  if (demoMode) window.__missedCall = () => { logCall('dispatcher', 'missed', 'Test'); renderPhone(); }; // Test
  if (demoMode) window.__dispatch = (text) => dispatch(text); // Test
  function renderChatApp() {
    const convs = conversations();
    const c = chatOpen && convs.find((x) => x.id === chatOpen);
    const incoming = (x) => x.msgs.filter((m) => m.dir === 'in').length;
    let markup;
    if (!c) {
      markup = `<div class="chat-head"><h1>Nachrichten</h1><button class="round glass" data-focus data-action="chat-compose" aria-label="Neue Nachricht">${ICONS.compose}</button></div>
        <div class="chat-list">${convs.map((x) => {
          const last = x.msgs[x.msgs.length - 1];
          const unread = incoming(x) > (chatSeen[x.id] || 0);
          return `<button class="list-row chat-row" data-focus data-chat-open="${x.id}"><i class="chat-dot ${unread ? '' : 'off'}"></i>${chatAvatar(x)}
            <div class="lr-text"><b>${escape(x.name)}</b><small>${escape(last ? last.text : 'Noch keine Nachrichten')}</small></div>
            <span class="lr-right">${last ? escape(dayClock(last.at)) : ''}</span><span class="chat-chev">${ICONS['chevron-right']}</span></button>`;
        }).join('')}</div>`;
    } else {
      chatSeen[c.id] = incoming(c);
      const bubbles = c.msgs.slice(-40).map((m) => `<div class="bubble ${m.dir}">${escape(m.text)}<small>${clock(m.at)}</small></div>`).join('')
        || '<div class="list-empty">Noch keine Nachrichten – schreib dem Disponenten unten eine Schnellantwort.</div>';
      const quick = c.id === 'dispatcher' ? `<div class="chat-quick">${QUICK.map((q, i) => `<button class="glass" data-focus data-chat-reply="${i}">${escape(q.text)}</button>`).join('')}</div>` : '';
      markup = `<div class="chat-head"><button class="round glass" data-focus data-action="back" aria-label="Zurück">${ICONS.back}</button>${chatAvatar(c)}<h2>${escape(c.name)}</h2>
          <button class="round glass" data-focus data-action="chat-read" aria-label="Vorlesen">${ICONS.speaker}</button></div>
        <div class="chat-thread" data-chat-thread>${bubbles}</div>${quick}`;
    }
    list('chat-app', markup);
    refreshAppBadges();
    const thread = stage.querySelector('[data-chat-thread]');
    if (thread) thread.scrollTop = thread.scrollHeight;
  }
  function chatReply(index) {
    const q = QUICK[index];
    if (!q) return;
    const at = telemetry?.gameTimeMin ?? 0;
    chatReplies.push({ conv: 'dispatcher', dir: 'out', at, text: q.text, seq: ++chatSeq });
    renderChatApp();
    setTimeout(() => {
      chatReplies.push({ conv: 'dispatcher', dir: 'in', at: telemetry?.gameTimeMin ?? at, text: q.answer, seq: ++chatSeq });
      renderChatApp();
      if (screen !== 'chat' || chatOpen !== 'dispatcher') showToast({ icon: 'message', color: 'green', title: 'Disponent', text: q.answer, open: 'chat', kind: 'Dispatcher' });
    }, 1800);
  }
  function chatRead() {
    const c = conversations().find((x) => x.id === chatOpen);
    const last = c && [...c.msgs].reverse().find((m) => m.dir === 'in');
    if (last) speak(`${c.name}: ${last.text}`);
  }

  // ------------------------------------------------------------------ Telefon (wie CarPlay: Favoriten, Anrufliste, Nachrichten, Mailbox)
  // Die „Kontakte“ sind Infodienste: anrufen = sie sagen dir per Sprachausgabe, was gerade wichtig ist.
  const CONTACTS = {
    dispatcher: { name: 'Disponent', number: '1', kind: 'Spedition', sub: 'Spedition – Auftrag, Ankunft, Pause', initial: 'D', colors: ['#5ac8fa', '#0a84ff'], text: () => withLines('dispatcher', statusText(telemetry)) },
    traffic: { name: 'Verkehrsfunk', number: '2', kind: 'Dienst', sub: 'Route, Abbiegungen, Blitzer voraus', initial: 'V', colors: ['#ffb340', '#ff7a00'], text: () => withLines('traffic', trafficText()) },
    weather: { name: 'Wetterdienst', number: '3', kind: 'Dienst', sub: 'Wetter am Standort', initial: 'W', colors: ['#7fe3ff', '#18a7d8'], text: () => withLines('weather', weatherText()) },
    service: { name: 'Werkstatt', number: '4', kind: 'Werkstatt', sub: 'Fahrzeug-Check und nächste Werkstatt', initial: 'S', colors: ['#a1a1a6', '#636366'], text: () => withLines('service', serviceText()) },
    rest: { name: 'Rasthof-Info', number: '5', kind: 'Dienst', sub: 'Pause, Parkplätze, Tankstellen', initial: 'R', colors: ['#3ae374', '#1db954'], text: () => withLines('rest', restText()) },
    // Geheime Nummern (Easter Eggs): stehen nicht in den Kontakten, der Name erscheint erst beim Anruf
    police: { name: 'Polizei', number: '110', kind: 'Notruf', secret: true, initial: 'P', colors: ['#5e8bff', '#1c3faa'], text: () => policeText() },
    // Notruf: in ETS2 die 112, in ATS die 911 – die jeweils andere Nummer ist der „falsche Kontinent“
    rescue: {
      number: '112', kind: 'Notruf', secret: true,
      get name() { return isAts() ? 'Falscher Kontinent' : 'Leitstelle'; },
      get initial() { return isAts() ? '?' : '+'; },
      get colors() { return isAts() ? ['#c7c7cc', '#8e8e93'] : ['#ff6b5e', '#d1281b']; },
      text: () => (isAts() ? 'Sie sind in den USA – hier gilt die 911. Aber schön, dass Sie anrufen!' : 'Leitstelle hier. Keine Sorge, im Spiel kommt niemand zu Schaden. Wenn es brennt: Warnblinker an und rechts ran!'),
    },
    usa: {
      number: '911', kind: 'Notruf', secret: true,
      get name() { return isAts() ? 'Leitstelle' : 'Falscher Kontinent'; },
      get initial() { return isAts() ? '+' : '?'; },
      get colors() { return isAts() ? ['#ff6b5e', '#d1281b'] : ['#c7c7cc', '#8e8e93']; },
      text: () => (isAts() ? 'Leitstelle hier. Keine Sorge, im Spiel kommt niemand zu Schaden. Wenn es brennt: Warnblinker an und rechts ran!' : 'Sie sind in Europa – hier gilt die 112. Aber schön, dass Sie anrufen!'),
    },
    thought: { name: 'Deep Thought', number: '42', kind: 'Großrechner', secret: true, initial: '42', colors: ['#2c2c2e', '#000000'], text: () => 'Die Antwort auf die Frage nach dem Leben, dem Universum und allem – und darauf, wie viele Paletten noch auf den Auflieger passen.' },
    elite: { name: 'Elite', number: '1337', kind: 'Profi', secret: true, initial: 'L', colors: ['#30d158', '#0a7a2f'], text: () => 'Elite-Fahrer erkannt. Respekt! Ab sofort zählt jede Kurve doppelt.' },
    standard: { name: 'Auftragsbörse', number: '0815', kind: 'Spedition', secret: true, initial: 'A', colors: ['#ffd60a', '#c79a00'], text: () => 'Willkommen beim Standardauftrag: zwanzig Tonnen Joghurt nach Calais. Kühlung nicht vergessen!' },
    agent: { name: 'Agent', number: '007', kind: 'Geheim', secret: true, initial: '7', colors: ['#3a3a3c', '#1c1c1e'], text: () => (isAts() ? 'Mein Name ist Truck. American Truck. Geschüttelt, nicht gerührt – genau wie die Ladung auf der Schotterstraße.' : 'Mein Name ist Truck. Euro Truck. Geschüttelt, nicht gerührt – genau wie die Ladung auf der Schotterstraße.') },
    sixseven: { name: 'Six Seven', number: '67', kind: 'Meme', secret: true, initial: '67', colors: ['#bf5af2', '#7d2ae8'], text: () => 'Six… seven! Sechs Gänge hoch, sieben runter – oder so ähnlich. Keiner weiß, was es bedeutet, aber alle sagen es.' },
    nice: { name: 'Nice', number: '69', kind: 'Meme', secret: true, initial: '69', colors: ['#ff375f', '#c3002f'], text: () => pickFresh('nice', [
      'Nice. Einfach nice. Mehr gibt es dazu nicht zu sagen – gute Fahrt!',
      'Neunundsechzig? Du weißt genau, warum du diese Nummer gewählt hast. Ich sag nur: Gang rein und schön gleichmäßig in Bewegung bleiben.',
      'Na, du Schlingel. Neunundsechzig um diese Uhrzeit? Erst die Ladung zustellen, dann Feierabend – in dieser Reihenfolge.',
      'Hier ist die Nice-Hotline. Wir lieben alles, was gut zusammenpasst: Zugmaschine und Auflieger zum Beispiel. Sanft ankuppeln, nicht ruckeln!',
      'Neunundsechzig, die Lieblingsposition jedes Lkw-Fahrers: Auflieger hinten, Kabine vorne. Was hast du denn gedacht?',
      'Nice. Aber denk dran: Beim Rückwärtsrangieren immer schön Gefühl im Gasfuß. Sonst wird’s ungemütlich.',
    ]) },
    fourtwenty: { name: 'Vier-Zwanzig', number: '420', kind: 'Meme', secret: true, initial: '420', colors: ['#5fd068', '#2a8a3a'], text: () => 'Vier-Zwanzig? Hier gibt’s nur Kaffee und Kekse. Am Steuer bleibt der Kopf klar – gute Fahrt!' },
    bande: { name: 'Die Bande', number: '787', kind: 'Meme', secret: true, initial: '787', colors: ['#ff9f0a', '#ff375f'], text: () => 'Sieben-Acht-Sieben ist die Bande! Tempolimit Sieben-Acht-Sieben gilt hier leider nicht – für Lkw bleibt es bei achtzig. Grüße an Basti!' },
    streetgang: { name: 'Straßenbande', number: '187', kind: 'Meme', secret: true, initial: '187', colors: ['#3a3a3c', '#ff453a'], text: () => 'Eins-Acht-Sieben? Falsche Bande – hier ist nur die Speditionsbande. Die Ladung kommt pünktlich an, ganz ohne Stress.' },
    mayday: { name: 'Flugsicherung', number: '7700', kind: 'Notfall', secret: true, initial: '✈', colors: ['#ff453a', '#b3261e'], text: () => 'Squawk 7700, Notfall erkannt! Moment … Sie fahren ja einen Lkw. Trotzdem notiert: bitte rechts ran und Warnblinker an.' },
    hijack: { name: 'Flugsicherung', number: '7500', kind: 'Notfall', secret: true, initial: '✈', colors: ['#ff9f0a', '#b35c00'], text: () => 'Squawk 7500? Entführung? Das Einzige, was hier entführt wird, sind die Gummibärchen aus dem Handschuhfach. Alles gut!' },
    nordo: { name: 'Flugsicherung', number: '7600', kind: 'Notfall', secret: true, initial: '✈', colors: ['#64d2ff', '#0a6aa1'], text: () => 'Squawk 7600, Funkausfall gemeldet. Komisch – wir hören Sie doch ganz deutlich. Over!' },
    // Erscheinungsjahr des Spiels: ETS2 2012, ATS 2016
    hotline: {
      kind: 'Hotline', secret: true, name: 'Fan-Hotline', colors: ['#ff9f0a', '#c25e00'],
      get number() { return isAts() ? '2016' : '2012'; },
      get initial() { return isAts() ? 'A' : 'E'; },
      text: () => (isAts()
        ? 'Hier ist die Fan-Hotline zu American Truck Simulator, seit 2016 auf Achse. Bitte bleiben Sie dran – der nächste Bundesstaat kommt bestimmt.'
        : 'Hier ist die Fan-Hotline zu Euro Truck Simulator 2, seit 2012 auf Achse. Bitte bleiben Sie dran – das nächste Update kommt bestimmt.'),
    },
  };
  // Begrüßung und Gruß je Dienst – damit nicht jeder Anruf gleich klingt (nachts eigene Begrüßungen)
  const CALL_LINES = {
    dispatcher: {
      hi: ['Spedition, hallo!', 'Na, alles klar bei dir?', 'Hey, schön von dir zu hören!', 'Disposition, was gibt’s?', 'Hallo! Gut, dass du anrufst.'],
      night: ['So spät noch auf Achse?', 'Nachtschicht, was? Ich bin auch noch da.'],
      bye: ['Melde dich, wenn was ist.', 'Fahr vorsichtig!', 'Bis später!', 'Ich halte dir den Rücken frei.'],
    },
    traffic: {
      hi: ['Verkehrsfunk, hallo!', 'Hier ist der Verkehrsfunk.', 'Die Verkehrslage für dich:'],
      bye: ['Gute Fahrt!', 'Bleib entspannt da draußen.', 'Wir melden uns, wenn sich was tut.'],
    },
    weather: {
      hi: ['Wetterdienst, guten Tag!', 'Hier ist der Wetterdienst.', 'Das Wetter für dich:'],
      night: ['Wetterdienst, guten Abend!'],
      bye: ['Schöne Fahrt!', 'Und immer schön Abstand halten.'],
    },
    service: {
      hi: ['Werkstatt, hallo!', 'Hier ist die Werkstatt.', 'Moin, Werkstatt hier!', 'Werkstatt, ich hör dir zu.'],
      bye: ['Komm vorbei, wenn was klappert.', 'Gute Fahrt – und schone die Kupplung!', 'Bei uns gibt’s immer einen Kaffee für dich.'],
    },
    rest: {
      hi: ['Rasthof-Info, hallo!', 'Hier ist die Rasthof-Info.', 'Rasthof-Info, schön, dass du anrufst!'],
      night: ['Rasthof-Info, die Nachtschicht ist für dich da.'],
      bye: ['Gönn dir eine Pause!', 'Der Kaffee ist frisch.', 'Pausen sind keine Zeitverschwendung.'],
    },
  };
  const lastLine = new Map();
  // zufällig, aber nicht zweimal hintereinander dasselbe
  function pickFresh(key, list) {
    const pool = list.length > 1 ? list.filter((x) => x !== lastLine.get(key)) : list;
    const pick = pickOne(pool);
    lastLine.set(key, pick);
    return pick;
  }
  function withLines(id, body) {
    const lines = CALL_LINES[id];
    if (!lines || !body) return body;
    const hour = telemetry?.available ? Math.floor(num(telemetry.gameTimeMin) / 60) % 24 : 12;
    const night = (hour >= 22 || hour < 5) && lines.night;
    const hi = pickFresh(`${id}-hi`, night ? [...lines.hi, ...lines.night, ...lines.night] : lines.hi);
    const bye = Math.random() < 0.6 ? ` ${pickFresh(`${id}-bye`, lines.bye)}` : '';
    return `${hi} ${body}${bye}`;
  }

  // 110: misst das Tempo wie eine Radarkontrolle
  function policeText() {
    const t = telemetry;
    const speed = Math.round(num(t?.speedKmh));
    const limit = Math.round(num(t?.speedLimitKmh));
    if (t?.available && limit > 0 && speed > limit + 3) {
      // in den eingestellten Einheiten (mph in ATS/UK) – gemessen wird weiter in km/h
      return pickFresh('police-fast', [
        `Polizei hier. Wir haben Sie mit ${spd(speed)} ${spdUnit()} gemessen, erlaubt sind ${spd(limit)}. Diesmal nur eine Verwarnung – fahren Sie vorsichtig!`,
        `Polizei hier. ${spd(speed)} ${spdUnit()} bei erlaubten ${spd(limit)}? Bitte runter vom Gas, sonst wird’s teuer.`,
      ]);
    }
    if (t?.available && speed < 3) return 'Polizei hier. Sie stehen? Sehr vernünftig. Gute Fahrt nachher!';
    return pickFresh('police-ok', [
      'Polizei hier. Alles in Ordnung, Sie fahren vorbildlich. Gute Fahrt!',
      'Polizei hier. Keine Beanstandungen – weiter so!',
      'Polizei hier. Wir haben Sie im Blick. Alles korrekt, gute Fahrt!',
    ]);
  }
  let phoneTab = 'favorites';
  let dialed = '';
  const callLog = []; // { contact, dir: 'out' | 'in' | 'missed', at, text }
  let pendingCall = null; // eingehender, noch nicht angenommener Anruf

  const avatarHtml = (id, cls = '') => {
    const c = CONTACTS[id] || CONTACTS.dispatcher;
    return `<span class="avatar ${cls}" style="background:linear-gradient(160deg, ${c.colors[0]}, ${c.colors[1]})">${c.initial}</span>`;
  };

  function trafficText() {
    const t = telemetry;
    if (!t || !t.available) return 'Keine Verbindung zum Spiel.';
    const parts = [];
    const m = CarMap.hasRoute() && CarMap.onRoute() ? CarMap.maneuvers(pose.current()?.h) : null;
    if (t.navDistanceKm > 0.05) parts.push(`Noch ${distance(t.navDistanceKm)} bis zum Ziel, Ankunft gegen ${clockU(t.gameTimeMin + t.navTimeMin)}.`);
    else parts.push('Im Navi ist kein Ziel gesetzt.');
    const turn = m && m.turns[0];
    if (turn) parts.push(`In ${meters(turn.distance)} ${turnSpoken(turn)}${m.towards ? ` Richtung ${m.towards}` : ''}.`);
    const hazard = radar.near.find((h) => h.ahead);
    if (hazard) parts.push(`${HAZARD[hazard.type].name} in ${meters(hazard.dist)}.`);
    else if (settings.radar) parts.push('Keine Blitzer voraus.');
    if (Math.round(t.speedLimitKmh) > 0) parts.push(`Hier gilt Tempo ${spd(t.speedLimitKmh)}.`); // in der eingestellten Einheit
    return parts.join(' ');
  }
  function weatherText() {
    const w = weatherData;
    if (!settings.weather) return 'Der Wetterdienst ist in den Einstellungen ausgeschaltet.';
    if (!w) return 'Ich habe noch keine Wetterdaten – dafür braucht es Internet und deine Position im Spiel.';
    const today = w.daily[0];
    const rain = w.daily.slice(0, 2).find((d) => d.rain >= 50);
    return `In ${w.city} ist es ${wxInfo(w.current.code).text.toLowerCase()} bei ${Math.round(w.current.temp)} Grad, Wind ${Math.round(w.current.wind)} Kilometer pro Stunde.`
      + (today ? ` Heute bis ${Math.round(today.max)} Grad.` : '')
      + (rain ? ` ${rain === today ? 'Heute' : 'Morgen'} wird es wahrscheinlich nass.` : ' Kein Regen in Sicht.');
  }
  function serviceText() {
    const t = telemetry;
    if (!t || !t.available) return 'Keine Verbindung zum Spiel.';
    const parts = [];
    const wear = [['Motor', t.wearEngine], ['Getriebe', t.wearTransmission], ['Kabine', t.wearCabin], ['Fahrgestell', t.wearChassis], ['Räder', t.wearWheels]]
      .filter(([, v]) => num(v) >= 0.05).sort((a, b) => b[1] - a[1]);
    parts.push(wear.length ? `Am meisten abgenutzt: ${wear.slice(0, 2).map(([n, v]) => `${n} ${Math.round(v * 100)} Prozent`).join(', ')}.` : 'Dein Truck ist gut in Schuss.');
    if (t.fuelRangeKm > 0) parts.push(`Der Tank reicht noch etwa ${distance(t.fuelRangeKm)}.`);
    if (t.adblueCapacity > 0 && t.adblue / t.adblueCapacity < 0.2) parts.push('AdBlue wird knapp.');
    const p = pose.current();
    const shop = p ? CarMap.nearbyPlaces(['s'], p.x, p.z, 1)[0] : null;
    if (shop) parts.push(`Die nächste Werkstatt ist ${meters(gameMeters(shop.onRoute ? shop.along : shop.air))} entfernt${shop.onRoute ? ', an deiner Route' : ''}.`);
    return parts.join(' ');
  }
  function restText() {
    const t = telemetry;
    if (!t || !t.available) return 'Keine Verbindung zum Spiel.';
    const parts = [t.restStopMin > 0 ? `Deine nächste Pause ist in ${duration(t.restStopMin)} fällig.` : 'Du musst jetzt eine Pause machen!'];
    const p = pose.current();
    if (p) {
      const park = CarMap.nearbyPlaces(['p'], p.x, p.z, 1)[0];
      const gas = CarMap.nearbyPlaces(['g'], p.x, p.z, 1)[0];
      if (park) parts.push(`Nächster Rastplatz: ${meters(gameMeters(park.onRoute ? park.along : park.air))}${park.onRoute ? ' an der Route' : ''}.`);
      if (gas) parts.push(`Nächste Tankstelle: ${meters(gameMeters(gas.onRoute ? gas.along : gas.air))}.`);
    }
    return parts.join(' ');
  }

  function logCall(contact, dir, text) {
    callLog.unshift({ contact, dir, text, at: telemetry?.gameTimeMin ?? 0 });
    callLog.length = Math.min(callLog.length, 40);
    renderPhone();
  }
  // Selbst anrufen: Name oben, Ansage, danach auflegen
  function callContact(id) {
    const c = CONTACTS[id];
    if (!c) return;
    const text = c.text();
    logCall(id, 'out', text);
    showCall(text, { ongoing: true, contact: id, full: true }); // selbst angerufen: gleich der volle Anrufbildschirm
    speak(text, () => afterGreeting(id, text));
    if (!canSpeak || !settings.voice) callTimer = setTimeout(() => afterGreeting(id, text), 6000);
  }

  function renderPhone() {
    // Zahl der verpassten Anrufe wie beim iPhone: nur neue seit dem letzten Blick in die Anrufliste
    const missedAll = callLog.filter((c) => c.dir === 'missed').length;
    if (screen === 'phone' && phoneTab === 'recents') missedSeen = missedAll;
    const missed = Math.max(0, missedAll - missedSeen);
    for (const el of stage.querySelectorAll('[data-phone-tab]')) el.classList.toggle('on', el.dataset.phoneTab === phoneTab);
    html('phone-missed', String(missed), missed ? `<i>${missed}</i>` : '');
    refreshAppBadges();
    let markup;
    const row = (id, right, cls = '', sub = '') => `<button class="list-row phone-row ${cls}" data-focus data-call="${id}">
        ${avatarHtml(id)}<div class="lr-text"><b>${escape(CONTACTS[id]?.name || 'Unbekannt')}</b>${sub ? `<small>${escape(sub)}</small>` : ''}</div>
        <span class="phone-kind">${escape(right)}</span></button>`;
    if (phoneTab === 'favorites') {
      markup = ['dispatcher', 'traffic', 'rest', 'weather'].map((id) => row(id, CONTACTS[id].kind)).join('');
    } else if (phoneTab === 'contacts') {
      markup = Object.entries(CONTACTS).filter(([, c]) => !c.secret).sort((a, b) => a[1].name.localeCompare(b[1].name, 'de'))
        .map(([id, c]) => row(id, `Kurzwahl ${c.number}`, '', c.sub)).join('');
    } else if (phoneTab === 'keypad') {
      const keys = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']];
      const match = Object.entries(CONTACTS).find(([, c]) => c.number === dialed && !c.secret); // geheime Nummern verraten sich nicht
      markup = `<div class="keypad">
          <div class="keypad-display"><b>${escape(dialed) || '&nbsp;'}</b><small>${match ? escape(match[1].name) : 'Kurzwahl: 1 Disponent · 2 Verkehrsfunk · 3 Wetter · 4 Werkstatt · 5 Rasthof'}</small></div>
          <div class="keypad-grid">${keys.map(([k, l]) => `<button class="key" data-focus data-key="${k}"><b>${k}</b><small>${l}</small></button>`).join('')}</div>
          <div class="keypad-actions"><button class="round green" data-focus data-action="dial" aria-label="Anrufen">${ICONS.phone}</button>
            ${dialed ? `<button class="key-del" data-focus data-key="del" aria-label="Löschen">${ICONS.back}</button>` : ''}</div>
        </div>`;
    } else if (phoneTab === 'recents') {
      const label = { out: 'Ausgehend', in: 'Eingehend', missed: 'Verpasst' };
      markup = callLog.length ? callLog.map((c) => row(c.contact, dayClock(c.at), c.dir, label[c.dir])).join('')
        : '<div class="list-empty">Noch keine Anrufe.</div>';
    } else if (phoneTab === 'messages-alt') {
      markup = chat.length
        ? `<div class="chat">${chat.map((m) => `<div class="bubble"><p>${escape(m.text)}</p><small>${dayClock(m.at)}</small></div>`).join('')}</div>`
        : '<div class="list-empty">Noch keine Nachrichten. Der Disponent meldet sich bei neuen Aufträgen, Lieferungen, Strafen und Warnungen.</div>';
    } else {
      const mails = callLog.map((c, i) => ({ ...c, i })).filter((c) => c.dir === 'missed');
      markup = mails.length ? mails.map((c) => `<button class="list-row phone-row" data-focus data-voicemail="${c.i}">
          ${avatarHtml(c.contact)}<div class="lr-text"><b>${escape(CONTACTS[c.contact]?.name || 'Unbekannt')}</b><small>${escape(c.text)}</small></div>
          <span class="phone-kind">${dayClock(c.at)}</span><span class="phone-play">${ICONS.play}</span></button>`).join('')
        : '<div class="list-empty">Keine Nachrichten auf der Mailbox. Verpasste Anrufe landen hier zum Anhören.</div>';
    }
    list('phone', markup);
  }



  function statusText(t) {
    if (!t || !t.available) return 'Ich höre dich nicht – ist das Spiel gestartet?';
    const parts = [];
    if (t.hasJob) {
      parts.push(`Du fährst ${t.cargo} von ${latin(t.sourceCity)} nach ${latin(t.destinationCity)}.`);
      if (t.navDistanceKm > 0.05) parts.push(`Noch ${distance(t.navDistanceKm)}, Ankunft gegen ${clockU(t.gameTimeMin + t.navTimeMin)}.`);
      const left = t.deliveryTimeMin - t.gameTimeMin;
      parts.push(left > 0 ? `Lieferfrist in ${duration(left)}.` : 'Die Lieferfrist ist leider schon vorbei.');
    } else {
      parts.push('Gerade hast du keinen Auftrag. Schau doch mal auf die Frachtbörse.');
    }
    if (t.restStopMin > 0) parts.push(`Pause in ${duration(t.restStopMin)}.`);
    return parts.join(' ');
  }

  function dispatcherOnTelemetry(t) {
    const key = t.hasJob ? `${t.cargo}|${t.sourceCity}|${t.destinationCity}|${t.deliveryTimeMin}` : '';
    if (dispatcherState.jobKey === undefined) {
      // Erster Kontakt: kurze Begrüßung statt einer Flut alter Meldungen
      dispatcherState.jobKey = key;
      if (t.hasJob && isBus(t)) dispatch(`Hallo! Du bist mit Fahrgästen nach ${latin(t.destinationCity)} unterwegs. Ankunft bis ${dayClockU(t.deliveryTimeMin)}.`);
      else if (t.hasJob) dispatch(`Hallo! Du bist noch mit ${t.cargo} nach ${latin(t.destinationCity)} unterwegs. Lieferfrist ${dayClockU(t.deliveryTimeMin)}.`);
      return;
    }
    if (key !== dispatcherState.jobKey) {
      dispatcherState.jobKey = key;
      dispatcherState.warned.clear();
      if (t.hasJob && isBus(t)) {
        dispatch(`${pickOne(['Neue Fahrt für dich!', 'Fahrgäste warten!'])} ${t.cargo} von ${latin(t.sourceCity)} nach ${latin(t.destinationCity)}${t.plannedKm ? `, rund ${distance(t.plannedKm)}` : ''}. Lohn ${money(t.income)}, ankommen bis ${dayClockU(t.deliveryTimeMin)}. Gute Fahrt!`, { call: true });
      } else if (t.hasJob) {
        dispatch(`${pickOne(['Neuer Auftrag für dich!', 'Ich hab was für dich!', 'Frische Fracht wartet!'])} ${t.cargo} von ${latin(t.sourceCity)} nach ${latin(t.destinationCity)}${t.plannedKm ? `, rund ${distance(t.plannedKm)}` : ''}. Lohn ${money(t.income)}, liefern bis ${dayClockU(t.deliveryTimeMin)}. Gute Fahrt!`, { call: true });
      }
    }
    const warnOnce = (id, text, opts) => {
      if (dispatcherState.warned.has(id)) return;
      dispatcherState.warned.add(id);
      dispatch(text, opts);
    };
    const navigating = t.navDistanceKm > 0.05 && t.navTimeMin > 0;
    if (t.hasJob && navigating && t.gameTimeMin + t.navTimeMin > t.deliveryTimeMin + 10) {
      warnOnce('late', `Das wird knapp mit ${latin(t.destinationCity)}: du kommst voraussichtlich ${duration(t.gameTimeMin + t.navTimeMin - t.deliveryTimeMin)} zu spät. Ich sag dem Kunden Bescheid.`);
    }
    if (t.restStopMin > 0 && t.restStopMin <= 45) warnOnce(`rest-${Math.floor(t.gameTimeMin / 600)}`, `Denk an deine Pause – in ${duration(t.restStopMin)} musst du raus. Der nächste Rastplatz ist in der App „Tanken & Rasten“.`);
    const fuel = t.fuelCapacity > 0 ? t.fuel / t.fuelCapacity : 1;
    if (fuel < 0.12) {
      const p = pose.current();
      const gas = p ? CarMap.nearbyPlaces(['g'], p.x, p.z, 1)[0] : null;
      warnOnce('fuel', `Dein Tank ist fast leer${gas ? ` – die nächste Tankstelle ist ${meters(gameMeters(gas.onRoute ? gas.along : gas.air))} entfernt` : ''}.`);
    } else if (fuel > 0.3) dispatcherState.warned.delete('fuel');
  }

  function dispatcherOnEvent(e) {
    const t = telemetry || {};
    if (e.type === 'job.delivered') dispatch(`${pickOne(['Super gemacht!', 'Lieferung angekommen – danke!', 'Top, der Kunde ist zufrieden!'])} ${signedMoney(e.amount) || ''} gehen auf das Firmenkonto.`, { call: true });
    else if (e.type === 'job.cancelled') dispatch(`Schade, der Auftrag ist abgebrochen. ${e.amount ? `Das kostet uns ${money(-e.amount)}.` : ''}`, { call: true });
    else if (e.type === 'player.fined') dispatch(`Gerade kam eine Strafe rein: ${e.text}, ${money(-e.amount)}. ${pickOne(['Fahr bitte vorsichtiger.', 'Lass das nicht zur Gewohnheit werden.', 'Das zahlt nicht die Firma!'])}`);
    else if (e.type === 'player.use.ferry' || e.type === 'player.use.train') dispatch(`${e.text.replace(/^(Fähre|Zug): /, 'Gute Überfahrt: ')}. Nutz die Zeit für eine Pause!`);
    else if (e.type === 'player.tollgate.paid' && Math.abs(e.amount) >= 100) dispatch(`Teure Maut: ${money(-e.amount)}. Ich buche das auf den Auftrag${t.hasJob ? ` nach ${latin(t.destinationCity)}` : ''}.`);
  }

  // Kalender: Termine des Spieltags aus Auftrag, Navi und Ruhezeit, dazu erledigte Ereignisse
  const DAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  function renderAgenda() {
    const t = telemetry;
    // echtes Datum in der Sprache der Oberfläche (de-DE ergab überall „Montag, 10. November“ – das Wörterbuch kennt keine Daten)
    text('cal-real', new Date().toLocaleDateString(CarI18n.lang === 'de' ? 'de-DE' : CarI18n.lang, { weekday: 'long', day: 'numeric', month: 'long' }));
    if (!t || !t.available) {
      list('agenda', '<div class="list-empty">Keine Daten vom Spiel</div>');
      list('agenda-mini', '<div class="list-empty">Keine Termine</div>');
      return;
    }
    const now = t.gameTimeMin;
    const day = (min) => Math.floor(min / 1440);
    text('cal-weekday', DAY_NAMES[day(now) % 7]);
    text('cal-weekday-long', DAY_NAMES[day(now) % 7]);
    text('cal-time', clock(now));

    const upcoming = [];
    if (t.navDistanceKm > 0.05 && t.navTimeMin > 0) {
      upcoming.push({ at: now + t.navTimeMin, title: 'Ankunft', text: t.hasJob ? latin(t.destinationCity) : 'Navi-Ziel', color: 'green' });
    }
    if (t.restStopMin > 0) upcoming.push({ at: now + t.restStopMin, title: 'Pause fällig', text: 'Ruhezeit beginnt', color: 'orange' });
    if (t.hasJob) {
      upcoming.push({ at: t.deliveryTimeMin, title: 'Lieferfrist', text: `${latin(t.sourceCity)} → ${latin(t.destinationCity)} · ${t.cargo}`, color: t.deliveryTimeMin < now ? 'red' : 'purple' });
    }
    upcoming.sort((a, b) => a.at - b.at);
    const done = [...allEvents.values()].filter((e) => day(e.gameTimeMin) === day(now)).sort((a, b) => b.gameTimeMin - a.gameTimeMin)
      .map((e) => ({ at: e.gameTimeMin, title: e.text, text: signedMoney(e.amount) || 'erledigt', color: 'gray', past: true }));

    const dayLabel = (min) => (day(min) === day(now) ? (zhUnits() ? '今天' : 'heute') : day(min) === day(now) + 1 ? (zhUnits() ? '明天' : 'morgen') : DAYS[day(min) % 7]);
    const row = (item) => `<div class="list-row agenda-row ${item.past ? 'past' : ''}">
        <div class="ag-time"><b>${clock(item.at)}</b><small>${dayLabel(item.at)}</small></div>
        <span class="ag-bar" style="--c:${catalog.COLORS[item.color][1]}"></span>
        <div class="lr-text"><b>${escape(item.title)}</b><small>${escape(item.text)}</small></div>
        <span class="lr-right muted">${item.past ? '' : item.at < now ? 'vorbei' : `in ${duration(item.at - now)}`}</span></div>`;
    const all = [...upcoming, ...done];
    list('agenda', all.length ? all.map(row).join('') : '<div class="list-empty">Keine Termine – nimm einen Auftrag an.</div>');
    list('agenda-mini', upcoming.length ? upcoming.slice(0, 2).map(row).join('') : '<div class="list-empty">Keine Termine</div>');
  }

  let lastStopsAt = 0;
  function renderStops(force = false) {
    const now = performance.now();
    if (!force && now - lastStopsAt < 1000) return;
    lastStopsAt = now;
    const p = pose.current();
    if (!p || !CarMap.hasPlaces()) {
      const msg = '<div class="list-empty">Noch keine Orte – die Karte fehlt oder dein Standort ist noch unbekannt.</div>';
      list('stops', msg);
      list('stops-mini', '<div class="list-empty">–</div>');
      return;
    }
    const heading = (p.h / 360) * Math.PI * 2;
    const row = (place, mini) => {
      // Richtung relativ zur Fahrtrichtung (SCS: 0 = Norden = −z, gegen den Uhrzeigersinn)
      const bearing = Math.atan2(place.x - p.x, -(place.y - p.z));
      const rel = ((bearing + heading) * 180) / Math.PI;
      const look = { g: ['fuel', 'blue', 'Tankstelle'], p: ['parking', 'gray', 'Rastplatz'], s: ['service', 'orange', 'Werkstatt'], d: ['service', 'purple', 'Händler'] }[place.type];
      const city = CarMap.nearestCity(place.x, place.y);
      // Chinesisch: „加油站 · 塞尔福斯（附近）“ statt „in/bei“
      const where = city ? (zhUnits() ? `· ${city.name}${city.d < 4000 ? '' : '附近'}` : city.d < 4000 ? `in ${city.name}` : `bei ${city.name}`) : '';
      // An der Route: Ankunft wie im Navi des Spiels (dessen Schnitt aus Zeit und Strecke), sonst Luftlinie
      const t = telemetry;
      const minPerKm = t && t.navDistanceKm > 1 && t.navTimeMin > 0 ? t.navTimeMin / t.navDistanceKm : 0;
      const eta = place.onRoute && minPerKm ? ` · ${duration((gameMeters(place.along) / 1000) * minPerKm)}` : '';
      const dist = place.onRoute ? `${meters(gameMeters(place.along))} an der Route${eta}` : `${meters(gameMeters(place.air))} Luftlinie`;
      const road = mini ? null : CarMap.roadAt?.(place.x, place.y);
      return `<div class="list-row ${place.onRoute ? 'on-route' : ''}">${badge(look[0], look[1])}
        <div class="lr-text"><b>${road ? `<span class="stop-road">${escape(road)}</span>` : ''}${escape(place.label || look[2])} ${escape(where)}</b><small>${escape(dist)}</small></div>
        ${mini ? '' : `<span class="lr-dir" style="transform:rotate(${rel.toFixed(0)}deg)">${ICONS['turn-straight']}</span>`}</div>`;
    };
    const types = stopsTab === 's' ? ['s', 'd'] : [stopsTab];
    const near = CarMap.nearbyPlaces(types, p.x, p.z, 8);
    list('stops', near.length ? near.map((x) => row(x, false)).join('') : '<div class="list-empty">Nichts in der Nähe</div>');
    const gas = CarMap.nearbyPlaces(['g'], p.x, p.z, 2);
    list('stops-mini', gas.map((x) => row(x, true)).join(''));
    const next = gas[0];
    text('places-next', next ? `Nächste Tankstelle: ${meters(gameMeters(next.onRoute ? next.along : next.air))}${next.onRoute ? ' an der Route' : ''}` : '');
    const country = countryHere(p.x, p.z);
    text('fuel-price', country && country.fuel ? (zhUnits() ? `${countryName(country)}${zhT('柴油价格', '柴油價格')}：${country.fuel.toFixed(2).replace('.', ',')} ${zhT('欧元/升', '歐元/升')}` : `Diesel in ${countryName(country)}: ${country.fuel.toFixed(2).replace('.', ',')} €/l`) : '');
  }

  // Ländernamen in der Sprache der App (die Kartendaten liefern Englisch)
  const regionCache = {};
  const regionNamesOf = (lang) => {
    if (!(lang in regionCache)) regionCache[lang] = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([lang], { type: 'region' }) : null;
    return regionCache[lang];
  };
  // „in den Niederlanden“, „in der Schweiz“, „im Vereinigten Königreich“ – sonst „in Frankreich“
  function countryIn(name) {
    const special = { Niederlande: 'in den Niederlanden', Schweiz: 'in der Schweiz', Türkei: 'in der Türkei', Slowakei: 'in der Slowakei', Ukraine: 'in der Ukraine', 'Vereinigtes Königreich': 'im Vereinigten Königreich', Tschechien: 'in Tschechien' };
    return special[name] || `in ${name}`;
  }
  function countryName(country) {
    if (country.state) return country.name; // ATS: Bundesstaat
    const code = country.iso;
    try {
      const regionNames = regionNamesOf(CarI18n.lang);
      return (regionNames && code && regionNames.of(code)) || country.name;
    } catch {
      return country.name;
    }
  }

  // ------------------------------------------------------------------ Musik
  const history = [];
  if (demoMode) window.__media = (patch) => onMedia({ ...media, ...patch }); // Test: Musik abwandeln (z. B. langer Titel)
  function onMedia(m, rebinding = false) {
    media = m;
    if (!rebinding) mediaReceivedAt = performance.now();
    const has = m.available && m.title;
    marqueeText('title', has ? m.title : 'Nichts wird abgespielt');
    // nur der Titel läuft durch, Interpret und Album enden mit „…“ (wie bei Apple, Rückmeldung 15.11.)
    text('artist', has ? m.artist || '' : 'Spotify öffnen');
    text('album', has ? m.album || '' : '');
    const app = String(m.app || '').replace(/\.exe$/i, '');
    text('source', /spotify/i.test(app) ? 'Spotify' : app || 'Musik');
    for (const el of nodes('art')) {
      const value = m.art ? `url("${m.art}")` : '';
      if (el.style.backgroundImage !== value) el.style.backgroundImage = value;
      el.classList.toggle('empty', !m.art);
    }
    const icon = m.playing ? ICONS.pause : ICONS.play;
    for (const el of nodes('play')) if (el.dataset.state !== String(m.playing)) {
      el.innerHTML = icon;
      el.dataset.state = String(m.playing);
    }
    if (musicTab === 'lyrics' && !rebinding) loadLyrics();
    if (has && !rebinding) {
      const key = `${m.title}|${m.artist}`;
      if (!history.length || history[0].key !== key) {
        const i = history.findIndex((h) => h.key === key);
        if (i >= 0) history.splice(i, 1);
        history.unshift({ key, title: m.title, artist: m.artist || '', art: m.art || '', at: telemetry?.available ? telemetry.gameTimeMin : null });
        history.length = Math.min(history.length, 15);
        renderHistory();
      }
      if (m.art && m.art !== lastArt) extractArtColor(m.art);
    }
  }

  // ------------------------------------------------------------------ Songtext (LRCLIB)
  let lyrics = null; // { key, synced, plain, none, instrumental, error, loading }
  let lyricsLine = -1;
  function loadLyrics(force = false) {
    const key = media?.title ? `${media.artist || ''}|${media.title}` : '';
    text('ly-title', media?.title ? `${media.title}${media.artist ? ` · ${media.artist}` : ''}` : '');
    if (!key) {
      lyrics = null;
      return renderLyrics();
    }
    if (!force && lyrics?.key === key) return;
    if (lyrics?.key === key && !lyrics.error) return renderLyrics();
    lyrics = { key, loading: true };
    lyricsLine = -1;
    renderLyrics();
    if (!api?.lyrics) {
      lyrics = { key, none: true };
      return renderLyrics();
    }
    api.lyrics(media.artist || '', media.title, media.album || '', media.durationMs || 0).then((r) => {
      if (lyrics?.key !== key) return;
      lyrics = { key, ...r };
      lyricsLine = -1;
      renderLyrics();
    });
  }
  function renderLyrics() {
    const l = lyrics;
    let markup;
    if (!media?.title) markup = '<div class="list-empty">Gerade läuft nichts.</div>';
    else if (!l || l.loading) markup = '<div class="list-empty">Songtext wird gesucht …</div>';
    else if (l.error) markup = '<div class="list-empty">Der Songtext-Dienst ist gerade nicht erreichbar.</div>';
    else if (l.instrumental) markup = '<div class="list-empty">Instrumental – ohne Text.</div>';
    else if (l.synced?.length) markup = l.synced.map(([, t], i) => `<p class="ly-line" data-i="${i}">${escape(t) || '♪'}</p>`).join('');
    else if (l.plain) markup = `<div class="ly-plain">${escape(l.plain).replace(/\n/g, '<br>')}</div>`;
    else markup = '<div class="list-empty">Für diesen Titel gibt es keinen Songtext.</div>';
    list('lyrics', markup);
    lyricsLine = -1;
    tickLyrics();
  }
  // aktuelle Zeile hervorheben und in die Mitte scrollen (nur, wenn der Reiter offen ist)
  function tickLyrics() {
    if (musicTab !== 'lyrics' || screen !== 'music' || !lyrics?.synced?.length) return;
    const pos = mediaPosition() + 300; // etwas vorauslaufen – die Zeile soll beim Singen schon stehen
    let i = -1;
    for (let k = 0; k < lyrics.synced.length && lyrics.synced[k][0] <= pos; k++) i = k;
    if (i === lyricsLine) return;
    lyricsLine = i;
    for (const box of stage.querySelectorAll('[data-list="lyrics"]')) {
      box.querySelector('.ly-line.on')?.classList.remove('on');
      const el = box.querySelector(`.ly-line[data-i="${i}"]`);
      if (!el) continue;
      el.classList.add('on');
      box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
    }
  }
  setInterval(tickLyrics, 250);

  function renderHistory() {
    list('history', history.length
      ? history.map((h, i) => `<div class="list-row ${i === 0 ? 'now' : ''}"><span class="lr-art" style="${h.art ? `background-image:url('${h.art}')` : ''}"></span>
          <div class="lr-text"><b>${escape(h.title)}</b><small>${escape(h.artist)}</small></div>
          <span class="lr-right muted">${i === 0 ? 'läuft' : h.at != null ? clock(h.at) : ''}</span></div>`).join('')
      : spotifyLib?.recent?.length
        ? spotifyLib.recent.map((r) => `<button class="list-row" data-focus data-sp-play="${escape(r.uri)}"><span class="lr-art" style="${r.image ? `background-image:url('${escape(r.image)}')` : ''}"></span>
            <div class="lr-text"><b>${escape(r.name)}</b><small>${escape(r.artist)}</small></div><span class="lr-play">${ICONS.play}</span></button>`).join('')
        : '<div class="list-empty">Noch nichts gehört – Titel erscheinen hier, sobald Musik läuft.</div>');
  }

  // Hintergrundfarbe wie in der Spotify-App aus dem Albumcover
  let lastArt = '';
  function extractArtColor(src) {
    lastArt = src;
    const img = new Image();
    img.onload = () => {
      if (src !== lastArt) return;
      const c = document.createElement('canvas');
      c.width = c.height = 24;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, 24, 24);
      const d = g.getImageData(0, 0, 24, 24).data;
      let r = 0, gr = 0, b = 0, wsum = 0;
      for (let i = 0; i < d.length; i += 4) {
        const max = Math.max(d[i], d[i + 1], d[i + 2]);
        const min = Math.min(d[i], d[i + 1], d[i + 2]);
        const weight = 0.1 + (max ? (max - min) / max : 0) * (max / 255);
        r += d[i] * weight; gr += d[i + 1] * weight; b += d[i + 2] * weight; wsum += weight;
      }
      const [h, s, l] = rgbToHsl(r / wsum, gr / wsum, b / wsum);
      artColor = `hsl(${Math.round(h)} ${Math.round(Math.min(s, 0.65) * 100)}% ${Math.round(Math.max(0.24, Math.min(0.4, l)) * 100)}%)`;
      // Hintergrund wie bei CarPlay: das Cover stark verwischt. Einmal pro Titel klein vorberechnen –
      // hochskaliert wirkt es wie eine große Unschärfe, ohne dass Chromium (ohne GPU) ständig filtern muss.
      const blur = document.createElement('canvas');
      blur.width = blur.height = 96;
      const bg = blur.getContext('2d');
      bg.filter = 'blur(10px) saturate(1.5)';
      bg.drawImage(img, -24, -24, 144, 144);
      artBlur = blur.toDataURL('image/jpeg', 0.85);
      applyArtColor();
    };
    img.src = src;
  }

  let artBlur = '';
  function applyArtColor() {
    for (const el of stage.querySelectorAll('[data-screen="music"], .w-music')) el.style.setProperty('--art', artColor || '#2a2a2a');
    const value = artBlur ? `url("${artBlur}")` : '';
    for (const el of nodes('np-bg')) if (el.style.backgroundImage !== value) el.style.backgroundImage = value;
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }

  function mediaPosition() {
    if (!media || !media.durationMs) return 0;
    const elapsed = media.playing ? performance.now() - mediaReceivedAt : 0;
    return Math.min(media.durationMs, media.positionMs + elapsed);
  }

  // ------------------------------------------------------------------ Abbiegehinweise
  const TURN_TEXT = {
    slight: { left: 'Links halten', right: 'Rechts halten' },
    exit: { left: 'Ausfahrt links', right: 'Ausfahrt rechts' },
    turn: { left: 'Links abbiegen', right: 'Rechts abbiegen' },
    sharp: { left: 'Scharf links abbiegen', right: 'Scharf rechts abbiegen' },
    uturn: { left: 'Wenden', right: 'Wenden' },
    ferry: { left: 'Fähre nehmen', right: 'Fähre nehmen', '': 'Fähre nehmen' },
  };
  // Anzeige/Ansage einer Abbiegung; Kreisverkehr mit Nummer der Ausfahrt
  const turnText = (t) => (t.kind === 'roundabout' ? `Im Kreisverkehr ${t.exit}. Ausfahrt` : TURN_TEXT[t.kind][t.side]);
  const turnSpoken = (t) => (t.kind === 'roundabout' ? `im Kreisverkehr die ${t.exit}. Ausfahrt nehmen`
    : t.kind === 'exit' ? `die ${TURN_TEXT.exit[t.side]} nehmen` : t.kind === 'ferry' ? 'die Fähre nehmen' : TURN_TEXT[t.kind][t.side].toLowerCase());
  // Letzte Abbiegung vor dem Ziel (höchstens 300 m davor) mit Auftrag: die Einfahrt aufs Firmengelände
  const yardTurn = (m, t) => !!(t && telemetry?.hasJob && m.turns[0] === t && m.turns.length === 1 && m.remaining - t.distance < 300 && t.kind !== 'roundabout');
  const yardName = () => latin(telemetry?.destinationCompany || '') || 'Firmengelände';
  // Straßennummer nach der Abbiegung als kleines Schild (Farbe wie auf der Karte: Autobahn blau/rot/grün, E grün, Landstraße gelb)
  const roadShield = (m) => (m.road ? `<b class="rshield k-${escape(m.roadKind || 'n')}">${escape(m.road)}</b>` : '');
  const arrowIcon = (kind, side) => `<span class="turn k-${kind} ${side === 'left' ? 'mirror' : ''}">${ICONS[`turn-${kind}`] || (kind === 'ferry' && ICONS.ferry) || ICONS.arrive}</span>`;

  let nextTurnDistance = Infinity; // für den Auto-Zoom vor Abbiegungen
  let legsKey = '', legsNow = null; // Arme der Kreuzung fürs Abbiegesymbol (Apple-Stil)

  // ------------------------------------------------------------------ Ampeln voraus (vom Plugin aus dem Spiel gelesen)
  let gameLights = [];
  let lightsAt = 0;
  // Kartensymbole wie Google Maps: ein Ampel-Zeichen je Kreuzung, aber nur entlang der Route –
  // ohne Route nur auf der Straße, auf der wir gerade fahren (Korridor in Fahrtrichtung)
  function onOurRoad(l) {
    const ourY = telemetry?.available ? telemetry.y : null;
    if (ourY != null && typeof l.y === 'number' && Math.abs(l.y - ourY) > 5) return false; // Brücke/Unterführung
    if (CarMap.routeActive()) {
      const a = CarMap.routeAheadDetail(l.x, l.z, 25);
      return !!a && a.along < 2000;
    }
    const p = pose.current();
    if (!p) return false;
    const hr = (p.h / 180) * Math.PI;
    const fx = -Math.sin(hr), fz = -Math.cos(hr);
    const dx = l.x - p.x, dz = l.z - p.z;
    const ahead = dx * fx + dz * fz;
    return ahead > -10 && ahead < 600 && Math.abs(dx * fz - dz * fx) < 25;
  }
  // Ein Symbol je Kreuzung in deren Mitte: Plugin ab 1.9.4 schickt g (Kreuzung). In ATS hängen die Ampeln an Auslegern
  // über jeder Zufahrt, oft auf der anderen Seite – einzeln gezeigt lagen die Symbole neben bzw. hinter der Kreuzung.
  function lightCenters() {
    const groups = new Map();
    for (const l of gameLights) {
      if (l.t !== 1) continue;
      const key = l.g ? `g${l.g}` : `${Math.round(l.x)},${Math.round(l.z)}`; // ältere Plugins: jede Ampel einzeln
      const g = groups.get(key) || { x: 0, y: 0, z: 0, n: 0, hasY: true };
      g.x += l.x;
      g.z += l.z;
      if (typeof l.y === 'number') g.y += l.y;
      else g.hasY = false;
      g.n++;
      groups.set(key, g);
    }
    return [...groups.values()].map((g) => ({ x: g.x / g.n, z: g.z / g.n, ...(g.hasY ? { y: g.y / g.n } : {}) }));
  }
  function updateLightIcons() {
    const fresh = performance.now() - lightsAt < 3000;
    CarMap.setLights(settings.mapLightIcons && fresh ? lightCenters().filter(onOurRoad) : []);
  }
  api?.onLights?.((list) => {
    gameLights = Array.isArray(list) ? list : [];
    lightsAt = performance.now();
    updateLightIcons();
  });
  const LIGHT_STATE = {
    // ohne Gelbphasen: Gelb (gleich Rot) zählt als Rot, Rot-Gelb (gleich Grün) als Grün
    2: ['red', 'Rot'], 1: ['red', 'Rot'], 4: ['green', 'Grün'], 8: ['green', 'Grün'],
  };
  // Protokoll der ersten Ampel-Begegnungen (Abstand; seitlich; Ausrichtung zur Route; Zustand; Restzeit) für die Auswertung
  const lightLog = [];
  setInterval(() => {
    if (lightLog.length && api?.appendLog) api.appendLog('ampeln.log', lightLog.splice(0).join(String.fromCharCode(10)) + String.fromCharCode(10));
  }, 5000);
  // Kurvenwarnung (Einstellung curveWarn): empfohlene Geschwindigkeit aus dem Kurvenradius – Querbeschleunigung
  // 2,0 m/s², mit über 15 t Ladung 1,6 m/s² (hoher Schwerpunkt). Nur wenn du deutlich schneller fährst.
  const spokenCurves = new Set();
  function curveAdvice(radius) {
    const heavy = num(telemetry?.cargoMassKg) > 15000;
    return Math.max(15, Math.floor((Math.sqrt((heavy ? 1.6 : 2.0) * radius) * 3.6) / 5) * 5);
  }
  function updateCurve(m) {
    const c = settings.curveWarn && m?.curve ? m.curve : null;
    const advise = c ? curveAdvice(c.radius) : 0;
    const v = num(telemetry?.speedKmh);
    const show = !!c && advise <= 70 && v > advise + 10;
    for (const el of nodes('mv-curve')) setHidden(el, !show);
    if (!show) return;
    const where = c.distance > 30 ? `Enge Kurve in ${meters(c.distance)}` : 'Enge Kurve';
    html('mv-curve', `${spd(advise)}|${where}`, `<span class="cw-sign">${spd(advise)}</span><span class="mv-curve-text">${escape(where)}</span>`);
    if (settings.navVoice && !spokenCurves.has(c.start) && c.distance < 400) {
      spokenCurves.add(c.start);
      // mit Einheit – sonst klang es wie ein Tempolimit
      speak(imperial() ? `Achtung, enge Kurve. Höchstens ${spd(advise)} mph.` : `Achtung, enge Kurve. Höchstens ${spd(advise)} km/h.`);
    }
  }

  // Nächstes Tempolimit (Einstellung mapNextLimit): klein neben dem aktuellen Schild im Tacho-Feld der Karte, mit Entfernung
  // (wie bei MBUX). Echte Schilder aus den Kartendaten ([x, y, Blickrichtung °, Wert]; ETS2 km/h, ATS mph), die in unsere
  // Richtung blicken, mit anderem Wert als jetzt: mit Route an der Route, ohne Route geradeaus auf unserer Straße (höchstens
  // 15 m seitlich). Erst etwa 12 s vor dem Schild (bei 50 km/h ~170 m, bei 90 km/h ~300 m; 150–450 m) – bis 800 m kam es zu früh
  // Auch fürs Kombiinstrument (1.18.6): dasselbe Schild neben dem aktuellen Limit im Tacho – gemeldet über den Kombi-Zustand
  let clusterNextLimitNow = null; // { value, dist } oder null
  // Straßen um den Truck (alle ~150 m bzw. 2 s neu, asynchron): Schilder an einer abzweigenden Straße erkennen – teilen sich
  // die Spuren (Ausfahrt, Gabelung), stand sonst das Limit der anderen Straße als „bald“ da, obwohl die Route geradeaus führt
  let limitNet = null, limitNetAt = 0, limitNetPos = null, limitNetBusy = false;
  function refreshLimitNet(p) {
    const now = performance.now();
    if (limitNetBusy || !CarMap.linesNear) return;
    if (limitNetPos && now - limitNetAt < 2000 && Math.hypot(p.x - limitNetPos.x, p.z - limitNetPos.z) < 150) return;
    limitNetBusy = true;
    limitNetAt = now;
    limitNetPos = { x: p.x, z: p.z };
    CarMap.linesNear(p.x, p.z, 700).then((l) => { limitNet = l && l.length ? l : null; }, () => {}).finally(() => (limitNetBusy = false));
  }
  // Abstand eines Punkts zur nächsten Straßenmitte (Infinity ohne Daten)
  function nearestRoadDist(x, z) {
    let best = Infinity;
    for (const l of limitNet || []) {
      const q = l.p;
      for (let i = 0; i + 3 < q.length; i += 2) {
        const ax = q[i], az = q[i + 1], bx = q[i + 2], bz = q[i + 3];
        if ((ax - x > best && bx - x > best) || (x - ax > best && x - bx > best) || (az - z > best && bz - z > best) || (z - az > best && z - bz > best)) continue;
        const dx = bx - ax, dz = bz - az;
        const len2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
        const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
        if (d < best) best = d;
      }
    }
    return best;
  }
  function updateNextLimit() {
    let best = null;
    const t = telemetry;
    const p = pose.current();
    const forCluster = typeof clusterActive !== 'undefined' && clusterActive && settings.clusterNextLimit !== false;
    if ((settings.mapNextLimit || forCluster) && p && t?.available && CarMap.limitsNear) {
      const nowKmh = num(t.speedLimitKmh);
      const routed = CarMap.hasRoute() && CarMap.onRoute();
      const reach = Math.max(150, Math.min(450, (num(t.speedKmh) / 3.6) * 12)); // etwa 12 s voraus
      const hr = (p.h / 180) * Math.PI;
      const fx = -Math.sin(hr), fz = -Math.cos(hr);
      // Schilder in Großbritannien zeigen mph (Kartendaten: Zahl wie auf dem Schild, Issue #9) – wie in ATS umrechnen
      const mphSigns = isAts() || !!countryHere(p.x, p.z)?.mph;
      if (routed) refreshLimitNet(p);
      for (const [x, z, deg, value] of CarMap.limitsNear(p.x, p.z, 900) || []) {
        if (!(value > 0)) continue;
        let ahead = null;
        if (routed) ahead = CarMap.routeAheadDetail(x, z, 20);
        else {
          const dx = x - p.x, dz = z - p.z;
          const a = dx * fx + dz * fz;
          if (a <= reach && Math.abs(dx * fz - dz * fx) < 15) ahead = { along: a, dir: [fx, fz] };
        }
        if (!ahead || ahead.along < 15 || ahead.along > reach) continue;
        let d = Math.abs(deg - (Math.atan2(ahead.dir[1], ahead.dir[0]) * 180) / Math.PI) % 360;
        if (d > 180) d = 360 - d;
        if (d > 50) continue; // Schild für die Gegenrichtung oder eine Querstraße
        const kmh = mphSigns ? value * 1.609344 : value;
        if (nowKmh > 0 && Math.abs(kmh - nowKmh) < 2) continue; // gilt schon
        // Mit Route: steht das Schild deutlich näher an einer anderen Straße als an der Route (Ausfahrt, Gabelung, Spuren
        // teilen sich), gilt es der anderen Straße – nicht anzeigen. Deutlich: höchstens 60 % des Abstands und 4 m näher, damit
        // Schilder am Mittelstreifen der eigenen Straße bleiben
        if (routed && ahead.lateral > 6) {
          const other = nearestRoadDist(x, z);
          if (other < ahead.lateral * 0.6 && ahead.lateral - other > 4) continue;
        }
        if (!best || ahead.along < best.along) best = { along: ahead.along, kmh, value, mph: mphSigns };
      }
    }
    for (const el of nodes('next-limit')) setHidden(el, !best || !settings.mapNextLimit);
    // Wert wie auf dem Schild: ATS und Großbritannien mph, sonst km/h (mit mph-Einstellung auf 5 gerundet umgerechnet)
    const shown = best ? (best.mph ? (imperial() ? best.value : Math.round(best.kmh)) : imperial() ? Math.round((best.kmh * 0.621371) / 5) * 5 : best.value) : 0;
    clusterNextLimitNow = best && forCluster ? { value: shown, dist: Math.round(best.along) } : null;
    if (!best || !settings.mapNextLimit) return;
    // Leiste darunter: nach der wirklichen Lage des Tacho-Felds (der Google-Stil setzt es immer nach oben rechts) –
    // in der unteren Hälfte der Karte über dem Feld, in der linken Hälfte linksbündig
    {
      for (const el of nodes('next-limit')) {
        const box = el.parentElement, map = box?.closest('.map');
        if (!box || !map || !box.classList.contains('nl-below')) continue;
        const r = box.getBoundingClientRect(), m = map.getBoundingClientRect();
        if (!r.height) continue;
        el.classList.toggle('nl-up', r.top + r.height / 2 > m.top + m.height / 2);
        el.classList.toggle('nl-left', r.left + r.width / 2 < m.left + m.width / 2);
      }
    }
    html('nl-sign', String(shown), `<span class="lv">${shown}</span>`);
    toggle('nl-sign', 'd3', String(shown).length >= 3);
    text('nl-dist', meters(Math.max(50, Math.round(best.along / 50) * 50)).replace(/ /g, ' '));
  }

  function updateLight() {
    let best = null;
    const p = pose.current();
    // Auf welcher Seite der Routenlinie fahren wir? (rechts in Kontinentaleuropa, links in Großbritannien)
    // Fahrbahnseite nach dem Land: Linksverkehr in Großbritannien (mph-Schilder), Irland, Malta, Zypern – vorher immer rechts
    // (die Abfrage unten lieferte nie etwas), in Großbritannien kam so die Ampel des Gegenverkehrs
    const land = p && !isAts() ? countryHere(p.x, p.z) : null;
    const leftHandLand = !!land && (land.mph || ['IE', 'MT', 'CY'].includes(land.iso));
    const ourSide = leftHandLand ? -1 : 1; // nach dem Land (die Lage zur Routenlinie ist auf mehrspurigen Straßen nicht verlässlich)
    const ourY = telemetry?.available ? telemetry.y : null;
    if (settings.mapLights && performance.now() - lightsAt < 3000) {
      for (const l of gameLights) {
        if (l.t !== 1 || !LIGHT_STATE[l.s]) continue;  // nur Ampeln (Schranken: t 2), keine blinkenden/ausgeschalteten
        const ahead = CarMap.routeAheadDetail(l.x, l.z, 14);
        if (!ahead || ahead.along > 350) continue;
        // ATS: unsere Ampel hängt hinter der Kreuzung. Biegt die Route vorher ab, lägen danach nur noch Ampeln anderer
        // Fahrtrichtungen an der Route (Gegenverkehr, Querverkehr) – lieber keine als die falsche
        // Auch kurz davor: an der Kreuzung, an der wir abbiegen, hängt unsere Ampel nicht an der Route – die nahe Ampel ist dort
        // die des Gegen- oder Querverkehrs (Linksabbiegen: „Grün“, obwohl unsere rot war)
        if (isAts() && ahead.along > nextTurnDistance - 25) continue;
        // Ampeln für den Querverkehr ausschließen: Blickrichtung parallel zur Route (für uns oder den Gegenverkehr)
        const fx = -Math.sin(l.h), fz = -Math.cos(l.h);
        const dot = fx * ahead.dir[0] + fz * ahead.dir[1];
        const dy = ourY != null && typeof l.y === 'number' ? l.y - ourY : 0;
        if (lightLog.length < 300 && role === 'game') lightLog.push(`${Math.round(ahead.along)};${ahead.side.toFixed(1)};${ourSide};${dot.toFixed(2)};${dy.toFixed(1)};${l.s};${l.r.toFixed(1)}`);
        if (Math.abs(dot) < 0.75) continue;
        // nur Ampeln auf unserer Fahrbahnseite (die gegenüber gelten dem Gegenverkehr)
        if (Math.sign(ahead.side) !== ourSide) continue;
        // Brücke oder Unterführung: Ampel deutlich über oder unter uns
        if (Math.abs(dy) > 5) continue;
        if (!best || ahead.along < best.along) best = { ...l, along: ahead.along };
      }
    }
    updateLightIcons();
    toggle('mv-light', 'hidden', !best);
    for (const el of nodes('mv-light')) setHidden(el, !best);
    if (!best) return;
    const [cls, name] = LIGHT_STATE[best.s] || ['off', '–'];
    // Restzeit nur bei echtem Rot/Grün – in den Übergängen wäre es die kurze Gelbzeit, nicht die Zeit bis zum Wechsel.
    // Zahl und Einheit mit geschütztem Leerzeichen, damit „s“ bzw. „m“ nie allein in die nächste Zeile rutscht
    const secs = (best.s === 2 || best.s === 8) && best.r > 0.5 && best.r < 120 ? ` · noch ${Math.ceil(best.r)}\u00a0s` : '';
    html('mv-light', `${cls}|${Math.round(best.along / 10)}|${secs}`,
      `<span class="tl"><i class="${cls === 'red' ? 'on red' : ''}"></i><i class="${cls === 'green' ? 'on green' : ''}"></i></span>
       <span class="mv-light-text">Ampel in ${meters(best.along).replace(/ /g, '\u00a0')} · <b>${name}</b>${secs}</span>`);
    fitText('mv-light', '.mv-light-text');
  }
  // Text, der nicht in seinen Platz passt (Breite, bei mehrzeiligen Feldern auch Höhe), schrittweise kleiner setzen
  // statt mit „…“ abzuschneiden – höchstens bis minScale, damit es lesbar bleibt.
  // Nur neu messen, wenn sich Inhalt oder Breite geändert haben (läuft 4× pro Sekunde).
  function fitText(name, selector, minScale = 0.6) {
    for (const node of nodes(name)) {
      const el = selector ? node.querySelector(selector) : node;
      if (!el) continue;
      const w = el.clientWidth;
      // Ziffern zählen nicht: aus „800 m“ wird „750 m“ ohne neue Messung (jede Messung erzwingt ein Layout)
      const fitKey = `${w}|${el.innerHTML.replace(/\d/g, '0')}`;
      if (!w || el.dataset.fit === fitKey) continue;
      el.style.fontSize = '';
      const base = parseFloat(getComputedStyle(el).fontSize);
      let size = base;
      const over = () => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      while (over() && size > base * minScale) {
        size -= base * 0.04;
        el.style.fontSize = `${size}px`;
      }
      el.dataset.fit = fitKey;
    }
  }
  // Kartenfehler melden: Position, Blickrichtung, Zoom, Kartenstand und ein Bild der Karte (ohne Menü) speichern –
  // zum gezielten Prüfen und Korrigieren (Ordner map-reports im Datenordner)
  async function reportMapIssue(kind = 'other') {
    mapSheetOpen = false;
    rerenderMapSheet();
    const p = pose.current();
    const view = maps.find((m) => m.canvas.closest('.map-full')) || maps[0];
    let image = null;
    try {
      if (view) {
        view.lastSignature = '';
        image = view.canvas.toDataURL('image/png');
      }
    } catch {
      // Bild nicht verfügbar
    }
    const t = telemetry || {};
    const report = {
      at: new Date().toISOString(),
      kind, // land: Wasser, wo Land ist · water: Land, wo Wasser ist · other
      x: p ? Math.round(p.x * 10) / 10 : null,
      z: p ? Math.round(p.z * 10) / 10 : null,
      heading: p ? Math.round(p.h) : null,
      metersPerPx: view ? Math.round(view.metersPerPx * 100) / 100 : null,
      style: settings.mapStyle,
      theme: mapThemeName(),
      mapBuilt: mapStatus?.built || null,
      app: appVersion || null,
      city: t.city || null,
      nearestCity: p ? CarMap.nearestCity(p.x, p.z)?.en || null : null,
    };
    const saved = api?.saveMapReport ? await api.saveMapReport(report, image).catch(() => null) : null;
    showToast({ icon: 'maps', color: 'blue', title: 'Kartenfehler gemeldet', text: saved?.ok ? (report.nearestCity ? `Gespeichert – nahe ${report.nearestCity}` : 'Gespeichert') : 'Konnte nicht gespeichert werden' });
  }

  // Spurempfehlung verbessern (Einstellung laneShare): auf den letzten 150 m vor der Kreuzung die Spur des Trucks
  // verfolgen, nach der Durchfahrt prüfen, ob er auf der Route blieb, und dem Hauptprozess melden (main/lane-learn.js).
  // Nur wenn er die ganze Zeit (mind. 50 m) in derselben Spur war – mitten im Spurwechsel oder Einfädeln sagt die
  // Spur nichts über die Empfehlung.
  // Blinkerhebel (Plugin ab 1.7) als Zusatzsignal – er unterdrückt nur etwas (Ansage, Zählung), löst nie selbst etwas
  // aus: Blinken zum Überholen oder versehentlich ändert so weder Route noch Hinweise. Der Hebel springt im Spiel nach
  // dem Spurwechsel zurück, daher zählt ein Blinken noch 3 s nach.
  let blinkSeen = { side: '', t: -1e9 };
  function blinkSide(maxAge = 3000) {
    const t = telemetry;
    const now = performance.now();
    if (t && !t.hazard && (t.blinkerLeft || t.blinkerRight)) blinkSeen = { side: t.blinkerLeft ? 'l' : 'r', t: now };
    return now - blinkSeen.t < maxAge ? blinkSeen.side : '';
  }

  let laneWatch = null;
  function learnLanes(m) {
    if (role !== 'game' || !settings.laneShare || !api?.laneLearn) return;
    const hint = m?.laneHint;
    if (hint?.key && hint.distance >= 10 && hint.distance < 150) {
      const lane = hint.laneNow && hint.laneNow.own === hint.lanes ? hint.laneNow.lane : -1;
      if (laneWatch?.key !== hint.key) laneWatch = { key: hint.key, lanes: hint.lanes, mask: hint.mask, lane, own: hint.own ? 1 : 0, from: hint.distance, x: hint.at?.x, z: hint.at?.y, blink: '' };
      else if (laneWatch.lane !== lane) laneWatch.lane = -1;
      const b = blinkSide();
      if (b && !laneWatch.blink.includes(b)) laneWatch.blink += b;
      laneWatch.to = hint.distance;
      return;
    }
    if (!laneWatch || hint?.key === laneWatch.key) return;
    const { from, to, ...r } = laneWatch;
    laneWatch = null;
    // nach der Kreuzung ein paar Sekunden abwarten: noch auf der Route? Ins Navi-Fahrtenbuch kommt jede Durchfahrt,
    // in die Zähler (Teilen auf GitHub) nur die mit stabiler Spur – wer auf den letzten 150 m geblinkt hat, war mitten
    // im Spurwechsel, seine Spur sagt nichts über die Empfehlung
    const stable = r.lane >= 0 && from - to >= 50 && !r.blink;
    setTimeout(() => {
      const stayed = CarMap.hasRoute() && CarMap.onRoute();
      api.naviEvent?.({ type: 'lane', ...r, x: Math.round(r.x || 0), z: Math.round(r.z || 0), stable, stayed });
      // gezählt (und auf GitHub geteilt) nur, wo die Kreuzung selbst die Spur verlangt – bei einer Vorgabe für eine
      // spätere Kreuzung darf man vorher noch wechseln, eine andere Spur ist dort kein Fehler
      if (stable && r.own) api.laneLearn({ ...r, stayed });
    }, 5000);
  }

  // Navi-Fahrtenbuch: Abbiegungen (gefolgt oder nicht) und Verlassen der Route mit dem zuletzt gezeigten Hinweis
  let naviTurn = null; // nächste Abbiegung beim letzten Mal
  let naviOff = false;
  let naviLogged = null; // zuletzt protokollierte Abbiegung { t, x, z }
  function naviEvents(m, offRoute) {
    blinkSide(); // Blinker mitschreiben, auch wenn gerade kein Hinweis ansteht
    if (role !== 'game' || !settings.laneShare || !api?.naviEvent) return;
    const p = pose.current();
    const at = p ? { x: Math.round(p.x), z: Math.round(p.z) } : {};
    const first = m?.turns?.[0] || null;
    const t = first?.start ? null : first; // Wende beim Losfahren wandert mit dem Truck – keine Abbiegung der Route
    // dieselbe Abbiegung nur einmal: nach dem Verlassen der Route rechnet die Route laufend neu, der Index wechselt
    // dann bei jedem Bild – Abbiegungen innerhalb von 80 m und 60 s gelten als eine
    const now = performance.now();
    const dup = naviLogged && now - naviLogged.t < 60000 && Math.hypot((at.x ?? 0) - naviLogged.x, (at.z ?? 0) - naviLogged.z) < 80;
    if (naviTurn && (!t || t.index !== naviTurn.index) && naviTurn.distance < 150 && !dup) {
      const passed = naviTurn;
      naviLogged = { t: now, x: at.x ?? 0, z: at.z ?? 0 };
      const blink = blinkSide(8000); // geblinkt vor der Abbiegung? (für die Auswertung)
      setTimeout(() => api.naviEvent({ type: 'turn', kind: passed.kind, side: passed.side, road: passed.road || '', towards: passed.towards || '', ...at, blink, stayed: CarMap.hasRoute() && CarMap.onRoute() }), 5000);
    }
    if (offRoute && !naviOff) {
      api.naviEvent({ type: 'offroute', ...at, blink: blinkSide(8000), kmh: Math.round(num(telemetry?.speedKmh)), lastKind: naviTurn?.kind || '', lastSide: naviTurn?.side || '', lastDist: naviTurn ? Math.round(naviTurn.distance) : -1 });
    }
    naviOff = offRoute;
    if (m) naviTurn = t ? { index: t.index, kind: t.kind, side: t.side, distance: t.distance, road: t.road, towards: t.towards } : null;
  }

  // 车道引导（高德式）：150–900 m 前主动播报推荐车道（SET 集合 / SINGLE 单条）；
  // 走错车道 3 秒后纠偏。同一路口主动播一次、纠偏播一次。
  const laneSaid = new Set();   // 主动推荐已播（一次）
  const laneWarned = new Set(); // 纠偏已播（一次）
  let laneWrongSince = 0;
  function lanePhrase(count, goal) {
    // goal：从左边数(0-based)的推荐车道索引（已升序）
    if (goal.length === 1) {
      const idx = goal[0];
      const fromLeft = idx + 1;      // 从左数第几
      const fromRight = count - idx; // 从右数第几
      if (fromLeft <= fromRight) return `Bitte die ${fromLeft}. Spur von links nehmen.`;
      return `Bitte die ${fromRight}. Spur von rechts nehmen.`;
    }
    if (goal.length === count) return ''; // 全车道可走，不提示
    const leftCount = goal.length;
    const fromLeftEdge = goal[0];
    const fromRightEdge = count - 1 - goal[goal.length - 1];
    if (fromLeftEdge <= fromRightEdge) return `Bitte die ${leftCount} linken Spuren nehmen.`;
    return `Bitte die ${leftCount} rechten Spuren nehmen.`;
  }
  function laneVoice(m) {
    const hint = m?.laneHint;
    if (!settings.navVoice || !hint?.key || hint.distance < 40 || hint.distance > 900) { laneWrongSince = 0; return; }
    const goal = [...Array(hint.lanes).keys()].filter((i) => (hint.mask >> i) & 1);
    if (!goal.length) { laneWrongSince = 0; return; }
    // 主动推荐（一次）：只要有车道选择就报，不依赖当前车道数
    if (!laneSaid.has(hint.key)) {
      laneSaid.add(hint.key);
      const p = lanePhrase(hint.lanes, goal);
      if (p) speak(p, null, { priority: 2 });
    }
    // 纠偏：需要知道当前车道（且车道数一致时才能判断是否走错）
    if (!hint.laneNow || hint.laneNow.own !== hint.lanes) { laneWrongSince = 0; return; }
    const lane = hint.laneNow.lane;
    if ((hint.mask >> lane) & 1) { laneWrongSince = 0; return; } // 已在推荐车道
    if (laneWarned.has(hint.key)) { laneWrongSince = 0; return; }
    // blinkt schon in Richtung der richtigen Spur: wechselt gerade – nicht dazwischenreden
    const blink = blinkSide();
    if (blink && ((blink === 'l' && goal[0] < lane) || (blink === 'r' && goal[goal.length - 1] > lane))) { laneWrongSince = 0; return; }
    const now = performance.now();
    if (!laneWrongSince) { laneWrongSince = now; return; }
    if (now - laneWrongSince < 3000) return;
    let best = -1;
    for (let i = 0; i < hint.lanes; i++) if ((hint.mask >> i) & 1 && (best < 0 || Math.abs(i - lane) < Math.abs(best - lane))) best = i;
    if (best < 0) return;
    laneWarned.add(hint.key);
    laneWrongSince = 0;
    speak(best < lane ? 'Bitte links einordnen.' : 'Bitte rechts einordnen.', null, { priority: 2 });
  }

  let navActive = false;
  let onRouteSeen = false; // war der Truck schon auf dieser Route? (sonst: Start abseits, z. B. Firmengelände)
  let laneNowSeen = null; // für das Kombiinstrument (Fahrassistenz-Ansicht)
  // Spurempfehlung fürs Kombiinstrument: { lanes, mask (Bit i = Spur i von links empfohlen), lane (jetzige Spur), dist (m bis
  // zur Stelle, an der die Spur zählt) } – nur wenn die Spurzahl der Straße zur Empfehlung passt, sonst null
  let laneAdviceNow = null;
  function updateManeuver() {
    const m = CarMap.hasRoute() && CarMap.onRoute() ? CarMap.maneuvers(pose.current()?.h) : null;
    laneNowSeen = m?.laneNow || null;
    laneAdviceNow = null;
    // Spielmaßstab messen: Spiel-Restkilometer / Weltmeter bis zum Ziel (nur bei längerer Strecke aussagekräftig)
    const navKm = num(telemetry?.navDistanceKm);
    if (m && m.remaining > 3000 && navKm > 5) {
      const r = (navKm * 1000) / m.remaining;
      if (r > 1.5 && r < 40) worldScale += (r - worldScale) * 0.05;
    }
    learnLanes(m);
    laneVoice(m);
    // Route verlassen: bis das Spiel die neue Route schickt, keinen alten (falschen) Hinweis zeigen
    if (m) onRouteSeen = true;
    // nicht auf Rast- und Tankplätzen (dort verlässt man die Route absichtlich) und nicht beim Rangieren
    const here = pose.current();
    updateNextLimit(); // auch ohne Route
    const atRest = here && CarMap.poisNear(['p', 'g'], here.x, here.z, 500).some((poi) => Math.hypot(poi[1] - here.x, poi[2] - here.z) < 500);
    const offRoute = !m && onRouteSeen && CarMap.hasRoute() && num(telemetry?.speedKmh) > 25 && !atRest;
    naviEvents(m, offRoute);
    toggle('maneuver', 'idle', !m && !offRoute);
    if (offRoute) {
      html('mv-arrow', 'recalc', `<span class="turn recalc">${ICONS.reset || ''}</span>`);
      text('mv-dist', 'Route wird neu berechnet …');
      html('mv-road', 'recalc', '');
      toggle('mv-lanes', 'hidden', true);
      toggle('mv-then', 'hidden', true);
      for (const el of nodes('road-notice')) setHidden(el, true);
      nextTurnDistance = Infinity;
      return;
    }
    if (!!m !== navActive) {
      navActive = !!m;
      if (navActive) surfaceWidget('nav');
    }
    if (!m) return;
    const t = telemetry || {};
    const destination = t.hasJob ? latin(t.destinationCity) : m.destination;
    const first = m.turns[0];
    let arrow;
    let dist;
    let road;
    // Abbiegung noch weit weg (über 2 km): Geradeaus-Pfeil, die Abbiegung steht klein als „Dann“ daneben
    const far = first && first.distance > 2000;
    // Buslinie: Zwischenhalt vor der nächsten Abbiegung und unter 1,5 km entfernt – wie das Ziel ankündigen
    const stop = busNextStop(t);
    const stopNear = !!stop && !stop.last && stop.along < 1500 && (!first || stop.along < first.distance);
    if (stopNear) {
      arrow = stop.along > 1000 ? ['straight', ''] : ['arrive', ''];
      dist = meters(stop.along);
      road = `<span>Halt</span><span class="mv-sep"> · </span><span class="mv-tw">${escape(latin(stop.name || ''))}</span>`;
    } else if (far) {
      arrow = ['straight', ''];
      dist = meters(first.distance);
      road = `<span>Geradeaus</span>${m.towards ? `<span class="mv-sep"> · </span><span class="mv-tw">Richtung ${escape(m.towards)}</span>` : ''}`;
    } else if (first) {
      arrow = [first.kind, first.side];
      dist = meters(first.distance);
      // Abbiegen und Richtung als eigene Teile: im schmalen Navi-Widget stehen sie in zwei Zeilen
      road = yardTurn(m, first)
        ? `<span>${escape(turnText(first))}</span><span class="mv-sep"> · </span><span class="mv-tw">aufs Gelände: ${escape(yardName())}</span>`
        : `<span>${escape(turnText(first))}</span>${m.towards || m.road ? `<span class="mv-sep"> · </span><span class="mv-tw">${roadShield(m)}${m.towards ? `${m.road ? '' : 'Richtung '}${escape(m.towards)}` : ''}</span>` : ''}`;
    } else if (m.arriving) {
      // Wie die Abbiegungen: erste Zeile „Ziel: Firma“, zweite die Stadt; noch weit weg: Geradeaus-Pfeil statt Nadel
      arrow = m.remaining > 1000 ? ['straight', ''] : ['arrive', ''];
      dist = meters(m.remaining);
      const company = t.hasJob ? latin(t.destinationCompany || '') : '';
      const head = company ? `Ziel: ${company}` : destination ? 'Ziel' : 'Ziel erreicht';
      road = `<span>${escape(head)}</span>${destination ? `<span class="mv-sep"> · </span><span class="mv-tw">${escape(destination)}</span>` : ''}`;
    } else {
      arrow = ['straight', ''];
      dist = 'Der Route folgen';
      road = escape(m.towards ? `Richtung ${m.towards}` : destination ? `Richtung ${destination}` : '');
    }
    // Apple-Stil: beim Abbiegen um 90° die grauen Arme der Kreuzung unter dem Pfeil – nur die vorhandenen
    let legs = '';
    if (arrow[0] === 'turn' && first && Number.isInteger(first.index)) {
      const lk = `${first.index}|${arrow[1]}`;
      if (legsKey !== lk) {
        legsKey = lk;
        legsNow = null;
        CarMap.junctionLegs?.(first.index).then((r) => { if (legsKey === lk) legsNow = r; }).catch(() => {});
      }
      if (legsNow) legs = `${legsNow.straight ? ' leg-s' : ''}${legsNow.opposite ? ' leg-o' : ''}`;
    }
    const key = arrow.join('-') + legs;
    html('mv-arrow', key, arrowIcon(arrow[0], arrow[1]).replace('class="turn ', `class="turn${legs} `));
    text('mv-dist', dist);
    html('mv-road', road, road);
    fitText('mv-dist');
    fitText('mv-road', '.mv-tw', 0.8);
    fitText('mv-road');
    // Spuren wie bei Apple Karten: ab 1,5 km vor der Abbiegung, richtige Spur hell, die anderen gedimmt.
    // Vorausschauend (laneHint): auch für die Kreuzungen danach richtig, und auch wo es geradeaus weitergeht und sich
    // die Spuren teilen. Ohne diese Kartendaten: aus der Kreuzung selbst, sonst geschätzt (äußere Spur zur Abbiegeseite).
    const hint = m.laneHint;
    // Ohne vorausschauenden Hinweis: Spuren der Kreuzung erst, wenn die Straße so viele Spuren hat (Abbiegespur, die erst
    // kurz vor der Ausfahrt dazukommt: ab 200 m vor ihrem Beginn) oder 250 m vor der Abbiegung – vorher lägen Tankstellen
    // und andere Ausfahrten dazwischen, und die Anzeige zeigte eine Spur, die es noch gar nicht gibt
    const lanesReady = (at) => !(at > 200) || first.distance < 250;
    const exact = hint ? [hint.lanes, hint.mask] : first && first.junction && first.distance < 1500 && lanesReady(m.turnLanesAt) ? first.junction : null;
    // Empfehlung fürs Instrument: vorausschauender Hinweis, sonst die Spuren der Kreuzung (wie die Ansage „einordnen“)
    const now = hint?.laneNow || m.laneNow;
    if (exact && exact[1] && now && now.own === exact[0] && first) laneAdviceNow = { lanes: exact[0], mask: exact[1], lane: now.lane, dist: Math.round(hint ? hint.distance : first.distance) };
    const lanes = hint?.view ? hint.view.length : exact ? Math.min(exact[0], 8) : first && first.lanes >= 2 && first.distance < 1500 && lanesReady(m.guessLanesAt) ? Math.min(first.lanes, 6) : 0;
    if (lanes) {
      const [kind, side] = hint && !hint.atTurn ? ['straight', ''] : [first.kind, first.side];
      const guess = kind === 'uturn' ? 0 : side === 'left' ? 0 : lanes - 1;
      const usable = (i) => (exact ? (exact[1] >> i) & 1 : i === guess);
      // aktuelle Spur (Punkt darunter): nur wenn die Spurzahl der Straße passt; bei Zusatzspuren rechts zählen die linken
      const view = hint?.view;
      // Vor einem Kreisverkehr: in jeder Spur das Kreisverkehr-Symbol mit der Richtung ihrer Ausfahrt (wie bei Google),
      // statt einfacher Abbiegepfeile – sonst wirkten die Spuren zweispuriger Kreisverkehre wie eine Kreuzung
      const rb = !!first && first.kind === 'roundabout' && (!hint || hint.atTurn);
      const laneIcon = (k2, s2) => {
        if (!rb) return arrowIcon(k2, s2);
        if (k2 === 'roundabout') return s2 === 'left' || s2 === 'right' ? arrowIcon('rb-right', s2) : arrowIcon('rb-straight', '');
        if (k2 === 'straight') return arrowIcon('rb-straight', '');
        if (k2 === 'slight') return arrowIcon('roundabout', s2);
        if (k2 === 'turn' || k2 === 'sharp') return arrowIcon('rb-right', s2);
        return arrowIcon('rb-plain', '');
      };
      // Pfeile je Spur (von links) fürs Instrument: auf die Fahrbahn gemalt vor der Kreuzung (wie bei Tesla)
      if (laneAdviceNow) {
        const arrows = view ? view.map(([k2, s2]) => [k2, s2]) : Array.from({ length: lanes }, (_, i) => (usable(i) ? [kind, side] : hint?.arrows?.[i] || ['straight', '']));
        if (arrows.length === laneAdviceNow.lanes) laneAdviceNow.arrows = arrows;
      }
      const nowLane = settings.laneMarker && hint?.laneNow && (hint.laneNow.own === (view ? view.filter((v) => v[2] === 0 || v[1] !== 'right').length : lanes) || hint.laneNow.own === lanes) ? hint.laneNow.lane : -1;
      const cells = view
        ? view.map(([k2, s2, on], i) => `<span class="lane ${on ? 'on' : ''} ${i === nowLane ? 'here' : ''}">${laneIcon(k2, s2)}</span>`)
        : Array.from({ length: lanes }, (_, i) => (usable(i)
          ? `<span class="lane on ${i === nowLane ? 'here' : ''}">${laneIcon(kind, side)}</span>`
          : `<span class="lane ${i === nowLane ? 'here' : ''}">${rb && !hint?.arrows?.[i] ? laneIcon(null, '') : laneIcon(...(hint?.arrows?.[i] || ['straight', '']))}</span>`));
      html('mv-lanes', `${rb ? 'rb-' : ''}${lanes}-${kind}-${side}-${exact ? exact[1] : 'g'}-${hint?.arrows ? hint.arrows.map((a) => (a ? a.join('') : '')).join(',') : ''}-${view ? view.map((v) => v.join('')).join(',') : ''}-${nowLane}`, cells.join(''));
    }
    toggle('mv-lanes', 'hidden', !lanes);
    const then = far ? first : m.turns[1] && first && m.turns[1].distance - first.distance < 600 ? m.turns[1] : null;
    toggle('mv-then', 'hidden', !then);
    if (then) html('mv-then-arrow', `${then.kind}-${then.side}`, arrowIcon(then.kind, then.side));
    nextTurnDistance = first ? first.distance : Infinity;
    updateLight();
    updateCurve(m);
    updateRoadNotice();
    announceTurn(m);
  }

  // ------------------------------------------------------------------ Bildschleife
  let lastSlowUpdate = 0;
  let lastMapFrame = 0;
  let mapFrameGap = 0; // Abstand der Kartenbilder in ms (aus der letzten Runde)
  let screenFps = 30; // Bildrate des Displays im Truck – öfter zu zeichnen ist verschwendet
  // Zoom-Knöpfe wie in echt nur bei Bedarf: Karte antippen blendet sie ein, nach 6 s verschwinden sie wieder
  let zoomVisible = false;
  let zoomTimer = 0;
  function showZoom() {
    zoomVisible = true;
    for (const el of nodes('zoom-pill')) el.classList.add('show');
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      zoomVisible = false;
      for (const el of nodes('zoom-pill')) el.classList.remove('show');
    }, 6000);
  }
  document.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element && e.target.closest('.map-full') && !e.target.closest('.map-menu')) showZoom();
  });

  // Übersicht der ganzen Route (wie Google Maps); kehrt nach 20 s von selbst zur Fahrtansicht zurück
  let mapOverview = false;
  let overviewTimer = 0;
  function setOverview(on) {
    mapOverview = !!on && CarMap.hasRoute();
    clearTimeout(overviewTimer);
    if (mapOverview) overviewTimer = setTimeout(() => setOverview(false), 20000);
    else if (on) showToast({ icon: 'maps', color: 'blue', title: 'Übersicht', text: 'Keine Route – Ziel im Navi des Spiels setzen', open: 'maps' });
    toggle('overview-btn', 'active', mapOverview);
  }

  // Rastplätze und Tankstellen entlang der Route (Option): die nächsten an der Route mit Entfernung und Ankunft
  let alongAt = 0;
  function updateAlong() {
    if (!settings.mapAlong || screen !== 'maps') {
      for (const el of nodes('along')) setHidden(el, true);
      return;
    }
    const now = performance.now();
    if (now - alongAt < 2000) return;
    alongAt = now;
    const p = pose.current();
    const t = telemetry;
    const show = !!(p && CarMap.routeActive());
    for (const el of nodes('along')) setHidden(el, !show);
    if (!show) return;
    const found = [];
    for (const [type, x, y, label] of CarMap.poisNear(['p', 'g'], p.x, p.z, 150000)) {
      const along = CarMap.routeAhead(x, y, 220);
      if (along != null && along > 200) found.push({ type, x, y, label, along });
    }
    found.sort((a, b) => a.along - b.along);
    const pick = [...found.filter((f) => f.type === 'p').slice(0, 2), ...found.filter((f) => f.type === 'g').slice(0, 2)].sort((a, b) => a.along - b.along);
    // Fahrzeit aus der Navi-Schätzung des Spiels (sonst 75 km/h)
    const minPerKm = t && t.navDistanceKm > 1 && t.navTimeMin > 0 ? t.navTimeMin / t.navDistanceKm : 60 / 75;
    list('along', pick.length ? pick.map((f) => {
      const city = CarMap.nearestCity(f.x, f.y);
      const mins = (gameMeters(f.along) / 1000) * minPerKm;
      const at = t && t.available ? `${clockU(t.gameTimeMin + mins)}` : duration(mins);
      return `<div class="along-row">${badge(f.type === 'p' ? 'parking' : 'fuel', f.type === 'p' ? 'gray' : 'blue')}
        <div class="lr-text"><b>${f.type === 'p' ? 'Rastplatz' : 'Tankstelle'}${city ? ` ${city.d < 4000 ? 'in' : 'bei'} ${escape(city.name)}` : ''}</b><small>${distance(gameMeters(f.along) / 1000)} · ${at}</small></div></div>`;
    }).join('') : '<div class="along-empty">Nichts an der Route voraus</div>');
  }

  // Breite der Seitenleiste in Pixeln (+ links, − rechts) – Karte und Musik liegen darunter
  let sideInsetCache = { key: '', px: 0 };
  function sideInset() {
    const key = `${window.innerWidth}|${settings.sidebar}`;
    if (sideInsetCache.key !== key) {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
      // Leiste oben/unten liegt in einer eigenen Zeile, nicht über der Karte: kein Versatz
      sideInsetCache = { key, px: settings.sidebar === 'top' || settings.sidebar === 'bottom' ? 0 : rem * 11.6 * (settings.sidebar === 'right' ? -1 : 1) };
    }
    return sideInsetCache.px;
  }
  // Leiste oben/unten: das Kartenbild reicht darunter (03-ios-stil.css) – Höhe der Leiste samt Rand in Pixeln (+ oben, − unten)
  let sideInsetYCache = { key: '', px: 0 };
  function sideInsetY() {
    if (settings.sidebar !== 'top' && settings.sidebar !== 'bottom') return 0;
    const key = `${window.innerWidth}x${window.innerHeight}|${settings.sidebar}`; // rem hängt an Breite und Höhe
    if (sideInsetYCache.key !== key) {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
      sideInsetYCache = { key, px: rem * 9.6 * (settings.sidebar === 'bottom' ? -1 : 1) };
    }
    return sideInsetYCache.px;
  }

  // Farbschema der Karte – unabhängig von Hell/Dunkel des Systems wie bei Google Maps und Apple Karten
  function mapThemeName() {
    const mode = settings.mapTheme;
    if (mode === 'light' || mode === 'dark') return mode;
    if (mode === 'lights') return lightsDark() ? 'dark' : 'light';
    if (mode === 'auto') return nightByClock() ? 'dark' : 'light';
    return theme;
  }

  // Bildschleife: mit voller Bildrate nur, solange eine Karte oder ein Kompass zu sehen ist – sonst 4x pro Sekunde
  // (Uhr, Fortschritt, Widgets). Ein leer laufendes requestAnimationFrame lässt Chromium ohne Grafikkarte trotzdem
  // jedes Bild neu zusammensetzen – gemessen ~12 % eines Kerns im Editor auf dem Home-Bildschirm.
  // Auch mit Karte erst kurz vor dem nächsten fälligen Kartenbild um ein Bild bitten: Das Editor-Fenster läuft sonst mit
  // der Bildrate des Monitors (bei 540 Hz über 500 leere Runden pro Sekunde – gemessen ~60 % eines Kerns im Leerlauf).
  function scheduleFrame() {
    const live = poweredOn && ((!standby && (maps.some((m) => m.canvas.offsetParent) || compasses.some((c) => c.offsetParent))) || clusterMapWanted());
    if (!live) return void setTimeout(frame, 250);
    const wait = lastMapFrame + mapFrameGap - performance.now() - 6;
    if (wait > 0) setTimeout(() => requestAnimationFrame(frame), wait);
    else requestAnimationFrame(frame);
  }

  function frame() {
    scheduleFrame();
    if (!poweredOn) return; // Display aus: nichts zeichnen
    // Karte nur so oft zeichnen, wie das Display Bilder abholt (Electron ruft rAF bis zu 60x/s auf)
    const tick = performance.now();
    // Im Stand (Pause, Rastplatz, Ampel) reichen 10 Bilder/s – spart Rechenzeit, sieht gleich aus
    const standing = !telemetry || telemetry.paused || telemetry.speedKmh < 1;
    let mapFps = standing ? Math.min(10, settings.mapFps) : settings.mapFps;
    // Editor-Fenster am PC: minimiert/verdeckt gar nicht zeichnen, im Hintergrund (beim Spielen) nur als Vorschau –
    // es zeichnete sonst genauso aufwendig wie das Display im Truck
    if (role === 'editor') {
      if (document.hidden) return;
      if (!document.hasFocus()) mapFps = Math.min(mapFps, 8);
    }
    mapFrameGap = 1000 / Math.min(screenFps, mapFps);
    if (tick - lastMapFrame < mapFrameGap - 2) return;
    lastMapFrame = tick;
    const speed = telemetry ? telemetry.speedKmh : 0;
    const mapOptions = {
      zoom: settings.mapZoom,
      tilt: settings.mapTilt && !settings.mapNorth, // Norden oben wie beim Navi: flach von oben
      north: settings.mapNorth,
      style: params.get('mapstyle') || settings.mapStyle, // --mapstyle=… nur zum Testen
      highways: settings.mapHighways,
      labels: settings.mapLabels,
      shields: settings.mapShields,
      lights: settings.mapLightIcons,
      areas: settings.mapAreas,
      buildings: settings.mapBuildings,
      water: settings.mapWater,
      inland: settings.mapInlandWater,
      trail: settings.mapTrail,
      driven: settings.mapDriven,
      forest: settings.mapForest,
      meadow: settings.mapMeadow,
      ground: settings.mapGround,
      buildings3d: settings.map3dBuildings,
      viewpoints: settings.mapViewpoints,
      towns: settings.mapTowns,
      sites: settings.mapSites,
      siteNames: settings.mapSiteNames,
      hiddenRoads: settings.mapHiddenRoads,
      rails: settings.mapRails,
      roadClasses: settings.mapRoadClasses,
      laneMarkings: settings.mapLaneMarkings,
      secretRoads: settings.mapSecretRoads,
      busStops: settings.mapBusStops,
      pois: settings.mapPois,
      radar: settings.radar || settings.radarToll,
      turnNear: nextTurnDistance < 400, // wie Apple/Google Karten: vor dem Abbiegen heranzoomen
      overview: mapOverview,
    };
    let drawn = false;
    for (const map of maps) {
      if (standby || !map.canvas.offsetParent) continue; // Display aus: nur die Uhr
      map.draw(speed, mapThemeName(), map.canvas.closest('.map-full') ? { ...mapOptions, insetX: sideInset(), insetY: sideInsetY() } : mapOptions);
      drawn = true;
    }
    drawClusterMap(speed, mapOptions); // Kombiinstrument, Design „Karte“ (10a-kombi.js)
    const current = pose.current();
    if (!drawn && current) CarMap.track(current.x, current.z);
    if (!standby) for (const c of compasses) if (c.offsetParent) CarMap.drawCompass(c, current);

    // Langsame Anzeigen nur 4x pro Sekunde – jede Änderung zwingt Chromium zum Neumalen
    const now = performance.now();
    if (now - lastSlowUpdate > 250) {
      lastSlowUpdate = now;
      const pos = mediaPosition();
      const dur = media?.durationMs || 0;
      width('progress', dur ? Math.round((pos / dur) * 400) / 400 : 0);
      text('elapsed', mmss(pos));
      text('remaining', `-${mmss(dur - pos)}`);
      updateManeuver();
      updateMapNote();
      const w = dashboardWidgets();
      if (screen === 'stops' || w.includes('stops') || w.includes('places')) renderStops();
      if (screen === 'calendar' || w.includes('calendar')) renderAgenda();
      if (screen === 'weather' || w.includes('weather') || (clusterActive && settings.clusterInfo !== false)) updateWeather();
      if (screen === 'sports') loadSport();
      updateRadar(telemetry);
      updateAlong();
      placeVideo();
      if (screen === 'music' && musicTab === 'library') loadLibrary();
      if (screen === 'music') refreshSpotifyState();
    }
  }

  // ------------------------------------------------------------------ Navi-Route (vom Plugin aus dem Spiel gelesen)
  let routeItems = null;
  let lanesData = null; // "start|ende" -> [Spuren vorwärts, rückwärts]
  let junctionData = null; // "einfahrt|ausfahrt" -> [Spuren, Maske der passenden Spuren (Bit 0 = links)]
  let branchNodes = null; // Knoten von Kreuzungen mit Abzweigung (hex) -> Kreuzung(en) – nur dort wird „abbiegen“ angesagt
  let branchGrouped = false; // Kartendaten kennen die Kreuzung je Knoten
  let roundaboutExits = null; // "einfahrt|ausfahrt" -> Nummer der Ausfahrt im Kreisverkehr
  let continuations = null; // "einfahrt|ausfahrt": die Straße geht dort einfach weiter (kein Abbiegen, auch wenn sie knickt)
  let turnSignals = null; // "einfahrt|ausfahrt" -> 'r'/'l' (KI blinkt) oder '-' (kein Blinker: kein Abbiegen)
  let laneLinks = null; // "einfahrt|ausfahrt" -> { nOut, masks }: je Einfahrspur die erreichbaren Ausfahrspuren (Bit 0 = links)
  let turnLinks = null; // "einfahrt|ausfahrt" -> { a: Grad (+ rechts), b: Blinker 0/1 rechts/2 links/3, alts: [Grad der anderen Ausfahrten] }

  // Abbiegeregeln aus den Kartendaten (turnRules je Prefab-Art) für jede platzierte Kreuzung aufschlüsseln
  function expandTurnRules(rules, placed) {
    if (!rules || !Array.isArray(placed)) return null;
    const map = new Map();
    for (const row of placed) {
      const list = rules[row[0]];
      if (!list) continue;
      const origin = row[1];
      const uids = row.slice(2);
      const n = uids.length;
      const world = (local) => uids[(local - origin + n * 2) % n];
      for (const [entry, exit, a, b, d] of list) {
        const alts = list.filter((r) => r[0] === entry && r[1] !== exit).map((r) => r[2]);
        map.set(`${world(entry)}|${world(exit)}`, { a, b, d, alts });
      }
    }
    return map;
  }
  // Abbiegen oder nicht – wie die Navi-Ansage des Spiels aus Richtungswechsel, Blinker der KI und den anderen
  // Ausfahrten: Blinker oder deutlicher Knick = abbiegen; die geradeste Ausfahrt ohne Blinker = weiter der Straße
  // nach; eine leicht abknickende Ausfahrt neben einer geraderen = halten/Ausfahrt. Ergebnis [Art, Seite] oder null.
  function junctionTurn(t) {
    if (!t) return null;
    const abs = Math.abs(t.a);
    const side = t.b === 1 ? 'right' : t.b === 2 ? 'left' : t.a > 0 ? 'right' : 'left';
    const straighter = t.alts.some((o) => Math.abs(o) < abs - 5);
    // Ausfahrt mit Schleife oder Überflieger: knickt der Weg ab dem Abzweig 40 m lang höchstens 45° ab, fährt man
    // erst zur Seite raus – was danach kommt (Kleeblatt-Schleife, Brücke zur Gegenseite), ist nicht die Ansage
    // Blinkt die KI zur anderen Seite als der Abzweig (erst kurz rechts raus, dann links weg über die Gegenseite),
    // gilt der Blinker – so sagt es auch das Spiel an
    const blinkAgainst = ((t.b === 1 && t.d < 0) || (t.b === 2 && t.d > 0)) && Math.sign(t.a) === (t.b === 1 ? 1 : -1); // Gesamtrichtung wie Blinker
    if (t.d !== undefined && abs >= 35 && Math.abs(t.d) >= 5 && Math.abs(t.d) <= 45 && !blinkAgainst) return ['exit', t.d > 0 ? 'right' : 'left'];
    if (abs >= 150) return ['uturn', side];
    if (abs >= 120) return ['sharp', side];
    if (abs >= 35) return ['turn', side];
    if (t.b === 1 || t.b === 2) return ['slight', side];
    if (straighter && abs >= 5) return ['slight', side];
    return null;
  }

  // Spurzuordnung aus den Kartendaten (je Prefab-Art einmal, dazu die platzierten Prefabs) für jede Kreuzung aufschlüsseln
  function expandLaneRules(rules, placed) {
    if (!rules || !Array.isArray(placed)) return null;
    const map = new Map();
    for (const row of placed) {
      const list = rules[row[0]];
      if (!list) continue;
      const origin = row[1];
      const uids = row.slice(2);
      const n = uids.length;
      const world = (local) => uids[(local - origin + n * 2) % n]; // wie build-places.js
      for (const [entry, exit, nOut, ...masks] of list) {
        const rule = { nOut, masks, exit: world(exit) };
        map.set(`${world(entry)}|${world(exit)}`, rule);
        const from = `from|${world(entry)}`; // alle Ausfahrten einer Einfahrt (Richtung der übrigen Spuren)
        if (!map.has(from)) map.set(from, []);
        map.get(from).push(rule);
      }
    }
    return map;
  }

  // Richtung einer Ausfahrt von der Einfahrt aus (Pfeile der übrigen Spuren): aus der Lage der Ausfahrt zur Fahrtrichtung.
  // Die Knotenrichtung taugt dafür nicht (oft um 90°/180° gedreht). Ausfahrten nach hinten (Wende-Verbindungen in den
  // Spurdaten, die praktisch niemand fährt) → null.
  // Mit Abbiegeregeln (turnRules) gilt der Richtungswechsel entlang der Fahrkurven: die Hauptfahrbahn neben einer
  // Ausfahrt ist dann „geradeaus“, auch wenn ihr Knoten ein paar Meter neben dem der Rampe liegt.
  function exitDirection(entryHex, exitHex, heading, routeExitHex) {
    const tr = turnLinks?.get(`${entryHex}|${exitHex}`);
    if (tr) {
      const abs = Math.abs(tr.a);
      const blinkAgainst = ((tr.b === 1 && tr.d < 0) || (tr.b === 2 && tr.d > 0)) && Math.sign(tr.a) === (tr.b === 1 ? 1 : -1);
      if (tr.d !== undefined && abs >= 35 && Math.abs(tr.d) >= 5 && Math.abs(tr.d) <= 45 && !blinkAgainst) return ['slight', tr.d > 0 ? 'right' : 'left']; // Ausfahrt zur Seite
      if (abs >= 150) return null;
      const side = tr.b === 1 ? 'right' : tr.b === 2 ? 'left' : tr.a > 0 ? 'right' : 'left';
      if (abs >= 55) return ['turn', side];
      if (abs >= 15 || tr.b === 1 || tr.b === 2) return ['slight', side]; // bis 15° Knick in der Kreuzung: geradeaus
      return ['straight', ''];
    }
    const node = (h) => {
      try {
        return CarMap.nodePosition(BigInt(`0x${h}`));
      } catch {
        return null;
      }
    };
    const a = node(entryHex);
    const b = node(exitHex);
    if (!a || !b || !heading) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ahead = heading[0] * dx + heading[1] * dy;
    const right = heading[0] * dy - heading[1] * dx; // positiv heißt rechts, weil y nach Süden zeigt
    if (ahead < 2) return null;
    const deg = (Math.atan2(Math.abs(right), ahead) * 180) / Math.PI;
    const side = right > 0 ? 'right' : 'left';
    if (deg > 55) return ['turn', side];
    if (deg > 18) return ['slight', side];
    // fast gerade: liegt die Ausfahrt deutlich neben der Ausfahrt der Route, ist es eine Abfahrt zu dieser Seite
    const r = routeExitHex ? node(routeExitHex) : null;
    if (r) {
      const off = right - (heading[0] * (r.y - a.y) - heading[1] * (r.x - a.x));
      if (Math.abs(off) > 6) return ['slight', off > 0 ? 'right' : 'left'];
    }
    return ['straight', ''];
  }

  // Vorausschauende Spurwahl wie die Spurplanung des Spiels: von hinten nach vorn bleiben an jeder Kreuzung nur die
  // Spuren übrig, die auch für die folgenden Kreuzungen richtig liegen – solange die Spuren über die Straße dazwischen
  // unverändert weiterlaufen (gleiche Spurzahl) und höchstens LANE_RANGE_M zurück.
  // Ergebnis je Stück k (Knoten k-1 → k): [Spuren, Maske der richtigen Spuren, 1 = wegen einer Abzweigung] oder null.
  // out.zone[k]: zu welcher Spurvorgabe (Stück der auslösenden Kreuzung) das Stück gehört – nur dort, wo die Spuren
  // der Vorgabe ohne Unterbrechung bis hierher reichen. Auf einer Rampe oder Rastplatz-Ausfahrt mit anderer Spurzahl
  // gehört das Stück zu keiner Vorgabe, die Spuren der Autobahn dahinter erscheinen erst nach dem Einfädeln.
  const LANE_RANGE_M = 1500;
  function planLanes(hex, points, laneOf, branchOf) {
    const out = hex.map(() => null);
    out.zone = hex.map(() => null);
    if (!laneLinks) return out;
    let pending = null; // { mask, lanes, budget, branch, root } – Vorgabe der späteren Kreuzung für die Spuren davor
    let chain = null; // { lanes, root } – dieselben Spuren laufen weiter zurück (auch wenn die Vorgabe nicht mehr so weit reicht)
    for (let k = hex.length - 1; k >= 1; k--) {
      const a = points[k - 1];
      const b = points[k];
      const len = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : Infinity;
      const rule = laneLinks.get(`${hex[k - 1]}|${hex[k]}`);
      if (!rule) {
        // Straße zwischen zwei Kreuzungen: Spuren laufen nur bei gleicher Spurzahl unverändert weiter
        if (pending && ((laneOf[k] || 1) !== pending.lanes || (pending.budget -= len) <= 0)) pending = null;
        if (chain && (laneOf[k] || 1) !== chain.lanes) chain = null;
        if (chain) out.zone[k] = chain.root;
        continue;
      }
      const nIn = rule.masks.length;
      const all = (1 << nIn) - 1;
      let single = 0;
      rule.masks.forEach((m, i) => { if (m) single |= 1 << i; });
      let ahead = single;
      if (pending && pending.lanes === rule.nOut) {
        let g = 0;
        rule.masks.forEach((m, i) => { if (m & pending.mask) g |= 1 << i; });
        if (g) ahead = g;
      }
      const own = ahead === single && single !== all; // Einschränkung durch diese Kreuzung selbst
      const branch = own ? !!branchOf[k] : !!pending?.branch;
      if (ahead && ahead !== all) {
        // übrige Spuren: wohin führen sie stattdessen? (Pfeil in ihrer Richtung, gedimmt)
        const p0 = points[k - 2];
        const p1 = points[k - 1];
        const hl = p0 && p1 ? Math.hypot(p1.x - p0.x, p1.y - p0.y) : 0;
        const heading = hl > 0.5 ? [(p1.x - p0.x) / hl, (p1.y - p0.y) / hl] : null;
        const others = laneLinks.get(`from|${hex[k - 1]}`) || [];
        // Lage der Spurgruppen: Mitte der Einfahrspuren, die in eine Ausfahrt führen (0 = ganz links). Eine Ausfahrt,
        // deren Spuren rechts der Route liegen, geht rechts ab – auch wenn sie danach über eine Brücke nach links
        // schwenkt (Autobahn-T, Überflieger). Pfeil und Reihenfolge folgen deshalb der Lage, nicht der Endrichtung.
        const lanePos = (masks) => {
          let sum = 0;
          let n = 0;
          masks.forEach((m, i) => { if (m) { sum += i; n++; } });
          return n ? sum / n : null;
        };
        const routePos = lanePos(rule.masks);
        const sideOf = (r, dir) => {
          const p = lanePos(r.masks);
          if (!dir || p === null || routePos === null || Math.abs(p - routePos) < 0.5) return dir;
          const side = p > routePos ? 'right' : 'left';
          return !dir[1] || dir[1] === side ? dir : ['slight', side]; // geradeaus bleibt geradeaus
        };
        const arrows = rule.masks.map((_, i) => {
          if ((ahead >> i) & 1) return null;
          for (const r of others) {
            if (r.exit === hex[k] || !r.masks[i]) continue;
            const dir = sideOf(r, exitDirection(hex[k - 1], r.exit, heading, hex[k]));
            if (dir) return dir;
          }
          return null;
        });
        let view = null;
        const routeDir = exitDirection(hex[k - 1], hex[k], heading, null) || ['straight', ''];
        // Spuren je Richtung an der Haltelinie: beim Abbiegen höchstens so viele, wie Einfahrspuren dorthin führen – die Spurzahl
        // der Straße, in die man abbiegt (nOut), sagt nichts über die Spuren davor. Sonst zeigte z. B. Osnabrück (12.11.2026)
        // bei zwei Spuren (eine links, eine rechts ab) vier Pfeile, weil beide Querstraßen zweispurig sind
        const fed = (masks) => masks.reduce((a, m) => a + (m ? 1 : 0), 0);
        const turning = (dir) => dir && (dir[0] === 'turn' || dir[0] === 'sharp' || dir[0] === 'uturn');
        const lanesTo = (nOut, masks, dir) => (turning(dir) ? Math.min(nOut, Math.max(1, fed(masks))) : nOut);
        const exits = [{ n: lanesTo(rule.nOut, rule.masks, routeDir), dir: routeDir, route: true, pos: routePos ?? 0 }];
        for (const r of others) {
          if (r.exit === hex[k]) continue;
          const dir = sideOf(r, exitDirection(hex[k - 1], r.exit, heading, hex[k]));
          if (dir) exits.push({ n: lanesTo(r.nOut, r.masks, dir), dir, route: false, pos: lanePos(r.masks) ?? 0 });
        }
        const total = exits.reduce((a, e) => a + e.n, 0);
        // nur bei sauberer Teilung (jede Einfahrspur führt in genau eine Richtung) – sonst sind es keine Zusatzspuren
        const clean = rule.masks.every((_, i) => [rule, ...others.filter((r) => r.exit !== hex[k])].filter((r) => r.masks[i]).length === 1);
        if (clean && total > nIn && total <= 8 && exits.length > 1) {
          // von links nach rechts nach der Lage der Einfahrspuren; gleich liegend: nach Richtung
          const rank = ([kind, side]) => (side === 'left' ? (kind === 'turn' ? 0 : 1) : side === 'right' ? (kind === 'turn' ? 4 : 3) : 2);
          view = exits.sort((a, b) => a.pos - b.pos || rank(a.dir) - rank(b.dir)).flatMap((e) => Array.from({ length: e.n }, () => [e.dir[0], e.dir[1], e.route ? 1 : 0]));
        }
        // Vorgabe einer späteren Kreuzung (vorausschauend) an einer Stelle, an der hier selbst nichts zu entscheiden ist
        // (Rastplatz bei Calais, 16.11.2026: Anzeige sprang 2 → 3 → 2 → 3 Spuren):
        //  – Auffahrt/Beschleunigungsstreifen: die Straße wird schmaler, jede Spur führt weiter – keine eigene Anzeige,
        //    die Spuren danach gelten (sonst erschien die Auffahrt als dritte Spur)
        //  – Abzweig am Rand (Rastplatz-Ausfahrt), dessen Spuren gar nicht zur Route führen: ohne diese Spuren zeigen,
        //    also so viele Spuren wie die Straße weiter hat (gleich wie die Hinweise davor und danach)
        let shown = { nIn, ahead, arrows, view };
        if (!own && Number.isFinite(rule.nOut) && rule.nOut < nIn && single === all) shown = null;
        else if (!own) {
          let lo = 0;
          let hi = nIn - 1;
          while (hi > lo && !rule.masks[hi]) hi--;
          while (lo < hi && !rule.masks[lo]) lo++;
          if (lo > 0 || hi < nIn - 1) {
            const keep = (ahead >> lo) & ((1 << (hi - lo + 1)) - 1);
            const cut = arrows.slice(lo, hi + 1);
            // die volle Fassung bleibt dabei (8. Feld): fährt der Truck schon auf so vielen Spuren, ist der Abzweig da und wird gezeigt
            shown = keep && hi > lo && keep !== (1 << (hi - lo + 1)) - 1 ? { nIn: hi - lo + 1, ahead: keep, arrows: cut, view: null, full: [nIn, ahead, arrows.some(Boolean) ? arrows : null] } : null;
          }
        }
        // 7. Feld: 1 = die Kreuzung selbst verlangt die Spur, 0 = Vorgabe einer späteren Kreuzung (vorausschauend)
        if (shown) out[k] = [shown.nIn, shown.ahead, branch ? 1 : 0, shown.arrows.some(Boolean) ? shown.arrows : null, shown.view, `${hex[k - 1]}|${hex[k]}`, own ? 1 : 0, shown.full || null];
      }
      if (!ahead || ahead === all) pending = null;
      else if (own) pending = { mask: ahead, lanes: nIn, budget: LANE_RANGE_M, branch, root: k };
      else pending = { mask: ahead, lanes: nIn, budget: pending.budget, branch, root: pending.root };
      if (pending) chain = { lanes: nIn, root: pending.root };
      else if (chain && !out[k] && rule.nOut === chain.lanes && nIn === chain.lanes && rule.masks.every((m, i) => m === 1 << i)) chain = { lanes: nIn, root: chain.root }; // Spuren laufen gerade durch
      else chain = null;
      if (chain) out.zone[k] = chain.root;
      if (pending && (pending.budget -= Number.isFinite(len) ? len : 0) <= 0) pending = null;
    }
    return out;
  }
  let routePath = null;
  const mapData = () => CarMap.hasMapData();

  function onRoute(items) {
    routeItems = items;
    if (!mapData()) {
      updateMapNote();
      return;
    }
    // Knoten-IDs -> Koordinaten; unbekannte Knoten (z. B. aus Mods) unterbrechen die Linie
    const lookup = CarMap.nodePosition;
    const hex = items.map((item) => {
      try {
        return BigInt(item.uid).toString(16);
      } catch {
        return '';
      }
    });
    // Spuren in Fahrtrichtung für das Stück vom vorigen zu diesem Knoten (0 = unbekannt/einspurig)
    const laneOf = items.map((_, k) => {
      if (!k || !lanesData) return 0;
      const forward = lanesData[`${hex[k - 1]}|${hex[k]}`];
      if (forward) return forward[0];
      const backward = lanesData[`${hex[k]}|${hex[k - 1]}`];
      return backward ? backward[1] : 0;
    });
    // Kreuzung zwischen zwei Routenknoten: welche Spuren führen in die richtige Ausfahrt?
    const junctionOf = items.map((_, k) => (k && junctionData ? junctionData[`${hex[k - 1]}|${hex[k]}`] || null : null));
    // Stück an einer Kreuzung mit Abzweigung (einer der beiden Knoten gehört dazu)
    // Stück innerhalb einer Kreuzung mit Abzweigung (beide Knoten gehören zu ihr). Eine Rampe zwischen zwei Kreuzungen
    // (Kleeblatt-Schleife) zählt nicht – ihre Kurve ist keine Abbiegung. Ältere Daten: einer der Knoten gehört dazu.
    const sameJunction = (a, b) => {
      const x = branchNodes.get(a);
      const y = branchNodes.get(b);
      if (x === undefined || y === undefined) return false;
      const ys = [].concat(y);
      return [].concat(x).some((v) => ys.includes(v));
    };
    const branchOf = items.map((_, k) => !!branchNodes && (branchGrouped
      ? k > 0 && sameJunction(hex[k - 1], hex[k])
      : branchNodes.has(hex[k]) || (k > 0 && branchNodes.has(hex[k - 1]))));
    // Kreisverkehr (Nummer der Ausfahrt) und natürliche Fortsetzung der Straße an einer Kreuzung
    const pairOf = (k) => (k ? `${hex[k - 1]}|${hex[k]}` : '');
    const extraOf = items.map((_, k) => {
      const rb = k && roundaboutExits ? roundaboutExits[pairOf(k)] || 0 : 0;
      const cont = !!k && !!continuations && continuations.has(pairOf(k));
      const bl = k && turnSignals ? turnSignals[pairOf(k)] || '' : '';
      // Abbiegen an dieser Kreuzung laut Kartendaten (null = geradeaus/weiter der Straße nach; keine Daten = undefined)
      const tr = k && turnLinks ? turnLinks.get(pairOf(k)) : undefined;
      const jt = tr ? junctionTurn(tr) || 'none' : '';
      return rb || cont || bl || jt ? { rb, cont, bl, jt } : null;
    });
    // Seitlicher Versatz je Stück: auf Straßen mit beiden Fahrtrichtungen liegen die Knoten in der Straßenmitte, bei
    // getrennten Fahrbahnen auf der eigenen. Die Route gehört immer auf die eigene Fahrbahn (halber Mittelstreifen +
    // halbe Breite der eigenen Spuren) – sonst springt die Linie zwischen Mitte und rechtem Rand.
    // Dazu die seitliche Verschiebung, mit der die Karte die Straße zeichnet (e[4], e[5]: Start, Ende).
    // Ergebnis je Stück: [Versatz am Anfang, am Ende] nach rechts zur Fahrtrichtung; null = unbekannt (Kreuzung,
    // einfache Straße) – dort wird zwischen den Nachbarn übergeblendet.
    const sideOf = items.map((_, k) => {
      if (!k || !lanesData) return null;
      const fwd = lanesData[`${hex[k - 1]}|${hex[k]}`];
      const e = fwd || lanesData[`${hex[k]}|${hex[k - 1]}`];
      if (!e) return null;
      const own = fwd ? e[0] : e[1];
      const other = fwd ? e[1] : e[0];
      // eigene Fahrbahn neben der Mitte: rechts davon, bei Linksverkehr (e[3]) links – in Straßenrichtung gemessen
      const lane = own && other ? ((e[2] || 0) / 2 + own * 2.25) * (e[3] ? -1 : 1) : 0;
      const d0 = e[4] || 0;
      const d1 = e[5] || 0;
      // gegen die Straßenrichtung: Seiten tauschen, Anfang und Ende auch
      return fwd ? [d0 + lane, d1 + lane] : [-(d1 - lane), -(d0 - lane)];
    });
    const nodePoints = items.map((item) => lookup(BigInt(item.uid)));
    const aheadOf = planLanes(hex, nodePoints, laneOf, branchOf);
    analyzeRoad(hex, nodePoints); // Grenzen und Steigungen (07b-strecke.js)
    // Spur der Linie und genaue Kurven durch Kreuzungen (07c-kurven.js); Linksverkehr aus den Spurdaten
    const leftHand = hex.some((h, k) => k && lanesData?.[`${hex[k - 1]}|${h}`]?.[3] === 1);
    const { curveOf, laneOff } = planRouteLanes(hex, laneOf, sideOf, aheadOf, leftHand, nodePoints);
    onRouteSeen = false; // neue Route: erst „verlassen“ melden, wenn der Truck einmal darauf war
    routePath = smoothRoute(nodePoints, laneOf, junctionOf, branchOf, extraOf, sideOf, aheadOf, curveOf, laneOff);
    CarMap.setRoute(routePath);
    if (demo) demo.followPath(routePath);
    updateMapNote();
  }

  // Zwischen zwei Routenknoten der Straßenkurve folgen (Hermite wie in mapdata/build-map.js).
  // Die Knotenrichtung kann der Fahrtrichtung entgegen zeigen – dann umdrehen.
  function smoothRoute(points, laneOf = [], junctionOf = [], branchOf = [], extraOf = [], sideOf = [], aheadOf = [], curveOf = [], laneOff = []) {
    const out = [];
    const zoneOf = aheadOf.zone || [];
    // Versatz an jedem Knoten: von der angrenzenden Straße (beide bekannt: Mittel), sonst 0
    const nodeSide = points.map((_, i) => {
      const a = sideOf[i] ? sideOf[i][1] : null;
      const b = sideOf[i + 1] ? sideOf[i + 1][0] : null;
      return a !== null && b !== null ? (a + b) / 2 : a ?? b ?? 0;
    });
    for (let i = 0; i < points.length; i++) {
      const b = points[i];
      const a = i > 0 ? points[i - 1] : null;
      if (!b) { out.push(null); continue; }
      const dx = a ? b.x - a.x : 0;
      const dy = a ? b.y - a.y : 0;
      const len = Math.hypot(dx, dy);
      // Kreuzung mit bekannter Fahrkurve: der Kurve der gewählten Spur folgen (Kreisverkehr, Rampe)
      if (a && curveOf[i]) {
        const extra = { lanes: laneOf[i] || 0, junction: junctionOf[i] || null, branch: !!branchOf[i], rb: extraOf[i]?.rb || 0, cont: !!extraOf[i]?.cont, bl: extraOf[i]?.bl || '', jt: extraOf[i]?.jt || '', la: aheadOf[i] || null, lz: zoneOf[i] ?? -1 };
        const ln = curveOf[i].lane || { lo: null, own: 0 };
        for (const p of curveOf[i]) out.push({ x: p.x, y: p.y, lo: ln.lo, own: ln.own, ...extra });
        continue;
      }
      if (!a || a.r == null || b.r == null || len < 1 || len > 600) {
        out.push(laneOf[i] || junctionOf[i] || branchOf[i] || extraOf[i] || aheadOf[i] || zoneOf[i] != null ? { ...b, lanes: laneOf[i] || 0, junction: junctionOf[i] || null, branch: !!branchOf[i], rb: extraOf[i]?.rb || 0, cont: !!extraOf[i]?.cont, bl: extraOf[i]?.bl || '', jt: extraOf[i]?.jt || '', la: aheadOf[i] || null, lz: zoneOf[i] ?? -1 } : b);
        continue;
      }
      const orient = (r) => {
        const d = [Math.cos(r), Math.sin(r)];
        return d[0] * dx + d[1] * dy < 0 ? [-d[0], -d[1]] : d;
      };
      const [ax, ay] = orient(a.r);
      const [bx, by] = orient(b.r);
      // alle ~4 m ein Punkt: enge Kurven (Stadt, Rampen) wirken sonst eckig
      const steps = Math.max(1, Math.min(48, Math.round(len / 4)));
      // Fahrbahnmitte plus Versatz auf die gewählte Spur (07c-kurven.js)
      const side0 = (sideOf[i] ? sideOf[i][0] : nodeSide[i - 1]) + (laneOff[i] ? laneOff[i][0] : 0);
      const side1 = (sideOf[i] ? sideOf[i][1] : nodeSide[i]) + (laneOff[i] ? laneOff[i][1] : 0);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;
        let x = h00 * a.x + h10 * ax * len + h01 * b.x + h11 * bx * len;
        let y = h00 * a.y + h10 * ay * len + h01 * b.y + h11 * by * len;
        const off = side0 + (side1 - side0) * t;
        if (off) {
          // nach rechts zur Fahrtrichtung (Ableitung der Kurve; y zeigt nach Süden)
          const tx = (6 * t2 - 6 * t) * a.x + (3 * t2 - 4 * t + 1) * ax * len + (6 * t - 6 * t2) * b.x + (3 * t2 - 2 * t) * bx * len;
          const ty = (6 * t2 - 6 * t) * a.y + (3 * t2 - 4 * t + 1) * ay * len + (6 * t - 6 * t2) * b.y + (3 * t2 - 2 * t) * by * len;
          const tl = Math.hypot(tx, ty) || 1;
          x += (-ty / tl) * off;
          y += (tx / tl) * off;
        }
        out.push({
          x,
          y,
          lo: laneOff[i] ? laneOff[i][0] + (laneOff[i][1] - laneOff[i][0]) * t : (sideOf[i] && laneOf[i] >= 2 ? 0 : null), // Spurversatz zur Fahrbahnmitte
          own: laneOf[i] || 0,
          lanes: laneOf[i] || 0,
          junction: junctionOf[i] || null,
          branch: !!branchOf[i],
          rb: extraOf[i]?.rb || 0,
          cont: !!extraOf[i]?.cont,
          bl: extraOf[i]?.bl || '',
          jt: extraOf[i]?.jt || '', // Abbiegen laut Kreuzungsdaten: [Art, Seite], 'none' = weiter der Straße nach
          la: aheadOf[i] || null, // vorausschauende Spurwahl
          lz: zoneOf[i] ?? -1, // gehört zur Spurvorgabe dieser Kreuzung (planLanes)
        });
      }
    }
    return smoothLine(out);
  }

  // Kleine seitliche Sprünge glätten (Übergänge zwischen Straßenstücken mit anderer Spurzahl, kurze Kreuzungsstücke):
  // jeder Punkt wird zum gewichteten Mittel seiner Nachbarn im Umkreis von etwa ±30 m. Wo die Route deutlich die
  // Richtung ändert (Abbiegen, enge Kurve), wird kaum geglättet – dort bleibt die Linie auf der Straße.
  function smoothLine(points) {
    const out = points.slice();
    let start = 0;
    while (start < points.length) {
      while (start < points.length && !points[start]) start++;
      let end = start;
      while (end < points.length && points[end]) end++;
      smoothRun(points, out, start, end);
      start = end;
    }
    return out;
  }

  function smoothRun(points, out, from, to) {
    const n = to - from;
    if (n < 5) return;
    const cum = new Float64Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(points[from + i].x - points[from + i - 1].x, points[from + i].y - points[from + i - 1].y);
    const at = (i) => points[from + i];
    // Richtung zwischen zwei Stellen im Abstand d vor/nach Punkt i
    const indexAt = (i, d) => {
      let j = i;
      if (d < 0) while (j > 0 && cum[i] - cum[j] < -d) j--;
      else while (j < n - 1 && cum[j] - cum[i] < d) j++;
      return j;
    };
    for (let i = 1; i < n - 1; i++) {
      const a = at(indexAt(i, -25)), b = at(i), c = at(indexAt(i, 25));
      const h1 = Math.atan2(b.y - a.y, b.x - a.x);
      const h2 = Math.atan2(c.y - b.y, c.x - b.x);
      let turn = Math.abs(h2 - h1);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      // bis 12° knickfrei glätten (σ 12 m), ab 35° nur die Ecken abrunden (σ 4 m), dazwischen gleitend
      const k = Math.min(1, Math.max(0, (turn - 0.21) / (0.61 - 0.21)));
      const sigma = 12 - 8 * k;
      const reach = sigma * 2.5;
      let sx = 0, sy = 0, sw = 0;
      for (let j = indexAt(i, -reach), last = indexAt(i, reach); j <= last; j++) {
        const d = cum[j] - cum[i];
        // Gewicht nach Abstand und nach dem Stück Linie, das der Punkt vertritt (ungleich dichte Punkte)
        const span = ((j < n - 1 ? cum[j + 1] : cum[j]) - (j > 0 ? cum[j - 1] : cum[j])) / 2 || 1;
        const w = Math.exp((-d * d) / (2 * sigma * sigma)) * span;
        sx += at(j).x * w;
        sy += at(j).y * w;
        sw += w;
      }
      if (sw > 0) out[from + i] = { ...at(i), x: sx / sw, y: sy / sw };
    }
  }

  // Das Navi des Spiels führt (Ankunftszeit sichtbar): dann ist „Keine Route“ falsch, auch wenn die Karte die Linie noch
  // nicht kennt (Route wird gerade gelesen) – und der Hinweis läge über der Ankunftsleiste
  let gameNavigating = false;
  function updateMapNote() {
    const note = !mapData()
      ? (mapJob.state === 'running' && mapJob.first ? 'Karte wird erstellt – einmalig, ein paar Minuten' : 'Noch keine Karte – Einstellungen › Allgemein › Kartendaten')
      : CarMap.hasRoute() || gameNavigating
        ? ''
        : 'Keine Route – Ziel im Navi des Spiels setzen';
    text('map-note', note);
    for (const el of nodes('map-note')) setHidden(el, !note);
  }

  // ------------------------------------------------------------------ Grenzen und Steigungen entlang der Route
  // Aus den Kartendaten: Höhe und Land je Straßenknoten (mapdata/europe-nodeinfo.bin) und Länderinfos (Lkw-Tempolimits,
  // Zeitzone, Diesel, Mautstellen; europe-places.json). Beim Laden der Route werden Grenzübergänge und steile Abschnitte
  // gesucht; der Hinweis erscheint im Navi-Banner (Karten-App) und im Navi-Widget des Dashboards, optional mit Ansage.
  // Die Höhen sind die der Spielwelt (gestaucht wie die Entfernungen) – die Steigung ist genau die, die der Truck fährt.
  let nodeInfo = null; // { uids: BigUint64Array, z: Int16Array (dm), c: Uint8Array (Land) }
  let countryById = new Map(); // id -> { name, iso, limits, tz, fuel, tolls, mph }
  let roadEvents = []; // { type: 'border'|'grade', … , x, y }
  let roadProfile = null; // { cum: [], z: [] } entlang der Routenknoten
  const spokenRoad = new Set();
  const shownRoad = new Set();
  const dismissedRoad = new Set(); // weggeklickt (✕) – bis zur nächsten Route
  function dismissRoadNotice(id) {
    dismissedRoad.add(id);
    roadNoticeAt = 0;
    updateRoadNotice();
  }

  function setNodeInfo(bytes) {
    nodeInfo = null;
    if (!bytes || bytes.length < 8) return;
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'ECNI') return;
    const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4, true);
    if (b.length < 8 + n * 11) return;
    nodeInfo = {
      uids: new BigUint64Array(b.slice(8, 8 + n * 8).buffer),
      z: new Int16Array(b.slice(8 + n * 8, 8 + n * 10).buffer),
      c: b.slice(8 + n * 10, 8 + n * 11),
    };
    // Positionen (neuere Kartendaten): Raster aller Knoten mit Land, für das Land unter dem Truck
    nodeGrid = null;
    const base = 8 + n * 11 + ((8 - ((n * 3) % 8)) % 8);
    if (b.length >= base + n * 8) {
      const xs = new Float32Array(b.slice(base, base + n * 4).buffer);
      const ys = new Float32Array(b.slice(base + n * 4, base + n * 8).buffer);
      const cells = new Map();
      for (let i = 0; i < n; i++) {
        if (!nodeInfo.c[i]) continue;
        const key = `${Math.floor(xs[i] / NODE_CELL)},${Math.floor(ys[i] / NODE_CELL)}`;
        (cells.get(key) || cells.set(key, []).get(key)).push(i);
      }
      nodeGrid = { xs, ys, cells };
    }
  }
  // Land unter dem Truck: Land des nächsten Straßenknotens (genau an der Grenze). Die nächste Stadt (CarMap.countryAt)
  // liegt in Grenznähe oft im Nachbarland – sie bleibt nur Ersatz für ältere Kartendaten oder abseits der Straßen.
  const NODE_CELL = 250;
  let nodeGrid = null;
  function countryHere(x, z) {
    if (nodeGrid && countryById.size) {
      const cx = Math.floor(x / NODE_CELL), cy = Math.floor(z / NODE_CELL);
      let best = -1, bestD = Infinity;
      for (let r = 1; r <= 2 && best < 0; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            const list = nodeGrid.cells.get(`${cx + dx},${cy + dy}`);
            if (!list) continue;
            for (const i of list) {
              const d = (nodeGrid.xs[i] - x) ** 2 + (nodeGrid.ys[i] - z) ** 2;
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            }
          }
        }
      }
      const info = best >= 0 ? countryById.get(nodeInfo.c[best]) : null;
      if (info) return info;
    }
    return CarMap.countryAt(x, z);
  }
  function setCountries(countries) {
    countryById = new Map();
    for (const info of Object.values(countries || {})) if (info && info.id !== undefined) countryById.set(info.id, info);
  }
  function nodeInfoOf(hexUid) {
    if (!nodeInfo || !hexUid) return null;
    let uid;
    try {
      uid = BigInt(`0x${hexUid}`);
    } catch {
      return null;
    }
    let lo = 0;
    let hi = nodeInfo.uids.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = nodeInfo.uids[mid];
      if (v === uid) return { z: nodeInfo.z[mid] / 10, c: nodeInfo.c[mid] };
      if (v < uid) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }
  const borderCountryName = (info) => {
    if (info.state) return info.name; // ATS: Bundesstaat
    try {
      return new Intl.DisplayNames([CarI18n.lang], { type: 'region' }).of(info.iso) || info.name;
    } catch {
      return info.name;
    }
  };

  // Beim Laden der Route: Grenzen und steile Abschnitte suchen
  const GRADE_WINDOW_M = 300; // Steigung über mindestens so viel Strecke (kurze Rampen und Brückenköpfe zählen nicht)
  function analyzeRoad(hex, points) {
    roadEvents = [];
    roadProfile = null;
    spokenRoad.clear();
    shownRoad.clear();
    dismissedRoad.clear();
    if (!nodeInfo || !hex.length) return;
    const info = hex.map((h) => nodeInfoOf(h));
    // Grenzen: Land wechselt entlang der Routenknoten. Etwa jeder siebte Straßenknoten hat im Spiel kein Land (0) –
    // verglichen wird deshalb mit dem letzten Knoten, dessen Land bekannt ist (sonst fehlte die Grenze, wenn genau
    // dort ein Knoten ohne Land liegt)
    let known = null;
    for (let k = 0; k < hex.length; k++) {
      const b = info[k];
      if (!b || !b.c || !points[k] || !countryById.has(b.c)) continue;
      if (known && known.c !== b.c) {
        roadEvents.push({ type: 'border', id: `b${k}`, x: points[k].x, y: points[k].y, from: countryById.get(known.c), to: countryById.get(b.c) });
      }
      known = b;
    }
    // Steigungen: Strecke entlang der Knoten, Fenster von mindestens 300 m
    const cum = [];
    const z = [];
    let total = 0;
    for (let k = 0; k < hex.length; k++) {
      if (k && points[k] && points[k - 1]) total += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y);
      cum.push(total);
      z.push(info[k] && points[k] ? info[k].z : null);
    }
    roadProfile = { cum, z, points };
    const min = 0.05; // ab 5 % suchen, die Einstellung (ab 6 %, 8 % …) filtert erst bei der Anzeige
    const flagged = []; // [i, j, Steigung]
    for (let i = 0; i < hex.length; i++) {
      if (z[i] === null) continue;
      let j = i + 1;
      while (j < hex.length && cum[j] - cum[i] < GRADE_WINDOW_M) j++;
      if (j >= hex.length || z[j] === null || cum[j] - cum[i] > GRADE_WINDOW_M * 4) continue;
      const g = (z[j] - z[i]) / (cum[j] - cum[i]);
      if (Math.abs(g) >= min) flagged.push([i, j, g]);
    }
    // überlappende Fenster gleicher Richtung zu Abschnitten zusammenfassen
    const segments = [];
    for (const [i, j, g] of flagged) {
      const last = segments[segments.length - 1];
      if (last && i <= last.j && Math.sign(g) === Math.sign(last.g)) {
        last.j = Math.max(last.j, j);
        if (Math.abs(g) > Math.abs(last.max)) last.max = g;
      } else segments.push({ i, j, g, max: g });
    }
    for (const s of segments) {
      const length = cum[s.j] - cum[s.i];
      if (length < GRADE_WINDOW_M || !points[s.i] || !points[s.j]) continue;
      roadEvents.push({
        type: 'grade', id: `g${s.i}`, x: points[s.i].x, y: points[s.i].y, ex: points[s.j].x, ey: points[s.j].y,
        down: s.max < 0, pct: Math.round(Math.abs(s.max) * 100), length, startCum: cum[s.i], endCum: cum[s.j],
      });
    }
  }

  // Rat je nach Gewicht (Ladung über 15 t: früher runterschalten)
  function gradeAdvice(ev) {
    const heavy = num(telemetry?.cargoMassKg) > 15000;
    if (ev.down) return heavy ? 'Vorher runterschalten und Retarder nutzen' : 'Retarder nutzen';
    return heavy ? 'Rechtzeitig runterschalten' : 'Steigung voraus';
  }
  // Tempolimit-Schild mit Beschriftung darunter
  const limitSign = (v, label) => `<div class="rn-limit"><span class="rn-sign">${v}</span><small>${label}</small></div>`;
  // Länderkennzeichen wie am Auto: EU-Länder mit blauem Euro-Streifen und Sternenkranz, sonst das weiße Oval
  const EU = new Set(['A', 'B', 'BG', 'HR', 'CZ', 'DK', 'EST', 'FI', 'F', 'D', 'GR', 'H', 'I', 'LV', 'LT', 'L', 'NL', 'PL', 'P', 'RO', 'SK', 'SLO', 'E', 'S']);
  const STARS = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return `<circle cx="${(10 + Math.sin(a) * 6.2).toFixed(2)}" cy="${(10 - Math.cos(a) * 6.2).toFixed(2)}" r="1.15"/>`;
  }).join('');
  const plate = (code, state) => (state
    ? `<span class="rn-plate us" data-no-names><b>${escape(code)}</b></span>`
    : EU.has(code)
    ? `<span class="rn-plate eu" data-no-names><svg viewBox="0 0 20 20">${STARS}</svg><b>${escape(code)}</b></span>`
    : `<span class="rn-plate oval" data-no-names><b>${escape(code)}</b></span>`);
  const chip = (icon, text, cls = '') => `<span class="rn-chip ${cls}">${ICONS[icon] || ''}<span>${escape(text)}</span></span>`;
  // Warnschild: rotes Dreieck mit Prozentangabe und Neigung (wie Verkehrszeichen Gefälle/Steigung)
  // wie das Verkehrszeichen: unten der Hang als schwarzer Keil, darüber die Prozentzahl
  const gradeSign = (pct, down) => `<span class="rn-warn"><svg viewBox="0 0 40 36"><path d="M20 2.5 38 33.5H2Z" class="rn-warn-bg"/>
      <path d="${down ? 'M8.5 30.5H31.5L8.5 24.5Z' : 'M8.5 30.5H31.5V24.5Z'}" class="rn-warn-hill"/><text x="20" y="22" class="rn-warn-text">${pct}%</text></svg></span>`;

  // Höhenprofil von hier bis 8 km voraus; der steile Abschnitt ist farbig, der Truck ein Punkt am Anfang
  function profileSvg(fromCum, ev) {
    const p = roadProfile;
    if (!p) return '';
    const pts = [];
    for (let k = 0; k < p.cum.length; k++) {
      if (p.z[k] === null || p.cum[k] < fromCum - 200) continue;
      if (p.cum[k] > fromCum + 8000) break;
      pts.push([p.cum[k] - fromCum, p.z[k]]);
    }
    if (pts.length < 2) return '';
    const zs = pts.map((q) => q[1]);
    const lo = Math.min(...zs);
    const span = Math.max(20, Math.max(...zs) - lo);
    const X = (d) => Math.max(0, Math.min(200, (d / 8000) * 200));
    const Y = (h) => 34 - ((h - lo) / span) * 28;
    const line = (list) => list.map(([d, h], i) => `${i ? 'L' : 'M'}${X(d).toFixed(1)},${Y(h).toFixed(1)}`).join(' ');
    const all = line(pts);
    const a = ev.startCum - fromCum;
    const b = ev.endCum - fromCum;
    const steep = pts.filter(([d]) => d >= a - 1 && d <= b + 1);
    const zAt = (d) => {
      for (let i = 1; i < pts.length; i++) if (pts[i][0] >= d) {
        const [d0, h0] = pts[i - 1];
        const [d1, h1] = pts[i];
        return h0 + ((h1 - h0) * (d - d0)) / Math.max(1, d1 - d0);
      }
      return pts[pts.length - 1][1];
    };
    const here = zAt(0);
    return `<svg class="rn-profile" viewBox="0 0 200 38" preserveAspectRatio="none">
        <path d="${all} L${X(pts[pts.length - 1][0]).toFixed(1)},38 L${X(pts[0][0]).toFixed(1)},38 Z" class="rn-fill"/>
        <path d="${all}" class="rn-line"/>
        ${steep.length > 1 ? `<path d="${line(steep)}" class="rn-steep"/>` : ''}
      </svg><span class="rn-dot" style="top:${((Y(here) / 38) * 100).toFixed(1)}%"></span>`;
  }

  let roadNoticeAt = 0;
  function updateRoadNotice() {
    const now = performance.now();
    if (now - roadNoticeAt < 900) return;
    roadNoticeAt = now;
    let best = null; // nächster Hinweis: { ev, dist, inside }
    if (roadEvents.length && CarMap.routeActive()) {
      for (const ev of roadEvents) {
        if (dismissedRoad.has(ev.id)) continue;
        if (ev.type === 'border' && !settings.mapBorder) continue;
        if (ev.type === 'grade' && (!settings.mapGrade || ev.pct < (settings.gradeMin || 6))) continue;
        const dist = CarMap.routeAhead(ev.x, ev.y, 80);
        let inside = false;
        if (dist == null && ev.type === 'grade') {
          const toEnd = CarMap.routeAhead(ev.ex, ev.ey, 80);
          if (toEnd == null || toEnd > ev.length) continue;
          inside = true;
        } else if (dist == null) continue;
        const range = ev.type === 'border' ? 1500 : 2500;
        if (!inside && dist > range) continue;
        const d = inside ? 0 : dist;
        if (!best || d < best.dist) best = { ev, dist: d, inside, toEnd: inside ? CarMap.routeAhead(ev.ex, ev.ey, 80) : null };
      }
    }
    if (!best) {
      html('road-notice', '', '');
      for (const el of nodes('road-notice')) setHidden(el, true);
      return;
    }
    const { ev } = best;
    let markup;
    let key;
    if (ev.type === 'border') {
      const to = ev.to;
      const l = carMode ? [] : (to.limits || []).map((v) => limitIn(v, to.mph)); // Auto (Road Trip): Lkw-Limits gelten nicht
      const unit = spdUnit();
      const roads = to.state ? ['Interstate', 'Highway', 'Landstraße'] : ['Autobahn', 'Schnellstraße', 'Landstraße'];
      // Dieselpreis-Vergleich (ATS: nur relativ – fuelRel, die absolute Einheit der Spieldaten ist unklar)
      const price = (c) => c.fuel || c.fuelRel || 0;
      const fuel = price(ev.from) && price(to) ? Math.round(((price(to) - price(ev.from)) / price(ev.from)) * 100) : 0;
      const tz = to.tz != null && ev.from.tz != null ? (to.tz - ev.from.tz) / 60 : 0;
      key = `b-${ev.id}-${Math.round(best.dist / 50)}`;
      markup = `<div class="rn-head">${plate(to.code || '', to.state)}<div class="rn-title"><b>${escape(borderCountryName(to))}</b><small>${escape(to.state ? `Staatsgrenze in ${meters(best.dist)}` : `Grenze in ${meters(best.dist)}`)}</small></div></div>
          ${l.length ? `<div class="rn-limits">${limitSign(l[0], roads[0])}${limitSign(l[1], roads[1])}${limitSign(l[2], roads[2])}<span class="rn-unit">${unit}<br>Lkw</span></div>` : ''}
          <div class="rn-chips">${chip('toll', to.tolls ? (to.state ? 'Mautstraßen' : 'Maut auf Autobahnen') : 'Keine Mautstellen', to.tolls ? 'warn' : '')}${fuel ? chip('fuel', `Diesel ${fuel > 0 ? '+' : '−'}${Math.abs(fuel)} %`, fuel < 0 ? 'good' : 'bad') : ''}${tz ? chip('clock', `Uhr ${tz > 0 ? '+' : '−'}${Math.abs(tz)} Std.`) : ''}</div>`;
      if (!spokenRoad.has(ev.id) && best.dist < 1000) {
        spokenRoad.add(ev.id);
        if (settings.mapBorderVoice && l.length) {
          speak(to.state
            ? `Staatsgrenze nach ${borderCountryName(to)}. Lkw: Interstate ${l[0]}, Landstraße ${l[2]}.${to.tolls ? ' Mautstraßen.' : ''}`
            : `Grenze nach ${borderCountryName(to)}. Lkw: Autobahn ${l[0]}, Landstraße ${l[2]}.${to.tolls ? ' Maut auf Autobahnen.' : ''}`);
        }
      }
    } else {
      const what = ev.down ? 'Gefälle' : 'Steigung';
      const sub = best.inside ? `noch ${meters(best.toEnd ?? 0)}` : `in ${meters(best.dist)} · ${meters(ev.length)} lang`;
      key = `g-${ev.id}-${Math.round(best.dist / 50)}-${best.inside ? Math.round((best.toEnd || 0) / 50) : ''}`;
      const fromCum = best.inside ? ev.endCum - (best.toEnd || 0) : ev.startCum - best.dist;
      markup = `<div class="rn-head">${gradeSign(ev.pct, ev.down)}<div class="rn-title"><b>${escape(`${what} ${ev.pct} %`)}</b><small>${escape(sub)}</small></div></div>
          <div class="rn-graph">${profileSvg(fromCum, ev)}</div>
          <div class="rn-chips">${chip(ev.down ? 'slope-down' : 'slope-up', gradeAdvice(ev), 'warn')}</div>`;
      if (!spokenRoad.has(ev.id) && !best.inside && best.dist < 2000) {
        spokenRoad.add(ev.id);
        if (settings.mapGradeVoice) speak(`Achtung, ${ev.pct} Prozent ${ev.down ? 'Gefälle' : 'Steigung'} in ${meters(best.dist)}. ${gradeAdvice(ev)}.`);
      }
    }
    const close = `<button class="rn-close" data-focus data-action="road-dismiss" data-id="${ev.id}" aria-label="Ausblenden">${ICONS.cancelled || '×'}</button>`;
    html('road-notice', key, close + markup);
    for (const el of nodes('road-notice')) setHidden(el, false);
    // in anderen Apps einmal als Mitteilung oben
    if (!shownRoad.has(ev.id)) {
      shownRoad.add(ev.id);
      if (screen !== 'maps' && screen !== 'dashboard') {
        showToast(ev.type === 'border'
          ? { icon: 'border', color: 'blue', title: `${borderCountryName(ev.to)} in ${meters(best.dist)}`, text: !carMode && (ev.to.limits || []).length ? (ev.to.state ? `Lkw: Interstate ${limitIn(ev.to.limits[0], true)}, Landstraße ${limitIn(ev.to.limits[2], true)}` : `Lkw: Autobahn ${limitIn(ev.to.limits[0], ev.to.mph)}, Landstraße ${limitIn(ev.to.limits[2], ev.to.mph)}`) : '', open: 'maps' }
          : { icon: ev.down ? 'slope-down' : 'slope-up', color: 'orange', title: `${ev.pct} % ${ev.down ? 'Gefälle' : 'Steigung'} in ${meters(best.dist)}`, text: gradeAdvice(ev), open: 'maps' });
      }
    }
  }
  if (demoMode) window.__roadEvents = () => roadEvents.map((e) => ({ ...e, from: e.from?.iso, to: e.to?.iso })); // Test
  // ------------------------------------------------------------------ Routenlinie auf der Spur, durch Kreuzungen exakt
  // Fahrkurven der Prefabs (mapdata/europe-curves.json, lokale Koordinaten) werden über die Knoten der Kreuzung in die
  // Welt eingepasst. Die Linie folgt in Kreisverkehren und Rampen der Kurve der gewählten Spur; auf den Straßen dazwischen
  // bleibt sie auf derselben Spur und wechselt erst dort, wo die Spurplanung (planLanes) es verlangt.
  const LANE_WIDTH = 4.5; // Spurbreite im Spiel (wie in sideOf: halbe Fahrbahn = Spuren × 2,25 m)
  let curveData = null; // { tokens, placed, byNode: Map(Knoten -> [Index in placed]) }
  const curveFits = new Map(); // Index in placed -> Einpassung oder null

  function setCurves(data) {
    curveData = null;
    curveFits.clear();
    if (!data || !data.tokens || !Array.isArray(data.placed)) return;
    const byNode = new Map();
    data.placed.forEach((row, i) => {
      for (let k = 2; k < row.length; k++) {
        const list = byNode.get(row[k]);
        if (list) list.push(i);
        else byNode.set(row[k], [i]);
      }
    });
    curveData = { tokens: data.tokens, placed: data.placed, byNode };
  }

  // Lage der Kreuzung: Drehung + Verschiebung (Spiegelung nur, wenn sie deutlich besser passt) aus den Knoten
  function fitPrefab(index) {
    if (curveFits.has(index)) return curveFits.get(index);
    const row = curveData.placed[index];
    const t = curveData.tokens[row[0]];
    const uids = row.slice(2);
    const n = uids.length;
    const local = [];
    const world = [];
    uids.forEach((uid, wi) => {
      const li = (wi + row[1]) % n;
      let w = null;
      try {
        w = CarMap.nodePosition(BigInt(`0x${uid}`));
      } catch {
        w = null;
      }
      if (w && t.n[li]) {
        local.push([t.n[li][0], t.n[li][1]]);
        world.push([w.x, w.y]);
      }
    });
    let best = null;
    if (local.length >= 2) {
      const m = local.length;
      const avg = (a, k) => a.reduce((s, p) => s + p[k], 0) / m;
      const lx = avg(local, 0), ly = avg(local, 1), wx = avg(world, 0), wy = avg(world, 1);
      for (const mirror of [1, -1]) {
        let sxx = 0, sxy = 0;
        for (let i = 0; i < m; i++) {
          const ax = local[i][0] - lx, ay = (local[i][1] - ly) * mirror;
          const bx = world[i][0] - wx, by = world[i][1] - wy;
          sxx += ax * bx + ay * by;
          sxy += ax * by - ay * bx;
        }
        const a = Math.atan2(sxy, sxx), c = Math.cos(a), s = Math.sin(a);
        const tf = (x, y) => { const ax = x - lx, ay = (y - ly) * mirror; return { x: wx + c * ax - s * ay, y: wy + s * ax + c * ay }; };
        const rot = (dx, dy) => ({ x: c * dx - s * dy * mirror, y: s * dx + c * dy * mirror });
        let err = 0;
        for (let i = 0; i < m; i++) { const p = tf(local[i][0], local[i][1]); err = Math.max(err, Math.hypot(p.x - world[i][0], p.y - world[i][1])); }
        if (!best || err < best.err - 0.5) best = { err, tf, rot };
      }
    }
    const fitResult = best && best.err < 2 ? best : null;
    curveFits.set(index, fitResult);
    return fitResult;
  }

  // Spuren an einem Knoten quer zur Fahrtrichtung ordnen (links → rechts) – wie build-places.js (Spurregeln)
  function orderLanes(t, list, useEnd) {
    const curves = list.filter((c) => t.c[c]);
    let dx = 0, dy = 0;
    for (const c of curves) {
      const cu = t.c[c];
      const len = Math.hypot(cu[3] - cu[0], cu[4] - cu[1]) || 1;
      dx += (cu[3] - cu[0]) / len;
      dy += (cu[4] - cu[1]) / len;
    }
    return curves.map((c) => ({ c, side: (useEnd ? t.c[c][3] : t.c[c][0]) * -dy + (useEnd ? t.c[c][4] : t.c[c][1]) * dx }))
      .sort((a, b) => a.side - b.side).map((o) => o.c);
  }

  // Kurvenweg durch eine Kreuzung: von Einfahrspur (bevorzugt preferred, sonst die nächste erlaubte) zur Ausfahrt.
  // Ergebnis: Weltpunkte alle ~3 m, gewählte Einfahrspur, erreichte Ausfahrspur, Spurzahlen – oder null
  function prefabCurvePoints(hexA, hexB, preferred, allowedMask) {
    if (!curveData) return null;
    const ia = curveData.byNode.get(hexA);
    if (!ia) return null;
    const index = ia.find((i) => curveData.placed[i].includes(hexB, 2));
    if (index === undefined) return null;
    const row = curveData.placed[index];
    const t = curveData.tokens[row[0]];
    const uids = row.slice(2);
    const n = uids.length;
    const localOf = (uid) => (uids.indexOf(uid) + row[1]) % n;
    const entry = t.n[localOf(hexA)];
    const exit = t.n[localOf(hexB)];
    if (!entry || !exit) return null;
    const fit = fitPrefab(index);
    if (!fit) return null;
    const ins = orderLanes(t, entry[2], false);
    const outs = orderLanes(t, exit[3], true);
    if (!ins.length || !outs.length) return null;
    const outIndex = new Map(outs.map((c, i) => [c, i]));
    const wanted = Math.min(ins.length - 1, Math.max(0, preferred ?? ins.length - 1));
    const order = ins.map((_, i) => i).filter((i) => !allowedMask || (allowedMask >> i) & 1).sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted));
    for (const li of order) {
      // kürzester Kurvenweg (Breitensuche) von dieser Spur zur Ausfahrt
      const prev = new Map([[ins[li], -1]]);
      const queue = [ins[li]];
      let end = -1;
      while (queue.length && prev.size < 400) {
        const k = queue.shift();
        if (outIndex.has(k)) { end = k; break; }
        for (const nx of t.c[k]?.[6] || []) if (!prev.has(nx)) { prev.set(nx, k); queue.push(nx); }
      }
      if (end < 0) continue;
      const chain = [];
      for (let c = end; c !== -1; c = prev.get(c)) chain.unshift(c);
      const pts = [];
      for (const ci of chain) {
        const [x0, y0, r0, x1, y1, r1] = t.c[ci];
        const len = Math.hypot(x1 - x0, y1 - y0);
        const steps = Math.max(1, Math.min(40, Math.round(len / 3)));
        const ax = Math.cos(r0) * len, ay = Math.sin(r0) * len, bx = Math.cos(r1) * len, by = Math.sin(r1) * len;
        for (let s = pts.length ? 1 : 0; s <= steps; s++) {
          const u = s / steps, u2 = u * u, u3 = u2 * u;
          const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
          pts.push(fit.tf(h00 * x0 + h10 * ax + h01 * x1 + h11 * bx, h00 * y0 + h10 * ay + h01 * y1 + h11 * by));
        }
      }
      // Gegenprobe: Anfang und Ende müssen bei den Knoten der Kreuzung liegen (Spur neben der Knotenmitte)
      let wa = null, wb = null;
      try {
        wa = CarMap.nodePosition(BigInt(`0x${hexA}`));
        wb = CarMap.nodePosition(BigInt(`0x${hexB}`));
      } catch {
        return null;
      }
      if (!wa || !wb || pts.length < 2) return null;
      if (Math.hypot(pts[0].x - wa.x, pts[0].y - wa.y) > 16 || Math.hypot(pts[pts.length - 1].x - wb.x, pts[pts.length - 1].y - wb.y) > 16) return null;
      return { pts, inLane: li, outLane: outIndex.get(end), nIn: ins.length, nOut: outs.length };
    }
    return null;
  }

  // Spurwahl entlang der Route und Kurvenpunkte der Kreuzungen.
  // curveOf[k]: Punkte der Kreuzung zwischen Knoten k-1 und k; laneOff[k]: [Versatz am Anfang, am Ende] der Straße
  // gegenüber der Fahrbahnmitte (nach rechts), damit die Linie auf der gewählten Spur liegt
  const EARLY_LANE_M = 800; // so weit vor der Kreuzung liegt die Linie schon auf der Spur, die sie braucht
  function planRouteLanes(hex, laneOf, sideOf, aheadOf, leftHand, points = []) {
    const curveOf = hex.map(() => null);
    const laneOff = hex.map(() => null);
    spokenTurns.clear(); // neue Route: Ansagen neu
    lastFirstTurn = null;
    if (!curveData) return { curveOf, laneOff };
    const choice = hex.map(() => null); // Kreuzung: { inLane, outLane, nIn, nOut }
    let cur = null; // { lane, count } – Spur, auf der die Linie gerade liegt
    const defaultLane = (count) => (leftHand ? 0 : count - 1); // Lkw fahren rechts (Linksverkehr: links)
    for (let k = 1; k < hex.length; k++) {
      const own = laneOf[k] || 0;
      const isPrefab = curveData.byNode.has(hex[k - 1]) && curveData.byNode.get(hex[k - 1]).some((i) => curveData.placed[i].includes(hex[k], 2));
      if (!isPrefab) {
        // Straße: Spur behalten, wenn die Zahl passt; sonst neu von außen
        if (own >= 2) cur = cur && cur.count === own ? cur : { lane: defaultLane(own), count: own };
        else cur = null;
        continue;
      }
      const rule = laneLinks?.get(`${hex[k - 1]}|${hex[k]}`);
      let mask = aheadOf[k] ? aheadOf[k][1] : 0;
      if (!mask && rule) rule.masks.forEach((m, i) => { if (m) mask |= 1 << i; });
      let res = prefabCurvePoints(hex[k - 1], hex[k], cur ? cur.lane : null, mask || null)
        || (mask ? prefabCurvePoints(hex[k - 1], hex[k], cur ? cur.lane : null, null) : null);
      // Spurregeln ohne Straßenbahngleise, Fahrkurven mit: zählen sie verschieden, passt die Maske nicht zu den Kurven
      if (res && mask && rule && rule.masks.length !== res.nIn) res = prefabCurvePoints(hex[k - 1], hex[k], cur ? cur.lane : null, null);
      if (!res) { cur = null; continue; }
      if (cur && cur.count !== res.nIn) cur = null;
      res.pts.lane = { lo: (res.inLane - (res.nIn - 1) / 2) * LANE_WIDTH, own: res.nIn }; // für die aktuelle Spur
      curveOf[k] = res.pts;
      choice[k] = res;
      cur = { lane: res.outLane, count: res.nOut };
    }
    // Rückwärts: Einfahrspur der nächsten Kreuzung über die Straßen davor (gleiche Spurzahl, bis EARLY_LANE_M) –
    // die Linie wechselt früh auf die Spur, wie man sich auch einordnet, nicht erst auf den letzten Metern
    const isPrefabPiece = (k) => curveData.byNode.has(hex[k - 1]) && curveData.byNode.get(hex[k - 1]).some((i) => curveData.placed[i].includes(hex[k], 2));
    const target = hex.map(() => null);
    let want = null;
    for (let k = hex.length - 1; k >= 1; k--) {
      if (choice[k]) { want = { lane: choice[k].inLane, count: choice[k].nIn, dist: 0 }; continue; }
      const own = laneOf[k] || 0;
      if (!want || isPrefabPiece(k) || own !== want.count || want.dist > EARLY_LANE_M) { want = null; continue; }
      target[k] = want.lane;
      const a = points[k - 1];
      const b = points[k];
      want.dist += a && b ? Math.hypot(b.x - a.x, b.y - a.y) : Infinity;
    }
    // Straßen: Spur am Anfang (aus der Kreuzung davor) und am Ende (Zielspur von oben, sonst unverändert)
    let carry = null;
    for (let k = 1; k < hex.length; k++) {
      if (choice[k]) { carry = { lane: choice[k].outLane, count: choice[k].nOut }; continue; }
      if (curveOf[k] === null && curveData.byNode.has(hex[k - 1]) && curveData.byNode.get(hex[k - 1]).some((i) => curveData.placed[i].includes(hex[k], 2))) { carry = null; continue; }
      const own = laneOf[k] || 0;
      if (own < 2 || !sideOf[k]) { carry = null; continue; }
      const start = carry && carry.count === own ? carry.lane : defaultLane(own);
      const end = target[k] ?? start;
      const off = (lane) => (lane - (own - 1) / 2) * LANE_WIDTH;
      laneOff[k] = [off(start), off(end)];
      carry = { lane: end, count: own };
    }
    return { curveOf, laneOff };
  }

  // ------------------------------------------------------------------ Eigene Abbiegeansagen (optional)
  // Die Navi-Stimme des Spiels sagt schon an – das hier ist für alle, die sie aus haben oder Olivia hören möchten.
  // Zeitpunkte nach Tempo: Autobahn früh (2 km, 800 m, 250 m), Landstraße mittel, Stadt spät (300 m, 100 m, 30 m)
  const spokenTurns = new Map(); // Abbiegung (Routenpunkt) -> zuletzt angesagte Stufe
  let lastTurnSay = { text: '', at: 0 }; // gleicher Satz nicht zweimal kurz hintereinander
  let lastFirstTurn = null; // nächste Abbiegung beim letzten Mal – wechselt sie, ist die vorige geschafft
  function announceTurn(m) {
    if (!settings.navVoice || !m) return;
    const t = m.turns[0];
    const firstKey = t ? String(t.index) : 'none';
    if (lastFirstTurn !== null && firstKey !== lastFirstTurn && num(telemetry?.speedKmh) > 15) {
      // gerade abgebogen: ist die nächste weit weg, „24 km geradeaus“ (wie echte Navis)
      if (t && t.distance > 3000) {
        const km = Math.round(t.distance / 1000);
        lastFirstTurn = firstKey;
        speak(`${imperial() ? meters(t.distance) : `${km} km`} geradeaus.`, null, { priority: 3 });
        return;
      }
      if (!t) speak('Der Route folgen.', null, { priority: 3 });
    }
    lastFirstTurn = firstKey;
    if (!t) return;
    const v = num(telemetry?.speedKmh);
    const mps = v / 3.6; // 游戏内米 / 现实秒
    const T_SPEECH = 3;  // 语音时长补偿（约 3 秒，语音在参考点恰好结束）
    // 提前秒数（按速度近似道路等级：高速/主干路更长，城市更短）；执行层提前 0.5 秒
    const adv = v > 65 ? [45, 14, 0.5] : v > 35 ? [30, 10, 0.5] : [18, 7, 0.5];
    // D_ref = V × 提前秒数；D_trigger = D_ref + V × T_speech
    const refs = adv.map((s) => Math.round(mps * s));
    const trigs = refs.map((d) => d + Math.round(mps * T_SPEECH));
    // 找到已触发的最深层级（0=L1 预告, 1=L2 准备, 2=L3 执行）
    let lv = -1;
    for (let i = 0; i < 3; i++) if (t.distance <= trigs[i]) lv = i;
    if (lv < 0) return;
    // 环岛：L3（“现在驶出环岛”）只在环岛内、接近出口时触发（进环岛时 distance 是到入口的距离，不能报“驶出”）
    if (lv === 2 && t.kind === 'roundabout' && !t.inside) return;
    const key = String(t.index);
    if ((spokenTurns.get(key) ?? -1) >= lv) return; // 同一 (id, level) 全局只播一次
    spokenTurns.set(key, lv);
    const isNow = lv === 2;
    // 两步联合播报（组合弯道）：预告/准备层且下一机动很近（< 400 m）时合并为“，然后 …”
    const then = lv <= 1 && m.turns[1] && m.turns[1].distance - t.distance < 400 ? `, dann ${turnSpoken(m.turns[1])}` : '';
    // Ziel vom Wegweiser (nur wenn das Schild zur Route passt): „Ausfahrt rechts nehmen Richtung München“
    const yard = yardTurn(m, t) ? ' auf das Firmengelände' : t.towards && t.kind !== 'roundabout' ? ` Richtung ${t.towards}` : '';
    const say = isNow
      ? (t.kind === 'roundabout' ? 'Jetzt aus dem Kreisverkehr ausfahren.' : `Jetzt ${turnSpoken(t)}${yard}${then}.`)
      : `In ${meters(refs[lv])} ${turnSpoken(t)}${yard}${then}.`;
    if (say === lastTurnSay.text && performance.now() - lastTurnSay.at < 20000) return;
    lastTurnSay = { text: say, at: performance.now() };
    if (demoMode) (window.__said = window.__said || []).push(`${Math.round(t.distance)} m bei ${Math.round(v)} km/h: ${say}`); // Test
    speak(say, null, { priority: lv === 2 ? 1 : lv === 1 ? 2 : 3 });
  }
  // ------------------------------------------------------------------ Video (YouTube, Twitch)
  // Der Player liegt außerhalb der Bildschirme (#video-layer), damit er beim Neuaufbau der Oberfläche
  // nicht neu lädt. Er spielt nur auf dem Truck-Bildschirm – der Editor zeigt ein Vorschaubild.
  const videoLayer = document.getElementById('video-layer');
  const canPlayVideo = role === 'game' || !api;
  let videoKey = '';
  let videoPaused = false;
  let videoFull = false;
  const ytInfo = { time: 0, state: -1 }; // vom YouTube-Player gemeldet (Zeit, Status)
  let videoError = '';
  let videoPlaying = null; // das Video im Player (für die gemerkte Stelle, auch wenn die Liste sich ändert)
  const currentVideoPlaying = () => videoPlaying;
  const currentVideo = () => settings.video.items[settings.video.current] || null;
  // Weiterschauen: zuletzt gesehene Stelle je Video (nicht bei Live-Streams, Playlists und Clips)
  // Vollbild einer eingebetteten Seite (ihr eigener Vollbild-Knopf) läge über allem und wäre im Truck nicht mehr
  // bedienbar: sofort beenden – das Vollbild der App (⤢) ist davon unabhängig
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  });
  let videoPositions = {};
  try { videoPositions = JSON.parse(localStorage.getItem('videoPositions') || '{}') || {}; } catch {}
  let videoPosSavedAt = 0;
  const resumeKey = (v) => (v && (v.kind === 'yt' || v.kind === 'twv') ? `${v.kind}:${v.id}` : '');
  const resumeAt = (v) => Math.floor(Number(videoPositions[resumeKey(v)]) || 0);
  function clearVideoPositions() {
    videoPositions = {};
    try { localStorage.removeItem('videoPositions'); } catch {}
  }
  function pruneVideoPositions() {
    const keep = new Set(settings.video.items.map(resumeKey).filter(Boolean));
    const before = Object.keys(videoPositions).length;
    for (const k of Object.keys(videoPositions)) if (!keep.has(k)) delete videoPositions[k];
    if (Object.keys(videoPositions).length !== before) try { localStorage.setItem('videoPositions', JSON.stringify(videoPositions)); } catch {}
  }
  function rememberVideoPosition(v, time, duration) {
    const key = resumeKey(v);
    if (!key || !(duration > 60)) return;
    // kurz nach dem Anfang oder kurz vor dem Ende: nichts merken (beim nächsten Mal von vorn)
    if (time < 15 || time > duration - 20) delete videoPositions[key];
    else videoPositions[key] = Math.floor(time);
    const keys = Object.keys(videoPositions);
    if (keys.length > 60) for (const k of keys.slice(0, keys.length - 60)) delete videoPositions[k];
    try { localStorage.setItem('videoPositions', JSON.stringify(videoPositions)); } catch {}
  }

  function videoUrl(v) {
    if (v.kind === 'tw') return `https://player.twitch.tv/?channel=${encodeURIComponent(v.id)}&parent=localhost&autoplay=true&muted=false`;
    const start = resumeAt(v);
    if (v.kind === 'twv') return `https://player.twitch.tv/?video=v${encodeURIComponent(v.id)}&parent=localhost&autoplay=true&muted=false${start ? `&time=${Math.floor(start / 3600)}h${Math.floor((start % 3600) / 60)}m${start % 60}s` : ''}`;
    if (v.kind === 'web') return catalog.webEmbedUrl(v.id);
    // TikTok: offizieller Einbett-Player (hochkant, im 16:9-Fenster mit Rand); ohne embed_from=oembed meldet er „Player error“
    if (v.kind === 'tt') return `https://www.tiktok.com/player/v1/${encodeURIComponent(v.id)}?embed_from=oembed&autoplay=1&loop=0&rel=0&music_info=1&description=1&native_context_menu=0&closed_caption=0`;
    if (v.kind === 'twc') return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(v.id)}&parent=localhost&autoplay=true&muted=false`;
    const base = 'https://www.youtube-nocookie.com/embed/';
    // hl: Sprache der Bedienelemente und Hinweise des Players wie die App
    const common = `autoplay=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&iv_load_policy=3&hl=${encodeURIComponent(CarI18n.lang || 'de')}`;
    return v.kind === 'ytl' ? `${base}videoseries?list=${encodeURIComponent(v.id)}&${common}` : `${base}${encodeURIComponent(v.id)}?${common}${start ? `&start=${start}` : ''}`;
  }
  // Zeit wie bei YouTube: 4:05 oder 1:02:09
  function fmtVideoTime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
  }
  const fmtVideoRate = (r) => `${String(r).replace('.', ',')}×`;
  // Spul-Symbol: Kreispfeil mit Sekundenzahl (zurück links herum, vor rechts herum)
  function seekIcon(dir, n) {
    const arc = dir < 0 ? '<path d="M5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M5 3.5v4h4"/>' : '<path d="M19 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19 3.5v4h-4"/>';
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${arc}<text x="12" y="15.4" font-size="8" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">${n}</text></svg>`;
  }
  const webHost = (v) => {
    try {
      return new URL(v.id).hostname.replace(/^www\./, '');
    } catch {
      return 'Web';
    }
  };
  const videoKindLabel = (v) => (v.kind === 'web' ? webHost(v) : ({ tw: 'Twitch', twv: 'Twitch · Video', twc: 'Twitch · Clip', ytl: 'YouTube · Playlist', tt: 'TikTok' })[v.kind] || 'YouTube');
  function videoThumb(v, size = 'mq') {
    if (v.kind === 'yt') return `https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/${size}default.jpg`;
    if (v.kind === 'tw') return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(v.id)}-640x360.jpg`;
    return '';
  }
  // Als CSS-Hintergrund. YouTube: immer die große Vorschau – die mittlere fehlt bei manchen Videos (Livestreams, 404)
  function thumbCss(v) {
    const t = videoThumb(v, v.kind === 'yt' ? 'hq' : 'mq');
    return t ? `url('${t}')` : '';
  }
  function videoPlaceholder() {
    const v = currentVideo();
    if (!v) return `<div class="video-empty"><span class="ve-icon">${ICONS.video}</span><b>Kein Video ausgewählt</b><small>Link von YouTube, Twitch oder TikTok kopieren und rechts „Link einfügen“ antippen – oder vom Handy schicken.</small></div>`;
    const thumb = videoThumb(v, 'hq');
    const text = canPlayVideo ? (videoStopped ? 'Gestoppt – Video antippen' : 'Lädt …') : 'Läuft auf dem Truck-Display';
    return `<div class="video-thumb" ${thumb ? `style="background-image:${thumbCss(v)}"` : ''}></div>
      <button class="video-play" data-focus data-action="video-start"><span>${ICONS.play}</span><b>${escape(v.title)}</b><small>${text}</small></button>`;
  }
  let videoEdit = false;
  function videoRows() {
    const items = settings.video.items;
    if (videoEdit && items.length) {
      return items.map((v, i) => {
        const thumb = videoThumb(v);
        return `<div class="list-row video-row editing">
          <button class="vr-delete" data-focus data-video-remove="${i}" aria-label="Löschen">${ICONS.minus}</button>
          <span class="vr-thumb ${v.kind}" ${thumb ? `style="background-image:${thumbCss(v)}"` : ''}>${thumb ? '' : ICONS.video}</span>
          <div class="lr-text"><b>${escape(v.title)}</b><small>${videoKindLabel(v)}</small></div></div>`;
      }).join('') + `<button class="video-clear" data-focus data-action="video-clear">Alle löschen</button>`;
    }
    if (!items.length) return '<div class="list-empty">Noch keine Videos gespeichert.</div>';
    return items.map((v, i) => {
      const thumb = videoThumb(v);
      return `<button class="list-row video-row ${i === settings.video.current ? 'now' : ''}" data-focus data-video-pick="${i}">
        <span class="vr-thumb ${v.kind}" ${thumb ? `style="background-image:${thumbCss(v)}"` : ''}>${thumb ? '' : ICONS.video}</span>
        <div class="lr-text"><b>${escape(v.title)}</b><small>${v.kind === 'tw' ? '<i class="vr-live">LIVE</i> Twitch' : videoKindLabel(v)}${resumeAt(v) ? ` <i class="vr-resume">${ICONS.play}${fmtVideoTime(resumeAt(v))}</i>` : ''}</small>
          ${i === settings.video.current ? '<span class="vr-now">Ausgewählt</span>' : ''}</div></button>`;
    }).join('');
  }

  function rerenderVideoSlot() {
    const slot = stage.querySelector('[data-video-slot]');
    if (slot) slot.innerHTML = videoPlaceholder();
  }

  function syncVideo() {
    const v = currentVideo();
    if (!settings.video.items.length && Object.keys(videoPositions).length) pruneVideoPositions(); // Verlauf gelöscht
    if (!v || videoStopped || !settings.video.pip) videoPip = false;
    const pip = videoPip && screen !== 'video';
    const active = canPlayVideo && (screen === 'video' || pip) && v && !videoStopped && poweredOn;
    const key = active ? `${v.kind}:${v.id}` : '';
    if (key !== videoKey) {
      // altes Video: Stelle merken (der Zustand von eben ist höchstens eine halbe Sekunde alt)
      if (videoKey && !videoLive && videoTime > 0) rememberVideoPosition(videoPlaying, videoTime, videoDuration);
      videoPlaying = key ? v : null;
      // Wie im Auto: startet ein Video, pausiert die Musik
      if (key && media?.playing && role === 'game') sendMedia('toggle');
      videoKey = key;
      videoPaused = false;
      ytInfo.time = 0;
      videoTime = 0;
      videoDuration = 0;
      videoRate = 1;
      videoLive = false;
      videoLayer.innerHTML = key
        ? `<iframe src="${escape(videoUrl(v))}" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"${v.kind === 'web' ? ' sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"' : ''}></iframe>
           <div class="pip-grab"></div>${v.kind === 'web' && api?.videoTap ? '<div class="web-tap"></div>' : ''}
           <div class="video-bar">
             <button class="glass" data-focus data-action="video-full" aria-label="Vollbild">${ICONS.fullscreen}</button>
             <button class="glass pip-only" data-focus data-action="video-pip-size" aria-label="Größe ändern">${PIP_SIZE_ICON}</button>
             <button class="glass" data-focus data-action="video-toggle" aria-label="Pause">${ICONS.pause}</button>
             <button class="glass pip-only" data-focus data-action="video-pip-close" aria-label="Schließen">${ICONS.cancelled || '×'}</button>
           </div>
           <div class="video-cover" hidden>${ICONS.truck}<b>Video pausiert beim Fahren</b><small>Ton läuft weiter – das Bild kommt im Stand zurück</small></div>`
        : '';
    }
    const frameEl = videoLayer.querySelector('iframe');
    if (frameEl && !frameEl.dataset.listen) {
      frameEl.dataset.listen = '1';
      frameEl.addEventListener('load', () => {
        frameEl.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1 }), '*');
        setTimeout(applyVideoVolume, 1500); // nach dem Start des Players
        // Twitch startet eingebettet nicht von selbst: ein paar Mal den Abspielknopf des Players drücken, bis der Stream läuft
        if (api?.videoControl && v.kind.startsWith('tw')) {
          let tries = 0;
          const kick = () => {
            if (videoLayer.querySelector('iframe') !== frameEl || ++tries > 8) return;
            api.videoControl('start').then((st) => {
              if (st && !st.paused) return applyVideoVolume();
              setTimeout(kick, 1500);
            });
          };
          setTimeout(kick, 1500);
        }
      });
    }
    setHidden(videoLayer, !key);
    if (key && videoLayer.dataset.volume !== String(settings.volumeVideo)) {
      videoLayer.dataset.volume = String(settings.volumeVideo);
      applyVideoVolume();
    }
    width('vd-vol', settings.volumeVideo / 100);
    text('vd-vol-text', `${settings.volumeVideo} %`);
    if (!key) videoFull = false;
    videoLayer.classList.toggle('full', videoFull);
    if (videoLayer.classList.contains('pip') !== (!!key && pip)) {
      videoLayer.classList.toggle('pip', !!key && pip);
      videoLayer.dataset.pos = ''; // neu platzieren (Ecke bzw. Platz in der Video-App)
    }
    if (key) placeVideo();
    syncVideoWidget(key && v);
    if (role === 'game' && api?.videoState) api.videoState(!!key);
  }

  // Dashboard-Widget „Musik“: läuft ein Video, zeigt es dessen Bild, Titel und Knöpfe (statt Spotify bzw. Radio)
  function syncVideoWidget(v) {
    shell.classList.toggle('video-src', !!v);
    if (!v) return;
    const bg = thumbCss(v);
    for (const el of nodes('wv-art')) if (el.style.backgroundImage !== bg) el.style.backgroundImage = bg;
    marqueeText('wv-title', v.title);
    text('wv-kind', videoKindLabel(v));
    for (const btn of stage.querySelectorAll('.wv-controls [data-action="video-toggle"]')) btn.innerHTML = videoPaused ? ICONS.play : ICONS.pause;
  }

  // Vollbild: Video über die ganze Anzeige, Seitenleiste verschwindet; Zurück/Home oder ⤡ beendet es
  function setVideoFull(on) {
    videoFull = !!on && !!videoKey;
    videoLayer.classList.toggle('full', videoFull);
    videoLayer.dataset.pos = '';
    placeVideo();
    const btn = videoLayer.querySelector('[data-action="video-full"]');
    if (btn) btn.innerHTML = videoFull ? ICONS['fullscreen-exit'] : ICONS.fullscreen;
  }

  // YouTube-Player meldet Zeit und Status (enablejsapi) – für Vor-/Zurückspulen per Medientaste
  window.addEventListener('message', (e) => {
    let host = '';
    try {
      host = new URL(e.origin).hostname;
    } catch {
      return; // Herkunft „null“ (eingebettete Werbe- oder Sandbox-Rahmen): new URL warf hier einen Fehler
    }
    if (!/youtube(-nocookie)?\.com$/.test(host)) return;
    let data;
    try {
      data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    const info = data && data.info;
    if (info && typeof info.currentTime === 'number') ytInfo.time = info.currentTime;
    if (info && typeof info.playerState === 'number') {
      ytInfo.state = info.playerState;
      videoPaused = info.playerState === 2;
      const btn = videoLayer.querySelector('[data-action="video-toggle"]');
      if (btn) btn.innerHTML = videoPaused ? ICONS.play : ICONS.pause;
    }
  });
  function ytCommand(func, args = []) {
    const frameEl = videoLayer.querySelector('iframe');
    frameEl?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  }

  // Medientasten (Lenkrad-Hotkeys, Handy) steuern das laufende Video
  function videoCommand(cmd) {
    const v = currentVideo();
    if (!v) return;
    if (cmd === 'toggle') return videoToggle();
    if (v.kind === 'ytl') return ytCommand(cmd === 'next' ? 'nextVideo' : 'previousVideo');
    videoSeek(cmd === 'next' ? 15 : -15);
  }

  // Eigene Knöpfe: steuern das Video im Player direkt (api.videoControl) – für YouTube und Twitch gleich.
  // Live-Streams lassen sich nicht spulen. Ohne App (Browser-Test) bleibt die YouTube-Schnittstelle.
  function showVideoState(st) {
    if (!st) return;
    videoPaused = !!st.paused;
    videoLive = !!st.live;
    if (!videoSeekDrag) videoTime = Number(st.time) || 0;
    videoDuration = Number(st.duration) || 0;
    if (videoKey && !videoLive && !videoPaused && videoTime > 0 && performance.now() - videoPosSavedAt > 5000) {
      videoPosSavedAt = performance.now();
      rememberVideoPosition(currentVideoPlaying(), videoTime, videoDuration);
    }
    if (Number(st.rate) > 0) videoRate = Number(st.rate);
    for (const btn of document.querySelectorAll('[data-action="video-toggle"]')) btn.innerHTML = videoPaused ? ICONS.play : ICONS.pause;
    for (const btn of document.querySelectorAll('[data-action="video-seek"]')) btn.disabled = !!st.live;
    showVideoProgress();
  }
  // Zeitleiste der Video-App: Position, Länge, Geschwindigkeit (bei Live-Streams ausgeblendet)
  function showVideoProgress() {
    for (const el of nodes('vd-progress')) setHidden(el, videoLive || !videoDuration);
    const t = videoSeekDrag ? videoSeekDrag.time : videoTime;
    text('vd-time', fmtVideoTime(t));
    text('vd-dur', fmtVideoTime(videoDuration));
    width('vd-pos', videoDuration ? Math.min(1, t / videoDuration) : 0);
    const label = fmtVideoRate(videoRate);
    for (const btn of document.querySelectorAll('[data-action="video-rate"]')) {
      if (btn.textContent !== label) btn.textContent = label;
      btn.classList.toggle('on', videoRate !== 1);
    }
  }
  function videoSeek(seconds) {
    if (api?.videoControl) return api.videoControl('seek', seconds).then(showVideoState);
    ytCommand('seekTo', [Math.max(0, ytInfo.time + seconds), true]);
  }
  function videoSeekTo(time) {
    videoTime = time;
    showVideoProgress();
    if (api?.videoControl) return api.videoControl('seekto', time).then(showVideoState);
    ytCommand('seekTo', [Math.max(0, time), true]);
  }
  // Geschwindigkeit: 1× → 1,25× → 1,5× → 2× → 0,75× → 1×
  function videoRateNext() {
    if (videoLive) return;
    const next = { 1: 1.25, 1.25: 1.5, 1.5: 2, 2: 0.75 }[videoRate] || 1;
    videoRate = next;
    showVideoProgress();
    if (api?.videoControl) return api.videoControl('rate', next).then(showVideoState);
    ytCommand('setPlaybackRate', [next]);
  }

  // Zeitleiste antippen oder ziehen: springt beim Loslassen dorthin
  let videoSeekDrag = null;
  function videoSeekFromBar(x) {
    const r = videoSeekDrag.bar.getBoundingClientRect();
    videoSeekDrag.time = Math.max(0, Math.min(1, (x - r.left) / r.width)) * videoDuration;
    showVideoProgress();
  }
  // Spul-Knöpfe halten: spult immer schneller (10, 10, 20, 30, 60 s … – im Widget in 15er-Schritten), Antippen springt einmal
  let videoSeekHold = null;
  let videoSeekHeldAt = 0;
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element) || e.button > 0) return;
    const bar = e.target.closest('.vd-seek');
    if (bar && videoDuration) {
      e.preventDefault();
      videoSeekDrag = { bar, time: videoTime };
      videoSeekFromBar(e.clientX);
      return;
    }
    const btn = e.target.closest('[data-action="video-seek"]');
    if (!btn || btn.disabled) return;
    const step = Number(btn.dataset.step) || 10;
    const base = Math.abs(step);
    let n = 0;
    const tick = () => {
      n++;
      videoSeekHeldAt = performance.now();
      videoSeek(Math.sign(step) * (n < 3 ? base : n < 5 ? 2 * base : n < 8 ? 3 * base : 6 * base));
      if (n < 40) videoSeekHold = setTimeout(tick, 350);
    };
    clearTimeout(videoSeekHold);
    videoSeekHold = setTimeout(tick, 450);
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (videoSeekDrag) videoSeekFromBar(e.clientX);
  });
  const endVideoSeek = (e) => {
    clearTimeout(videoSeekHold);
    videoSeekHold = null;
    if (!videoSeekDrag) return;
    const drag = videoSeekDrag;
    videoSeekDrag = null;
    if (e.type === 'pointerup') videoSeekTo(drag.time);
    else showVideoProgress();
  };
  document.addEventListener('pointerup', endVideoSeek);
  document.addEventListener('pointercancel', endVideoSeek);
  window.addEventListener('blur', endVideoSeek);
  // Klick nach dem Halten nicht noch einmal spulen
  const videoSeekTap = (step) => {
    if (performance.now() - videoSeekHeldAt > 500) videoSeek(step);
  };
  function applyVideoVolume() {
    if (api?.videoControl) api.videoControl('volume', settings.volumeVideo / 100);
    else ytCommand('setVolume', [settings.volumeVideo]);
  }
  // Zustand (läuft/pausiert, live, Position) zweimal pro Sekunde abfragen, solange ein Video läuft
  setInterval(() => {
    if (!videoKey || !api?.videoControl || videoSeekDrag) return;
    const asked = videoKey;
    api.videoControl('state').then((st) => {
      // Antwort des vorigen Videos (gerade gewechselt): verwerfen – sonst merkte sich das neue dessen Stelle
      if (asked !== videoKey) return;
      showVideoState(st);
      // Player setzt beim Start (oder nach Werbung) seine eigene Lautstärke – auf die eingestellte zurückholen
      if (st && !videoVolHold && Math.abs(st.volume - settings.volumeVideo / 100) > 0.015) applyVideoVolume();
    });
  }, 500);

  // Lautstärke wie beim Radio: Tippen ±1 %, Halten wird immer schneller, Balken antippen oder ziehen springt hin
  let videoVolHold = null;
  let lastVideoVolPointer = 0;
  function setVideoVolume(v, save) {
    settings.volumeVideo = Math.max(0, Math.min(100, Math.round(v)));
    width('vd-vol', settings.volumeVideo / 100);
    text('vd-vol-text', `${settings.volumeVideo} %`);
    applyVideoVolume();
    // Speichern ohne Neuaufbau der Oberfläche (der baute bei jedem Schritt alles neu, Anzeige flackerte/blieb leer)
    if (save) quietSetting((st) => (st.volumeVideo = settings.volumeVideo));
  }
  function videoVolFromBar(bar, x) {
    const r = bar.getBoundingClientRect();
    setVideoVolume(((x - r.left) / r.width) * 100, false);
  }
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element)) return;
    const bar = e.target.closest('.vd-bar');
    const btn = e.target.closest('[data-action="video-vol"]');
    if (!bar && !btn) return;
    e.preventDefault();
    lastVideoVolPointer = performance.now();
    if (bar) {
      videoVolHold = { bar };
      videoVolFromBar(bar, e.clientX);
      return;
    }
    const dir = Number(btn.dataset.step) < 0 ? -1 : 1;
    setVideoVolume(settings.volumeVideo + dir, false);
    let n = 0;
    const tick = () => {
      n++;
      setVideoVolume(settings.volumeVideo + dir * (n < 6 ? 1 : n < 14 ? 2 : 5), false);
      videoVolHold.timer = setTimeout(tick, n < 6 ? 140 : 90);
    };
    videoVolHold = { timer: setTimeout(tick, 420) };
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (videoVolHold?.bar) videoVolFromBar(videoVolHold.bar, e.clientX);
  });
  const endVideoVolHold = () => {
    if (!videoVolHold) return;
    clearTimeout(videoVolHold.timer);
    videoVolHold = null;
    setVideoVolume(settings.volumeVideo, true); // erst am Ende speichern
  };
  document.addEventListener('pointerup', endVideoVolHold);
  document.addEventListener('pointercancel', endVideoVolHold);
  window.addEventListener('blur', endVideoVolHold);
  // Drehknopf/Tastatur: ein Schritt (Berührung/Maus erledigt pointerdown)
  function videoVolumeStep(step) {
    if (performance.now() - lastVideoVolPointer > 800) setVideoVolume(settings.volumeVideo + (step < 0 ? -1 : 1), true);
  }
  // Bild im Bild: Fläche neben der Seitenleiste, Größe gut ein Drittel der Breite (16:9), 1,6 rem Abstand zum Rand
  // Größe des Bilds im Bild (Einstellung, Knopf im Fenster): Anteil an der Breite neben der Seitenleiste
  const PIP_SIZE = { s: 0.28, m: 0.38, l: 0.5 };
  const PIP_SIZE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="11" y="11" width="8" height="6" rx="1" fill="currentColor"/></svg>';
  function pipArea() {
    const s = shell.getBoundingClientRect();
    const side = document.querySelector('.sidebar');
    const sr = side && side.offsetParent ? side.getBoundingClientRect() : null;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
    const m = rem * 1.6;
    let left = m;
    let right = s.width - m;
    let top = m;
    let bottom = s.height - m;
    if (sr && sr.width) {
      if (sr.width > sr.height) {
        // Leiste oben/unten
        if (sr.top - s.top < s.height / 2) top = sr.bottom - s.top + m;
        else bottom = sr.top - s.top - m;
      } else if (sr.left - s.left < s.width / 2) left = sr.right - s.left + m;
      else right = sr.left - s.left - m;
    }
    const share = PIP_SIZE[settings.video.pipSize] || PIP_SIZE.m;
    const w = Math.round(Math.min(right - left, (bottom - top) * (16 / 9), Math.max(rem * 24, (right - left) * share)));
    const h = Math.round((w * 9) / 16);
    return { left, right, top, bottom, w, h };
  }
  function pipRect(corner) {
    const a = pipArea();
    return { x: Math.round(corner[1] === 'l' ? a.left : a.right - a.w), y: Math.round(corner[0] === 't' ? a.top : a.bottom - a.h), w: a.w, h: a.h };
  }
  // nächste Ecke zur Mitte des Fensters
  function pipNearest(cx, cy) {
    const a = pipArea();
    return `${cy < (a.top + a.bottom) / 2 ? 't' : 'b'}${cx < (a.left + a.right) / 2 ? 'l' : 'r'}`;
  }

  // Ziehen: das Fenster folgt dem Finger, die vier Ecken erscheinen als Ablageflächen (die nächste hervorgehoben),
  // beim Loslassen rastet es dort ein; nur Antippen öffnet die App. Bewegung und Loslassen werden am ganzen Fenster
  // abgefragt – im Spiel kommen die Mausereignisse vom Plugin, und wer schnell zieht, ist sofort außerhalb des Videos.
  let pipDrag = null;
  let pipTargets = null;
  function showPipTargets(on) {
    if (!on) {
      pipTargets?.remove();
      pipTargets = null;
      return;
    }
    if (pipTargets) return;
    pipTargets = document.createElement('div');
    pipTargets.className = 'pip-targets';
    pipTargets.innerHTML = ['tl', 'tr', 'bl', 'br'].map((c) => {
      const p = pipRect(c);
      return `<i data-corner="${c}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px"></i>`;
    }).join('');
    shell.appendChild(pipTargets);
  }
  // Schwung wie bei Apples Bild im Bild: aus dem Tempo der letzten 100 ms den Ruhepunkt vorausrechnen (Abbremsen wie beim
  // Scrollen, Faktor 0,998) – die Ecke nächst diesem Punkt gewinnt. Ein kurzer Wurf reicht, statt bis über die Mitte zu
  // ziehen; wer anhält und dann loslässt, wirft nicht. Ergebnis: Versatz [x, y] in px (höchstens eine Bildschirmbreite)
  function pipThrow(trail, maxPx) {
    const now = performance.now();
    const recent = trail.filter((p) => now - p.t < 100);
    if (recent.length < 2) return [0, 0];
    const a = recent[0], b = recent[recent.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt < 0.008) return [0, 0];
    const project = (v) => Math.max(-maxPx, Math.min(maxPx, ((v / 1000) * 0.998) / (1 - 0.998)));
    return [project((b.x - a.x) / dt), project((b.y - a.y) / dt)];
  }
  function movePipDrag(e) {
    if (!pipDrag) return;
    const dx = e.clientX - pipDrag.x;
    const dy = e.clientY - pipDrag.y;
    if (!pipDrag.moved && Math.hypot(dx, dy) < 8) return;
    if (!pipDrag.moved) {
      pipDrag.moved = true;
      videoLayer.classList.add('dragging');
      showPipTargets(true);
    }
    const left = pipDrag.left + dx;
    const top = pipDrag.top + dy;
    // letzte Bewegungen merken: Tempo beim Loslassen (Schwung)
    pipDrag.trail.push({ t: performance.now(), x: e.clientX, y: e.clientY });
    if (pipDrag.trail.length > 6) pipDrag.trail.shift();
    videoLayer.style.left = `${Math.round(left)}px`;
    videoLayer.style.top = `${Math.round(top)}px`;
    // hervorgehobene Ecke = wo das Fenster beim Loslassen jetzt landen würde (mit Schwung)
    const [tx, ty] = pipThrow(pipDrag.trail, shell.clientWidth);
    const near = pipNearest(left + pipDrag.w / 2 + tx, top + pipDrag.h / 2 + ty);
    for (const t of pipTargets?.children || []) t.classList.toggle('near', t.dataset.corner === near);
  }
  function endPipDrag(e) {
    if (!pipDrag) return;
    const drag = pipDrag;
    pipDrag = null;
    window.removeEventListener('pointermove', movePipDrag, true);
    window.removeEventListener('pointerup', endPipDrag, true);
    window.removeEventListener('pointercancel', endPipDrag, true);
    videoLayer.classList.remove('dragging');
    showPipTargets(false);
    if (!drag.moved) {
      if (e.type === 'pointerup') showScreen('video'); // angetippt
      return;
    }
    const s = shell.getBoundingClientRect();
    const r = videoLayer.getBoundingClientRect();
    const [tx, ty] = pipThrow(drag.trail, s.width); // Schwung beim Loslassen
    const corner = pipNearest(r.left - s.left + r.width / 2 + tx, r.top - s.top + r.height / 2 + ty);
    videoLayer.dataset.pos = '';
    if (corner !== settings.video.pipCorner) quietSetting((st) => (st.video.pipCorner = corner));
    placeVideo();
  }
  videoLayer.addEventListener('pointerdown', (e) => {
    if (!videoLayer.classList.contains('pip') || e.button > 0 || !(e.target instanceof Element) || !e.target.closest('.pip-grab')) return;
    e.preventDefault();
    e.stopPropagation();
    const s = shell.getBoundingClientRect();
    const r = videoLayer.getBoundingClientRect();
    pipDrag = { x: e.clientX, y: e.clientY, left: r.left - s.left, top: r.top - s.top, w: r.width, h: r.height, moved: false, trail: [] };
    window.addEventListener('pointermove', movePipDrag, true);
    window.addEventListener('pointerup', endPipDrag, true);
    window.addEventListener('pointercancel', endPipDrag, true);
  });
  // Andere Webseiten: Antippen im Video als Klick in der Seite (main.js, video:tap) – ohne das blieben Play,
  // Altersabfrage und Cookie-Banner im Truck unerreichbar
  videoLayer.addEventListener('click', (e) => {
    const tap = e.target instanceof Element && e.target.closest('.web-tap');
    if (!tap || videoLayer.classList.contains('pip')) return;
    const r = tap.getBoundingClientRect();
    api?.videoTap?.((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  });
  // Größe: klein → mittel → groß
  const nextPipSize = (size) => ({ s: 'm', m: 'l', l: 's' })[size] || 'm';
  function cyclePipSize() {
    const next = nextPipSize(settings.video.pipSize);
    quietSetting((st) => (st.video.pipSize = next));
    videoLayer.dataset.pos = '';
    placeVideo();
  }

  // Player genau über den Platzhalter legen
  function placeVideo() {
    if (!videoKey) return;
    if (videoLayer.classList.contains('pip')) {
      if (pipDrag) return;
      const p = pipRect(settings.video.pipCorner);
      const css = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px`;
      if (videoLayer.dataset.pos !== css) {
        videoLayer.dataset.pos = css;
        videoLayer.style.cssText = css;
      }
      return;
    }
    if (videoFull) {
      if (videoLayer.dataset.pos !== 'full') {
        videoLayer.dataset.pos = 'full';
        videoLayer.style.cssText = 'left:0;top:0;width:100%;height:100%';
      }
      return;
    }
    const slot = stage.querySelector('.screen.active [data-video-slot]');
    if (!slot) return;
    const r = slot.getBoundingClientRect();
    const s = shell.getBoundingClientRect();
    const css = `left:${Math.round(r.left - s.left)}px;top:${Math.round(r.top - s.top)}px;width:${Math.round(r.width)}px;height:${Math.round(r.height)}px`;
    if (videoLayer.dataset.pos !== css) {
      videoLayer.dataset.pos = css;
      videoLayer.style.cssText = css;
    }
  }
  function updateVideoCover(t) {
    const cover = videoLayer.querySelector('.video-cover');
    if (cover) setHidden(cover, settings.video.driving || !(t.speedKmh > 8));
  }
  // „Verlauf löschen“ und „Cookies löschen“ (Video-Einstellungen): erstes Tippen fragt nach, zweites (binnen 4 s) löscht
  const videoClearArmed = { history: 0, cookies: 0 };
  function videoClear(what) {
    const now = performance.now();
    if (now - videoClearArmed[what] > 4000) {
      videoClearArmed[what] = now;
      rerenderSettings(`[data-action="video-clear-${what}"]`);
      setTimeout(() => {
        if (videoClearArmed[what] && performance.now() - videoClearArmed[what] >= 4000) {
          videoClearArmed[what] = 0;
          if (screen === 'settings') rerenderSettings();
        }
      }, 4100);
      return;
    }
    videoClearArmed[what] = 0;
    if (what === 'history') {
      clearVideoPositions();
      videoStopped = true;
      changeSetting((s) => {
        s.video.items = [];
        s.video.current = -1;
      });
      showToast({ icon: 'video', color: 'red', title: 'Verlauf gelöscht', text: 'Gespeicherte Videos und gemerkte Stellen sind entfernt.' });
    } else {
      api?.webClear?.(settings.video.items.filter((v) => v.kind === 'web').map((v) => v.id)).then((ok) => {
        rerenderSettings();
        if (ok) showToast({ icon: 'video', color: 'red', title: 'Cookies gelöscht', text: 'Anmeldungen und gespeicherte Antworten der Video-Seiten sind entfernt.' });
      });
    }
  }

  // Anruf (klingelt oder läuft): Video anhalten, nach dem Auflegen weiter – nur wenn es die App selbst angehalten hat
  let videoCallPaused = false;
  function videoForCall(on) {
    if (on) {
      if (settings.video.pauseOnCall && videoKey && !videoPaused && !videoCallPaused) {
        videoCallPaused = true;
        videoToggle();
      }
    } else if (videoCallPaused) {
      videoCallPaused = false;
      if (videoKey && videoPaused) videoToggle();
    }
  }
  // Pause/Weiter: direkt am Video im Player (YouTube und Twitch); ohne App über die YouTube-Schnittstelle
  function videoToggle() {
    const v = currentVideo();
    const frameEl = videoLayer.querySelector('iframe');
    if (!v) return;
    if (!frameEl) {
      videoStopped = false;
      return syncVideo();
    }
    if (api?.videoControl) {
      api.videoControl('toggle').then((st) => {
        if (st) return showVideoState(st);
        // andere Webseite ohne Video-Element (Player startet erst auf Klick): in die Mitte des Players klicken
        if (v.kind === 'web' && api.videoTap) return api.videoTap(0.5, 0.5);
        // Player noch nicht bereit: Twitch wie bisher anhalten, YouTube über seine Schnittstelle
        if (v.kind.startsWith('tw')) {
          videoStopped = true;
          syncVideo();
        } else ytCommand(videoPaused ? 'playVideo' : 'pauseVideo');
      });
      return;
    }
    if (v.kind.startsWith('tw')) {
      videoStopped = true;
      return syncVideo();
    }
    videoPaused = !videoPaused;
    ytCommand(videoPaused ? 'pauseVideo' : 'playVideo');
    const btn = videoLayer.querySelector('[data-action="video-toggle"]');
    if (btn) btn.innerHTML = videoPaused ? ICONS.play : ICONS.pause;
  }

  // ------------------------------------------------------------------ Blitzer (wie Blitzer.de)
  let radarPushed = null; // für diesen Blitzer schon eine Mitteilung gezeigt
  const HAZARD = {
    c: { icon: 'camera', color: 'red', name: 'Blitzer', warn: 700, tone: 'camera' },
    w: { icon: 'scale', color: 'orange', name: 'Waage / Kontrolle', warn: 1500, tone: 'info' },
    m: { icon: 'toll', color: 'yellow', name: 'Mautstelle', warn: 1000, tone: 'info' },
  };
  const TONES = {
    camera: [[0, 1318, 0.12], [0.17, 1318, 0.12], [0.34, 1760, 0.26]],
    info: [[0, 880, 0.16], [0.2, 660, 0.26]],
    speed: [[0, 988, 0.09], [0.13, 988, 0.09]],
    border: [[0, 660, 0.14], [0.17, 880, 0.14], [0.34, 1100, 0.22]],
    listen: [[0, 784, 0.1], [0.11, 1175, 0.16]],
  };
  let audioCtx = null;
  function beep(name) {
    if (!canSpeak || !poweredOn || (name !== 'listen' && !settings.radarSound)) return;
    const volume = (name === 'listen' ? settings.volumeSiri : settings.volumeAlerts) / 100;
    if (volume <= 0) return;
    try {
      audioCtx = audioCtx || new AudioContext();
      const t0 = audioCtx.currentTime + 0.02;
      for (const [at, freq, dur] of TONES[name]) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.5 * volume), t0 + at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0 + at);
        osc.stop(t0 + at + dur + 0.03);
      }
    } catch {
      // kein Audio verfügbar
    }
  }

  const radar = { near: [], alert: null, alerted: new Map(), over: false, lastSpeedBeep: 0, lastCamBeep: 0, country: null, candidate: null, since: 0 };
  function radarTypes() {
    const t = [];
    if (settings.radar && !isAts()) t.push('c'); // ATS hat keine Blitzer
    if (settings.radarWeigh) t.push('w');
    if (settings.radarToll) t.push('m');
    return t;
  }
  // Eigene Blitzer auf die Karte und in die Suche
  // nur die Blitzer des laufenden Spiels (Einträge ohne game stammen aus ETS2)
  const gameCameras = () => settings.cameras.filter((c) => (c.game || 'ets2') === currentGame.id);
  function syncCameras() {
    CarMap.setExtraPois(gameCameras().map((c) => ['c', c.x, c.z, c.src === 'fine' ? 'Blitzer (hat dich erwischt)' : 'Blitzer (gemeldet)', c.src]));
  }

  function updateRadar(t) {
    const p = pose.current();
    if (!p || !CarMap.hasPlaces() || !t || !t.available) return;
    const now = performance.now();
    const heading = (p.h / 360) * Math.PI * 2;
    const types = radarTypes();
    // „Betrifft mich“ nur, was auf dem Weg liegt: mit Navi-Route direkt an der Route voraus (Entfernung entlang
    // der Route), ohne Route fast genau auf der Fahrlinie – nicht alles, was irgendwo vorne in der Gegend steht.
    const LATERAL = { c: 18, m: 40, w: 70 };
    const routed = CarMap.routeActive();
    radar.near = CarMap.poisNear(types, p.x, p.z, 15000).map(([type, x, y, label, src]) => {
      const rel = Math.atan2(x - p.x, -(y - p.z)) + heading;
      const r = Math.atan2(Math.sin(rel), Math.cos(rel));
      const dist = Math.hypot(x - p.x, y - p.z);
      let along = null;
      if (routed) along = CarMap.routeAhead(x, y, LATERAL[type]);
      else if (Math.cos(r) > 0 && dist * Math.abs(Math.sin(r)) < LATERAL[type]) along = dist * Math.cos(r);
      return { id: `${type}|${x}|${y}`, type, x, y, label, src, dist: along ?? dist, rel: r, ahead: along !== null };
    }).sort((a, b) => (a.ahead !== b.ahead ? (a.ahead ? -1 : 1) : a.dist - b.dist));

    // Warnung: nächste Gefahr auf dem Weg im Warnbereich; eine laufende Warnung bleibt bis zum Vorbeifahren
    let ahead = radar.near.find((h) => h.ahead && h.dist < HAZARD[h.type].warn);
    if (!ahead && radar.alert) {
      const still = radar.near.find((h) => h.id === radar.alert.id);
      if (still && Math.cos(still.rel) > 0.2 && still.dist < HAZARD[still.type].warn + 150) ahead = still;
    }
    if (ahead && t.speedKmh > 5) {
      if (!radar.alerted.has(ahead.id)) {
        radar.alerted.set(ahead.id, now);
        beep(HAZARD[ahead.type].tone);
        if (ahead.type === 'c') surfaceWidget('radar');
      }
      radar.alert = ahead;
    } else radar.alert = null;
    for (const [id, at] of radar.alerted) if (now - at > 120000) radar.alerted.delete(id); // nach 2 Min. wieder warnen

    // Tempo-Warnung
    const limit = Math.round(t.speedLimitKmh);
    const tol = settings.radarTolerance;
    radar.over = tol >= 0 && limit > 0 && t.speedKmh > limit + spdDeltaKmh(tol);
    if (radar.over && radar.alert && radar.alert.type === 'c' && now - radar.lastCamBeep > 2500) {
      radar.lastCamBeep = now;
      beep('camera'); // zu schnell am Blitzer: dringend
    } else if (radar.over && now - radar.lastSpeedBeep > 8000) {
      radar.lastSpeedBeep = now;
      beep('speed');
    }

    // Grenzübertritt (Land der nächsten Stadt, erst nach 15 s stabil)
    const country = countryHere(p.x, p.z);
    const key = country ? (country.state ? country.name : country.iso || country.name) : null; // ATS: jeder Bundesstaat einzeln
    if (key !== radar.country) {
      if (radar.candidate !== key) {
        radar.candidate = key;
        radar.since = now;
      } else if (now - radar.since > 15000) {
        const first = radar.country === null;
        radar.country = key;
        if (!first && settings.radarBorder && country) {
          const lim = carMode ? [] : country.limits || []; // Auto (Road Trip): Lkw-Limits gelten nicht
          const info = country.state
            ? (lim.length ? `Lkw: Interstate ${limitIn(lim[0], true)}, Landstraße ${limitIn(lim[2], true)}` : 'Staatsgrenze überquert')
            : country.fuel ? (zhUnits() ? `柴油 ${country.fuel.toFixed(2).replace('.', ',')} ${zhT('欧元/升', '歐元/升')}` : `Diesel ${country.fuel.toFixed(2).replace('.', ',')} €/l`) : 'Grenze überquert';
          showToast({ kind: 'Border', icon: 'border', color: 'blue', title: `Willkommen ${countryIn(countryName(country))}`, text: info, open: 'maps' });
          beep('border');
        }
      }
    }
    renderRadar(t);
  }

  function renderRadar(t = telemetry) {
    const a = radar.alert;
    const look = a ? HAZARD[a.type] : null;
    const limit = t ? Math.round(t.speedLimitKmh) : 0;
    const overBy = t && limit > 0 ? Math.round(t.speedKmh - limit) : 0;
    let state;
    if (a) {
      state = `<div class="rs warn rs-${a.type}">${badge(look.icon, look.color)}<div><b>${escape(a.label && a.type !== 'm' ? a.label.replace(/ \(.*\)$/, '') : look.name)}</b><span>in ${meters(a.dist)}</span></div></div>`;
    } else if (radar.over) {
      state = `<div class="rs fast">${badge('truck', 'red')}<div><b>Zu schnell</b><span>${spd(overBy)} ${spdUnit()} über dem Limit</span></div></div>`;
    } else {
      state = `<div class="rs ok"><span class="rs-check"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M5 9.5 12 5l7 4.5v3L12 8 5 12.5zM4 15l8-5 8 5v3.5l-8-5-8 5z"/></svg></span><div><b>Strecke frei</b><span>${isAts() ? (settings.radarWeigh || settings.radarToll ? 'Keine Waage voraus' : 'Warnungen aus') : settings.radar ? 'Keine Blitzer voraus' : 'Warnungen aus'}</span></div></div>`;
    }
    html('radar-state', `${a ? a.id : ''}|${radar.over}|${a ? Math.round(a.dist / 50) : ''}|${overBy}|${settings.radar}`, state);
    text('radar-mini', a ? `${look.name} in ${meters(a.dist)}` : radar.over ? `Zu schnell: +${spd(overBy)} ${spdUnit()}` : 'Strecke frei');
    toggle('radar-mini', 'alert', !!a || radar.over);
    toggle('radar-main', 'alert', !!a);
    toggle('radar-main', 'over', radar.over);

    // Außerhalb der Blitzer-App: einmal je Blitzer, Waage oder Mautstelle als normale Push-Mitteilung
    if (a && screen !== 'radar' && poweredOn && radarPushed !== a.id) {
      radarPushed = a.id;
      showToast({ kind: 'Radar', icon: look.icon, color: look.color, title: look.name, text: `in ${meters(a.dist)}${limit > 0 ? ` · Tempo ${spd(limit)}` : ''}`, open: 'radar' });
    }

    if (screen !== 'radar') return;
    const items = radar.near.filter((h) => h.ahead).slice(0, 12);
    text('radar-count', CarMap.routeActive() ? 'auf der Route' : 'auf dieser Straße');
    list('radar', items.length ? items.map((h) => {
      const lk = HAZARD[h.type];
      const own = h.src === 'user' || h.src === 'fine';
      return `<div class="list-row ${h.ahead ? 'on-route' : ''}">${badge(lk.icon, lk.color)}
        <div class="lr-text"><b>${escape(h.label || lk.name)}</b><small>${meters(h.dist)} ${h.ahead ? 'voraus' : 'entfernt'}</small></div>
        ${own ? `<button class="pill-button small" data-focus data-cam-remove="${h.x}|${h.y}">Entfernen</button>` : `<span class="lr-dir" style="transform:rotate(${((h.rel * 180) / Math.PI).toFixed(0)}deg)">${ICONS['turn-straight']}</span>`}</div>`;
    }).join('') : `<div class="list-empty">${settings.radar ? 'Nichts auf deinem Weg. Mit Navi-Route schaut die App bis 15 km voraus, ohne Route nur geradeaus auf dieser Straße. Blitzer, die dich erwischen, merkt sie sich – und alles, was du meldest.' : 'Warnungen sind aus (Einstellungen › Blitzer).'}</div>`);
  }

  function addCamera(x, z, src) {
    const near = gameCameras().some((c) => Math.hypot(c.x - x, c.z - z) < 120)
      || CarMap.poisNear(['c'], x, z, 120).length > 0;
    if (near) return false;
    changeSetting((s) => s.cameras.push({ x: Math.round(x), z: Math.round(z), src, at: Date.now(), ...(isAts() ? { game: 'ats' } : {}) }));
    return true;
  }
  function reportCamera() {
    const p = pose.current();
    if (!p) return showToast({ icon: 'camera', color: 'gray', title: 'Blitzer melden', text: 'Keine Position vom Spiel' });
    // Gemeldet wird meist kurz nach dem Vorbeifahren – ein Stück zurück liegt der Blitzer
    const heading = (p.h / 360) * Math.PI * 2;
    const back = Math.min(60, (telemetry?.speedKmh || 0) / 3.6 * 2);
    const x = p.x + Math.sin(heading) * back;
    const z = p.z + Math.cos(heading) * back;
    const added = addCamera(x, z, 'user');
    showToast({ icon: 'camera', color: 'red', title: added ? 'Blitzer gemeldet' : 'Schon bekannt', text: added ? 'Du wirst hier künftig gewarnt' : 'An dieser Stelle gibt es schon einen Blitzer', open: 'radar' });
  }
  // Vom Blitzer erwischt: Ort merken (nur der Truck-Bildschirm speichert, sonst doppelt)
  function learnCamera(e) {
    if (e.offence !== 'speeding_camera' || !Number.isFinite(e.x) || !(e.x || e.z)) return;
    if (role !== 'game' && api) return;
    if (addCamera(e.x, e.z, 'fine')) setTimeout(() => showToast({ kind: 'Radar', icon: 'camera', color: 'red', title: 'Blitzer gespeichert', text: 'Hier warnt dich die App ab jetzt', open: 'radar' }), 6500);
  }

  // ------------------------------------------------------------------ Spiegelkamera beim Blinken (Totwinkel)
  // Trucks mit Kameraspiegeln zeichnen die Spiegel in eine kleine Textur; das Plugin schickt beim Blinken die Hälfte der
  // Seite (dx11/mirror_cam.cpp): Haupt- und Weitwinkelspiegel übereinander. Hier als Bild im Bild in 16:9 – nicht
  // verzerrt: ein Spiegel – der Weitwinkel (oder auf Wunsch der Hauptspiegel). Läuft ein Video als Bild
  // im Bild, erscheint die Kamera auf Wunsch an seiner Stelle (mirrorReplace), danach kommt das Video zurück.
  const mirrorLayer = document.getElementById('mirror-layer');
  const mirrorCanvas = mirrorLayer.querySelector('canvas');
  const mirrorTag = mirrorLayer.querySelector('.mirror-tag');
  const mirrorSrc = document.createElement('canvas');
  const mirrorBlur = document.createElement('canvas'); // winziges Zwischenbild: hochskaliert wirkt es unscharf
  mirrorBlur.width = 24;
  mirrorBlur.height = 14;
  let mirrorWant = 0; // angeforderte Seite: 0 aus, 1 links, 2 rechts
  let mirrorSent = 0; // zuletzt ans Plugin geschickte Anforderung (Seite, Layout, Bildrate)
  let mirrorBlinkAt = 0;
  let mirrorFrameAt = 0;
  let mirrorShown = false;
  let mirrorWide = true; // Weitwinkel statt Hauptspiegel (Einstellung)
  // Monitor-Layouts der Spieldateien (ui/dashboard/*_cam_mirrors.sii): ETS2 1.62 Volvo FH 2024, DAF 2021/XD/XF Electric,
  // Iveco S-Way und ATS Volvo VNL 2025, Kenworth T680 2022 haben den Hauptspiegel oben, der Renault T (2024) den
  // Weitwinkel. Der Freightliner Cascadia 2024 (ATS) hat eine hohe Textur (1 : 2): oben der Seitenspiegel und eine leere
  // Fläche, die Kameraspiegel erst ab 34 % der Höhe. Der MAN TGX 2020 hat nur die zwei Hauptspiegel ohne Trennlinien und
  // ohne Weitwinkel: dort sucht das Plugin auf Anforderung (Bit 11) die Kante in der Mitte – ungetestet, kein MAN zur Hand.
  const mirrorTruck = () => String(telemetry?.truckId || '').replace(/^vehicle\./i, '').toLowerCase();
  const mirrorWideOnTop = () => mirrorTruck() === 'renault.t' || mirrorTruck() === 'man.lions_24'; // Bus-DLC: MAN Lion's Coach wie Renault T
  const mirrorNoLines = () => mirrorTruck() === 'man.tgx_2020';
  // Fahrzeuge mit Glasspiegeln (kein *_cam_mirrors-Layout in den Spieldateien), in denen das Plugin trotzdem eine Textur fand,
  // die nach Spiegeln aussah: Scania Touring (Bus-DLC) zeigte ein falsches, fast schwarzes Bild (12.11.2026) – dort keine Blinker-Kamera
  const NO_CAM_MIRRORS = new Set(['scania.touring_23']);
  // Busse mit Kameraspiegeln: die Spiegelansicht ist 512 × 1024 (doppelt so hoch wie breit, im Spiel gespeichert 12.11.2026).
  // Ohne diesen Hinweis gewann das Navi-Bild des Spiels (1024 × 1024, ebenfalls als Paar mit passender Linie) – im Bild
  // erschien die Karte. Bit 22: nur Texturen in diesem Format
  const MIRROR_TALL = new Set(['volvo.9700_23', 'man.lions_24']);
  // Farbige statt schwarze Trennlinie laut *_cam_mirrors.sii (Bit 23-24): MAN Lion's Coach grau FF777777 (vorher „0 with a
  // line“, keine Kamera, Spieltest 15.11.2026), Iveco S-Way FF664433. Alle anderen: schwarz bzw. Bus 9700 dunkelgrau
  const MIRROR_LINE_COLOR = { 'man.lions_24': 1, 'iveco.sway': 2 };
  // Oberkante der Trennlinie in Promille der Höhe, aus divide_lines derselben Dateien (Volvo: 468 von 666 = Zeile 360 von 512).
  // So muss das Plugin die Linie nicht suchen und erkennt Texturen und Bildlage sicher, auch nachts. Andere Trucks (Mods): 0.
  const MIRROR_LINE = { 'volvo.fh_2024': 703, 'volvo.vnl2025': 703, 'daf.2021': 669, 'daf.xd': 669, 'daf.xf_electric': 669, 'iveco.sway': 696, 'renault.t': 288, 'kenworth.t680_2022': 660, 'freightliner.cascadia2024': 778, 'volvo.9700_23': 664, 'man.lions_24': 243 }; // Busse: volvo_9700_23/man_lions_24_cam_mirrors.sii (453 bzw. 166 von 682)
  // Spiel-Fahrzeuge mit Kameraspiegeln (Layout ui/dashboard/*_cam_mirrors.sii in den Spieldateien, ETS2/ATS 1.62). Andere
  // Fahrzeuge der Spiel-Marken haben Glasspiegel – dort fand das Plugin eine fremde Textur (Scania S: Bild mit Karte, 15.11.),
  // also keine Blinker-Kamera. Mods mit eigener Marke bleiben erlaubt
  const CAM_MIRRORS = new Set([...Object.keys(MIRROR_LINE), 'man.tgx_2020']);
  const STOCK_BRAND = /^(scania|mercedes|renault|man|volvo|daf|iveco|kenworth|peterbilt|freightliner|international|intnational|mack|westernstar|western_star|ford)\./;
  // ohne Kameraspiegel laut Spieldaten – außer der Nutzer hat für diesen Lkw „Kameraspiegel per Mod“ eingeschaltet
  const stockNoCamMirrors = () => NO_CAM_MIRRORS.has(mirrorTruck()) || (STOCK_BRAND.test(mirrorTruck()) && !CAM_MIRRORS.has(mirrorTruck()));
  const modCamMirrors = () => !!mirrorTruck() && (settings.mirrorCamTrucks || []).includes(mirrorTruck());
  const noCamMirrors = () => stockNoCamMirrors() && !modCamMirrors();
  const mirrorMainTop = () => (mirrorTruck() === 'freightliner.cascadia2024' ? 0.34 : 0); // Anteil der Höhe über den Spiegeln

  function hideMirror() {
    mirrorShown = false;
    setHidden(mirrorLayer, true);
    videoLayer.classList.remove('replaced');
  }

  // Blinkerhebel (nicht Warnblinker): Seite anfordern; nach dem Blinken noch 1,5 s stehen lassen (Spurwechsel zu Ende)
  function updateMirror(t) {
    if (role !== 'game' && !demoMode) return;
    const blink = settings.mirrorCam && poweredOn && t && !t.hazard && !noCamMirrors() ? (t.blinkerLeft ? 1 : t.blinkerRight ? 2 : 0) : 0;
    const now = performance.now();
    if (blink) mirrorBlinkAt = now;
    const side = blink || (mirrorWant && now - mirrorBlinkAt < 1500 ? mirrorWant : 0);
    // Weitwinkel (Bereich neben dem Führerhaus), außer der Hauptspiegel ist gewählt; Trucks ohne Weitwinkel (MAN TGX)
    // zeigen in drawMirror ohnehin den Hauptspiegel
    mirrorWide = settings.mirrorView !== 'main';
    if (side !== mirrorWant) {
      mirrorWant = side;
      hideMirror(); // aus oder andere Seite: das Bild der neuen Seite erscheint mit dem ersten passenden Bild
    }
    // Bit 8: Weitwinkel oben (Layout), Bit 9-10: Bildrate 20/30/60, Bit 12-21: Lage der Trennlinie, Bit 22: hohe Spiegelansicht (Bus) – auch eine geänderte Einstellung gleich weitergeben
    const request = side ? side | (mirrorWideOnTop() ? 256 : 0) | ({ 30: 1, 60: 2 }[settings.mirrorFps] || 0) << 9 | (mirrorNoLines() ? 2048 : 0) | (MIRROR_LINE[mirrorTruck()] || 0) << 12 | (MIRROR_TALL.has(mirrorTruck()) ? 1 << 22 : 0) | (MIRROR_LINE_COLOR[mirrorTruck()] || 0) << 23 : 0;
    if (request !== mirrorSent) {
      mirrorSent = request;
      api?.mirrorRequest?.(request);
    }
    if (mirrorShown && now - mirrorFrameAt > 1000) hideMirror(); // keine Bilder mehr (Außenansicht, Truck ohne Kameraspiegel)
    if (side && params.has('mirrortest')) demoMirrorFrame(side); // Test ohne Spiel
  }

  // Ecke: Seite des Blinkers unten; mit Video als Bild im Bild und „ersetzen“ an dessen Stelle, sonst daneben
  function mirrorCorner(side) {
    const s = side === 1 ? 'l' : 'r';
    const video = videoLayer.classList.contains('pip') && !videoLayer.hidden;
    if (video && settings.mirrorReplace) return settings.video.pipCorner;
    const c = `b${s}`;
    return video && c === settings.video.pipCorner ? `t${s}` : c;
  }

  function drawMirror(m) {
    if (!mirrorWant || !poweredOn || !m || (m.side & 3) !== mirrorWant) return;
    const { width, height, split } = m;
    const data = m.data instanceof Uint8Array || m.data instanceof Uint8ClampedArray ? m.data : new Uint8Array(m.data || []);
    const noLines = split === 0; // MAN TGX: nur Hauptspiegel über die volle Höhe
    if (data.length !== width * height * 4 || (!noLines && (split < 8 || split > height - 8))) return;
    if (mirrorSrc.width !== width || mirrorSrc.height !== height) {
      mirrorSrc.width = width;
      mirrorSrc.height = height;
    }
    mirrorSrc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width, height), 0, 0);
    // Lage und Größe wie das Video-Bild-im-Bild
    const side = m.side & 3;
    const leftHalf = !!(m.side & 16); // linke Hälfte der Spiegeltextur: Trennlinie am rechten Rand
    const corner = mirrorCorner(side);
    const p = pipRect(corner);
    const css = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px`;
    if (mirrorLayer.dataset.pos !== css) {
      mirrorLayer.dataset.pos = css;
      mirrorLayer.style.cssText = css;
    }
    if (mirrorCanvas.width !== p.w || mirrorCanvas.height !== p.h) {
      mirrorCanvas.width = p.w;
      mirrorCanvas.height = p.h;
    }
    const g = mirrorCanvas.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, p.w, p.h);
    // ein Spiegel, ohne die schwarzen Trennlinien (innen an der Mitte der Textur und an der waagerechten Linie)
    const left = side === 1;
    const cx = leftHalf ? 0 : 4;
    const cw = width - 4;
    const y0 = noLines ? 0 : Math.min(split - 16, Math.round(height * mirrorMainTop()));
    const top = noLines ? { x: cx, y: 0, w: cw, h: height } : { x: cx, y: y0, w: cw, h: split - 2 - y0 };
    const bottom = { x: cx, y: split + 3, w: cw, h: height - split - 3 };
    const [main, wide] = mirrorWideOnTop() ? [bottom, top] : [top, bottom];
    if (mirrorWide && !noLines && wide.h > 8) {
      // Weitwinkel: fast schon 16:9 (Volvo 256 × 150) – auf 16:9 zuschneiden, ohne zu verzerren
      const scale = Math.max(p.w / wide.w, p.h / wide.h);
      const sw = p.w / scale;
      const sh = p.h / scale;
      g.drawImage(mirrorSrc, wide.x + (wide.w - sw) / 2, wide.y + (wide.h - sh) / 2, sw, sh, 0, 0, p.w, p.h);
    } else {
      // Hauptspiegel (hochkant): mittig, mindestens 60 % seiner Höhe (um die Fahrbahn, etwas unter der Mitte), die Ränder
      // mit einer unscharfen, abgedunkelten Kopie gefüllt – wie ein Hochkant-Video
      const scale = Math.min(p.w / main.w, p.h / (main.h * 0.6));
      const sh = Math.min(main.h, p.h / scale);
      const sy = main.y + Math.min(main.h - sh, Math.max(0, main.h * 0.55 - sh / 2));
      const dw = Math.min(p.w, main.w * scale);
      const dh = sh * scale;
      if (dw < p.w - 2) {
        const bs = p.w / main.w;
        const bh = Math.min(sh, p.h / bs);
        const b = mirrorBlur.getContext('2d');
        b.drawImage(mirrorSrc, main.x, sy + (sh - bh) / 2, main.w, bh, 0, 0, mirrorBlur.width, mirrorBlur.height);
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(mirrorBlur, 0, 0, mirrorBlur.width, mirrorBlur.height, -20, -20, p.w + 40, p.h + 40);
        g.fillStyle = 'rgba(0, 0, 0, 0.45)';
        g.fillRect(0, 0, p.w, p.h);
      }
      g.drawImage(mirrorSrc, main.x, sy, main.w, sh, (p.w - dw) / 2, (p.h - dh) / 2, dw, dh);
    }
    // Seite: grüner Blinkerpfeil wie die Kontrollleuchte im Cockpit, außen oben (ohne Text: in jeder Sprache gleich)
    if (!mirrorTag.firstChild) mirrorTag.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2 12 11 4v5h11v6H11v5z"/></svg>';
    mirrorLayer.dataset.side = left ? 'l' : 'r';
    mirrorLayer.classList.toggle('arrow', settings.mirrorArrow);
    mirrorFrameAt = performance.now();
    // Einstellung „Spiegelkamera zeigen“: Navi, Kombiinstrument oder beides. Ohne aktives Kombiinstrument immer im Navi.
    const toCluster = clusterActive && settings.mirrorTarget !== 'gps' && !!api?.clusterMirror;
    const onGps = !toCluster || settings.mirrorTarget === 'both';
    if (toCluster) sendMirrorToCluster(side);
    if (!onGps) {
      if (!mirrorLayer.hidden) setHidden(mirrorLayer, true);
      mirrorShown = true; // fürs Ausblenden nach dem Blinken (hideMirror)
      return;
    }
    if (!mirrorShown || mirrorLayer.hidden) {
      mirrorShown = true;
      setHidden(mirrorLayer, false);
    }
    videoLayer.classList.toggle('replaced', settings.mirrorReplace && corner === settings.video.pipCorner && videoLayer.classList.contains('pip'));
  }
  api?.onMirror?.(drawMirror);

  // Blinker-Kamera im Kombiinstrument: das zusammengesetzte Bild (ein Spiegel, 16 : 9) als JPEG, höchstens 20 Bilder/s
  let mirrorSendBusy = false;
  let mirrorSentAt = 0;
  let mirrorSmall = null;
  function sendMirrorToCluster(side) {
    const now = performance.now();
    if (mirrorSendBusy || now - mirrorSentAt < 30) return;
    mirrorSentAt = now;
    mirrorSendBusy = true;
    // zuschneiden wie der Kasten im Instrument (420 × 300) – kleines JPEG, schnell kodiert und dekodiert
    if (!mirrorSmall) {
      mirrorSmall = document.createElement('canvas');
      mirrorSmall.width = 420;
      mirrorSmall.height = 300;
    }
    const sw0 = mirrorCanvas.width, sh0 = mirrorCanvas.height;
    const scale = Math.max(420 / sw0, 300 / sh0);
    const sw = 420 / scale, sh = 300 / scale;
    mirrorSmall.getContext('2d').drawImage(mirrorCanvas, (sw0 - sw) / 2, (sh0 - sh) / 2, sw, sh, 0, 0, 420, 300);
    mirrorSmall.toBlob((blob) => {
      if (!blob) return void (mirrorSendBusy = false);
      blob.arrayBuffer().then((buffer) => api.clusterMirror({ side, buffer })).catch(() => {}).finally(() => (mirrorSendBusy = false));
    }, 'image/jpeg', 0.8);
  }

  // Test ohne Spiel (?mirrortest): Himmel, Straße und die Seite des eigenen Lkw als Ersatzbild
  let demoMirrorAt = 0;
  function demoMirrorFrame(side) {
    const now = performance.now();
    if (now - demoMirrorAt < 100) return;
    demoMirrorAt = now;
    const w = 256;
    const h = 512;
    const split = 360;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const scene = (y0, y1) => {
      const sky = g.createLinearGradient(0, y0, 0, y1);
      sky.addColorStop(0, '#7fb6e8');
      sky.addColorStop(0.45, '#cfe3f4');
      sky.addColorStop(0.46, '#6d7378');
      sky.addColorStop(1, '#4b5054');
      g.fillStyle = sky;
      g.fillRect(0, y0, w, y1 - y0);
      g.fillStyle = '#f2f2f2';
      g.fillRect(side === 1 ? w - 50 : 0, y0, 46, y1 - y0); // Seite des eigenen Lkw innen
      g.fillStyle = '#fff';
      for (let k = 0; k < 4; k++) g.fillRect(w / 2 - 3, y0 + (y1 - y0) * (0.55 + k * 0.1), 6, 14);
    };
    scene(0, split - 1);
    scene(split + 3, h);
    g.fillStyle = '#000';
    g.fillRect(0, split - 1, w, 4);
    g.fillRect(side === 1 ? w - 4 : 0, 0, 4, h);
    drawMirror({ width: w, height: h, side: side | (side === 1 ? 16 : 0), split, data: g.getImageData(0, 0, w, h).data });
  }
  // ------------------------------------------------------------------ Spotify-Mediathek
  let libLoadedAt = 0;
  function loadLibrary(force = false) {
    if (!api || !api.spotifyLibrary || !settings.spotify) return renderLibrary();
    if (!force && spotifyLib && performance.now() - libLoadedAt < 60000) return renderLibrary();
    libLoadedAt = performance.now();
    renderLibrary();
    api.spotifyLibrary(force).then((data) => {
      spotifyLib = data;
      renderLibrary();
    }, () => renderLibrary());
  }
  // Wie die Mediathek in CarPlay: Playlist antippen öffnet die Titelliste mit „Abspielen“ und „Zufall“
  let libDetail = null; // { uri, name, image, liked, tracks, error, loading }
  function openPlaylist(uri) {
    const p = spotifyLib?.playlists.find((x) => x.uri === uri);
    if (!p) return;
    libDetail = { uri, name: p.name, image: p.image, liked: p.liked, owner: p.owner, tracks: null, loading: true };
    renderLibrary();
    api.spotifyTracks(uri).then((r) => {
      if (!libDetail || libDetail.uri !== uri) return;
      libDetail.loading = false;
      libDetail.tracks = r?.ok ? r.tracks : [];
      libDetail.error = r?.ok ? '' : r?.error || '';
      renderLibrary();
    });
  }

  function renderLibrary() {
    const empty = (msg) => `<div class="list-empty lib-empty">${APP_ICONS.brands?.music ? `<div class="icon art-icon">${APP_ICONS.brands.music}</div>` : ''}<p>${msg}</p></div>`;
    const cover = (image, liked, cls = '') => `<span class="lib-cover ${liked ? 'liked' : ''} ${cls}" ${image ? `style="background-image:url('${escape(image)}')"` : ''}>${liked ? ICONS.heart : image ? '' : ICONS.music}</span>`;
    const trackRow = (t, attrs) => `<button class="list-row" data-focus ${attrs}>
        <span class="lr-art" ${t.image ? `style="background-image:url('${escape(t.image)}')"` : ''}></span>
        <div class="lr-text"><b>${escape(t.name)}</b><small>${escape(t.artist)}</small></div>
        ${t.ms ? `<span class="lr-right muted">${mmss(t.ms)}</span>` : `<span class="lr-play">${ICONS.play}</span>`}</button>`;
    const section = stage.querySelector('[data-screen="music"]');
    if (section) section.classList.toggle('lib-detail-open', !!libDetail);
    let markup;
    if (!api) markup = empty('Nur mit laufender App verfügbar.');
    else if (!spotifyStatus?.connected) markup = empty('Spotify ist nicht verbunden.<br>Im Editor: Einstellungen › Musik › Spotify-Mediathek → Client-ID eintragen und verbinden.');
    else if (!spotifyLib) markup = empty('Mediathek wird geladen …');
    else if (libDetail) {
      const d = libDetail;
      const rows = d.loading ? '<div class="list-empty">Titel werden geladen …</div>'
        : d.tracks && d.tracks.length ? d.tracks.map((t) => trackRow(t, `data-sp-track="${escape(t.uri)}"`)).join('')
          : `<div class="list-empty">${escape(d.error || 'Keine Titel')}</div>`;
      markup = `<div class="lib-detail">
          <div class="lib-hero">
            ${cover(d.image, d.liked, 'big')}
            <div class="lib-hero-text">
              <button class="lib-back" data-focus data-sp-back>${ICONS.back}<span>Mediathek</span></button>
              <b>${escape(d.name)}</b><small>${escape(d.owner || '')}${d.tracks && d.tracks.length ? ` · ${d.tracks.length} Titel` : ''}</small>
              <div class="lib-actions">
                <button class="lib-btn play" data-focus data-sp-play="${escape(d.uri)}">${ICONS.play}<span>Abspielen</span></button>
                <button class="lib-btn" data-focus data-sp-shuffle="${escape(d.uri)}">${ICONS.shuffle}<span>Zufall</span></button>
              </div>
            </div>
          </div>
          <div class="list-rows">${rows}</div>
        </div>`;
    } else if (libTab === 'start') {
      const pl = spotifyLib.playlists;
      const tile = (p) => `<button class="lib-tile" data-focus data-sp-open="${escape(p.uri)}">${cover(p.image, p.liked)}<b>${escape(p.name)}</b></button>`;
      const card = (image, name, sub, attrs, liked = false) => `<button class="sp-card" data-focus ${attrs}>${cover(image, liked)}<b>${escape(name)}</b><small>${escape(sub)}</small></button>`;
      markup = `<div class="lib-grid">${pl.slice(0, 6).map(tile).join('')}</div>
        ${spotifyLib.recent.length ? `<button class="sp-head" data-focus data-lib-tab="recent">Zuletzt gehört<span>${ICONS['chevron-right']}</span></button>
          <div class="sp-row">${spotifyLib.recent.slice(0, 12).map((r) => card(r.image, r.name, r.artist, `data-sp-play="${escape(r.uri)}"`)).join('')}</div>` : ''}
        ${pl.length > 6 ? `<button class="sp-head" data-focus data-lib-tab="playlists">Deine Playlists<span>${ICONS['chevron-right']}</span></button>
          <div class="sp-row">${pl.slice(6, 18).map((p) => card(p.image, p.name, p.owner, `data-sp-open="${escape(p.uri)}"`, p.liked)).join('')}</div>` : ''}`;
    } else if (libTab === 'search' && role !== 'editor') {
      markup = empty('Suchen geht im Editor-Fenster (mit Tastatur).<br>Hier: Start, Zuletzt und Bibliothek.');
    } else if (libTab === 'search') {
      const r = spotifySearch;
      const results = !r ? '' : !r.ok ? `<div class="list-empty">${escape(r.error)}</div>`
        : `<div class="list-rows">${r.tracks.map((t) => trackRow(t, `data-sp-play="${escape(t.uri)}"`)).join('')}</div>
           ${r.playlists.length ? `<p class="lib-section">Playlists</p><div class="lib-grid">${r.playlists.map((p) => `<button class="lib-tile" data-focus data-sp-play="${escape(p.uri)}">${cover(p.image, false)}<b>${escape(p.name)}</b><small>${escape(p.owner)}</small></button>`).join('')}</div>` : ''}`;
      markup = `<div class="lib-search"><input class="row-input" data-input="sp-search" placeholder="Titel, Künstler oder Playlist" value="${escape(spotifyQuery)}" spellcheck="false"><button class="lib-btn play" data-focus data-action="sp-search">${ICONS.search}<span>Suchen</span></button></div>${results}`;
    } else if (libTab === 'playlists') {
      markup = `<div class="lib-grid">${spotifyLib.playlists.map((p) => `<button class="lib-tile" data-focus data-sp-open="${escape(p.uri)}">
          ${cover(p.image, p.liked)}<b>${escape(p.name)}</b><small>${escape(p.owner)}</small></button>`).join('')}</div>`;
    } else {
      markup = spotifyLib.recent.length ? `<div class="list-rows">${spotifyLib.recent.map((r) => trackRow({ ...r, ms: 0 }, `data-sp-play="${escape(r.uri)}"`)).join('')}</div>`
        : empty('Noch nichts gehört.');
    }
    list('spotify-lib', markup);
  }

  // Warteschlange (Now Playing › „Warteschlange“)
  function loadQueue() {
    const render = (markup) => list('sp-queue', markup);
    if (!api?.spotifyQueue || !spotifyStatus?.connected) return render('<div class="list-empty">Spotify ist nicht verbunden.</div>');
    render('<div class="list-empty">Wird geladen …</div>');
    api.spotifyQueue().then((q) => {
      if (!q?.ok) return render(`<div class="list-empty">${escape(q?.error || 'Nicht verfügbar')}</div>`);
      if (!q.tracks.length) return render('<div class="list-empty">Die Warteschlange ist leer.</div>');
      render(q.tracks.map((t) => `<button class="list-row" data-focus data-sp-play="${escape(t.uri)}">
        <span class="lr-art" ${t.image ? `style="background-image:url('${escape(t.image)}')"` : ''}></span>
        <div class="lr-text"><b>${escape(t.name)}</b><small>${escape(t.artist)}</small></div>
        ${t.ms ? `<span class="lr-right">${mmss(t.ms)}</span>` : ''}</button>`).join(''));
    });
  }

  let spotifySearch = null;
  let spotifyQuery = '';
  function runSpotifySearch() {
    const input = stage.querySelector('[data-input="sp-search"]');
    spotifyQuery = input ? input.value : '';
    api.spotifySearch(spotifyQuery).then((r) => {
      spotifySearch = r;
      renderLibrary();
    });
  }

  // Zustand des Spotify-Players für die Knöpfe in Now Playing (alle 5 s und bei Titelwechsel)
  let spState = null;
  let spStateAt = 0;
  let spStateTitle = '';
  function refreshSpotifyState(force = false) {
    if (!api?.spotifyState || !settings.spotify || !spotifyStatus?.connected) return;
    const now = performance.now();
    const title = media?.title || '';
    if (!force && now - spStateAt < 5000 && title === spStateTitle) return;
    spStateAt = now;
    spStateTitle = title;
    api.spotifyState().then((st) => {
      spState = st && st.ok && st.active ? st : null;
      toggle('sp-shuffle', 'on', !!spState?.shuffle);
      toggle('sp-repeat', 'on', !!spState && spState.repeat !== 'off');
      toggle('sp-like', 'on', !!spState?.liked);
      html('sp-like', String(!!spState?.liked), spState?.liked ? ICONS['check-circle'] : ICONS['add-circle']);
      html('sp-repeat', spState?.repeat || 'off', spState?.repeat === 'track' ? ICONS['repeat-one'] : ICONS.repeat);
    });
  }
  function spotifyCommand(cmd) {
    if (!api || !spotifyStatus?.connected) return showToast({ icon: 'music', color: 'gray', title: 'Spotify', text: 'Nicht verbunden (Einstellungen › Musik)' });
    if (!spState) return showToast({ icon: 'music', color: 'gray', title: 'Spotify', text: 'Gerade läuft nichts in Spotify' });
    let job;
    if (cmd === 'shuffle') job = api.spotifyShuffle(!spState.shuffle);
    else if (cmd === 'repeat') job = api.spotifyRepeat({ off: 'context', context: 'track', track: 'off' }[spState.repeat] || 'off');
    else if (cmd === 'like') job = api.spotifyLike(spState.uri, !spState.liked).then((r) => {
      if (r.ok) showToast({ icon: 'heart', color: 'green', title: spState.liked ? 'Aus Lieblingssongs entfernt' : 'Zu Lieblingssongs hinzugefügt', song: true, text: media?.title || '' });
      return r;
    });
    job?.then((r) => {
      if (r && !r.ok) showToast({ icon: 'music', color: 'red', title: 'Spotify', text: r.error });
      setTimeout(() => refreshSpotifyState(true), 400);
    });
  }

  let spotifyBusy = false;
  function playSpotify(uri, options = {}) {
    if (!api?.spotifyPlay || spotifyBusy) return;
    spotifyBusy = true;
    showToast({ icon: 'music', color: 'green', title: 'Spotify', text: 'Wird gestartet …' });
    api.spotifyPlay(uri, options).then((r) => {
      spotifyBusy = false;
      if (r && r.ok) {
        toastEl.hidden = true;
        libDetail = null;
        musicTab = 'now';
        const section = stage.querySelector('[data-screen="music"]');
        if (section) section.dataset.tab = musicTab;
        renderLibrary();
      } else showToast({ icon: 'music', color: 'red', title: 'Spotify', text: r?.error || 'Abspielen nicht möglich' });
    }, () => (spotifyBusy = false));
  }

  // ------------------------------------------------------------------ Sprachbefehle (wie Siri)
  // Home-Knopf lange drücken oder Tastenkürzel: die deutsche Windows-Spracherkennung hört auf feste Befehle
  // (tools/listen.ps1). Nur der Truck-Bildschirm hört zu – sonst liefe es doppelt.
  const voiceEl = document.getElementById('voice');
  const glowEl = document.getElementById('ai-glow');
  let voiceBusy = false;
  let voiceHideTimer = 0;
  const VOICE_NAMES = {
    maps: 'Karte', music: 'Musik', pause: 'Pause', play: 'Abspielen', next: 'Nächster Titel', previous: 'Vorheriger Titel',
    weather: 'Wetter', traffic: 'Wie weit noch?', gas: 'Nächste Tankstelle', rest: 'Rastplatz', service: 'Fahrzeugzustand',
    dispatcher: 'Disponent anrufen', report: 'Blitzer melden', radar: 'Blitzer', phone: 'Telefon', video: 'Video',
    dashboard: 'Dashboard', home: 'Home', settings: 'Einstellungen', job: 'Auftrag', calendar: 'Kalender', dark: 'Nachtmodus', light: 'Tagmodus', cancel: 'Abbrechen',
    fuel: 'Tankinhalt', time: 'Wie spät?', deadline: 'Auftrag', repeat: 'Wiederholen',
    'call-traffic': 'Verkehrsfunk', 'call-weather': 'Wetterdienst', 'call-service': 'Pannenhilfe', 'call-rest': 'Rasthof-Info',
  };
  let lastAnswer = null; // für „Wiederholen“
  function voiceShow(title, text, state) {
    clearTimeout(voiceHideTimer);
    toastEl.hidden = true; // Sprachbefehl hat Vorrang vor Mitteilungen
    cancelLeave(voiceEl);
    voiceEl.hidden = false;
    glowEl.hidden = false;
    glowEl.dataset.state = state;
    voiceEl.dataset.state = state;
    voiceEl.querySelector('b').textContent = title;
    voiceEl.querySelector('small').textContent = text || '';
  }
  function voiceHide(delay = 0) {
    clearTimeout(voiceHideTimer);
    voiceHideTimer = setTimeout(() => {
      hideAnimated(voiceEl); // gleitet nach unten hinaus
      glowEl.hidden = true;
    }, delay);
  }
  // lang: freie Antwort des AI-Sprachmodells in dieser Sprache (sonst deutscher Text, übersetzt in die Sprache der Ansagen)
  function voiceAnswer(title, text, lang = null) {
    lastAnswer = { title, text, lang };
    voiceShow(title, text, 'answer');
    speak(text, () => voiceHide(800), { lang });
    if (!canSpeak || !settings.voice) voiceHide(5000);
  }
  function startVoice() {
    if (!api?.listen) return showToast({ icon: 'message', color: 'gray', title: 'Sprachbefehle', text: 'Nur mit laufender App verfügbar' });
    if (role !== 'game' && !demoMode) return; // der Truck-Bildschirm hört zu
    if (voiceBusy) {
      recordStop?.(); // Antippen während der Aufnahme: fertig gesprochen
      return;
    }
    if (aiReady()) return startAiVoice(); // KI-Sprachassistent geladen: frei sprechen
    voiceBusy = true;
    stopSpeaking();
    beep('listen');
    // Polnisch/Türkisch: Windows hat dafür keine Spracherkennung – die festen Befehle laufen auf Englisch
    const fixedEnglish = !['de', 'en'].includes(aiLang());
    voiceShow('Ich höre zu …', fixedEnglish ? 'Feste Befehle nur auf Englisch, z. B. „Nearest fuel station“ – frei sprechen mit dem AI-Sprachassistenten' : 'z. B. „Nächste Tankstelle“, „Wie weit noch?“, „Musik pausieren“', 'listening');
    api.listen(fixedEnglish ? 'en' : aiLang()).then((r) => {
      voiceBusy = false;
      if (r.error) return voiceAnswer('Sprachbefehle', `Das geht gerade nicht: ${r.error}. Prüfe Mikrofon und Datenschutz-Einstellungen von Windows.`);
      if (!r.cmd || r.confidence < 0.3) return voiceAnswer('Nicht verstanden', 'Das habe ich leider nicht verstanden.');
      runVoiceCommand(r.cmd);
    }, () => {
      voiceBusy = false;
      voiceHide();
    });
  }
  function runVoiceCommand(cmd) {
    const name = VOICE_NAMES[cmd] || cmd;
    const open = (id, text) => {
      showScreen(id);
      voiceShow(name, text || 'Wird geöffnet', 'answer');
      voiceHide(1500);
    };
    const playing = !!media?.playing;
    switch (cmd) {
      case 'maps': case 'music': case 'radar': case 'phone': case 'video': case 'dashboard': case 'home': case 'settings': case 'job': case 'calendar':
        return open(cmd);
      case 'pause':
        if (playing) sendMedia('toggle');
        return open(screen, 'Musik pausiert');
      case 'play':
        if (!playing) sendMedia('toggle');
        return open(screen, 'Musik läuft');
      case 'next': case 'previous':
        sendMedia(cmd);
        return open(screen, cmd === 'next' ? 'Nächster Titel' : 'Vorheriger Titel');
      case 'standby-on': voiceHide(0); return setStandby(true);
      case 'standby-off': setStandby(false); return open(screen, 'Display an');
      case 'weather': return voiceAnswer(name, weatherText());
      case 'fuel': return voiceAnswer(name, fuelText());
      case 'time': return voiceAnswer(name, telemetry?.available ? `Im Spiel ist es ${dayClockU(telemetry.gameTimeMin)}.` : `Es ist ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.`);
      case 'deadline': return voiceAnswer(name, deadlineText());
      case 'repeat': return lastAnswer ? voiceAnswer(lastAnswer.title, lastAnswer.text, lastAnswer.lang) : voiceAnswer(name, 'Ich habe noch nichts gesagt.');
      case 'call-traffic': case 'call-weather': case 'call-service': case 'call-rest':
        voiceHide();
        return callContact(cmd.slice(5));
      case 'traffic': return voiceAnswer(name, trafficText());
      case 'service': return voiceAnswer(name, serviceText());
      case 'rest':
        stopsTab = 'p';
        return voiceAnswer(name, restText());
      case 'gas': {
        const p = pose.current();
        const gas = p ? CarMap.nearbyPlaces(['g'], p.x, p.z, 1)[0] : null;
        stopsTab = 'g';
        return voiceAnswer(name, gas ? `Die nächste Tankstelle ist ${meters(gameMeters(gas.onRoute ? gas.along : gas.air))} entfernt${gas.onRoute ? ', direkt an deiner Route' : ''}.` : 'Ich finde gerade keine Tankstelle in der Nähe.');
      }
      case 'dispatcher':
        voiceHide();
        return callContact('dispatcher');
      case 'report':
        reportCamera();
        return voiceAnswer(name, 'Danke, ist gemeldet.');
      case 'dark': case 'light':
        changeSetting((s) => (s.appearance = cmd));
        return voiceAnswer(name, cmd === 'dark' ? 'Nachtmodus ist an.' : 'Tagmodus ist an.');
      default:
        return voiceHide();
    }
  }

  function fuelText() {
    const t = telemetry;
    if (!t || !t.available) return 'Keine Verbindung zum Spiel.';
    if (!(t.fuelCapacity > 0)) return 'Den Tankinhalt kenne ich gerade nicht.';
    const share = num(t.fuel) / t.fuelCapacity;
    return `Im Tank sind ${volume(num(t.fuel))} (${Math.round(share * 100)} Prozent).`
      + (t.fuelRangeKm > 0 ? ` Das reicht noch etwa ${distance(t.fuelRangeKm)}.` : '')
      + (share < 0.2 ? ' Du solltest bald tanken.' : '');
  }
  function deadlineText() {
    const t = telemetry;
    if (!t || !t.available) return 'Keine Verbindung zum Spiel.';
    if (!t.hasJob) return 'Du hast gerade keinen Auftrag.';
    const left = t.deliveryTimeMin - t.gameTimeMin;
    const parts = [`Du fährst ${t.cargo || 'Fracht'} nach ${t.destinationCity || 'unbekannt'}.`];
    parts.push(left > 0 ? `Lieferfrist ist ${dayClockU(t.deliveryTimeMin)}, noch ${duration(left)} Zeit.` : 'Die Lieferfrist ist schon abgelaufen.');
    if (left > 0 && t.navTimeMin > 0) parts.push(t.gameTimeMin + t.navTimeMin > t.deliveryTimeMin ? 'Laut Navi wird es knapp – du kommst zu spät.' : 'Laut Navi schaffst du das pünktlich.');
    return parts.join(' ');
  }

  // ------------------------------------------------------------------ Mitteilungs-Banner
  let toastTimer = 0;
  // kind: Art der Mitteilung (Einstellungen › Mitteilungen) – ohne kind (Rückmeldung auf eigene Aktionen) immer
  // song: text ist ein Songtitel (keine Ortsnamen übersetzen)
  function showToast({ icon, color, title, text: body, open, kind, song }) {
    if (params.has('quiet')) return; // Aufnahmen ohne Mitteilungen
    if (kind && settings['notify' + kind] === false) return;
    // open: App ("sports") oder Einstellungsseite ("settings/update")
    const app = open ? open.split('/')[0] : '';
    // Hinweis-Karte im Kombiinstrument (Option): gleiche Mitteilung, ohne Titelwechsel der Musik (steht dort schon)
    if (!song) clusterNote = { id: ++clusterNoteId, at: Date.now(), icon: icon || (catalog.APPS[app] ? app : 'info'), color: color || catalog.APPS[app]?.color || 'blue', title: String(title || ''), text: String(body || '') };
    const appIconHtml = app && catalog.APPS[app] ? `<span class="toast-app">${iconHtml(app)}</span>` : badge(icon, color);
    toastEl.innerHTML = `${appIconHtml}<div class="lr-text"><b>${escape(title)}</b>${body ? `<small${song ? ' data-no-names' : ''}>${escape(body)}</small>` : ''}</div>${open ? `<span class="toast-go">${ICONS['chevron-right']}</span>` : ''}`;
    toastEl.dataset.open = open || '';
    cancelLeave(toastEl); // ein gerade ausblendender Banner wird ersetzt
    toastEl.hidden = false;
    toastEl.classList.remove('show');
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => hideAnimated(toastEl), 6000); // gleitet nach unten hinaus
  }
  toastEl.addEventListener('click', () => {
    toastEl.hidden = true;
    const [app, page] = (toastEl.dataset.open || '').split('/');
    if (!app) return;
    showScreen(app);
    if (app === 'settings' && page) {
      settingsStack = page === 'update' ? ['main', 'general', 'update'] : ['main', page];
      rerenderSettings();
    }
  });

  // ------------------------------------------------------------------ AI-Sprachassistent (optional, lokal)
  // Mit geladenem Paket (Einstellungen › Sprachassistent) spricht man frei statt fester Befehle: Aufnahme hier über das
  // Mikrofon, Spracherkennung (Whisper) und Sprachmodell (Qwen3.5) laufen lokal im Hauptprozess (main/ai.js).
  // Einfache Befehle („nächstes Lied“) erkennt die App selbst – nur Fragen und alles andere gehen an das Sprachmodell.
  // Am Telefon antworten Disponent, Verkehrsfunk & Co. frei und passend zur Lage.
  let aiStatus = null;
  const aiReady = () => !!(api?.aiChat && aiStatus?.installed && settings.aiAssistant);
  const aiCallsReady = () => aiReady() && settings.aiCalls;
  const aiLang = () => (['en', 'pl', 'tr'].includes(CarI18n.lang) ? CarI18n.lang : CarI18n.chinese ? 'en' : 'de'); // Chinesisch: noch keine Stimme – Englisch
  function refreshAiStatus() {
    if (!api?.aiStatus) return;
    api.aiStatus().then((s) => {
      aiStatus = s;
      if (role === 'game' && s?.supertonic && /^st-/.test(settings.voiceName || '')) api.aiTtsWarm?.();
      if (role === 'game' && s?.kokoro && speechLang().startsWith('zh') && settings.voiceZh !== 'win') api.aiTtsWarm?.('kokoro');
      if (screen === 'settings' && settingsStack[settingsStack.length - 1] === 'assistant') rerenderSettings();
    }).catch(() => {});
  }
  if (api?.onAi) {
    api.onAi((s) => {
      aiStatus = s;
      if (screen === 'settings' && settingsStack[settingsStack.length - 1] === 'assistant') rerenderSettings();
    });
  }

  // ------------------------------------------------------------ Aufnahme (16 kHz mono, endet nach kurzer Stille)
  let recordStop = null;
  async function recordSpeech({ maxMs = 10000, silenceMs = 900, startTimeoutMs = 6000 } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const ctx = new AudioContext({ sampleRate: 16000 });
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    const chunks = [];
    let speaking = false;
    let silent = 0;
    let spoken = 0;
    let noise = 0.008;
    const started = performance.now();
    return new Promise((resolve) => {
      let finished = false;
      const done = (keep) => {
        if (finished) return;
        finished = true;
        recordStop = null;
        proc.onaudioprocess = null;
        proc.disconnect();
        src.disconnect();
        stream.getTracks().forEach((t) => t.stop()); // Mikrofon sofort wieder frei (Windows zeigt es sonst als belegt)
        ctx.close();
        resolve(keep && speaking ? encodeWav(chunks, ctx.sampleRate) : null);
      };
      recordStop = () => done(true);
      proc.onaudioprocess = (e) => {
        const data = new Float32Array(e.inputBuffer.getChannelData(0));
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const ms = (data.length / ctx.sampleRate) * 1000;
        chunks.push(data);
        if (!speaking) {
          noise = noise * 0.9 + rms * 0.1; // Grundrauschen (Motor, Lüfter) mitlernen
          if (chunks.length > 6) chunks.shift(); // ~0,8 s Vorlauf behalten, damit der Anfang nicht fehlt
          if (rms > Math.max(0.02, noise * 2.5)) speaking = true;
          else if (performance.now() - started > startTimeoutMs) done(false);
        } else {
          spoken += ms;
          silent = rms < Math.max(0.012, noise * 1.6) ? silent + ms : 0;
          if (silent > silenceMs || spoken > maxMs) done(true);
        }
      };
      src.connect(proc);
      proc.connect(ctx.destination);
    });
  }
  function encodeWav(chunks, rate) {
    const length = chunks.reduce((a, c) => a + c.length, 0);
    const buf = new ArrayBuffer(44 + length * 2);
    const v = new DataView(buf);
    const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, length * 2, true);
    let o = 44;
    for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 0x7fff, true);
    return new Uint8Array(buf);
  }

  // ------------------------------------------------------------ Lage im Spiel (Fakten fürs Sprachmodell)
  // Anweisungen und Beschriftungen auf Englisch – kleine Modelle folgen ihnen zuverlässiger; die Werte (Texte der App)
  // dürfen deutsch sein, geantwortet wird in der App-Sprache.
  // Spiel für die Anweisungen (ATS: amerikanische Orte, Staaten, Meilen je nach Einstellung)
  const gameName = () => (isAts() ? 'American Truck Simulator (USA)' : 'Euro Truck Simulator 2 (Europe)');
  function aiFacts() {
    const t = telemetry;
    const lines = [];
    if (!t || !t.available) lines.push('Not connected to the game.');
    else {
      lines.push(`Game time: ${dayClockU(t.gameTimeMin)}`);
      if (t.truckBrand || t.truckName) lines.push(`Truck: ${[t.truckBrand, t.truckName].filter(Boolean).join(' ')}`);
      lines.push(`Speed: ${spd(num(t.speedKmh))} ${spdUnit()}${t.speedLimitKmh > 0 ? `, limit ${spd(t.speedLimitKmh)} ${spdUnit()}` : ''}`);
      if (t.fuelCapacity > 0) lines.push(`Fuel: ${volume(num(t.fuel))} of ${volume(t.fuelCapacity)}${t.fuelRangeKm > 0 ? `, range about ${distance(t.fuelRangeKm)}` : ''}`);
      if (t.hasJob) {
        const left = t.deliveryTimeMin - t.gameTimeMin;
        lines.push(`Job: ${t.cargo || 'cargo'} from ${t.sourceCity || '?'}${t.sourceCompany ? ` (${t.sourceCompany})` : ''} to ${t.destinationCity || '?'}${t.destinationCompany ? ` (${t.destinationCompany})` : ''}`
          + `${t.cargoMassKg > 0 ? `, ${mass(t.cargoMassKg)}` : ''}${t.income > 0 ? `, pay ${money(t.income)}` : ''}; deadline ${dayClockU(t.deliveryTimeMin)}${left > 0 ? ` (${duration(left)} left)` : ' (expired)'}`
          + `${t.cargoDamage > 0.005 ? `; cargo damage ${Math.round(t.cargoDamage * 100)} %` : ''}`);
        if (t.navTimeMin > 0 && left > 0) lines.push(t.gameTimeMin + t.navTimeMin > t.deliveryTimeMin ? 'Navigation says: delivery will be late.' : 'Navigation says: delivery will be on time.');
      } else lines.push('Job: none');
      // Schlüsse fertig mitgeben – kleine Modelle rechnen unzuverlässig
      if (t.navDistanceKm > 0.5 && t.fuelRangeKm > 0) lines.push(t.fuelRangeKm < t.navDistanceKm ? `Fuel does NOT last to the destination (${distance(t.navDistanceKm)} to go, range ${distance(t.fuelRangeKm)}) - refuelling on the way is needed.` : 'Fuel lasts to the destination.');
      if (t.navTimeMin > 0 && t.restStopMin > 0) lines.push(t.restStopMin < t.navTimeMin ? 'A break is required before arrival.' : 'No break needed before arrival.');
      lines.push(`Navigation: ${trafficText()}`);
      lines.push(`Breaks: ${restText()}`);
      lines.push(`Truck condition: ${serviceText()}`);
    }
    if (settings.weather) lines.push(`Weather: ${weatherText()}`);
    lines.push(media?.title ? `Music: ${media.playing ? 'playing' : 'paused'} – "${media.title}"${media.artist ? ` by ${media.artist}` : ''}` : 'Music: nothing');
    return lines.join('\n');
  }
  // Vorgabe für die Spracherkennung: Orte aus Auftrag und Wetter, Namen der Kontakte, typische Begriffe
  function sttHint() {
    const t = telemetry;
    const places = [t?.sourceCity, t?.destinationCity, weatherData?.city].filter(Boolean);
    const words = {
      en: 'dispatcher, fuel station, rest area, roadside assistance, traffic radio, Spotify',
      pl: 'dyspozytor, stacja paliw, parking, pomoc drogowa, informacje drogowe, dostawa, Spotify',
      tr: 'sevk sorumlusu, benzin istasyonu, dinlenme alanı, yol yardımı, trafik yayını, teslimat, Spotify',
    }[aiLang()] || 'Disponent, Tankstelle, Rastplatz, Pannenhilfe, Verkehrsfunk, Lieferung, Spotify';
    return [...new Set(places), words].join(', ') + '.';
  }
  const answerLanguage = () => ({ en: 'English', pl: 'Polish, informal second person (ty), gender-neutral wording', tr: 'Turkish, informal second person (sen)' })[aiLang()] || 'German, informal second person';

  // ------------------------------------------------------------ Antwortformat (das Modell kann nur diese Aktionen)
  const AI_APPS = Object.keys(catalog.APPS);
  const AI_CALLS = Object.keys(CONTACTS).filter((id) => !CONTACTS[id].secret);
  // je Aktion nur die passenden Werte – das Sprachmodell kann keine ungültige Kombination erzeugen
  const action = (type, value) => ({ type: 'object', properties: { type: { const: type }, value }, required: ['type', 'value'] });
  const ASSIST_SCHEMA = {
    type: 'object',
    properties: {
      answer: { type: 'string' },
      actions: {
        type: 'array',
        maxItems: 3,
        items: {
          anyOf: [
            action('open_app', { enum: AI_APPS }),
            action('music', { enum: ['play', 'pause', 'next', 'previous'] }),
            action('play_music', { type: 'string' }),
            action('call', { enum: AI_CALLS }),
            action('show_stops', { enum: ['g', 'p'] }),
            action('appearance', { enum: ['dark', 'light'] }),
            action('report_camera', { const: '' }),
          ],
        },
      },
    },
    required: ['answer', 'actions'],
  };
  function assistantPrompt() {
    return [
      `You are the voice assistant on the CabPlay display in a truck in ${gameName()}.`,
      `Always answer in ${answerLanguage()}. The answer is read aloud while driving: 1-2 short sentences, no lists, no markdown, no emojis.`,
      'Use only the FACTS below. Never invent numbers, places or times. If something is not in the facts, say honestly that you do not know.',
      'Actions (type -> value):',
      `- open_app -> one of: ${AI_APPS.join(', ')}`,
      '- music -> play, pause, next, previous',
      '- play_music -> search text for Spotify (artist, song, genre or mood)',
      `- call -> one of: ${AI_CALLS.join(', ')} (dispatcher, traffic radio, weather service, roadside assistance, rest stop info)`,
      '- show_stops -> g (fuel stations) or p (rest areas)',
      '- appearance -> dark or light',
      '- report_camera -> empty (report a speed camera here)',
      'Use play_music (not music) when the driver names an artist, song, genre or mood.',
      'Only add actions the driver asked for, otherwise an empty list. For a plain question just answer.',
      '',
      `FACTS:\n${aiFacts()}`,
    ].join('\n');
  }

  function runAiAction({ type, value }) {
    const v = String(value || '').trim();
    switch (type) {
      case 'open_app': if (AI_APPS.includes(v)) showScreen(v); break;
      case 'music':
        if (v === 'pause' && media?.playing) sendMedia('toggle');
        else if (v === 'play' && !media?.playing) sendMedia('toggle');
        else if (v === 'next' || v === 'previous') sendMedia(v);
        break;
      case 'play_music':
        if (!v || !api?.spotifySearch || !spotifyStatus?.connected) break;
        api.spotifySearch(v).then((r) => {
          // Stimmung oder Genre („was Ruhiges“) → Playlist, sonst der beste Titel
          const mood = /musik|music|playlist|mix|hits|chill|ruhig|calm|relax|party|rock|pop|jazz|klassik|classical|country|schlager|techno|rap|hip.?hop/i.test(v);
          const hit = mood ? r?.playlists?.[0] || r?.tracks?.[0] : r?.tracks?.[0] || r?.playlists?.[0];
          if (hit?.uri) playSpotify(hit.uri);
        }).catch(() => {});
        break;
      case 'call': if (AI_CALLS.includes(v)) setTimeout(() => callContact(v), 1200); break;
      case 'show_stops':
        stopsTab = v === 'p' ? 'p' : 'g';
        showScreen('stops');
        break;
      case 'appearance': if (v === 'dark' || v === 'light') changeSetting((s) => (s.appearance = v)); break;
      case 'report_camera': reportCamera(); break;
      default: break;
    }
  }

  // Kurze Befehle erkennt die App selbst (schneller als das Sprachmodell) – Wörter wie bei den festen Befehlen
  const VOICE_QUICK = [
    [/^(nächste[sr]? (lied|titel|song)|lied überspringen|überspringen|next( song| track)?|skip( song)?)$/, 'next'],
    [/^(vorherige[sr]? (lied|titel|song)|letzte[sr]? lied|previous( song| track)?)$/, 'previous'],
    [/^(musik )?(pause|pausieren|stopp?|aus)$|^(pause|stop) music$/, 'pause'],
    [/^(musik )?(weiter|abspielen|an)$|^(spiel musik|play( music)?|resume)$/, 'play'],
    [/^(karte|navi|navigation|maps?|karte öffnen|navi öffnen|open maps)$/, 'maps'],
    [/^(home|startbildschirm|home screen)$/, 'home'],
    [/^(abbrechen|nichts|vergiss es|cancel|never mind|nothing)$/, 'cancel'],
    [/^(wiederholen|noch ?mal|repeat|say that again)$/, 'repeat'],
    [/^(display|bildschirm|monitor) (aus|ausschalten)$|^(screen|display) off$|^turn (the )?(screen|display) off$/, 'standby-on'],
    [/^(display|bildschirm|monitor) (an|ein|einschalten)$|^(screen|display) on$|^turn (the )?(screen|display) on$/, 'standby-off'],
    [/^(nachtmodus|dunkel|night mode|dark mode)$/, 'dark'],
    [/^(tagmodus|hell|day mode|light mode)$/, 'light'],
  ];
  const QUICK_STRIP = [/[.,!?\u201e\u201c\u0022\u0027]/g, /^(hey|hallo|ok|okay|bitte)\s+/, /\s+bitte$/];
  function quickCommand(text) {
    let s = text.toLowerCase();
    for (const re of QUICK_STRIP) s = s.replace(re, '');
    s = s.trim();
    for (const [re, cmd] of VOICE_QUICK) if (re.test(s)) return cmd;
    return null;
  }

  // Gesprächsverlauf: Rückfragen („und morgen?“) verstehen – vergisst nach 3 Minuten
  let aiHistory = [];
  let aiHistoryAt = 0;
  async function askAssistant(text) {
    if (performance.now() - aiHistoryAt > 180000) aiHistory = [];
    const messages = [{ role: 'system', content: assistantPrompt() }, ...aiHistory, { role: 'user', content: text }];
    const r = await api.aiChat({ messages, schema: ASSIST_SCHEMA });
    if (r.error) throw new Error(r.error);
    const answer = String(r.json?.answer || '').trim();
    aiHistory = [...aiHistory, { role: 'user', content: text }, { role: 'assistant', content: answer }].slice(-6);
    aiHistoryAt = performance.now();
    for (const a of (r.json?.actions || []).slice(0, 3)) runAiAction(a);
    return answer;
  }

  async function startAiVoice() {
    voiceBusy = true;
    stopSpeaking();
    beep('listen');
    voiceShow('Ich höre zu …', 'Sprich einfach – z. B. „Schaffe ich die Lieferung noch?“', 'listening');
    try {
      const wav = await recordSpeech();
      if (!wav) {
        voiceBusy = false;
        return voiceHide();
      }
      voiceShow('Einen Moment …', '', 'thinking');
      const tr = await api.aiTranscribe(wav, aiLang(), sttHint());
      if (tr.error) throw new Error(tr.error);
      if (!tr.text || tr.text.length < 2) {
        voiceBusy = false;
        return voiceAnswer('Nicht verstanden', 'Das habe ich leider nicht verstanden.');
      }
      const quick = quickCommand(tr.text);
      if (quick) {
        voiceBusy = false;
        return runVoiceCommand(quick);
      }
      voiceShow(`„${tr.text}“`, 'Einen Moment …', 'thinking');
      const answer = await askAssistant(tr.text);
      voiceBusy = false;
      voiceAnswer(`„${tr.text}“`, answer || 'Dazu fällt mir gerade nichts ein.', answer ? aiLang() : null);
    } catch (e) {
      voiceBusy = false;
      voiceAnswer('Sprachassistent', /mikrofon|microphone|notallowed|notfound|permission/i.test(`${e.name} ${e.message}`)
        ? 'Ich komme nicht an das Mikrofon. Prüfe die Datenschutz-Einstellungen von Windows.'
        : `Das ging gerade nicht: ${e.message}`);
    }
  }

  // ------------------------------------------------------------ Freie Telefonate
  // Nach der Ansage bleibt die Leitung offen: Mikrofon-Knopf antippen, sprechen – die Person antwortet passend zur Lage.
  const PERSONAS = {
    dispatcher: 'You are the dispatcher of the driver\'s haulage company: friendly, pragmatic, a bit gruff. You know job, deadline and route from the facts.',
    traffic: 'You are an editor at the traffic radio. You talk about route, speed limit, speed cameras and arrival time from the facts.',
    weather: 'You are a meteorologist at the weather service and describe the weather from the facts vividly but briefly.',
    service: 'You work for roadside assistance. You ask about the problem and give tips on the truck condition from the facts (workshop, fuel, wear).',
    rest: 'You work at the rest stop info line and help with breaks, rest areas and fuel stations from the facts.',
    police: 'You are a police officer on patrol, strict but with humour. You care about speed and the speed limit from the facts.',
    thought: 'You are Deep Thought, the supercomputer from The Hitchhiker\'s Guide to the Galaxy. You answer solemnly and philosophically, happily mentioning 42.',
    agent: 'You are a secret agent in the style of James Bond, charming and dry.',
    get hotline() { return `You are the fan hotline for ${gameName()}, wildly enthusiastic about the game.`; }, // Spiel erst beim Anruf
  };
  const CALL_SCHEMA = {
    type: 'object',
    properties: { answer: { type: 'string' }, hang_up: { type: 'boolean' } },
    required: ['answer', 'hang_up'],
  };
  let callChat = null; // { contact, history }
  function callPrompt(contact) {
    const c = CONTACTS[contact] || CONTACTS.dispatcher;
    return [
      PERSONAS[contact] || `You are "${c.name}" (${c.kind}).`,
      `This is a phone call with a truck driver in ${gameName()}.`,
      `Always speak ${answerLanguage()}. Answer like on the phone: 1-2 short spoken sentences, no lists. Stay in character.`,
      'Take numbers, places and times only from the FACTS - never invent them.',
      'Set hang_up to true when the driver says goodbye or the conversation is over.',
      '',
      `FACTS:\n${aiFacts()}`,
    ].join('\n');
  }
  // nach der Ansage: mit AI Leitung offen lassen, sonst auflegen – fehlt der Status (kam beim Start nicht an), erst nachfragen
  function afterGreeting(contact, text) {
    const go = () => {
      const open = aiCallsReady();
      api?.aiLog?.(`call ${contact}: ${open ? 'line stays open' : 'hung up'} (installed ${!!aiStatus?.installed}, assistant ${settings.aiAssistant}, calls ${settings.aiCalls}, window ${role})`);
      if (open) callKeepOpen(contact, text);
      else setTimeout(endCall, 600);
    };
    if (aiStatus || !api?.aiStatus) return go();
    api.aiStatus().then((s) => {
      aiStatus = s;
      go();
    }, go);
  }
  // nach der Ansage: Leitung offen lassen (statt aufzulegen)
  function callKeepOpen(contact, text) {
    callChat = { contact, history: text ? [{ role: 'assistant', content: text }] : [], pending: '' };
    showCall(text, { ongoing: true, contact, talk: true });
    clearTimeout(callTimer);
    callTimer = setTimeout(endCall, 60000); // niemand spricht → nach einer Minute auflegen
  }
  async function callTalk() {
    if (!callChat || voiceBusy) return;
    const { contact } = callChat;
    const setState = setCallStatus;
    clearTimeout(callTimer);
    voiceBusy = true;
    stopSpeaking();
    beep('listen');
    callEl.classList.add('talking');
    setState('Ich höre zu …');
    try {
      const wav = await recordSpeech({ startTimeoutMs: 7000 });
      callEl.classList.remove('talking');
      if (!wav || !callChat) {
        setState('Antippen zum Sprechen');
        return;
      }
      setState('…');
      const tr = await api.aiTranscribe(wav, aiLang(), sttHint());
      if (tr.error) throw new Error(tr.error);
      if (!tr.text || !callChat) {
        setState('Antippen zum Sprechen');
        return;
      }
      callChat.pending = tr.text;
      renderCallLog();
      setState(callFull ? '…' : `„${tr.text}“`);
      const messages = [{ role: 'system', content: callPrompt(contact) }, ...callChat.history.slice(-8), { role: 'user', content: tr.text }];
      const r = await api.aiChat({ messages, schema: CALL_SCHEMA, maxTokens: 200 });
      if (r.error) throw new Error(r.error);
      if (!callChat) return;
      const answer = String(r.json?.answer || '').trim() || '…';
      callChat.pending = '';
      callChat.history.push({ role: 'user', content: tr.text }, { role: 'assistant', content: answer });
      renderCallLog();
      setState(callFull ? 'Spricht …' : answer);
      logCall(contact, 'out', answer);
      speak(answer, () => {
        if (!callChat) return;
        if (r.json?.hang_up) setTimeout(endCall, 600);
        else {
          setState('Antippen zum Sprechen');
          callTimer = setTimeout(endCall, 60000);
        }
      }, { lang: aiLang() }); // freie Antwort des Sprachmodells – in ihrer Sprache vorlesen
      if (!canSpeak || !settings.voice) callTimer = setTimeout(r.json?.hang_up ? endCall : () => setState('Antippen zum Sprechen'), 5000);
    } catch (e) {
      callEl.classList.remove('talking');
      setState(`Verbindung gestört: ${e.message}`);
      callTimer = setTimeout(endCall, 8000);
    } finally {
      voiceBusy = false;
    }
  }
  // ------------------------------------------------------------------ Radio
  // Wie das Autoradio: großes Bild (Albumcover wie die DAB-Slideshow, sonst Senderlogo), Sendername, Lauftext,
  // Sendertasten. Den Zustand hält der Hauptprozess (main/radio.js); abgespielt wird nur in einem Fenster
  // (Truck-Bildschirm, ohne ihn im Editor). Radio an → Spotify pausiert; Spotify spielt → Radio aus.
  let radio = null;
  let radioStations = [];
  let radioSearch = null; // { query, results, busy }
  let radioEdit = false;
  let radioTab = null; // de | en | own – ohne Wahl der Reiter des laufenden Senders
  const RADIO_TABS = [['de', 'Deutsch'], ['en', 'Englisch'], ['us', 'USA'], ['ilove', 'I LOVE'], ['ets2', 'ETS2'], ['ats', 'ATS'], ['own', 'Eigene']];
  const radioAudio = new Audio();
  radioAudio.preload = 'none';
  const isRadioPlayer = () => !!radio && radio.player === role;
  const radioActive = () => radio?.source === 'radio';
  let radioDuck = false; // leiser, während eine Ansage läuft

  // Lautstärke nach Gehör: quadratisch statt linear. Linear war 1 % nur 40 dB leiser als voll – bei laut gemasterten
  // Sendern noch deutlich zu hören, und fast der ganze Regelweg lag im lauten Bereich. Jetzt: 50 % ≈ −12 dB,
  // 10 % ≈ −40 dB, 1 % ≈ −80 dB (praktisch stumm).
  function radioVolume() {
    const v = Math.max(0, Math.min(1, (settings.volumeRadio ?? 80) / 100));
    return v * v * (radioDuck ? 0.3 : 1);
  }
  function syncRadioAudio() {
    if (!api) return;
    const url = radio?.station?.url || '';
    if (isRadioPlayer() && radio.playing && url) {
      radioAudio.volume = radioVolume();
      if (radioAudio.dataset.url !== url) {
        radioAudio.dataset.url = url;
        radioAudio.src = url;
        radioRetries = 0;
        radioAudio.play().catch(() => radioReconnect());
      } else if (radioAudio.paused) radioAudio.play().catch(() => api.radioPlayer('error'));
      else if (radio.loading && radioAudio.readyState >= 3) api.radioPlayer('playing'); // läuft schon
    } else if (radioAudio.dataset.url) {
      radioAudio.pause();
      radioAudio.removeAttribute('src');
      radioAudio.load(); // Verbindung zum Stream wirklich schließen
      delete radioAudio.dataset.url;
    }
  }
  // Abbruch (Netz weg, Stream endet): bis zu dreimal neu verbinden, erst dann als Fehler melden
  let radioRetries = 0;
  function radioReconnect() {
    const url = radioAudio.dataset.url;
    if (!url || !radio?.playing) return;
    if (radioRetries >= 3) return api?.radioPlayer('error');
    radioRetries++;
    api?.radioPlayer('waiting');
    setTimeout(() => {
      if (radioAudio.dataset.url !== url || !radio?.playing) return;
      radioAudio.src = url;
      radioAudio.play().catch(() => radioReconnect());
    }, 1500 * radioRetries);
  }
  radioAudio.addEventListener('playing', () => {
    radioRetries = 0;
    if (radioAudio.dataset.url) api?.radioPlayer('playing');
  });
  radioAudio.addEventListener('waiting', () => radioAudio.dataset.url && api?.radioPlayer('waiting'));
  radioAudio.addEventListener('error', () => radioAudio.dataset.url && radioReconnect());
  radioAudio.addEventListener('ended', () => radioAudio.dataset.url && radioReconnect());
  function duckRadio(on) {
    radioDuck = on;
    if (radioAudio.dataset.url) radioAudio.volume = radioVolume();
  }

  // Kachel eines Senders: Logo oder Name auf Farbe
  const STATION_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00897b', '#3949ab', '#d81b60'];
  // Länge des längsten Worts: die Schrift wird so klein, dass es in die Kachel passt (kein Umbruch mitten im Wort)
  const longestWord = (text) => Math.max(4, ...String(text).split(/\s+/).map((w) => [...w].length));
  // Name in der Senderliste: im Reiter „I LOVE“ ohne den Vorsatz (steht schon auf dem Reiter und der Kachel)
  const presetLabel = (st) => (st.cat === 'ilove' && st.name !== 'I LOVE RADIO' ? st.name.replace(/^I LOVE\s*/, '') : st.name);
  const HEART = '<svg viewBox="0 0 24 22" aria-hidden="true"><path d="M12 21.4 10.3 19.9C4.2 14.4.2 10.8.2 6.4.2 2.8 3 0 6.6 0c2 0 4 1 5.4 2.5C13.4 1 15.4 0 17.4 0 21 0 23.8 2.8 23.8 6.4c0 4.4-4 8-10.1 13.5z" fill="currentColor"/></svg>';
  function stationArt(s, cls = '') {
    if (!s) return `<span class="rd-art ${cls} empty">${ICONS.radio || ''}</span>`;
    if (s.logo) return `<span class="rd-art ${cls}" style="background-image:url('${s.logo}')"></span>`;
    if (s.cat === 'ilove') {
      // wie das Logo des Senders: großes „I ♥“ (Herz als Grafik, nicht als Emoji) und ein Kurzwort darunter
      const tag = s.tag || s.name.replace(/^I LOVE\s*/, '') || 'RADIO';
      return `<span class="rd-art ${cls} text ilove" style="--w:${longestWord(tag)}"><i>I${HEART}</i><b>${escape(tag)}</b></span>`;
    }
    const color = STATION_COLORS[[...s.name].reduce((a, c) => a + c.charCodeAt(0), 0) % STATION_COLORS.length];
    return `<span class="rd-art ${cls} text" style="background:${color};--w:${longestWord(s.name)}"><b>${escape(s.name)}</b></span>`;
  }

  let radioBgSrc = '';
  let radioBg = '';
  let radioBgColor = '';
  function radioBackground(src) {
    if (src === radioBgSrc) return;
    radioBgSrc = src;
    if (!src) {
      radioBg = '';
      radioBgColor = '';
      return applyRadioBackground();
    }
    const img = new Image();
    img.onload = () => {
      if (src !== radioBgSrc) return;
      const c = document.createElement('canvas');
      c.width = c.height = 24;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, 24, 24);
      const d = g.getImageData(0, 0, 24, 24).data;
      let r = 0, gr = 0, b = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) {
        const max = Math.max(d[i], d[i + 1], d[i + 2]);
        const min = Math.min(d[i], d[i + 1], d[i + 2]);
        const weight = 0.1 + (max ? (max - min) / max : 0) * (max / 255);
        r += d[i] * weight; gr += d[i + 1] * weight; b += d[i + 2] * weight; w += weight;
      }
      const [h, s, l] = rgbToHsl(r / w, gr / w, b / w);
      radioBgColor = `hsl(${Math.round(h)} ${Math.round(Math.min(s, 0.65) * 100)}% ${Math.round(Math.max(0.22, Math.min(0.38, l)) * 100)}%)`;
      const blur = document.createElement('canvas');
      blur.width = blur.height = 96;
      const bg = blur.getContext('2d');
      bg.filter = 'blur(10px) saturate(1.5)';
      bg.drawImage(img, -24, -24, 144, 144);
      radioBg = blur.toDataURL('image/jpeg', 0.85);
      applyRadioBackground();
    };
    img.src = src;
  }
  function applyRadioBackground() {
    const value = radioBg ? `url("${radioBg}")` : '';
    for (const el of [...nodes('rd-bg'), ...nodes('rd-wbg')]) if (el.style.backgroundImage !== value) el.style.backgroundImage = value;
    for (const el of stage.querySelectorAll('[data-screen="radio"], .w-music')) el.style.setProperty('--rd-art', radioBgColor || '#5a1d1b');
  }

  function renderRadio() {
    shell.classList.toggle('radio-src', radioActive()); // Dashboard-Widget zeigt das Radio
    const s = radio?.station;
    const playing = !!radio?.playing;
    const status = !radio ? '' : radio.error || (radio.loading ? 'Verbinde …' : playing ? 'Live' : 'Pausiert');
    // großes Bild: Cover (Slideshow) – sonst Senderlogo
    const art = radio?.cover || s?.logo || '';
    radioBackground(art);
    applyRadioBackground();
    html('rd-slide', `${art}|${s?.id}`, art ? `<span class="rd-slide-img ${radio?.cover ? 'cover' : 'logo'}" style="background-image:url('${art}')"></span>` : stationArt(s, 'big'));
    marqueeText('rd-station', s ? s.name : 'Radio');
    text('rd-state', status);
    marqueeText('rd-title', radio?.title || (s ? (playing ? 'Live' : 'Antippen zum Abspielen') : 'Sender wählen'));
    text('rd-artist', radio?.artist || ''); // zweite Zeile mit „…“, nur der Titel läuft durch
    html('rd-play', String(playing), playing ? ICONS.pause : ICONS.play);
    width('rd-vol', (settings.volumeRadio ?? 80) / 100);
    // Reiter wie die Senderlisten im Auto: Deutsch, Englisch, Eigene. Senderliste eines Spiels (ETS2, ATS) nur, wenn
    // sie Sender hat oder gerade dieses Spiel läuft (dann mit Hinweis, wo die Liste herkommt)
    const tab = radioTab || s?.cat || 'de';
    const count = (id) => radioStations.filter((x) => x.cat === id).length;
    const shownTabs = RADIO_TABS.filter(([id]) => (id !== 'ets2' && id !== 'ats') || count(id) > 0 || id === (isAts() ? 'ats' : 'ets2') || id === tab);
    list('rd-tabs', shownTabs.map(([id, label]) => `<button data-focus data-action="radio-tab" data-tab="${id}" class="${id === tab ? 'on' : ''}">${label}<small>${count(id)}</small></button>`).join(''));
    text('rd-vol-text', `${settings.volumeRadio ?? 80} %`);
    toggle('rd-now', 'error', !!radio?.error);
    // Dashboard-Widget
    html('wr-art', `${art}|${s?.id}`, art ? `<span class="rd-slide-img" style="background-image:url('${art}')"></span>` : stationArt(s));
    marqueeText('wr-title', radio?.title || s?.name || 'Radio');
    text('wr-name', radio?.title ? `${radio.artist ? `${radio.artist} · ` : ''}${s?.name || ''}` : status);
    html('wr-play', String(playing), playing ? ICONS.pause : ICONS.play);
    // Sendertasten
    const shown = radioStations.filter((st) => st.cat === tab);
    const asList = settings.radioView === 'list';
    for (const el of stage.querySelectorAll('[data-list="rd-presets"]')) el.classList.toggle('list', asList);
    for (const el of stage.querySelectorAll('[data-screen="radio"]')) el.classList.toggle('list-view', asList);
    html('rd-view', String(asList), asList ? ICONS.grid9 : ICONS.list);
    list('rd-presets', shown.map((st) => `<button class="rd-preset ${st.id === radio?.current ? 'on' : ''} ${radioEdit ? 'edit' : ''}" data-focus ${radioEdit ? `data-action="radio-remove" data-id="${escape(st.id)}"` : `data-radio-play="${escape(st.id)}"`}>
        ${stationArt(st)}<small>${escape(presetLabel(st))}</small>${asList && st.id === radio?.current ? `<em class="rd-live">${escape(radio.title ? `${radio.artist ? `${radio.artist} – ` : ''}${radio.title}` : 'Live')}</em>` : ''}${radioEdit ? `<i class="rd-x">${ICONS.minus2}</i>` : ''}</button>`).join('')
      + `<button class="rd-preset add" data-focus data-action="radio-search-open"><span class="rd-art plus">${ICONS.plus}</span><small>Sender</small></button>`
      + (tab === 'own' && !shown.length ? '<div class="rd-hint">Eigene Sender fügst du mit „+ Sender“ hinzu – Suche nach Name oder Stream-Adresse.</div>' : '')
      + (tab === 'ets2' && !shown.length ? '<div class="rd-hint">Hier erscheinen die Sender aus dem Online-Radio von ETS2 (Datei live_streams.sii in Dokumente › Euro Truck Simulator 2). Deine Liste ist noch leer.</div>' : '')
      + (tab === 'ats' && !shown.length ? '<div class="rd-hint">Hier erscheinen die Sender aus dem Online-Radio von ATS (Datei live_streams.sii in Dokumente › American Truck Simulator). Deine Liste ist noch leer.</div>' : ''));
    renderRadioSearch();
    syncRadioAudio();
  }

  // Sender suchen und hinzufügen (Senderverzeichnis radio-browser.info oder eigene Stream-Adresse)
  function renderRadioSearch() {
    const open = !!radioSearch;
    for (const el of nodes('rd-search')) el.hidden = !open;
    if (!open) return;
    const r = radioSearch;
    let rows;
    if (r.busy) rows = '<div class="list-empty">Suche …</div>';
    else if (!r.results) rows = `<div class="list-empty">${role === 'editor' ? 'Sendername oder Stream-Adresse eingeben und Enter drücken.' : 'Tippen geht am PC im Editor-Fenster oder über die Handy-Steuerung. Hier kannst du Sender aus der Liste wieder einblenden.'}</div>`;
    else if (!r.results.length) rows = '<div class="list-empty">Nichts gefunden.</div>';
    else rows = r.results.map((x, i) => `<button class="list-row" data-focus data-action="radio-add" data-index="${i}">
        ${x.logo ? `<span class="lr-art" style="background-image:url('${x.logo}')"></span>` : `<span class="lr-art"></span>`}
        <div class="lr-text"><b>${escape(x.name)}</b><small>${escape(x.info || '')}</small></div><span class="lr-play">${ICONS.plus}</span></button>`).join('');
    list('rd-search-list', rows);
  }
  function runRadioSearch(query) {
    if (!api?.radioSearch || !query.trim()) return;
    radioSearch = { query, results: null, busy: true };
    renderRadioSearch();
    api.radioSearch(query).then((results) => {
      if (!radioSearch) return;
      radioSearch = { query, results: results || [], busy: false };
      renderRadioSearch();
    }, () => {
      radioSearch = { query, results: [], busy: false };
      renderRadioSearch();
    });
  }

  // Lautstärke wie ein Drehknopf: Tippen ±1 %, Halten wird immer schneller, Balken antippen oder ziehen springt hin
  let volHold = null;
  let lastVolPointer = 0;
  function setRadioVolume(v, save) {
    settings.volumeRadio = Math.max(0, Math.min(100, Math.round(v)));
    width('rd-vol', settings.volumeRadio / 100);
    text('rd-vol-text', `${settings.volumeRadio} %`);
    if (radioAudio.dataset.url) radioAudio.volume = radioVolume();
    if (save) changeSetting((st) => (st.volumeRadio = settings.volumeRadio));
  }
  function volFromBar(bar, x) {
    const r = bar.getBoundingClientRect();
    setRadioVolume(((x - r.left) / r.width) * 100, false);
  }
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element)) return;
    const bar = e.target.closest('.rd-bar');
    const btn = e.target.closest('[data-action="radio-vol"]');
    if (!bar && !btn) return;
    e.preventDefault();
    lastVolPointer = performance.now();
    if (bar) {
      volHold = { bar };
      volFromBar(bar, e.clientX);
      return;
    }
    const dir = Number(btn.dataset.step) < 0 ? -1 : 1;
    setRadioVolume(settings.volumeRadio + dir, false);
    let n = 0;
    const tick = () => {
      n++;
      setRadioVolume(settings.volumeRadio + dir * (n < 6 ? 1 : n < 14 ? 2 : 5), false);
      volHold.timer = setTimeout(tick, n < 6 ? 140 : 90);
    };
    volHold = { timer: setTimeout(tick, 420) };
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (volHold?.bar) volFromBar(volHold.bar, e.clientX);
  });
  const endVolHold = () => {
    if (!volHold) return;
    clearTimeout(volHold.timer);
    volHold = null;
    setRadioVolume(settings.volumeRadio, true); // erst am Ende speichern
  };
  document.addEventListener('pointerup', endVolHold);
  document.addEventListener('pointercancel', endVolHold);

  function onRadio(state) {
    radio = state;
    renderRadio();
  }
  function onRadioStations(list) {
    radioStations = Array.isArray(list) ? list : [];
    renderRadio();
  }
  // Radio-Knöpfe (App, Dashboard-Widget)
  function radioAction(action, d) {
    if (!api?.radioPlay) return showToast({ icon: 'radio', color: 'red', title: 'Radio', text: 'Nur in der App verfügbar' });
    if (action === 'radio-toggle') return radio?.playing ? api.radioStop() : api.radioPlay();
    if (action === 'radio-prev') return api.radioStep(-1);
    if (action === 'radio-next') return api.radioStep(1);
    if (action === 'radio-view') return changeSetting((st) => (st.radioView = st.radioView === 'list' ? 'grid' : 'list'));
    if (action === 'radio-vol') {
      // Berührung/Maus erledigt pointerdown (Halten, Balken); Drehknopf/Tastatur: ein Schritt
      if (performance.now() - lastVolPointer > 800) setRadioVolume(settings.volumeRadio + (Number(d.step) < 0 ? -1 : 1), true);
      return;
    }
    if (action === 'radio-tab') {
      radioTab = d.tab;
      lists.delete('rd-presets');
      renderRadio();
      const area = stage.querySelector('.screen.active [data-list="rd-presets"]');
      if (area) area.scrollTop = 0;
      return;
    }
    if (action === 'radio-edit') {
      radioEdit = !radioEdit;
      lists.delete('rd-presets');
      return renderRadio();
    }
    if (action === 'radio-remove') return api.radioRemove(d.id);
    if (action === 'radio-restore') return api.radioRestore();
    if (action === 'radio-search-open') {
      radioSearch = { query: '', results: null, busy: false };
      renderRadioSearch();
      if (role === 'editor') setTimeout(() => stage.querySelector('[data-input="radio-search"]')?.focus(), 50);
      return;
    }
    if (action === 'radio-search-close') {
      radioSearch = null;
      return renderRadioSearch();
    }
    if (action === 'radio-add') {
      const item = radioSearch?.results?.[Number(d.index)];
      if (!item) return;
      api.radioAdd(item).then((r) => {
        if (r?.ok) {
          radioSearch = null;
          renderRadioSearch();
          showToast({ icon: 'radio', color: 'red', title: 'Sender hinzugefügt', text: item.name });
          api.radioPlay(r.id);
        }
      });
    }
  }
  // ------------------------------------------------------------------ Einrichtung beim ersten Start
  // Nur im Fenster am PC (Editor), nur bei neuen Installationen (setupDone fehlt) – jederzeit überspringbar und unter
  // Einstellungen › Info neu startbar. Nutzt die vorhandenen Aktionen (Plugin installieren, Olivia laden, Karte erneuern).
  const SETUP_STEPS = ['game', 'control', 'voice', 'map', 'done'];
  let setupStep = -1; // -1 = geschlossen
  let setupTimer = 0;
  const setupLayer = document.createElement('div');
  setupLayer.className = 'setup-layer';
  setupLayer.hidden = true;
  document.body.appendChild(setupLayer);

  function maybeStartSetup() {
    if (role !== 'editor' || !api || settings.setupDone !== false) return;
    openSetup();
  }
  function openSetup() {
    setupStep = 0;
    setupLayer.hidden = false;
    renderSetup();
    clearInterval(setupTimer);
    setupTimer = setInterval(() => {
      // Plugin-, Download- und Kartenstand ändern sich im Hintergrund
      if (setupStep === 0) refreshPluginFile();
      if (setupStep === 2) refreshAiStatus();
      renderSetup();
    }, 1500);
  }
  function closeSetup() {
    setupStep = -1;
    setupLayer.hidden = true;
    clearInterval(setupTimer);
    if (settings.setupDone !== true) changeSetting((s) => (s.setupDone = true));
  }

  function setupBody(step) {
    const ok = (text) => `<div class="setup-row ok">${ICONS.check}<span>${escape(text)}</span></div>`;
    const bad = (text) => `<div class="setup-row bad">${ICONS.warning || ''}<span>${escape(text)}</span></div>`;
    const hk = pluginHotkeys || { menu: 'Strg+F8', touch: 'Strg+Alt+M' };
    if (step === 'game') {
      const pf = pluginFile;
      return `<h2>Spiel und Plugin</h2><p>Das Plugin zeigt CabPlay auf dem Navi-Bildschirm im Truck. Die App installiert es selbst, sobald das Spiel beendet ist.</p>
        ${pf?.games?.length ? pf.games.map((g) => ok(`Spiel gefunden: ${g.name}`)).join('') : pf?.game ? ok(`Spiel gefunden: ${pf.game}`) : bad('Spiel nicht gefunden – ist Euro Truck Simulator 2 oder American Truck Simulator über Steam installiert?')}
        ${!pf ? '' : pf.state === 'installed' ? ok('Plugin installiert') : bad(pf.state === 'outdated' ? 'Plugin veraltet' : 'Plugin fehlt noch')}
        ${pf && pf.bundled && pf.state !== 'installed' ? '<button class="pill-button" data-focus data-action="install-plugin">Plugin installieren</button><p class="setup-note">Dafür muss das Spiel beendet sein.</p>' : ''}`;
    }
    if (step === 'control') {
      const choice = (value, icon, title, text) => `<button class="setup-choice ${settings.setupControl === value ? 'on' : ''}" data-focus data-action="setup-control" data-value="${value}">
          <span class="setup-choice-icon">${ICONS[icon] || ''}</span><b>${title}</b><small>${text}</small></button>`;
      return `<h2>Wie bedienst du das Display?</h2><p>Das lässt sich später jederzeit ändern.</p>
        <div class="setup-choices">
          ${choice('touch', 'display', 'Maus im Spiel', escape(`Mit ${hk.touch} wird die Maus im Spiel zum Finger auf dem Display.`))}
          ${choice('keys', 'keyboard', 'Tasten am Lenkrad', 'Hoch, runter, auswählen, zurück – unter Einstellungen › Tastenkürzel belegen.')}
          ${choice('phone', 'qr', 'Handy', 'Das Handy zeigt das Display und bedient es per Touch, im selben WLAN.')}
        </div>
        <p class="setup-note">${escape(`Größe und Lage des Bildschirms im Truck stellst du im Spiel im CabPlay-Menü ein (${hk.menu}).`)}</p>`;
    }
    if (step === 'voice') {
      const st = aiStatus;
      const dl = st?.downloading && st.downloading.model === 'supertonic' ? st.downloading : null;
      const pct = dl && dl.total ? Math.floor((dl.done / dl.total) * 100) : 0;
      return `<h2>Stimme</h2><p>Olivia liest Navi-Hinweise, den Disponenten und Antworten vor – natürlich klingend, lokal auf dem PC, ohne Internet. Empfohlen.</p>
        ${st?.supertonic ? ok('Olivia ist geladen') : dl ? `<div class="setup-row">${ICONS.reset || ''}<span>Olivia wird geladen … ${pct} %</span></div>`
          : `<button class="pill-button" data-focus data-action="ai-install" data-model="supertonic">Olivia laden${st?.supertonicSize ? ` (${Math.round(st.supertonicSize / 1e6)} MB)` : ''}</button>`}
        ${st?.supertonic ? '<button class="pill-button" data-focus data-action="test-voice">Hörprobe</button><p class="setup-note">Die Hörprobe spielt auf dem Truck-Display, wenn das Spiel läuft.</p>' : '<p class="setup-note">Ohne Download sprechen die Windows-Stimmen.</p>'}`;
    }
    if (step === 'map') {
      const ms = mapStatus;
      return `<h2>Karte</h2><p>Die Karte wird aus den Dateien deines Spiels erzeugt – mit allen DLCs, die du hast.</p>
        ${!ms ? '<div class="setup-row"><span>Wird geprüft …</span></div>' : ms.available && !ms.stale ? ok('Karte ist aktuell') : ms.available ? bad('Spiel wurde aktualisiert – Karte neu erzeugen empfohlen') : bad('Noch keine Karte')}
        ${ms && (!ms.available || ms.stale) ? '<button class="pill-button" data-focus data-action="update-map">Karte erzeugen</button><p class="setup-note">Dauert einige Minuten und läuft im Hintergrund weiter.</p>' : ''}`;
    }
    return `<h2>Fertig!</h2><p>Starte das Spiel – CabPlay erscheint auf dem Navi-Bildschirm im Truck und die App startet künftig mit dem Spiel.</p>
      <div class="setup-tips">
        <div>${ICONS.settings || ''}<span>Alles Weitere unter Einstellungen – oben gibt es eine Suche.</span></div>
        <div>${ICONS.maps || ''}<span>Ziel im Navi des Spiels setzen, die Karte übernimmt die Route.</span></div>
        <div>${ICONS.message || ''}<span>Die Einrichtung lässt sich unter Einstellungen › Info erneut starten.</span></div>
      </div>`;
  }

  function renderSetup() {
    if (setupStep < 0) return;
    const step = SETUP_STEPS[setupStep];
    const last = setupStep === SETUP_STEPS.length - 1;
    const bar = SETUP_STEPS.slice(0, -1).map((_, i) => `<span class="${i < setupStep ? 'done' : i === setupStep ? 'now' : ''}"></span>`).join('');
    const markup = `<div class="setup-card">
        ${last ? '' : `<div class="setup-bar">${bar}</div>`}
        <div class="setup-body">${setupBody(step)}</div>
        <div class="setup-nav">
          ${last ? '<span></span>' : `<button class="setup-skip" data-focus data-action="setup-skip">${setupStep === 0 ? 'Überspringen' : 'Einrichtung beenden'}</button>`}
          <div>
            ${setupStep > 0 && !last ? '<button class="pill-button secondary" data-focus data-action="setup-back">Zurück</button>' : ''}
            <button class="pill-button" data-focus data-action="${last ? 'setup-done' : 'setup-next'}">${last ? 'Los geht’s' : 'Weiter'}</button>
          </div>
        </div>
      </div>`;
    if (setupLayer.dataset.markup !== markup) {
      setupLayer.dataset.markup = markup;
      setupLayer.innerHTML = markup;
    }
  }

  function setupAction(action, value) {
    if (action === 'setup-next') setupStep = Math.min(SETUP_STEPS.length - 1, setupStep + 1);
    else if (action === 'setup-back') setupStep = Math.max(0, setupStep - 1);
    else if (action === 'setup-skip' || action === 'setup-done') return closeSetup();
    else if (action === 'setup-start') return openSetup();
    else if (action === 'setup-control') {
      // Handy: Handy-Steuerung einschalten (Adresse und QR-Code unter Einstellungen › Handy-Steuerung)
      changeSetting((s) => {
        s.setupControl = value;
        if (value === 'phone') s.remote = true;
      });
    }
    renderSetup();
  }
  // ------------------------------------------------------------------ Sport
  // Wie Apple Sports: links die Ligen, rechts der Spieltag als Ergebniskarten (live mit Minute und Torschützen) oder
  // die Tabelle; Formel 1 mit dem nächsten Rennwochenende, dem letzten Ergebnis und dem WM-Stand. Daten holt der
  // Hauptprozess (main/sports.js). Stern in der Tabelle = Lieblingsteam: Live-Ticker als Mitteilung.
  const SPORT_LEAGUES = [
    ['bl1', 'Bundesliga', 'BL', '#d20515'], ['bl2', '2. Bundesliga', '2', '#d20515'], ['bl3', '3. Liga', '3', '#55636e'],
    ['dfb', 'DFB-Pokal', 'P', '#00843d'], ['ffb1', 'Frauen-Bundesliga', 'FBL', '#d20515'],
    ['ucl', 'Champions League', 'CL', '#0b1e5b'], ['uel', 'Europa League', 'EL', '#f26a1b'], ['uecl', 'Conference League', 'ECL', '#19a24b'],
    ['pl', 'Premier League', 'PL', '#3d195b'], ['ech', 'Championship', 'EFL', '#1c2f5c'], ['la1', 'LaLiga', 'LL', '#ff4b44'],
    ['ita', 'Serie A', 'SA', '#0a8f3c'], ['fra', 'Ligue 1', 'L1', '#1a2b6d'], ['ned', 'Eredivisie', 'ED', '#e4002b'],
    ['por', 'Liga Portugal', 'LP', '#0c2340'], ['aut', 'Österreich Bundesliga', 'AT', '#ed1c24'], ['sui', 'Super League Schweiz', 'CH', '#d52b1e'],
    ['tur', 'Süper Lig', 'TR', '#e30a17'], ['unl', 'Nations League', 'NL', '#0b2f6b'], ['intl', 'Freundschaftsspiele', 'FS', '#2e7d32'],
    ['nfl', 'NFL', 'NFL', '#013369'], ['f1', 'Formel 1', 'F1', '#e10600'],
  ];
  // Ligen in der eigenen Reihenfolge (Einstellungen › Sport), neue Ligen hinten angehängt; sichtbare ohne ausgeblendete
  function sportOrdered() {
    const byId = new Map(SPORT_LEAGUES.map((l) => [l[0], l]));
    const ids = [...(settings.sportsOrder || []).filter((id) => byId.has(id)), ...SPORT_LEAGUES.map((l) => l[0]).filter((id) => !(settings.sportsOrder || []).includes(id))];
    return ids.map((id) => byId.get(id));
  }
  const sportVisible = () => {
    const list = sportOrdered().filter(([id]) => !(settings.sportsHidden || []).includes(id));
    return list.length ? list : sportOrdered().slice(0, 1);
  };
  // Nationalmannschaften (Länderspiele): ESPN liefert englische Namen und den Ländercode – gezeigt in der Sprache der App
  const SPORT_GB = {
    'gb-eng': { de: 'England', en: 'England', pl: 'Anglia', tr: 'İngiltere', zh: '英格兰', 'zh-hant': '英格蘭' },
    'gb-sct': { de: 'Schottland', en: 'Scotland', pl: 'Szkocja', tr: 'İskoçya', zh: '苏格兰', 'zh-hant': '蘇格蘭' },
    'gb-wls': { de: 'Wales', en: 'Wales', pl: 'Walia', tr: 'Galler', zh: '威尔士', 'zh-hant': '威爾斯' },
    'gb-nir': { de: 'Nordirland', en: 'Northern Ireland', pl: 'Irlandia Północna', tr: 'Kuzey İrlanda', zh: '北爱尔兰', 'zh-hant': '北愛爾蘭' },
  };
  const sportRegions = {};
  function sportCountry(code) {
    const lang = CarI18n.lang || 'de';
    if (SPORT_GB[code]) return SPORT_GB[code][lang] || SPORT_GB[code].en;
    try {
      const loc = lang === 'zh-hant' ? 'zh-Hant-HK' : lang;
      sportRegions[loc] ||= new Intl.DisplayNames([loc], { type: 'region' });
      const n = sportRegions[loc].of(code);
      return n && n !== code ? n : '';
    } catch {
      return '';
    }
  }
  function sportLocalize(d) {
    const fix = (t) => {
      if (!t?.country) return;
      const n = sportCountry(t.country);
      if (n) t.name = t.short = n;
    };
    for (const m of d?.matches || []) { fix(m.home); fix(m.away); }
    for (const r of d?.table || []) fix(r.team);
    return d;
  }
  const sportData = {}; // Liga -> Daten (oder { error })
  const sportAt = {}; // Liga -> letzter Abruf
  let sportView = 'games'; // games | table – bei F1: games = Rennen, table = WM-Stand
  const sportLeague = () => (sportVisible().some(([id]) => id === settings.sportsLeague) ? settings.sportsLeague : sportVisible()[0][0]);
  const sportFavs = () => settings.sportsTeams || [];
  const isFav = (league, teamId) => sportFavs().includes(`${league}:${teamId}`);
  // Für die Einstellungen: Lieblingsteams je Verein zusammengefasst (derselbe Verein in Liga, Pokal und Europapokal),
  // mit Name und Wappen aus den Ligadaten; fehlen die noch, werden sie nachgeladen (danach neu gezeichnet)
  function sportFavTeams() {
    const byTeam = new Map();
    for (const fav of sportFavs()) {
      const [l, id] = fav.split(':');
      const d = sportData[l];
      if (api && !d && l !== 'f1') loadLeague(l);
      const team = d?.table?.find((r) => String(r.team.id) === id)?.team
        || d?.matches?.flatMap((m) => [m.home, m.away]).find((x) => String(x.id) === id);
      const e = byTeam.get(id) || byTeam.set(id, { id, team: null, leagues: [], favs: [] }).get(id);
      if (team && (!e.team || (!e.team.logo && team.logo))) e.team = team;
      e.leagues.push(SPORT_LEAGUES.find(([x]) => x === l)?.[1] || l);
      e.favs.push(fav);
    }
    return [...byTeam.values()];
  }
  // Einzeln verfolgte Spiele („liga:spielId“) mit Heim – Gast, sobald die Liga geladen ist
  function sportFollowedMatches() {
    return (settings.sportsMatches || []).map((key) => {
      const [l, id] = key.split(':');
      if (api && !sportData[l] && l !== 'f1') loadLeague(l);
      const m = sportData[l]?.matches?.find((x) => String(x.id) === id);
      const league = SPORT_LEAGUES.find(([x]) => x === l)?.[1] || l;
      return { key, label: m ? `${m.home.name} – ${m.away.name}` : `Spiel ${id}`, league, m };
    });
  }
  // live oder Anpfiff in Kürze/gerade vorbei (Daten zeigen es noch nicht): schnell nachladen
  const sportLive = (d) => !!d?.matches?.some((m) => m.state === 'live' || m.state === 'ht' || (m.state === 'pre' && Date.parse(m.kickoff) - Date.now() < 10 * 60000 && Date.now() - Date.parse(m.kickoff) < 3 * 3600000));

  // Liga laden (live alle 15 s, sonst alle 5 Min.); danach Sport-App und Dashboard-Widget neu zeichnen
  function loadLeague(id, force = false) {
    if (!api?.sportsLeague) return;
    const age = Date.now() - (sportAt[id] || 0);
    if (!force && age < (sportLive(sportData[id]) ? 15000 : 5 * 60000)) return;
    sportAt[id] = Date.now();
    const done = (d) => {
      sportData[id] = sportLocalize(d);
      renderSport();
      renderSportWidget();
      // Sport-Einstellungen offen: Vereinsnamen und Wappen nachtragen
      if (screen === 'settings' && settingsStack[settingsStack.length - 1] === 'sports') rerenderSettings();
    };
    (id === 'f1' ? api.sportsF1() : api.sportsLeague(id)).then((d) => done(d || { error: 'leer' })).catch(() => done({ error: 'Netz' }));
  }
  function loadSport(force = false) {
    if (!api?.sportsLeague) return renderSport();
    loadLeague(sportLeague(), force);
    renderSport();
  }

  // ------------------------------------------------------------------ Dashboard-Widget „Live-Ticker“
  // Zeigt das verfolgte Spiel (Glocke), sonst ein Spiel der Lieblingsteams: läuft eins, das; sonst das nächste,
  // sonst das letzte. Antippen öffnet die Sport-App bei der Liga.
  function sportWidgetLeagues() {
    const ids = [...(settings.sportsMatches || []), ...sportFavs()].map((k) => k.split(':')[0]).filter((l) => l && l !== 'f1');
    return [...new Set(ids)];
  }
  function sportWidgetMatch() {
    const followed = new Set(settings.sportsMatches || []);
    const list = [];
    for (const l of sportWidgetLeagues()) {
      for (const m of sportData[l]?.matches || []) {
        const key = `${l}:${m.id}`;
        const mine = followed.has(key) || isFav(l, m.home.id) || isFav(l, m.away.id);
        if (mine) list.push({ m: { ...m, league: m.league || l }, followed: followed.has(key) });
      }
    }
    const t = (m) => new Date(m.kickoff).getTime() || 0;
    const live = list.filter(({ m }) => m.state === 'live' || m.state === 'ht').sort((a, b) => b.followed - a.followed);
    if (live.length) return live[0];
    const next = list.filter(({ m }) => m.state === 'pre').sort((a, b) => b.followed - a.followed || t(a.m) - t(b.m));
    if (next.length) return next[0];
    return list.filter(({ m }) => m.state === 'ft').sort((a, b) => t(b.m) - t(a.m))[0] || null;
  }
  function renderSportWidget() {
    if (!dashboardWidgets().includes('sport')) return;
    const pick = sportWidgetMatch();
    if (!pick) {
      const loading = sportWidgetLeagues().some((l) => !sportData[l]);
      list('sport-widget', `<div class="sw-empty">${loading ? 'Wird geladen …' : 'Spiel in der Sport-App antippen oder Lieblingsteam wählen'}</div>`);
      return;
    }
    const { m, followed } = pick;
    const meta = SPORT_LEAGUES.find(([x]) => x === m.league);
    const status = m.state === 'live' ? `<span class="sx-live">LIVE ${m.clock ? escape(m.clock) : m.minute ? `${m.minute >= 90 ? '90+' : m.minute}′` : ''}</span>`
      : m.state === 'ht' ? '<span class="sx-live">Halbzeit</span>'
        : m.state === 'ft' ? '<span>Ende</span>'
          : `<span>${sportTime(m.kickoff)}</span>`;
    const score = m.score ? `${m.score[0]}<i>–</i>${m.score[1]}` : '<i>–</i>';
    const goal = m.state !== 'pre' && m.goals.length ? m.goals[m.goals.length - 1] : null;
    const last = goal ? `<div class="sw-last">Tor ${escape(goal.name)}${goal.min ? ` ${goal.min}′` : ''}</div>` : `<div class="sw-last">${escape(meta ? meta[1] : '')}</div>`;
    list('sport-widget', `<button class="sw-match ${m.state}" data-focus data-action="sport-open" data-id="${m.league}">
      ${followed ? `<span class="sx-bell">${ICONS.messages}</span>` : ''}
      <div class="sw-team">${crest(m.home)}<b>${escape(m.home.short)}</b></div>
      <div class="sw-mid"><div class="sw-score">${score}</div><div class="sw-status">${status}</div></div>
      <div class="sw-team">${crest(m.away)}<b>${escape(m.away.short)}</b></div>
      ${last}</button>`);
  }
  function tickSportWidget() {
    if (!dashboardWidgets().includes('sport')) return;
    for (const l of sportWidgetLeagues()) loadLeague(l);
    renderSportWidget();
  }
  setInterval(tickSportWidget, 5000);
  setTimeout(tickSportWidget, 1500);

  // Anstoß: „Heute 18:30“, „Morgen 20:45“, sonst mit Datum „Di 21.10. 18:45“
  const sportTime = (iso) => {
    const d = new Date(iso);
    const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / 86400000);
    if (days === 0) return `Heute ${clock}`;
    if (days === 1) return `Morgen ${clock}`;
    if (days === -1) return `Gestern ${clock}`;
    return `${DAYS[(d.getDay() + 6) % 7]} ${d.getDate()}.${d.getMonth() + 1}. ${clock}`;
  };
  const crest = (team) => (team?.logo ? `<img class="sx-crest" src="${escape(team.logo)}" alt="" loading="lazy">` : '<span class="sx-crest"></span>');
  const star = (on) => `<span class="sx-star ${on ? 'on' : ''}">${on ? '★' : '☆'}</span>`;

  function matchCard(m) {
    const fav = isFav(m.league, m.home.id) || isFav(m.league, m.away.id);
    const status = m.state === 'live' ? `<span class="sx-live">LIVE ${m.clock ? escape(m.clock) : m.minute ? `${m.minute >= 90 ? '90+' : m.minute}′` : ''}</span>`
      : m.state === 'ht' ? '<span class="sx-live">Halbzeit</span>'
        : m.state === 'ft' ? `<span>Ende${m.ht ? ` · HZ ${m.ht[0]}:${m.ht[1]}` : ''}</span>`
          : `<span>${sportTime(m.kickoff)}</span>`;
    const score = m.score ? `<b class="${m.score[0] > m.score[1] ? 'win' : ''}">${m.score[0]}</b><i>–</i><b class="${m.score[1] > m.score[0] ? 'win' : ''}">${m.score[1]}</b>` : '<i class="sx-vs">–</i>';
    // Torschützen: nur letzte drei, damit die Karte nicht wächst
    const goals = m.goals.slice(-3).map((g) => `<span class="${g.side}">${escape(g.name.split(' ').pop() || '')}${g.min ? ` ${g.min}′` : ''}</span>`).join('');
    // Antippen: Live-Ticker für dieses Spiel an/aus (nur solange es nicht vorbei ist) – Glocke oben rechts
    const followKey = `${m.league}:${m.id}`;
    const follow = (settings.sportsMatches || []).includes(followKey);
    const tap = m.state !== 'ft' ? ` data-focus data-action="sport-follow" data-id="${followKey}"` : '';
    const tag = tap ? 'button' : 'div';
    return `<${tag} class="sx-card glass ${m.state}${fav ? ' fav' : ''}${follow ? ' follow' : ''}"${tap}>
      ${follow ? `<span class="sx-bell">${ICONS.messages}</span>` : ''}
      <div class="sx-team">${crest(m.home)}<b>${escape(m.home.short)}</b></div>
      <div class="sx-mid"><div class="sx-score">${score}</div><div class="sx-status">${status}</div></div>
      <div class="sx-team">${crest(m.away)}<b>${escape(m.away.short)}</b></div>
      ${goals && m.state !== 'pre' ? `<div class="sx-goals">${goals}</div>` : ''}
    </${tag}>`;
  }

  // Tabellenzonen der deutschen Ligen (Champions League, Europa-/Conference League, Aufstieg, Relegation, Abstieg)
  const ZONES = {
    bl1: (p, n) => (p <= 4 ? 'cl' : p === 5 ? 'el' : p === 6 ? 'ecl' : p === n - 2 ? 'rel' : p > n - 2 ? 'down' : ''),
    bl2: (p, n) => (p <= 2 ? 'up' : p === 3 ? 'rel' : p === n - 2 ? 'rel' : p > n - 2 ? 'down' : ''),
    bl3: (p, n) => (p <= 2 ? 'up' : p === 3 ? 'rel' : p > n - 4 ? 'down' : ''),
  };
  function tableHtml(d) {
    const zone = ZONES[d.id] || (() => '');
    const nfl = d.id === 'nfl';
    // NFL: je Conference (AFC/NFC) eine Überschrift, Siege/Niederlagen/Unentschieden, Punkte für:gegen, Siegquote
    let group = '';
    const rows = d.table.map((r) => (r.group && r.group !== group ? `<div class="sx-row head sx-group"><b class="sx-name">${escape((group = r.group))}</b></div>` : '') + `<button class="sx-row ${zone(r.pos, d.table.length)} ${isFav(d.id, r.team.id) ? 'fav' : ''}" data-focus data-action="sport-fav" data-id="${d.id}:${r.team.id}">
      <span class="sx-pos">${r.pos}</span>${crest(r.team)}<b class="sx-name">${escape(r.team.short)}</b>
      <span>${r.played}</span><span>${r.won}</span><span>${r.draw}</span><span>${r.lost}</span><span class="sx-goaldiff">${r.goals}:${r.against}</span><span>${r.diff > 0 ? '+' : ''}${r.diff}</span><b class="sx-pts">${r.points}</b>${star(isFav(d.id, r.team.id))}
    </button>`).join('');
    return `<div class="sx-table glass" data-scroll-area>
      <div class="sx-row head"><span class="sx-pos">#</span><span class="sx-crest"></span><b class="sx-name">${nfl ? 'Team' : 'Verein'}</b><span>Sp</span><span>S</span><span>U</span><span>N</span><span class="sx-goaldiff">${nfl ? 'Punkte' : 'Tore'}</span><span>Diff</span><b class="sx-pts">${nfl ? 'Quote' : 'Pkt'}</b><span class="sx-star"></span></div>
      ${rows}</div>`;
  }

  function f1Html(d) {
    if (sportView === 'table') {
      const max = d.drivers[0]?.points || 1;
      const drv = d.drivers.slice(0, 12).map((r) => `<div class="f1-row"><span class="sx-pos">${r.pos}</span><i class="f1-bar" style="--tc:${r.color}"></i><b>${escape(r.family || r.name)}</b><small>${escape(r.team)}</small><span class="f1-meter"><i style="width:${Math.round((r.points / max) * 100)}%;--tc:${r.color}"></i></span><b class="sx-pts">${r.points}</b></div>`).join('');
      const tmax = d.teams[0]?.points || 1;
      const teams = d.teams.map((r) => `<div class="f1-row"><span class="sx-pos">${r.pos}</span><i class="f1-bar" style="--tc:${r.color}"></i><b>${escape(r.name)}</b><span class="f1-meter"><i style="width:${Math.round((r.points / tmax) * 100)}%;--tc:${r.color}"></i></span><b class="sx-pts">${r.points}</b></div>`).join('');
      return `<div class="f1-grid"><div class="sx-panel glass"><div class="sx-panel-title">Fahrer-WM ${escape(d.season)}</div>${drv}</div><div class="sx-panel glass"><div class="sx-panel-title">Konstrukteure</div>${teams}</div></div>`;
    }
    const n = d.next;
    const now = Date.now();
    let next = '<div class="sx-panel glass"><div class="sx-empty">Saison beendet</div></div>';
    if (n) {
      const ms = Date.parse(n.race) - now;
      // Countdown bis zum Rennen wie Apple Sports: Tage, Stunden, Minuten
      const left = Math.max(0, ms);
      const count = ms <= 0 ? '<div class="f1-count live"><b>LIVE</b></div>'
        : `<div class="f1-count">${[[Math.floor(left / 86400000), 'Tage'], [Math.floor(left / 3600000) % 24, 'Std.'], [Math.floor(left / 60000) % 60, 'Min.']]
          .map(([v, unit]) => `<span><b>${v}</b><small>${unit}</small></span>`).join('')}</div>`;
      const sessions = n.sessions.map((s) => {
        const t = Date.parse(s.at);
        const st = t + 2 * 3600000 < now ? 'done' : t <= now ? 'now' : '';
        return `<div class="f1-session ${st}"><span>${escape(s.label)}</span><b>${sportTime(s.at)}</b></div>`;
      }).join('');
      next = `<div class="sx-panel glass f1-next">
        <div class="f1-round">Runde ${n.round}</div>
        <div class="f1-gp">${escape(n.name)}</div><div class="f1-place">Grand Prix · ${escape(n.circuit)}</div><small class="f1-place">${escape(n.place)}</small>
        ${count}
        <div class="f1-sessions">${sessions}</div></div>`;
    }
    let last = '';
    if (d.last) {
      const [p1, p2, p3] = d.last.results;
      const step = (r, cls) => (r ? `<div class="f1-step ${cls}" style="--tc:${r.color}"><b>${escape(r.code)}</b><small>${escape(r.team)}</small><span>${r.pos}</span></div>` : '');
      const rest = d.last.results.slice(3, 10).map((r) => `<div class="f1-row"><span class="sx-pos">${r.pos}</span><i class="f1-bar" style="--tc:${r.color}"></i><b>${escape(r.family || r.name)}</b><small>${escape(r.time || '')}</small><b class="sx-pts">${r.points ? `+${r.points}` : ''}</b></div>`).join('');
      last = `<div class="sx-panel glass"><div class="sx-panel-title">Letztes Rennen · ${escape(d.last.name)}</div>
        <div class="f1-podium">${step(p2, 'p2')}${step(p1, 'p1')}${step(p3, 'p3')}</div>${rest}</div>`;
    }
    return `<div class="f1-grid">${next}${last}</div>`;
  }

  // Ligen per Ziehen sortieren – in der Sport-App kurz halten (0,4 s) und ziehen, in den Einstellungen am Griff (≡)
  // sofort. Die Reihenfolge landet in sportsOrder (ausgeblendete Ligen behalten ihren Platz dahinter).
  let sortDrag = null;
  let sortSwallowClick = false;
  function sortStart(el, e) {
    const listEl = el.parentElement;
    const r = el.getBoundingClientRect();
    sortDrag = { el, listEl, grab: e.clientY - r.top, ty: 0 };
    el.classList.add('sx-dragging');
    listEl.classList.add('sx-sorting');
  }
  window.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element)) return;
    const handle = e.target.closest('.sx-grip');
    const item = handle ? handle.closest('[data-sort-id]') : e.target.closest('.sx-rail .sx-league');
    if (!item) return;
    if (handle) {
      e.preventDefault();
      sortStart(item, e);
      return;
    }
    const x = e.clientX;
    const y = e.clientY;
    const timer = setTimeout(() => sortStart(item, { clientY: y }), 400);
    const cancel = (ev) => {
      if (ev.type === 'pointermove' && Math.hypot(ev.clientX - x, ev.clientY - y) < 8) return;
      clearTimeout(timer);
      window.removeEventListener('pointermove', cancel, true);
      window.removeEventListener('pointerup', cancel, true);
    };
    window.addEventListener('pointermove', cancel, true);
    window.addEventListener('pointerup', cancel, true);
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!sortDrag) return;
    e.stopPropagation(); // nicht gleichzeitig die Liste scrollen
    const { el, listEl } = sortDrag;
    const items = [...listEl.children].filter((c) => c !== el && c.matches('[data-sort-id], .sx-league'));
    // an die Stelle schieben, deren Mitte der Zeiger überschritten hat
    const before = items.find((c) => {
      const r = c.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    }) || (items.length ? items[items.length - 1].nextElementSibling : null);
    if (before !== el && el.nextElementSibling !== before) listEl.insertBefore(el, before);
    // dem Finger folgen: Abstand zur natürlichen Lage (ohne Verschiebung) ausgleichen
    const natural = el.getBoundingClientRect().top - sortDrag.ty;
    sortDrag.ty = e.clientY - sortDrag.grab - natural;
    el.style.transform = `translateY(${sortDrag.ty}px)`;
    // am Rand mitscrollen
    const lr = listEl.getBoundingClientRect();
    if (e.clientY < lr.top + 30) listEl.scrollTop -= 8;
    else if (e.clientY > lr.bottom - 30) listEl.scrollTop += 8;
  }, true);
  window.addEventListener('pointerup', (e) => {
    if (!sortDrag) return;
    e.stopPropagation();
    const { el, listEl } = sortDrag;
    sortDrag = null;
    el.classList.remove('sx-dragging');
    listEl.classList.remove('sx-sorting');
    el.style.transform = '';
    sortSwallowClick = true;
    setTimeout(() => (sortSwallowClick = false), 50);
    const shown = [...listEl.children].map((c) => c.dataset.sortId || c.dataset.id).filter(Boolean);
    const rest = sportOrdered().map((l) => l[0]).filter((id) => !shown.includes(id));
    changeSetting((s) => (s.sportsOrder = [...shown, ...rest]));
    renderSport();
    if (el.dataset.sortId) rerenderSettings();
  }, true);
  // der Klick nach dem Loslassen soll keine Liga öffnen
  window.addEventListener('click', (e) => {
    if (!sortSwallowClick) return;
    sortSwallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  if (demoMode) window.__sortDrag = () => !!sortDrag; // Test

  function renderSport() {
    if (!nodes('sx-title').length || sortDrag) return;
    const id = sportLeague();
    const meta = SPORT_LEAGUES.find(([l]) => l === id);
    list('sx-rail', sportVisible().map(([l, name, short, color]) => `<button class="sx-league ${l === id ? 'on' : ''}" data-focus data-action="sport-league" data-id="${l}">
      <span class="sx-badge" data-no-i18n style="--lc:${color}">${short}</span><b>${name}</b>${sportLive(sportData[l]) ? '<i class="sx-dot"></i>' : ''}</button>`).join(''));
    const d = sportData[id];
    text('sx-title', meta[1]);
    text('sx-sub', id === 'f1' ? (d?.season ? `Saison ${d.season}` : '') : d?.round ? `${d.round}${d.community ? ' · Daten der Community, teils verspätet' : ''}` : '');
    list('sx-tabs', (id === 'f1' ? [['games', 'Rennen'], ['table', 'WM-Stand']] : [['games', 'Spiele'], ['table', 'Tabelle']])
      .map(([v, label]) => `<button class="seg ${sportView === v ? 'on' : ''}" data-focus data-action="sport-view" data-id="${v}">${label}</button>`).join(''));
    let body;
    if (!api) body = '<div class="sx-empty">Sport braucht die App (Internet).</div>';
    else if (!d) body = '<div class="sx-empty">Wird geladen …</div>';
    else if (d.error) body = '<div class="sx-empty">Keine Verbindung zum Sportdienst. Versucht es gleich erneut.</div>';
    else if (id === 'f1') body = f1Html(d);
    else if (sportView === 'table') body = d.table?.length ? tableHtml(d) : '<div class="sx-empty">Keine Tabelle (K.-o.-Runde)</div>';
    else body = d.matches?.length ? `<div class="sx-grid" data-scroll-area>${d.matches.map(matchCard).join('')}</div>` : '<div class="sx-empty">Keine Spiele</div>';
    list('sx-body', body);
    // vorbei: einzeln verfolgte Spiele aus der Liste nehmen (der Ticker hat den Abpfiff gemeldet)
    const done = (settings.sportsMatches || []).filter((f) => {
      const [l, idText] = f.split(':');
      return sportData[l]?.matches?.some((x) => String(x.id) === idText && x.state === 'ft');
    });
    if (done.length) changeSetting((s) => (s.sportsMatches = (s.sportsMatches || []).filter((f) => !done.includes(f))));
    toggle('sx-hint', 'hidden', !(id !== 'f1' && sportView === 'table' && !sportFavs().some((f) => f.startsWith(`${id}:`))));
  }

  // Logo nicht ladbar: Platz frei lassen statt Symbol für ein kaputtes Bild (Inline-onerror verbietet die CSP)
  document.addEventListener('error', (e) => {
    // auch das Wappen in den Einstellungen (Lieblingsvereine) – ohne Wikimedia (China) sonst ein kaputtes Bild
    if (e.target instanceof HTMLImageElement && (e.target.classList.contains('sx-crest') || e.target.parentElement?.classList.contains('sx-set-crest'))) e.target.style.visibility = 'hidden';
  }, true);

  function sportAction(action, value) {
    if (action === 'sport-league' || action === 'sport-open') {
      if (value !== sportLeague()) changeSetting((s) => (s.sportsLeague = value));
      if (action === 'sport-open') {
        // vom Dashboard-Widget: Sport-App bei dieser Liga, Spiele-Ansicht
        sportView = 'games';
        showScreen('sports');
      }
      loadSport();
      renderSport();
    } else if (action === 'sport-view') {
      sportView = value === 'table' ? 'table' : 'games';
      renderSport();
    } else if (action === 'sport-follow') {
      const on = (settings.sportsMatches || []).includes(value);
      const [l, idText] = value.split(':');
      const m = sportData[l]?.matches?.find((x) => String(x.id) === idText);
      changeSetting((s) => (s.sportsMatches = on ? (s.sportsMatches || []).filter((f) => f !== value) : [...(s.sportsMatches || []), value].slice(-10)));
      if (m) showToast({ open: 'sports', kind: 'Sport', title: on ? 'Live-Ticker aus' : 'Live-Ticker an', text: `${m.home.short} – ${m.away.short}` });
      renderSport();
    } else if (action === 'sport-hide') {
      const hidden = settings.sportsHidden || [];
      changeSetting((s) => (s.sportsHidden = hidden.includes(value) ? hidden.filter((x) => x !== value) : [...hidden, value]));
      rerenderSettings();
    } else if (action === 'sport-order-reset') {
      changeSetting((s) => { s.sportsOrder = []; s.sportsHidden = []; });
      rerenderSettings();
    } else if (action === 'sport-fav') {
      const on = sportFavs().includes(value);
      changeSetting((s) => (s.sportsTeams = on ? (s.sportsTeams || []).filter((f) => f !== value) : [...(s.sportsTeams || []), value].slice(-12)));
      renderSport();
    } else if (action === 'sport-fav-remove') {
      // Einstellungen: Verein in allen Wettbewerben entfernen (value = "liga:id,liga:id")
      const drop = new Set(String(value).split(','));
      changeSetting((s) => (s.sportsTeams = (s.sportsTeams || []).filter((f) => !drop.has(f))));
      renderSport();
      rerenderSettings();
    } else if (action === 'sport-unfollow') {
      changeSetting((s) => (s.sportsMatches = (s.sportsMatches || []).filter((f) => f !== value)));
      renderSport();
      rerenderSettings();
    }
  }

  // Live-Ticker vom Hauptprozess (Tor, Anpfiff, Halbzeit, Abpfiff, F1)
  function onSportsEvent(e) {
    if (!e?.title) return;
    // Länderspiele: englische Ländernamen von ESPN durch die Namen in der Sprache der App ersetzen (längere zuerst)
    let title = e.title, text = e.text || '';
    if (Array.isArray(e.countries)) {
      const pairs = e.countries.flatMap(([name, short, code]) => { const n = sportCountry(code); return n ? [[name, n], [short, n]] : []; })
        .filter(([from]) => from).sort((a, b) => b[0].length - a[0].length);
      const names = new Map(pairs);
      // Spielstand („Tor! Germany 1:0 France“, „Germany 2:1 France“): Namen als ganze Wörter ersetzen
      const edge = (c) => c === undefined || !/\p{L}/u.test(c);
      const words = (str) => {
        for (const [from, to] of pairs) {
          let at = str.indexOf(from);
          while (at >= 0) {
            if (edge(str[at - 1]) && edge(str[at + from.length])) {
              str = str.slice(0, at) + to + str.slice(at + from.length);
              at = str.indexOf(from, at + to.length);
            } else at = str.indexOf(from, at + 1);
          }
        }
        return str;
      };
      const score = /\d+:\d+|–:–/;
      title = words(title);
      // Text: Abschnitte, die genau ein Mannschaftsname sind („Germany · Musiala · 12. Min.“, „Germany – France“), oder ein
      // Spielstand – ein Spieler wie „Jordan Henderson“ bleibt, wenn Jordanien spielt
      text = text.split(/( · | – )/).map((part) => names.get(part) ?? (score.test(part) ? words(part) : part)).join('');
    }
    showToast({ open: 'sports', kind: 'Sport', title, text });
    sportAt[sportLeague()] = 0; // Anzeige gleich nachziehen
    if (screen === 'sports') loadSport(true);
  }
  if (demoMode) window.__sportEvent = onSportsEvent; // Test: Mitteilung des Live-Tickers auslösen
  if (demoMode) window.__toast = showToast; // Test: beliebige Mitteilung
  if (demoMode) window.__show = (id) => showScreen(id); // Test: Bildschirm wechseln (tools/perf-test.js)
  if (demoMode) window.__setting = (k, v) => { settings[k] = v; }; // Test: Einstellung direkt setzen (Karte, Zoom …)
  if (demoMode) window.__change = (fn) => changeSetting(fn); // Test: Einstellung ändern und neu zeichnen
  // ------------------------------------------------------------------ Bedienung
  let demo = null;
  const sendMedia = (cmd) => (demo ? demo.command(cmd) : api?.media(cmd));

  function applySnapshot(result) {
    if (!result) return;
    customWallpaper = result.customWallpaper;
    customIcons = result.customIcons || {};
    wallpaperFiles = result.wallpaperFiles || {};
    applySettings(result.settings, false);
  }

  async function pickWallpaper() {
    if (api) applySnapshot(await api.pickWallpaper());
  }

  async function pickIcon(id) {
    if (api) applySnapshot(await api.pickIcon(id));
  }

  async function resetIcon(id) {
    if (api) applySnapshot(await api.resetIcon(id));
  }

  async function resetAll() {
    if (role === 'editor' && !ask('Alle Einstellungen und eigenen Icons auf Standard zurücksetzen?')) return;
    if (api) applySnapshot(await api.resetSettings());
    else applySettings(null, false);
  }

  // Liquid Glass reagiert auf Berührung: kurz aufhellen und leicht eindrücken
  document.addEventListener('pointerdown', (e) => {
    const el = e.target instanceof Element && !editor.editing ? e.target.closest('[data-focus]') : null;
    if (!el) return;
    el.classList.add('pressed');
    let glass = el.closest('.glass');
    if (glass && glass !== el && !glass.hasAttribute('data-focus')) glass = null;
    glass = glass || el.querySelector(':scope > .glass');
    if (glass) {
      const r = glass.getBoundingClientRect();
      glass.style.setProperty('--tx', `${e.clientX - r.left}px`);
      glass.style.setProperty('--ty', `${e.clientY - r.top}px`);
      glass.classList.add('lit');
    }
    const release = () => setTimeout(() => {
      el.classList.remove('pressed');
      glass?.classList.remove('lit');
    }, 90);
    document.addEventListener('pointerup', release, { once: true });
    document.addEventListener('pointercancel', release, { once: true });
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('button, [data-open]');
    if (!el || el.closest('#popover') || el.closest('#editbar')) return;
    const d = el.dataset;
    if (el.closest('.map-menu') && (d.toggle || d.choose || d.volumeStep)) {
      if (d.toggle) quietSetting((s) => (s[d.toggle] = !s[d.toggle]));
      else if (d.choose) quietSetting((s) => setOption(s, d.choose, d.value));
      else {
        const [key, step] = d.volumeStep.split(':');
        quietSetting((s) => (s[key] = Math.max(0, Math.min(100, (s[key] || 0) + Number(step)))));
      }
      return;
    }
    if (d.mapCmd) mapCommand(d.mapCmd);
    else if (d.action === 'home-toggle') {
      if (homeLongPressed) homeLongPressed = false;
      else pressHome();
    }
    else if (d.pageDot) setHomePage(Number(d.pageDot));
    else if (d.stackDot) {
      const [slot, i] = d.stackDot.split(':').map(Number);
      setStack(slot, i);
    } else if (d.stackToggle) {
      const [slot, type] = d.stackToggle.split(':');
      changeSetting((s) => {
        const list = s.dashboard.stacks[slot] || (s.dashboard.stacks[slot] = []);
        const i = list.indexOf(type);
        if (i >= 0) list.splice(i, 1);
        else list.push(type);
      }, `[data-stack-toggle="${d.stackToggle}"]`);
    }
    else if (d.action === 'radar-report') reportCamera();
    else if (d.action === 'overlay-reset') {
      // Anzeigen auf der Karte wieder an ihre Plätze ab Werk (alle Stile), ausgeblendete bleiben aus
      changeSetting((s) => {
        for (const k of Object.keys(catalog.DEFAULTS.overlays)) if (s.overlays[k] !== 'hidden') s.overlays[k] = catalog.DEFAULTS.overlays[k];
        s.overlayFree = { banner: false, speed: false };
      }, '[data-action="overlay-reset"]');
    }
    else if (d.action === 'dash-reset') {
      // Dashboard wie ab Werk (Widgets und Stapel)
      changeSetting((s) => (s.dashboard = JSON.parse(JSON.stringify(catalog.DEFAULTS.dashboard))), '[data-action="dash-reset"]');
    } else if (d.action === 'apps-reset') {
      // eigene Namen und Farben der Apps weg (eigene Bilder bleiben – die setzt „Standard-Icon“ je App zurück)
      changeSetting((s) => (s.apps = {}), '[data-action="apps-reset"]');
    }
    else if (d.action === 'mirror-mod-truck') {
      // Kameraspiegel per Mod für den aktuellen Lkw an/aus (Blinker-Kamera auch bei Lkw ohne Kameraspiegel im Spiel)
      const id = mirrorTruck();
      if (id) changeSetting((s) => {
        const list = Array.isArray(s.mirrorCamTrucks) ? s.mirrorCamTrucks.filter((x) => x !== id) : [];
        if (!(settings.mirrorCamTrucks || []).includes(id)) list.push(id);
        s.mirrorCamTrucks = list;
      }, '[data-action="mirror-mod-truck"]');
    }
    else if (d.action === 'cluster-widget') {
      changeSetting((s) => {
        const list = Array.isArray(s.clusterWidgetList) ? [...s.clusterWidgetList] : [];
        const i = list.indexOf(d.widget);
        if (i >= 0) list.splice(i, 1);
        else list.push(d.widget);
        s.clusterWidgetList = ['rest', 'delivery', 'range', 'fuel'].filter((w) => list.includes(w)); // feste Reihenfolge
      }, `[data-action="cluster-widget"][data-widget="${d.widget}"]`);
    } else if (d.action === 'cluster-cycle') {
      changeSetting((s) => {
        const list = Array.isArray(s.clusterCycle) ? [...s.clusterCycle] : [];
        const i = list.indexOf(d.design);
        if (i >= 0 && list.length > 1) list.splice(i, 1); // das letzte bleibt
        else if (i < 0) list.push(d.design);
        s.clusterCycle = list;
      }, `[data-action="cluster-cycle"][data-design="${d.design}"]`);
    } else if (d.action === 'radar-sound') changeSetting((s) => (s.radarSound = !s.radarSound), '[data-action="radar-sound"]');
    else if (d.action === 'radar-clear') {
      if (role !== 'editor' || ask('Alle gemeldeten und gelernten Blitzer löschen?')) changeSetting((s) => (s.cameras = s.cameras.filter((c) => (c.game || 'ets2') !== currentGame.id))); // nur die des laufenden Spiels
    } else if (d.camRemove) {
      const [x, z] = d.camRemove.split('|').map(Number);
      changeSetting((s) => (s.cameras = s.cameras.filter((c) => !(c.x === x && c.z === z && (c.game || 'ets2') === currentGame.id))));
    } else if (d.videoPick) {
      videoStopped = false;
      changeSetting((s) => (s.video.current = Number(d.videoPick)), `[data-video-pick="${d.videoPick}"]`);
    } else if (d.videoRemove) {
      if (Number(d.videoRemove) === settings.video.current) videoStopped = true;
      if (settings.video.items.length <= 1) videoEdit = false;
      changeSetting((s) => {
        const i = Number(d.videoRemove);
        s.video.items.splice(i, 1);
        if (s.video.current >= s.video.items.length || s.video.current === i) s.video.current = s.video.items.length ? 0 : -1;
        else if (s.video.current > i) s.video.current--;
      });
    } else if (d.action === 'video-driving') changeSetting((s) => (s.video.driving = !s.video.driving), '[data-action="video-driving"]');
    else if (d.action === 'video-clear-history') videoClear('history');
    else if (d.action === 'video-clear-cookies') videoClear('cookies');
    else if (d.action === 'video-web') changeSetting((s) => (s.video.web = !s.video.web), '[data-action="video-web"]');
    else if (d.action === 'video-pause-call') changeSetting((s) => (s.video.pauseOnCall = !s.video.pauseOnCall), '[data-action="video-pause-call"]');
    else if (d.action === 'video-pip') changeSetting((s) => (s.video.pip = !s.video.pip), '[data-action="video-pip"]');
    else if (d.action === 'video-pip-close') {
      videoPip = false;
      syncVideo();
    } else if (d.action === 'video-pip-open') showScreen('video');
    else if (d.action === 'video-pip-size') cyclePipSize();
    else if (d.action === 'video-pip-size-next') changeSetting((s) => (s.video.pipSize = nextPipSize(s.video.pipSize)), '[data-action="video-pip-size-next"]');
    else if (d.action === 'video-start') {
      videoStopped = false;
      syncVideo();
    } else if (d.action === 'video-toggle') videoToggle();
    else if (d.action === 'video-seek') videoSeekTap(Number(d.step) || 0);
    else if (d.action === 'video-rate') videoRateNext();
    else if (d.action === 'video-vol') videoVolumeStep(Number(d.step));
    else if (d.action === 'video-full') setVideoFull(!videoFull);
    else if (d.sheetPage) {
      mapSheetPage = d.sheetPage;
      rerenderMapSheet();
    } else if (d.action === 'sheet-back') goBack();
    else if (d.areaStep) {
      // Sichtbarer Bereich je Lkw: Navi-Display (Anzeige & Helligkeit) oder Kombiinstrument (data-area-kind="cluster")
      const id = String(telemetry?.truckId || '').toLowerCase().replace(/^vehicle\./, '');
      const [key, def] = d.areaKind === 'cluster' ? ['clusterAreas', 'CLUSTER_AREAS'] : ['displayAreas', 'DISPLAY_AREAS'];
      if (id) {
        const [k, step] = d.areaStep.split(':');
        changeSetting((st) => {
          const base = (st[key] || {})[id] || window.CarAreaDefault(def, id) || { l: 0, t: 0, r: 0, b: 0 };
          const a = { ...base };
          a[k] = Math.max(0, Math.min(45, (a[k] || 0) + Number(step)));
          st[key] = { ...(st[key] || {}), [id]: a };
        }, `[data-area-kind="${d.areaKind || 'display'}"][data-area-step="${d.areaStep}"]`);
      }
    } else if (d.action === 'area-reset') {
      const id = String(telemetry?.truckId || '').toLowerCase().replace(/^vehicle\./, '');
      const key = d.areaKind === 'cluster' ? 'clusterAreas' : 'displayAreas';
      if (id) changeSetting((st) => { st[key] = { ...(st[key] || {}) }; delete st[key][id]; });
    } else if (d.volumeStep) {
      const [key, step] = d.volumeStep.split(':');
      changeSetting((st) => (st[key] = Math.max(0, Math.min(100, (st[key] || 0) + Number(step)))));
      if (key === 'volumeRadio') renderRadio();
    } else if (d.action === 'map-report') {
      reportMapIssue(d.kind || 'other');
    } else if (d.action === 'map-reports-open') {
      api?.mapReportsOpen?.();
    } else if (d.action === 'map-report-issue') {
      api?.mapReportIssue?.();
    } else if (d.action === 'lanes-share') {
      api?.laneShare?.().then((ok) => { if (!ok) showToast({ icon: 'turn-slight', color: 'purple', title: 'Spurdaten', text: 'Noch nichts zu teilen' }); });
    } else if (d.action === 'ultra-next') ultraNextDesign();
    else if (d.action === 'ultra-settings') openUltraSettings();
    else if (d.action === 'map-settings') {
      mapSheetOpen = false;
      showScreen('settings');
      openSettingsPage('maps');
      settingsReturn = 'maps';
    }
    else if (d.action === 'test-voice') {
      if (role === 'game' || demoMode) speak('So klingen die Ansagen. Gute Fahrt!');
      else api?.navTest?.('voice');
    } else if (d.action === 'test-alert') {
      if (role === 'game' || demoMode) beep('camera');
      else api?.navTest?.('alert');
    } else if (d.action === 'test-announce') {
      if (role === 'game' || demoMode) busAnnounceTest();
      else api?.navTest?.('announce');
    }
    else if (d.action === 'video-edit') {
      videoEdit = !videoEdit;
      render();
    } else if (d.action === 'video-clear') {
      if (role !== 'editor' || ask('Alle gespeicherten Videos löschen?')) {
        videoEdit = false;
        changeSetting((s) => {
          s.video.items = [];
          s.video.current = -1;
        });
      }
    }
    else if (d.action === 'video-paste') {
      // Editor: eingetippter Link, sonst die Zwischenablage des PCs (Link am PC kopieren, im Truck „Link einfügen“)
      const input = stage.querySelector('[data-input="video-link-app"]');
      const typed = input && input.value.trim();
      const done = (ok, empty) => showToast(ok
        ? { icon: 'video', color: 'red', title: 'Video hinzugefügt', text: 'Wird abgespielt' }
        : { icon: 'video', color: 'gray', title: 'Kein Video-Link', text: empty ? 'Zwischenablage ist leer – Link am PC oder Handy kopieren' : 'Bitte einen YouTube-, Twitch- oder TikTok-Link kopieren' });
      if (typed) api?.addVideo(typed).then((ok) => done(ok, false));
      else if (api?.pasteVideo) api.pasteVideo().then((r) => done(r.ok, r.empty));
    }
    else if (d.action === 'video-stop') {
      videoStopped = true;
      syncVideo();
      rerenderVideoSlot();
    } else if (d.action === 'video-add') {
      const input = stage.querySelector('[data-input="video-link"]');
      const value = input ? input.value : '';
      if (!catalog.parseVideo(value, { web: settings.video.web }) && !catalog.isShortVideoLink(value)) {
        videoError = 'Das ist kein YouTube-, Twitch- oder TikTok-Link.';
        rerenderSettings('[data-input="video-link"]');
      } else {
        videoError = '';
        // Kurzlinks (TikTok-App) löst die App erst auf: klappt das nicht (offline, Link tot), wie ein falscher Link melden
        api?.addVideo(value).then((ok) => {
          if (ok) return;
          videoError = 'Das ist kein YouTube-, Twitch- oder TikTok-Link.';
          rerenderSettings('[data-input="video-link"]');
        });
      }
    } else if (d.action === 'spotify-connect') {
      const input = stage.querySelector('[data-input="spotify-id"]');
      api?.spotifyConnect(input ? input.value : '').then((st) => {
        spotifyStatus = st;
        rerenderSettings();
      });
    } else if (d.action === 'spotify-disconnect') {
      api?.spotifyDisconnect().then((st) => {
        spotifyStatus = st;
        spotifyLib = null;
        rerenderSettings();
      });
    } else if (d.spPlay) playSpotify(d.spPlay);
    else if (d.spOpen) openPlaylist(d.spOpen);
    else if ('spBack' in d) {
      libDetail = null;
      renderLibrary();
    } else if (d.spShuffle) playSpotify(d.spShuffle, { shuffle: true });
    else if (d.spCmd) spotifyCommand(d.spCmd);
    else if (d.action === 'sp-search') runSpotifySearch();
    else if (d.spTrack && libDetail) playSpotify(libDetail.uri, { track: d.spTrack, shuffle: false });
    else if (d.libTab) {
      libTab = d.libTab;
      libDetail = null;
      for (const b of stage.querySelectorAll('.sp-tabs [data-lib-tab]')) b.classList.toggle('on', b.dataset.libTab === libTab);
      renderLibrary();
      const body = stage.querySelector('.lib-body');
      if (body) body.scrollTop = 0;
    }
    else if (d.action && d.action.startsWith('radio-')) radioAction(d.action, d);
    else if (d.action && d.action.startsWith('sport-')) sportAction(d.action, d.id);
    else if (d.radioPlay) api?.radioPlay?.(d.radioPlay);
    else if (d.action === 'call-accept') acceptCall();
    else if (d.action === 'call-talk') callTalk();
    else if (d.action === 'call-full') setCallFull(true);
    else if (d.action === 'call-mute') toggleCallMute();
    else if (d.action === 'call-decline' || d.action === 'call-end') endCall(`Knopf ${d.action}`);
    else if (d.call) callContact(d.call);
    else if (d.trip) {
      tripShown = Number(d.trip);
      logTab = 'trips'; // auch aus dem Verlauf im Reiter Länder
      renderLogbook();
    } else if (d.action === 'log-tab') {
      logTab = ['session', 'trips', 'countries'].includes(d.tab) ? d.tab : 'session';
      tripShown = null;
      renderLogbook();
    } else if (d.action === 'trip-back') {
      tripShown = null;
      renderLogbook();
    } else if (d.action === 'trip-delete') deleteTrip();
    else if (d.action === 'trips-ahead-remove') removeTrips(tripsData?.ahead || [], 'Fahrten entfernt');
    else if (d.action === 'trips-ahead-keep') api?.tripsKeepAhead?.().then(loadTrips);
    else if (d.action === 'trips-clear') clearTrips();
    else if (d.key) {
      dialed = d.key === 'del' ? dialed.slice(0, -1) : (dialed + d.key).slice(0, 12);
      renderPhone();
    } else if (d.action === 'dial') {
      // *#06# wie beim Handy: Geräteinfo (App, Plugin, Karte)
      if (dialed === '*#06#') {
        dialed = '';
        renderPhone();
        const built = mapStatus?.built ? new Date(mapStatus.built).toLocaleDateString('de-DE') : '–';
        return showToast({ icon: 'info', color: 'gray', title: 'Geräteinfo', text: `App ${appVersion || '–'} · Plugin ${pluginInfo?.version || '–'} · Karte ${built}`, open: 'phone' });
      }
      const match = Object.entries(CONTACTS).find(([, c]) => c.number === dialed);
      if (match) {
        dialed = '';
        callContact(match[0]);
      } else showToast({ icon: 'phone', color: 'green', title: 'Telefon', text: dialed ? `Kein Anschluss unter ${dialed}` : 'Nummer eingeben – 1 bis 5 sind Kurzwahlen', open: 'phone' });
    } else if (d.scroll) {
      const listEl = el.closest('[data-scroll-host]')?.querySelector('[data-scroll-area]') || el.closest('.phone-body')?.querySelector('.phone-list');
      listEl?.scrollBy({ top: Number(d.scroll) * listEl.clientHeight * 0.8, behavior: 'smooth' });
    }
    else if (d.chatOpen) {
      chatOpen = d.chatOpen;
      renderChatApp();
    } else if (d.chatReply) chatReply(Number(d.chatReply));
    else if (d.action === 'chat-compose') {
      chatOpen = 'dispatcher';
      renderChatApp();
    } else if (d.action === 'chat-read') chatRead();
    else if (d.truckPart) {
      truckPart = d.truckPart;
      const card = stage.querySelector('.tr-side');
      if (card) card.dataset.part = truckPart;
      for (const b of stage.querySelectorAll('[data-truck-part]')) b.classList.toggle('on', b.dataset.truckPart === truckPart);
    }
    else if (d.phoneTab) {
      phoneTab = d.phoneTab;
      renderPhone();
    } else if (d.voicemail) {
      const entry = callLog[Number(d.voicemail)];
      if (entry) {
        showCall(entry.text, { ongoing: true, contact: entry.contact });
        speak(entry.text, () => setTimeout(endCall, 600));
        if (!canSpeak || !settings.voice) callTimer = setTimeout(endCall, 6000);
      }
    } else if (d.action === 'back') goBack();
    else if (d.stopsOpen) {
      stopsTab = d.stopsOpen;
      for (const b of stage.querySelectorAll('[data-stops-tab]')) b.classList.toggle('on', b.dataset.stopsTab === stopsTab);
      showScreen('stops');
      renderStops(true);
    } else if (d.open) {
      // Cover im Musik-Widget: immer „Läuft gerade“ zeigen, nicht den zuletzt offenen Reiter (Mediathek, Playlist …)
      if (d.open === 'music' && d.musicNow) {
        musicTab = 'now';
        const section = stage.querySelector('[data-screen="music"]');
        if (section) section.dataset.tab = musicTab;
      }
      showScreen(d.open);
    } else if (d.cmd) sendMedia(d.cmd);
    else if (d.musicTab) {
      musicTab = d.musicTab;
      const section = stage.querySelector('[data-screen="music"]');
      if (section) section.dataset.tab = musicTab;
      if (musicTab === 'library') loadLibrary();
      if (musicTab === 'lyrics') loadLyrics(true);
      if (musicTab === 'recent' && settings.spotify) loadQueue(); // ohne Spotify zeigt der Reiter den eigenen Verlauf
    } else if (d.stopsTab) {
      stopsTab = d.stopsTab;
      for (const b of stage.querySelectorAll('[data-stops-tab]')) b.classList.toggle('on', b.dataset.stopsTab === stopsTab);
      renderStops(true);
    } else if (d.osk !== undefined) oskKey(d.osk);
    else if (d.searchHit !== undefined) openSearchHit(Number(d.searchHit));
    else if (d.action === 'settings-search') openSettingsSearch();
    else if (d.page) openSettingsPage(d.page);
    else if ('back' in d) settingsBack();
    else if (d.choose) changeSetting((s) => setOption(s, d.choose, d.value), `[data-choose="${d.choose}"][data-value="${d.value}"]`);
    else if (d.toggle) {
      changeSetting((s) => (s[d.toggle] = !s[d.toggle]), `[data-toggle="${d.toggle}"]`);
      if (d.toggle === 'remote') refreshRemoteInfo(600);
      if (d.toggle === 'aiGpu' || d.toggle === 'aiAssistant') {
        if (settings.aiAssistant && aiStatus?.installed) api?.aiWarm?.({ gpu: settings.aiGpu });
        else api?.aiStop?.(); // ausgeschaltet: Grafikspeicher freigeben
      }
    }
    else if (d.wallpaper) changeSetting((s) => (s.wallpaper = d.wallpaper), `[data-wallpaper="${d.wallpaper}"]`);
    else if (d.appColor) changeSetting((s) => (s.apps[d.id] = { ...(s.apps[d.id] || {}), color: d.appColor }), `[data-app-color="${d.appColor}"]`);
    else if (d.hotkey) startCapture(d.hotkey);
    else if (d.action === 'pick-wallpaper') pickWallpaper();
    else if (d.action === 'edit-start') setEditing(true);
    else if (d.action === 'export-settings') api?.exportSettings().then((r) => r.ok && showToast({ icon: 'layers', color: 'blue', title: 'Einstellungen gesichert', text: r.file }));
    else if (d.action === 'import-settings') api?.importSettings().then((r) => {
      if (r.ok) showToast({ icon: 'reset', color: 'green', title: 'Einstellungen geladen', text: 'Alles wurde übernommen' });
      else if (r.error) showToast({ icon: 'warning', color: 'red', title: 'Laden fehlgeschlagen', text: r.error });
    });
    else if (d.action === 'pick-icon') pickIcon(d.id);
    else if (d.action === 'reset-icon') resetIcon(d.id);
    else if (d.action === 'reset-app') changeSetting((s) => delete s.apps[d.id]);
    else if (d.action === 'update-map') api?.updateMap(d.value || undefined); // data-value: Karte des anderen Spiels
    else if (d.action && d.action.startsWith('setup-')) setupAction(d.action, d.value);
    else if (d.action === 'road-dismiss') dismissRoadNotice(d.id);
    else if (d.action === 'ai-install') api?.aiInstall?.(d.model).then((r) => {
      if (r?.ok && d.model === 'supertonic') {
        changeSetting((s) => (s.voiceName = 'st-F4'));
        showToast({ icon: 'speaker', color: 'pink', title: 'Stimme bereit', text: 'Ansagen kommen jetzt von Olivia.' });
        speak('Hallo, ich bin Olivia. Ab jetzt lese ich dir alles vor.');
      } else if (r?.ok && d.model === 'kokoro') {
        if (settings.voiceZh === 'win') changeSetting((s) => (s.voiceZh = 'K28'));
        showToast({ icon: 'speaker', color: 'red', title: 'Stimme bereit', text: 'Chinesische Ansagen kommen jetzt von Xiaoyu.' });
        speak('So klingen die Ansagen. Gute Fahrt!');
      } else if (r?.ok) {
        showToast({ icon: 'message', color: 'purple', title: 'Sprachassistent bereit', text: 'Halte den Home-Knopf gedrückt und sprich einfach.' });
        if (role === 'game') api.aiWarm({ gpu: settings.aiGpu });
      } else if (r?.error && r.error !== 'Abgebrochen') showToast({ icon: 'warning', color: 'red', title: 'Sprachassistent', text: r.error });
    });
    else if (d.action === 'ai-cancel') api?.aiCancel?.();
    else if (d.action === 'ai-remove') {
      const stVoices = d.kind === 'supertonic';
      if (role === 'editor' && !ask(stVoices ? 'AI-Stimmen (Olivia & Co.) entfernen? Danach spricht wieder die Windows-Stimme.' : d.kind === 'kokoro' ? 'Chinesische AI-Stimme entfernen? Danach liest wieder die chinesische Windows-Stimme vor.' : 'Sprachmodell entfernen? Danach gelten wieder die festen Sprachbefehle.')) return;
      if (stVoices && /^st-/.test(settings.voiceName)) changeSetting((s) => (s.voiceName = 'Microsoft Katja'));
      api?.aiRemove?.(d.kind);
    }
    else if (d.action === 'ai-open') api?.aiOpen?.();
    else if (d.action === 'uninstall') {
      if (role === 'editor' && !ask(d.keep ? 'CabPlay deinstallieren? Die Einstellungen bleiben erhalten.' : 'CabPlay mit allen Einstellungen und Daten entfernen?')) return;
      api?.uninstall?.({ removeData: !d.keep }).then((r) => {
        if (r && !r.ok) showToast({ icon: 'warning', color: 'red', title: 'Nicht deinstalliert', text: r.error });
      });
    }
    else if (d.action === 'update-check') api?.updateCheck?.();
    else if (d.action === 'update-download') api?.updateDownload?.();
    else if (d.action === 'update-apply') api?.updateApply?.();
    else if (d.action === 'desktop-shortcut') {
      api?.shortcutSet?.(!desktopShortcut?.exists).then((s) => {
        desktopShortcut = s;
        if (screen === 'settings') rerenderSettings();
      });
    }
    else if (d.action === 'install-plugin') api?.installPlugin().then((r) => {
      showToast(r.ok ? { icon: 'check', color: 'green', title: 'Plugin installiert', text: 'Spiel starten – die App verbindet sich dann selbst' } : { icon: 'warning', color: 'red', title: 'Plugin nicht installiert', text: r.error });
      refreshPluginFile();
    });
    else if (d.action === 'reset') resetAll();
  });

  // Karte: Zoom (+/−/Auto) und 2D/3D – nur in der Karten-App
  function mapCommand(cmd) {
    if (cmd === 'in' || cmd === 'out') showZoom();
    if (cmd === 'overview') return setOverview(!mapOverview);
    if (cmd === 'sheet') {
      mapSheetOpen = !mapSheetOpen;
      mapSheetPage = 'main';
      if (!mapSheetOpen && mapNeedsRender) {
        mapNeedsRender = false;
        render();
      } else rerenderMapSheet();
      return undefined;
    }
    quietSetting((s) => {
      if (cmd === 'tilt') s.mapTilt = !s.mapTilt;
      else if (cmd === 'north') s.mapNorth = !s.mapNorth;
      else if (cmd === 'auto') s.mapZoom = 0;
      else {
        const current = s.mapZoom || 3;
        s.mapZoom = Math.max(1, Math.min(5, current + (cmd === 'in' ? -1 : 1)));
      }
    });
    // Manueller Zoom bleibt fest; nur der Auto-Knopf verschwindet nach 12 s ohne Bedienung (Antippen der Karte zeigt ihn wieder)
    showAutoButton();
  }

  // Einstellung ändern, ohne die Oberfläche neu aufzubauen (die Karte liest ihre Werte in jedem Bild selbst).
  // Was neues HTML braucht (Kartenstil Apple ↔ Google, Liste „Entlang der Route“), wird beim Schließen nachgeholt.
  let autoZoomTimer = 0;
  let autoBtnShown = false;
  function showAutoButton() {
    autoBtnShown = !!settings.mapZoom;
    for (const el of nodes('auto-btn')) el.hidden = !autoBtnShown;
    clearTimeout(autoZoomTimer);
    if (autoBtnShown) autoZoomTimer = setTimeout(() => {
      autoBtnShown = false;
      for (const el of nodes('auto-btn')) el.hidden = true;
    }, 12000);
  }
  let mapNeedsRender = false;
  // Lautstärke-Regler: beim Ziehen nur die Anzeige, beim Loslassen speichern (Einstellungen neu zeichnen, Kartenmenü leise)
  function volumeRangeShow(el) {
    el.style.setProperty('--v', `${el.value}%`);
    const out = el.parentElement?.querySelector('.vol-val');
    if (out) out.textContent = `${el.value} %`;
  }
  function volumeRangeSave(el) {
    const key = el.dataset.volumeRange;
    const v = Math.max(0, Math.min(100, Number(el.value) || 0));
    if (el.closest('.map-menu')) quietSetting((s) => (s[key] = v));
    else changeSetting((s) => (s[key] = v), `[data-volume-range="${key}"]`);
    if (key === 'volumeRadio') renderRadio();
  }
  // Ziehen selbst auswerten: Touch im Spiel kommt als Mausereignisse aus dem Hauptprozess, Bewegungen dabei ohne „Taste
  // gedrückt“ – der eingebaute Regler ließ sich deshalb nicht schieben (Rückmeldung 15.11.). Wert aus der Position auf der
  // Spur (ohne den halben Knopf an den Enden, wie beim eingebauten Regler), gespeichert beim Loslassen.
  let volumeDrag = null;
  // gleicher Regler nach dem Neuzeichnen (Statusmeldungen, Einstellungen vom Handy/Editor bauen die Seite neu auf)
  function volumeRangeLive(el) {
    if (el.isConnected) return el;
    const inMenu = !!el.closest('.map-menu') || el.dataset.inMenu === '1';
    return [...document.querySelectorAll(`input.vol-range[data-volume-range="${el.dataset.volumeRange}"]`)]
      .find((x) => !!x.closest('.map-menu') === inMenu && x.getBoundingClientRect().width > 0) || null;
  }
  function volumeRangeAt(el, clientX) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return; // nicht sichtbar (gerade neu gezeichnet) – Wert nicht anfassen
    const knob = 1.4 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 10); // halber Knopf (2,8rem)
    const frac = Math.max(0, Math.min(1, (clientX - r.left - knob) / Math.max(1, r.width - 2 * knob)));
    el.value = String(Math.max(0, Math.min(100, Math.round(frac * 100)))); // 1er-Schritte (Rückmeldung 16.11.)
    volumeRangeShow(el);
  }
  document.addEventListener('pointerdown', (e) => {
    const el = e.target?.closest?.('input.vol-range');
    if (!el) return;
    e.preventDefault(); // eingebauten Regler nicht zusätzlich reagieren lassen
    e.stopPropagation(); // Liste nicht mitscrollen, Regler nicht „eindrücken“ (andere pointerdown-Handler)
    cancelAnimationFrame(glide); // auslaufendes Scrollen anhalten (sonst rutscht die Liste unter dem Finger weiter)
    el.dataset.inMenu = el.closest('.map-menu') ? '1' : '0';
    volumeDrag = el;
    volumeRangeAt(el, e.clientX);
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (!volumeDrag) return;
    const el = volumeRangeLive(volumeDrag);
    if (!el) return;
    if (el !== volumeDrag) {
      el.dataset.inMenu = volumeDrag.dataset.inMenu;
      el.value = volumeDrag.value; // neu gezeichnet: gezogenen Wert übernehmen statt kurz den gespeicherten zu zeigen
      volumeRangeShow(el);
      volumeDrag = el;
    }
    volumeRangeAt(el, e.clientX);
  }, true);
  const volumeDragEnd = () => {
    if (!volumeDrag) return;
    const el = volumeRangeLive(volumeDrag);
    const value = volumeDrag.value;
    const key = volumeDrag.dataset.volumeRange;
    volumeDrag = null;
    if (!el) {
      // Regler nicht mehr da (z. B. Kartenmenü beim Ziehen geschlossen): Wert trotzdem speichern
      const v = Math.max(0, Math.min(100, Number(value) || 0));
      quietSetting((s) => (s[key] = v));
      if (key === 'volumeRadio') renderRadio();
      return;
    }
    el.value = value;
    volumeRangeSave(el);
  };
  document.addEventListener('pointerup', volumeDragEnd, true);
  document.addEventListener('pointercancel', volumeDragEnd, true);
  document.addEventListener('input', (e) => { if (e.target?.dataset?.volumeRange) volumeRangeShow(e.target); });
  document.addEventListener('change', (e) => { if (e.target?.dataset?.volumeRange) volumeRangeSave(e.target); });
  function quietSetting(mutator) {
    const next = JSON.parse(JSON.stringify(settings));
    mutator(next);
    const before = settings;
    settings = catalog.sanitize(next);
    if (before.mapStyle !== settings.mapStyle) mapNeedsRender = true;
    if (before.mapAlong !== settings.mapAlong) alongAt = 0;
    if (before.radarSound !== settings.radarSound) for (const b of document.querySelectorAll('[data-action="radar-sound"]')) b.innerHTML = settings.radarSound ? ICONS.speaker : ICONS.mute;
    document.body.dataset.mapstyle = params.get('mapstyle') || settings.mapStyle;
    if (api) api.saveSettings(settings);
    for (const el of nodes('auto-btn')) el.hidden = !settings.mapZoom || !autoBtnShown;
    if (mapSheetOpen) rerenderMapSheet();
    if (!mapSheetOpen && mapNeedsRender) {
      mapNeedsRender = false;
      render();
    }
  }

  // Mausrad: Karte zoomen (Vollbild) bzw. auf dem Home-Bildschirm blättern
  let lastWheel = 0;
  document.addEventListener('wheel', (e) => {
    if (editor.editing || !(e.target instanceof Element)) return;
    const onMap = e.target.closest('.map-full');
    const onStack = e.target.closest('[data-stack]');
    const onHome = screen === 'home' && e.target.closest('.screen');
    if (!onMap && !onHome && !onStack) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheel < 180) return;
    lastWheel = now;
    if (onMap) mapCommand(e.deltaY < 0 ? 'in' : 'out');
    else if (onStack) setStack(Number(onStack.dataset.stack), stackIndex[Number(onStack.dataset.stack)] + (e.deltaY > 0 ? 1 : -1));
    else setHomePage(homePage + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });

  // Wischen (Maus/Touch): senkrecht im Stapel, waagerecht auf dem Home-Bildschirm
  let swipe = null;
  let swallowClick = false;
  document.addEventListener('pointerdown', (e) => {
    if (editor.editing || !(e.target instanceof Element)) return;
    const stack = e.target.closest('[data-stack]');
    const home = screen === 'home' ? e.target.closest('[data-screen="home"]') : null;
    // Dashboard: Wischen nach links öffnet die Apps (nicht auf der Karte – dort wird gezoomt/geschaut)
    const dash = screen === 'dashboard' && !e.target.closest('.map-card') ? e.target.closest('[data-screen="dashboard"]') : null;
    swipe = stack || home || dash ? { x: e.clientX, y: e.clientY, stack, home, dash } : null;
  });
  document.addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    if (swipe.stack && Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) {
      const slot = Number(swipe.stack.dataset.stack);
      setStack(slot, stackIndex[slot] + (dy < 0 ? 1 : -1));
      swallowClick = true;
    } else if (swipe.home && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      setHomePage(homePage + (dx < 0 ? 1 : -1));
      swallowClick = true;
    } else if (swipe.dash && dx < -60 && Math.abs(dx) > Math.abs(dy)) {
      homePage = 0;
      showScreen('home', { slide: 'left' });
      setHomePage(0, false);
      swallowClick = true;
    }
    swipe = null;
  });
  // Home-Knopf lange drücken (0,6 s) = Disponent anrufen
  let homeLongPressed = false;
  let homePressTimer = 0;
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('#home-button')) return;
    homeLongPressed = false;
    clearTimeout(homePressTimer);
    homePressTimer = setTimeout(() => {
      homeLongPressed = true;
      startVoice();
    }, 600);
  });
  document.addEventListener('pointerup', () => clearTimeout(homePressTimer));

  // Ziehen zum Scrollen (Listen, Einstellungen, Mediathek) – Handy-Steuerung und Touch im Spiel schicken
  // Mausereignisse, und Ziehen mit der Maus scrollt in Chromium nicht. Mit Schwung wie auf dem iPhone.
  let drag = null;
  let glide = 0;
  function scrollableParent(el) {
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
    }
    return null;
  }
  document.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(glide);
    if (editor.editing || e.pointerType === 'touch' || !(e.target instanceof Element)) return; // echter Touch scrollt selbst
    const el = scrollableParent(e.target);
    drag = el ? { el, y: e.clientY, top: el.scrollTop, moved: false, lastY: e.clientY, lastT: performance.now(), v: 0 } : null;
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 10) return;
    drag.moved = true;
    drag.el.scrollTop = drag.top - dy;
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    drag.v = 0.7 * drag.v + 0.3 * ((e.clientY - drag.lastY) / dt); // px/ms, geglättet
    drag.lastY = e.clientY;
    drag.lastT = now;
  });
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    const { el, moved } = drag;
    let v = performance.now() - drag.lastT < 80 ? drag.v : 0;
    drag = null;
    if (!moved) return;
    swallowClick = true;
    // ausrollen lassen
    let last = performance.now();
    const step = (now) => {
      const dt = now - last;
      last = now;
      el.scrollTop -= v * dt;
      v *= Math.pow(0.995, dt);
      if (Math.abs(v) > 0.02) glide = requestAnimationFrame(step);
    };
    if (Math.abs(v) > 0.2) glide = requestAnimationFrame(step);
  });

  // Nach dem Wischen kein Klick auf das Widget darunter
  document.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  // Zurück wie bei CarPlay: erst innerhalb der App (Unterseite, Liste, Vollbild), dann zur vorigen Ansicht
  let lastHub = 'dashboard'; // zuletzt benutzter Startbildschirm: home oder dashboard
  function goBack() {
    if (videoFull) return setVideoFull(false);
    if (screen === 'maps' && mapSheetOpen) {
      if (mapSheetPage !== 'main') {
        mapSheetPage = 'main';
        return rerenderMapSheet();
      }
      return mapCommand('sheet');
    }
    if (screen === 'settings' && settingsStack.length > 1) return settingsBack();
    if (screen === 'music') {
      const section = stage.querySelector('[data-screen="music"]');
      if (musicTab === 'library' && libDetail) {
        libDetail = null;
        return renderLibrary();
      }
      if (musicTab === 'lyrics') {
        // Songtext → zurück zur Wiedergabe
        musicTab = 'now';
        if (section) section.dataset.tab = musicTab;
        return undefined;
      }
      if (musicTab === 'recent' || (musicTab === 'now' && settings.spotify)) {
        musicTab = settings.spotify && musicTab === 'now' ? 'library' : 'now';
        if (section) section.dataset.tab = musicTab;
        if (musicTab === 'library') loadLibrary();
        return undefined;
      }
    }
    if (screen === 'chat' && chatOpen) {
      chatOpen = null;
      return renderChatApp();
    }
    if (screen === 'phone' && phoneTab !== 'favorites') {
      phoneTab = 'favorites';
      return renderPhone();
    }
    if (screen === 'stops' && stopsTab !== 'g') {
      stopsTab = 'g';
      for (const b of stage.querySelectorAll('[data-stops-tab]')) b.classList.toggle('on', b.dataset.stopsTab === stopsTab);
      return renderStops(true);
    }
    return showScreen(previousScreen && previousScreen !== screen ? previousScreen : lastHub);
  }

  // Home-Knopf wie bei CarPlay: aus einer App zurück zum zuletzt benutzten Startbildschirm (Home oder Dashboard),
  // dort wechselt er zwischen beiden. Lange drücken startet Sprachbefehle (wie Siri).
  function pressHome() {
    if (screen === 'home') return showScreen('dashboard');
    if (screen === 'dashboard') return showScreen('home');
    return showScreen(lastHub);
  }

  function handleNav(action) {
    if (editor.editing) return;
    if (action === 'standby') return setStandby(!standby);
    if (standby && action !== 'voice') return setStandby(false); // Display aus: die erste Taste schaltet nur wieder ein
    if (action === 'voice') return startVoice();
    if (videoFull && (action === 'back' || action === 'home')) return setVideoFull(false);
    // Controller/Tasten: links/rechts auf einem Lautstärke-Regler stellt ihn um
    const range = (action === 'left' || action === 'right') && document.body.classList.contains('nav-active') && document.querySelector('input.vol-range.focused');
    if (range) {
      nav.show(); // Rahmen wach halten – sonst verschluckte der Druck nach 8 s nur das Wiederanzeigen
      const key = range.dataset.volumeRange;
      const inMenu = !!range.closest('.map-menu');
      range.value = String(Math.max(0, Math.min(100, Math.round(Number(range.value)) + (action === 'right' ? 1 : -1)))); // 1er-Schritte wie beim Ziehen
      volumeRangeShow(range);
      volumeRangeSave(range);
      // Kartenmenü zeichnet neu und setzt den Fokus zurück – wieder auf denselben Regler
      const again = [...document.querySelectorAll(`input.vol-range[data-volume-range="${key}"]`)].find((x) => !!x.closest('.map-menu') === inMenu && x.getBoundingClientRect().width > 0);
      if (again) nav.focusElement(again);
      return;
    }
    if (action === 'select') nav.select();
    else if (action === 'home') pressHome();
    else if (action === 'back') goBack(); else if (!nav.move(action)) {
      if (screen === 'home' && (action === 'left' || action === 'right')) setHomePage(homePage + (action === 'right' ? 1 : -1));
      else if (screen === 'dashboard' && action === 'right') showScreen('home', { slide: 'left' });
    }
  }

  // ------------------------------------------------------------------ Kombiinstrument (CabPlay Ultra)
  // Ersetzt das Plugin das Kombiinstrument (Ingame-Menü), schickt der Truck-Bildschirm viermal pro Sekunde, was dort in
  // der Mitte und unten stehen soll – fertig formatiert in Sprache und Einheiten der App, aus denselben Anzeigen wie hier
  // (Abbiegehinweis, Ankunft, Musik). So zeigen Navi und Instrument immer dasselbe. Tacho, Drehzahl und Leuchten holt sich
  // das Instrument (ui/cluster.js) selbst aus der Telemetrie.
  // Wer die Werte liefert: der Truck-Bildschirm – in der Demo nur mit Editor (--editor-only) der Editor (?kombi=1)
  const kombiHere = role === 'game' || params.get('kombi') === '1';
  let clusterActive = false;
  let clusterSent = '';
  api?.onCluster?.((info) => {
    clusterActive = !!info?.active;
    clusterSent = ''; // neues Fenster: gleich alles schicken
    updateUltraState(); // App CabPlay Ultra: „Aktiv im Truck“
  });
  const firstShown = (name) => nodes(name).find((el) => !el.closest('.idle, [hidden]')) || nodes(name)[0] || null;
  const boundText = (name) => (firstShown(name)?.textContent || '').replace(/\s+/g, ' ').trim();

  function clusterNav() {
    const box = nodes('maneuver').find((el) => !el.classList.contains('idle'));
    if (!box) return null;
    const pick = (name) => box.querySelector(`[data-bind="${name}"]`);
    const lanes = pick('mv-lanes');
    const eta = nodes('eta').find((el) => !el.classList.contains('idle'));
    const clockText = boundText('eta-clock');
    return {
      active: true,
      arrow: pick('mv-arrow')?.innerHTML || '',
      dist: (pick('mv-dist')?.textContent || '').trim(),
      road: (pick('mv-road')?.textContent || '').replace(/\s+/g, ' ').trim(),
      lanes: lanes && !lanes.classList.contains('hidden') ? lanes.innerHTML : '',
      eta: eta && clockText
        ? `<b>${escape(clockText)}</b> ${escape(CarI18n.translate(etaLabel))} · ${escape(boundText('eta-duration'))} · ${escape(boundText('eta-km'))}`
        : '',
    };
  }

  function clusterMedia() {
    if (radioActive() && radio?.playing) {
      const station = radio.station?.name || '';
      return { title: radio.title || station, artist: radio.title ? radio.artist || station : '', art: radio.cover || radio.station?.logo || '' };
    }
    // Position und Länge in Sekunden (ab 1.18.6): Fortschrittsbalken mit Restzeit wie bei CarPlay Ultra – ändert sich einmal je Sekunde
    if (media?.available && media.title) return { title: media.title, artist: media.artist || '', art: media.art || '', pos: media.durationMs ? Math.floor(mediaPosition() / 1000) : 0, dur: media.durationMs ? Math.round(media.durationMs / 1000) : 0 };
    return null;
  }

  // Design „Karte“: eine zweite Kartenansicht mit denselben Daten, derselben Route und Position wie das Navi – kein zweites
  // Laden der Karte. Gezeichnet in der Bildschleife (07b), höchstens mit der Bildrate des Instruments, als JPEG verschickt.
  // Die Leinwand liegt außerhalb des sichtbaren Bereichs: der Truck-Bildschirm malt deshalb kein neues Bild.
  let clusterMapView = null;
  let clusterMapAt = 0;
  let clusterMapBusy = false;
  // kleine Karte: Mitte bei Rundinstrumenten oder Balken; sonst das ganze Display
  // Design gerade im Instrument (nachts evtl. ein anderes)
  const clusterDesign = () => catalog.clusterDesignNow(settings, telemetry?.gameTimeMin);
  // Straßenszene (Netz, Verkehr, Schilder …): Fahrassistenz und seit 1.18.6 auch das Balken-Design (Szene in der Mitte)
  const clusterRoad = () => ['tesla', 'bars'].includes(clusterDesign());
  const clusterSmallMap = () => clusterDesign() === 'dials' && settings.clusterCenter === 'map'; // Balken: Mitte ist die Straßenszene
  const clusterMapWanted = () => kombiHere && clusterActive && (clusterDesign() === 'map' || clusterDesign() === 'mapdials' || clusterSmallMap()) && !!api?.clusterMap && CarMap.hasMapData();
  function drawClusterMap(speed, options) {
    if (!clusterMapWanted()) {
      if (clusterMapView) {
        clusterMapView.dispose?.();
        clusterMapView.canvas.remove();
        clusterMapView = null;
      }
      return;
    }
    const now = performance.now();
    // im Stand (Ampel, Pause, Rastplatz) reichen 4 Bilder pro Sekunde – die Karte bewegt sich kaum
    const standing = !telemetry || telemetry.paused || Math.abs(telemetry.speedKmh || 0) < 1;
    // höchstens 20 Kartenbilder pro Sekunde: bei 30 B/s laufen Zeiger flüssiger, die Karte braucht das nicht (kostet sonst doppelt)
    const gap = standing ? 250 : 1000 / Math.min(20, Number(settings.clusterFps) || 15);
    if (clusterMapBusy || now - clusterMapAt < gap - 2) return;
    // 960 × 360: zwei Drittel des Displays (1440 × 540) – scharf genug, halb so viel Arbeit wie volle Größe; kleine Karte 488 × 360
    const [mw, mh] = clusterSmallMap() ? [488, 360] : [960, 360];
    if (clusterMapView && clusterMapView.canvas.style.width !== `${mw}px`) {
      clusterMapView.dispose?.();
      clusterMapView.canvas.remove();
      clusterMapView = null;
    }
    if (!clusterMapView) {
      const canvas = document.createElement('canvas');
      canvas.style.cssText = `position: fixed; left: -4000px; top: 0; width: ${mw}px; height: ${mh}px; pointer-events: none; contain: strict;`;
      document.body.appendChild(canvas);
      clusterMapView = new CarMap.MapView(canvas, trail, pose);
    }
    clusterMapAt = now;
    // Instrument hell (tagsüber): Karte ebenfalls hell – helle Instrumente auf dunkler Karte sahen nicht gut aus
    const clusterTheme = settings.clusterBackground === 'light' && !telemetry?.lowBeam ? 'light' : mapThemeName();
    clusterMapLight = clusterTheme === 'light';
    // Vollbild-Karte (1.18.6): unten liegt die Glasleiste – eigener Pfeil etwas höher, damit er frei darüber steht
    const lift = clusterDesign() === 'map' ? { truckY: options?.tilt ? 0.66 : 0.58 } : {};
    clusterMapView.draw(speed, clusterTheme, { ...options, ...lift, insetX: 0, overview: false });
    clusterMapBusy = true;
    clusterMapView.canvas.toBlob((blob) => {
      if (!blob) return void (clusterMapBusy = false);
      blob.arrayBuffer().then((buffer) => api.clusterMap(buffer)).catch(() => {}).finally(() => (clusterMapBusy = false));
    }, 'image/jpeg', 0.82);
  }

  let clusterNet = null;
  // Tunnel erkennen wie der Truck selbst: Lichtautomatik an (Spiel-Einstellung), tagsüber, und sie hat das Abblendlicht
  // eingeschaltet – dann sieht man nur die eigene Röhre (Instrument blendet Verkehr auf anderen Fahrbahnen aus)
  let autoLights = null;
  api?.gameAutoLights?.().then((v) => { autoLights = !!v; }).catch(() => {});
  // Fernlichtassistent: bleibt das Fernlicht an, sieht der Truck vorne niemanden – Fahrzeuge auf anderen Fahrbahnen vorne
  // sind dann verdeckt (andere Tunnelröhre, Lärmschutzwand, Hügel)
  let autoHighBeams = null;
  api?.gameAutoHighBeams?.().then((v) => { autoHighBeams = !!v; }).catch(() => {});
  // Nur wenn das Licht während der Fahrt angegangen ist (Tunneleinfahrt), höchstens 8 Minuten, ohne Scheibenwischer (Regen):
  // von Hand eingeschaltetes Licht oder Licht schon beim Losfahren ist kein Tunnel
  let lowBeamSeen = null, lightOnAt = 0, lightOnMoving = false; // null: Zustand beim Start unbekannt – kein Wechsel
  // Beobachtet wird nur, solange das Instrument läuft (alle 250 ms): nach einer Lücke (Instrument aus, Spiel weg) ist der
  // vorige Zustand unbekannt – sonst gälte Licht, das in der Lücke angeschaltet wurde, als gerade eingeschaltet (Tunnel)
  let lightsCheckedAt = 0;
  const lightsGap = (now) => { const gap = now - lightsCheckedAt > 2000; lightsCheckedAt = now; return gap; };
  const tunnelGuess = () => {
    const t = telemetry;
    const now = performance.now();
    if (lightsGap(now)) { lowBeamSeen = null; highSeen = null; }
    if (!t?.available) { lowBeamSeen = null; highSeen = null; return false; }
    const low = !!t.lowBeam;
    if (low && lowBeamSeen === false) { lightOnAt = now; lightOnMoving = Math.abs(Number(t.speedKmh) || 0) > 20; }
    lowBeamSeen = low;
    return !!autoLights && low && lightOnMoving && now - lightOnAt < 8 * 60 * 1000 && !t.wipers && !nightByClock() && Math.abs(Number(t.speedKmh) || 0) > 5;
  };
  // Fernlicht zählt erst als „vorne frei“, wenn in dieser Sitzung beobachtet wurde, dass der Assistent abblendet und
  // binnen einer Minute wieder aufblendet – sonst könnte die Telemetrie auch nur die Hebelstellung melden
  let highSeen = null, highOffAt = 0, assistantSeen = false;
  const highBeamClear = () => {
    const t = telemetry;
    if (!t?.available || !autoHighBeams) return false;
    const high = !!t.highBeam;
    const now = performance.now();
    if (highSeen === true && !high && t.lowBeam) highOffAt = now;
    if (highSeen === false && high && highOffAt && now - highOffAt < 60000) assistantSeen = true;
    highSeen = high;
    return assistantSeen && high;
  };
  let clusterMapLight = false; // Kartenbild im Instrument hell (Tag) – Rundinstrumente darauf ebenfalls hell
  let clusterNetId = 0; // neue Nummer = neues Netz (das Instrument rechnet die Linien nur dann neu)
  let netAt = 0;
  let netPos = null;
  let netBusy = false;
  let clusterBlds = null; // Gebäude ringsum (Einstellung clusterBuildings)
  let clusterLimits = null; // Tempolimit-Schilder ringsum (null: Ortsdaten ohne Schilder)
  let clusterWorks = null; // Baustellen-Objekte ringsum
  let clusterRbs = null; // Kreisverkehre ringsum
  let clusterJns = null; // Kreuzungsumrisse ringsum (Karten ab Version 19)
  // Gebäude für die Fahrassistenz: nur größere (ab 80 m² Grundfläche und 3 m Höhe) und keins, das auf einer Straße
  // steht (Straßenpunkt im Umriss oder näher am Umriss als die halbe Fahrbahnbreite)
  function clearOfRoads(blds, lines) {
    const roads = lines.map((l) => ({ p: l.p, half: ((l.l || 0) + (l.r || 0)) * 2.25 + (l.m || 0) / 2 + 1 }));
    for (const r of roads) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < r.p.length; i += 2) { x0 = Math.min(x0, r.p[i]); x1 = Math.max(x1, r.p[i]); y0 = Math.min(y0, r.p[i + 1]); y1 = Math.max(y1, r.p[i + 1]); }
      r.box = [x0 - r.half, y0 - r.half, x1 + r.half, y1 + r.half];
    }
    const segDist = (px, py, ax, ay, bx, by) => {
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(ax + dx * t - px, ay + dy * t - py);
    };
    return blds.filter(({ p, h }) => {
      const n = p.length / 2;
      let area = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
        x0 = Math.min(x0, p[i * 2]); x1 = Math.max(x1, p[i * 2]); y0 = Math.min(y0, p[i * 2 + 1]); y1 = Math.max(y1, p[i * 2 + 1]);
      }
      if (Math.abs(area) / 2 < 80 || h < 3) return false;
      const inside = (x, y) => {
        let c = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const xi = p[i * 2], yi = p[i * 2 + 1], xj = p[j * 2], yj = p[j * 2 + 1];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) c = !c;
        }
        return c;
      };
      for (const r of roads) {
        if (r.box[0] > x1 || r.box[2] < x0 || r.box[1] > y1 || r.box[3] < y0) continue;
        for (let k = 0; k < r.p.length; k += 2) {
          const x = r.p[k], y = r.p[k + 1];
          if (x < x0 - r.half || x > x1 + r.half || y < y0 - r.half || y > y1 + r.half) continue;
          if (inside(x, y)) return false;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            if (segDist(x, y, p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1]) < r.half) return false;
          }
        }
        // lange gerade Straßenstücke haben wenige Punkte: auch die Ecken des Gebäudes gegen die Straßenabschnitte prüfen
        for (let k = 0; k + 3 < r.p.length; k += 2) {
          for (let i = 0; i < n; i++) if (segDist(p[i * 2], p[i * 2 + 1], r.p[k], r.p[k + 1], r.p[k + 2], r.p[k + 3]) < r.half) return false;
        }
      }
      return true;
    });
  }

  function updateClusterNet() {
    // Demo: das Instrument zeichnet eine Ersatz-Autobahn (ui/cluster.js) – kein Netz nötig
    if (!clusterRoad() || demoMode || !CarMap.hasMapData()) { clusterNet = null; netPos = null; return; }
    const p = pose.current();
    if (!p || netBusy) return;
    const now = performance.now();
    const moved = netPos ? Math.hypot(p.x - netPos.x, p.z - netPos.z) : Infinity;
    if (netPos && (now - netAt < 1000 || moved < 60) && now - netAt < 10000) return;
    netBusy = true;
    netAt = now;
    netPos = { x: p.x, z: p.z };
    clusterLimits = CarMap.limitsNear ? CarMap.limitsNear(p.x, p.z, 320) : null;
    clusterWorks = CarMap.worksNear ? CarMap.worksNear(p.x, p.z, 260) : null;
    const blds = settings.clusterBuildings && CarMap.buildingsNear ? CarMap.buildingsNear(p.x, p.z, 260) : Promise.resolve(null);
    const rbs = CarMap.roundaboutsNear ? CarMap.roundaboutsNear(p.x, p.z, 320) : Promise.resolve(null);
    const jns = CarMap.junctionsNear ? CarMap.junctionsNear(p.x, p.z, 320) : Promise.resolve(null);
    Promise.all([CarMap.linesNear(p.x, p.z, 320), blds, rbs, jns]).then(([lines, b, rb, jn]) => {
      clusterRbs = rb && rb.length ? rb : null;
      clusterJns = jn && jn.length ? jn : null;
      clusterNet = lines && lines.length ? lines : null;
      clusterBlds = b && b.length ? clearOfRoads(b, lines || []) : null;
      clusterNetId++;
    }, () => {}).finally(() => (netBusy = false));
  }

  setInterval(() => {
    if (!kombiHere || !clusterActive || !api?.clusterState) return;
    updateClusterNet();
    const t = telemetry || {};
    const p0 = pose.current();
    const land = !isAts() && p0 ? countryHere(p0.x, p0.z) : null; // Land unter dem Truck (Großbritannien: mph, Linksverkehr)
    const state = {
      lang: CarI18n.lang,
      locale: CarI18n.lang === 'de' ? 'de-DE' : CarI18n.lang,
      imperial: imperial(),
      ats: isAts(), // US-Tempolimit-Schild
      mphSigns: !!land?.mph, // Großbritannien: Schilder in mph (Issue #9)
      // Linksverkehr (Issue #9): Großbritannien, mit Karten-Mods auch Irland, Malta, Zypern – sonst lernte das Instrument die
      // Straßenseite erst auf einer Straße mit beiden Richtungen und nahm nach Autobahn und Rampe den Gegenverkehr
      // Länder aus Mods ohne ISO-Code: null – dann wie bisher vom Truck gelernt
      bus: busClusterNow, // Buslinie: Fahrerdisplay als Widget im Stapel (cluster.js)
      leftHand: !land ? null : land.mph || ['IE', 'MT', 'CY'].includes(land.iso) ? true : land.iso ? false : null,
      clock: t.available ? clock(t.gameTimeMin) : '',
      temp: settings.weather && weatherData?.current ? `${temp(weatherData.current.temp)}°` : '',
      nav: clusterNav(),
      lanes: laneNowSeen ? { lane: laneNowSeen.lane, own: laneNowSeen.own, pos: Math.round(laneNowSeen.pos * 100) / 100 } : null,
      advice: clusterRoad() ? laneAdviceNow : null, // Spurempfehlung: blaue Spur schwenkt in die richtige Spur
      net: clusterRoad() ? clusterNet : null, // Straßen ringsum (Weltkoordinaten)
      netId: clusterNetId,
      mapLight: clusterMapLight,
      tunnel: clusterRoad() && tunnelGuess(),
      clearAhead: clusterRoad() && highBeamClear(),
      blds: clusterRoad() && settings.clusterBuildings ? clusterBlds : null,
      limits: clusterRoad() ? clusterLimits : null,
      works: clusterRoad() && settings.clusterWorks !== false && clusterWorks && clusterWorks.length ? clusterWorks.slice(0, 400) : null,
      rbs: clusterRoad() ? clusterRbs : null,
      jns: clusterRoad() ? clusterJns : null, // Kreuzungsumrisse: Fläche und Bordstein
      // Straßenform für „Fahrassistenz“: Route voraus, nur in diesem Design (sonst unnötig viel zu schicken)
      road: clusterRoad() && CarMap.onRoute() ? (CarMap.routeAheadPoints(260) || []).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]) : null,
      media: clusterMedia(),
      note: settings.clusterNotes && clusterNote && Date.now() - clusterNote.at < 2500 ? clusterNote : null, // Hinweis-Karte (Option)
      nextLimit: clusterNextLimitNow, // nächstes Tempolimit voraus (07a updateNextLimit): { value, dist } – für Designs ohne Straßenszene
    };
    const json = JSON.stringify(state);
    if (json === clusterSent) return;
    clusterSent = json;
    api.clusterState(state);
  }, 250);
  // ------------------------------------------------------------------ App „CabPlay Ultra“ (1.18.6)
  // Wie bei Apple: das Kombiinstrument direkt im Navi anpassen – oben die Live-Vorschau, darunter Design, Hintergrund,
  // Farbe und die wichtigsten Schalter. Jede Wahl gilt sofort (gleiche Einstellungen wie Einstellungen › Kombiinstrument,
  // dort bleibt alles Weitere).
  const ULTRA_TINTED = ['gradient', 'topo', 'solid', 'mountains', 'waves', 'aurora', 'stars']; // Hintergründe in der Hintergrundfarbe

  // Kleine Skizze je Design (wie die Auswahl der Zifferblätter bei Apple) – Linien in der Akzentfarbe
  function ultraDesignSketch(id, acc) {
    const ring = (cx, r) => `<circle cx="${cx}" cy="30" r="${r}" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="4"/><path d="M${cx - r * 0.7} ${30 + r * 0.7}A${r} ${r} 0 1 1 ${cx + r * 0.95} ${30 - r * 0.3}" fill="none" stroke="${acc}" stroke-width="4" stroke-linecap="round"/>`;
    const card = (x, y, w, h, o = 0.16) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="rgba(255,255,255,${o})"/>`;
    const bar = (x, y, w, f) => `<rect x="${x}" y="${y}" width="${w}" height="4" rx="2" fill="rgba(255,255,255,.2)"/><rect x="${x}" y="${y}" width="${w * f}" height="4" rx="2" fill="${acc}"/>`;
    const map = '<path d="M0 44 C30 36 50 50 80 30 S130 18 160 26" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="3"/><path d="M40 60 C60 40 90 40 110 0" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/><path d="M80 60 C84 46 92 38 104 30" fill="none" stroke="' + acc + '" stroke-width="4" stroke-linecap="round"/>';
    const strip = card(30, 46, 100, 10, 0.2);
    const body = {
      dials: ring(30, 20) + ring(130, 20) + card(62, 16, 36, 12) + card(62, 32, 36, 8, 0.1),
      bars: bar(8, 18, 40, 0.6) + bar(8, 30, 40, 0.4) + bar(112, 18, 40, 0.5) + bar(112, 30, 40, 0.7) + card(56, 8, 48, 44, 0.08) + `<path d="M70 50 L77 14 M90 50 L83 14" stroke="rgba(255,255,255,.3)" stroke-width="1.5"/><path d="M80 50 L80 16" stroke="${acc}" stroke-width="4" stroke-opacity=".6"/>` + card(76, 36, 8, 7, 0.7),
      music: card(100, 10, 40, 34, 0.3) + card(16, 14, 60, 7, 0.4) + card(16, 25, 40, 5, 0.2) + bar(16, 36, 70, 0.4) + strip,
      map: map + card(8, 8, 46, 14, 0.25) + strip,
      mapdials: map + ring(28, 18) + ring(132, 18),
      service: card(40, 8, 80, 8) + card(40, 20, 80, 8) + card(40, 32, 80, 8) + card(40, 44, 80, 8),
      trip: ring(30, 20) + card(64, 12, 66, 6, 0.3) + card(64, 24, 54, 6, 0.2) + card(64, 36, 60, 6, 0.2),
      job: ring(24, 16) + ring(136, 16) + card(50, 10, 60, 7, 0.35) + card(50, 22, 44, 5, 0.2) + bar(50, 34, 60, 0.6) + card(50, 44, 50, 5, 0.2),
      tesla: `<path d="M64 60 L76 14 M96 60 L84 14" stroke="rgba(255,255,255,.3)" stroke-width="2"/><path d="M80 60 L80 14" stroke="${acc}" stroke-width="5" stroke-opacity=".6"/>` + card(74, 40, 12, 10, 0.7) + card(88, 22, 8, 7, 0.35) + `<text x="14" y="36" font-size="18" font-weight="700" fill="#fff">78</text>`,
    }[id] || '';
    return `<svg viewBox="0 0 160 60" aria-hidden="true">${body}</svg>`;
  }

  // Adresse der Vorschau (cluster.html im Vorschaumodus) – auch für Einstellungen › Kombiinstrument
  function clusterPreviewQuery() {
    return new URLSearchParams({
      demo: '1', design: settings.clusterDesign, accent: settings.clusterAccent, bg: settings.clusterBackground, center: settings.clusterCenter,
      arrows: settings.clusterArrows, blinkers: settings.clusterBlinkers || 'auto', widgets: settings.clusterWidgets === false || !(settings.clusterWidgetList || []).length ? '0' : settings.clusterWidgetList.join(','), wmode: settings.clusterWidgetMode || 'auto', infostyle: settings.clusterInfoStyle || 'classic', dinfo: settings.clusterDialInfo === false ? '0' : '1', dright: settings.clusterDialRight || 'water', focus: settings.clusterFocus, info: settings.clusterInfo === false ? '0' : '1',
      both: settings.clusterBoth === false ? '0' : '1', lang: CarI18n.lang, units: imperial() ? 'us' : 'metric', ats: isAts() ? '1' : '0', lanes: '1', fake: '1',
      wp: settings.wallpaper || '', gauge: settings.clusterGauge || 'standard', tint: settings.clusterTint || 'accent',
    });
  }

  const ultraStateText = () => (clusterActive ? 'Aktiv im Truck' : 'Im Truck aus – einschalten mit Strg+F8');
  function updateUltraState() {
    for (const el of stage.querySelectorAll('[data-ultra-state]')) {
      el.classList.toggle('on', clusterActive);
      const label = el.querySelector('span');
      if (label) label.textContent = CarI18n.translate(ultraStateText());
    }
  }

  function ultraScreenHtml() {
    const acc = settings.clusterAccent === 'multi' ? '#0a84ff' : window.ClusterBg.ACCENTS[settings.clusterAccent] || '#0a84ff';
    const pill = (attrs, label, sel, extra = '') => `<button class="u-pill ${sel ? 'on' : ''}" data-focus ${attrs}>${extra}<span>${escape(label)}</span></button>`;
    const designs = Object.entries(OPTIONS.clusterDesign).map(([id, name]) =>
      `<button class="u-design ${settings.clusterDesign === id ? 'on' : ''}" data-focus data-choose="clusterDesign" data-value="${id}">${ultraDesignSketch(id, acc)}<span>${escape(name.replace(/ \(.*\)$/, ''))}</span></button>`).join('');
    const bgs = Object.entries(OPTIONS.clusterBackground).map(([id, name]) =>
      `<button class="u-bg ${settings.clusterBackground === id ? 'on' : ''} ${id === 'light' ? 'is-light' : ''}" data-focus data-choose="clusterBackground" data-value="${id}" style="background:${escape(clusterBgPreview(id))}"><span>${escape(name.replace(/ \(.*\)$/, ''))}</span></button>`).join('');
    const dot = (key, id, name, css) => `<button class="u-dot ${getOption(key) === id ? 'on' : ''}" data-focus data-choose="${key}" data-value="${id}" style="--dot:${css}" aria-label="${escape(name)}" title="${escape(name)}"></button>`;
    const accents = Object.entries(OPTIONS.clusterAccent).map(([id, name]) => dot('clusterAccent', id, name,
      id === 'multi' ? 'conic-gradient(#0a84ff, #30d158, #ffd60a, #ff9f0a, #ff375f, #bf5af2, #0a84ff)' : window.ClusterBg.ACCENTS[id])).join('');
    const tinted = ULTRA_TINTED.includes(settings.clusterBackground);
    const tints = tinted ? Object.entries(OPTIONS.clusterTint).map(([id, name]) => dot('clusterTint', id, name, id === 'accent' ? `linear-gradient(135deg, ${acc} 50%, #333 50%)` : window.ClusterBg.TINTS[id])).join('') : '';
    const design = settings.clusterDesign;
    const center = (design === 'dials' || design === 'bars')
      ? `<div class="u-row"><b>Mitte</b><div class="u-pills">${['auto', 'nav', 'media', ...(design === 'dials' ? ['map'] : []), 'off'].map((id) => pill(`data-choose="clusterCenter" data-value="${id}"`, { auto: 'Automatisch', nav: 'Navi', media: 'Musik', map: 'Karte', off: 'Nichts' }[id], settings.clusterCenter === id)).join('')}</div></div>` : '';
    const gauges = ['dials', 'mapdials', 'trip', 'job', 'service'].includes(design)
      ? `<div class="u-row"><b>Instrumente</b><div class="u-pills">${Object.entries(OPTIONS.clusterGauge).map(([id, name]) => pill(`data-choose="clusterGauge" data-value="${id}"`, name, (settings.clusterGauge || 'standard') === id)).join('')}</div></div>` : '';
    const sw = (key, label, on) => pill(`data-toggle="${key}"`, label, on, `<i class="u-sw"></i>`);
    return `<div class="card surface list-card ultra-card">
        <div class="list-head"><h1>CabPlay Ultra</h1>
          <span class="u-state ${clusterActive ? 'on' : ''}" data-ultra-state><i></i><span>${escape(ultraStateText())}</span></span>
          <button class="glass u-more" data-focus data-action="ultra-settings">Alle Einstellungen${ICONS['chevron-right'] || ''}</button>
        </div>
        <div class="u-body">
          <div class="u-left">
            <button class="cl-preview u-preview" data-focus data-action="ultra-next" style="background:${escape(clusterBgPreview(settings.clusterBackground))}">${screen === 'ultra' ? `<iframe class="cl-frame" src="cluster.html?${escape(clusterPreviewQuery().toString())}" tabindex="-1" aria-hidden="true"></iframe>` : ''}<span class="cl-preview-tag">${escape((OPTIONS.clusterDesign[design] || '').replace(/ \(.*\)$/, ''))}</span></button>
            <div class="u-designs">${designs}</div>
          </div>
          <div class="u-right">
            <div class="u-row"><b>Hintergrund</b><div class="u-bgs">${bgs}</div></div>
            <div class="u-row"><b>Farbe</b><div class="u-dots">${accents}</div></div>
            ${tinted ? `<div class="u-row"><b>Hintergrundfarbe</b><div class="u-dots">${tints}</div></div>` : ''}
            ${center}${gauges}
            <div class="u-row"><b>Schnell</b><div class="u-pills">
              ${sw('clusterWidgets', 'Widgets', settings.clusterWidgets !== false)}
              ${sw('clusterBoot', 'Start-Animation', settings.clusterBoot !== false)}
              ${sw('clusterNotes', 'Hinweise', !!settings.clusterNotes)}
              ${design === 'map' || design === 'music' ? '' : sw('clusterInfo', 'Leiste unten', settings.clusterInfo !== false)}
            </div></div>
          </div>
        </div>
      </div>`;
  }

  // Vorschau antippen: nächstes Design der Displaytaste (wie die Taste im Truck)
  function ultraNextDesign() {
    const list = (settings.clusterCycle || []).length ? settings.clusterCycle : Object.keys(OPTIONS.clusterDesign);
    const i = list.indexOf(settings.clusterDesign);
    const next = list[(i + 1) % list.length];
    changeSetting((s) => (s.clusterDesign = next), '[data-action="ultra-next"]');
  }
  function openUltraSettings() {
    showScreen('settings');
    settingsStack = ['main', 'cluster'];
    settingsReturn = 'ultra';
    rerenderSettings();
  }
  // ------------------------------------------------------------------ Tastenkürzel aufnehmen (Editor)
  function startCapture(action) {
    capturing = capturing === action ? null : action;
    captureError = '';
    rerenderSettings(`[data-hotkey="${action}"]`);
  }

  function acceleratorFrom(e) {
    if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return null;
    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    const code = e.code;
    let name = null;
    if (/^Key[A-Z]$/.test(code)) name = code.slice(3);
    else if (/^Digit\d$/.test(code)) name = code.slice(5);
    else if (/^Numpad\d$/.test(code)) name = `num${code.slice(6)}`;
    else if (/^F\d{1,2}$/.test(code)) name = code;
    else {
      name = {
        ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Enter', NumpadEnter: 'Enter',
        Backspace: 'Backspace', Space: 'Space', PageUp: 'PageUp', PageDown: 'PageDown', Home: 'Home', End: 'End',
        Insert: 'Insert', Delete: 'Delete', Tab: 'Tab', NumpadAdd: 'numadd', NumpadSubtract: 'numsub',
        NumpadMultiply: 'nummult', NumpadDivide: 'numdiv',
      }[code] || null;
    }
    if (!name) return '';
    if (!mods.length && !/^F\d/.test(name)) return 'needs-mod';
    return [...mods, name].join('+');
  }

  async function finishCapture(accelerator) {
    const action = capturing;
    capturing = null;
    captureError = '';
    if (accelerator !== null && api) {
      const result = await api.setHotkey(action, accelerator);
      if (result.hotkeys) hotkeys = result.hotkeys;
      if (!result.ok) captureError = result.error || 'Nicht möglich';
    }
    rerenderSettings(`[data-hotkey="${action}"]`);
  }

  // Einstellungs-Suche: Treffer schon beim Tippen
  document.addEventListener('input', (e) => {
    if (!(e.target instanceof HTMLInputElement) || e.target.dataset.input !== 'settings-search') return;
    settingsQuery = e.target.value.slice(0, 40);
    updateSearchResults();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof Element && e.target.closest('input')) {
      if (e.key === 'Enter') {
        const field = e.target.dataset.input;
        if (field === 'sp-search') runSpotifySearch();
        else if (field === 'video-link-app') stage.querySelector('[data-action="video-paste"]')?.click();
        else if (field === 'radio-search') runRadioSearch(e.target.value);
        else if (field === 'settings-search') openSearchHit(0);
      }
      return;
    }
    if (capturing) {
      e.preventDefault();
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey) return finishCapture(null);
      if (e.key === 'Delete' && !e.ctrlKey && !e.altKey && !e.shiftKey) return finishCapture('');
      const acc = acceleratorFrom(e);
      if (acc === null) return; // nur Modifier gedrückt
      if (acc === 'needs-mod' || acc === '') {
        captureError = acc === '' ? 'Diese Taste geht nicht.' : 'Bitte mit Strg, Alt oder Umschalt kombinieren (F-Tasten gehen auch allein).';
        rerenderSettings(`[data-hotkey="${capturing}"]`);
        return;
      }
      return finishCapture(acc);
    }
    const keys = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'select', Backspace: 'back', Escape: 'back', h: 'home' };
    if (keys[e.key]) {
      e.preventDefault();
      handleNav(keys[e.key]);
    } else if (e.key === ' ') sendMedia('toggle');
  });

  // ------------------------------------------------------------------ Editor-Leiste
  // Bearbeiten startet in den Einstellungen oder durch Gedrückthalten der Seitenpunkte unter dem Home-Bildschirm;
  // solange es läuft, zeigt eine kleine Leiste „Fertig“ (wie iOS)
  const editBar = document.getElementById('editbar');
  function setEditing(on) {
    if (on && screen === 'settings') showScreen('home');
    editor.setEditing(on);
    editBar.hidden = !on;
  }
  editBar.addEventListener('click', (e) => {
    if (e.target.closest('[data-edit="done"]')) setEditing(false);
  });
  const LONG_PRESS_MS = 550;
  let hold = null; // { timer, x, y, el }
  const cancelHold = () => {
    if (!hold) return;
    clearTimeout(hold.timer);
    hold.el.classList.remove('holding');
    hold = null;
  };
  document.addEventListener('pointerdown', (e) => {
    if (editor.editing || e.button !== 0 || !(e.target instanceof Element)) return;
    const dots = e.target.closest('.screen.active .page-dots');
    if (!dots) return;
    dots.classList.add('holding');
    hold = {
      x: e.clientX,
      y: e.clientY,
      el: dots,
      timer: setTimeout(() => {
        cancelHold();
        setEditing(true); // der folgende Klick auf den Punkt wird im Bearbeiten-Modus verschluckt
      }, LONG_PRESS_MS),
    };
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 12) cancelHold();
  });
  document.addEventListener('pointerup', cancelHold);
  document.addEventListener('pointercancel', cancelHold);

  // ------------------------------------------------------------------ Start
  function setConnection(state) {
    connection = state;
    const linkEl = document.getElementById('link');
    linkEl.classList.toggle('on', state !== 'demo');
    linkEl.classList.toggle('demo', state === 'demo');
  }

  async function start() {
    if (api) {
      const snap = await api.getSettings();
      customWallpaper = snap.customWallpaper;
      customIcons = snap.customIcons || {};
      wallpaperFiles = snap.wallpaperFiles || {};
      settings = catalog.sanitize(snap.settings);
      api.onSettings((s) => {
        const iconKey = (icons) => Object.entries(icons || {}).map(([k, v]) => k + v.length).join();
        const imagesChanged = s.customWallpaper !== customWallpaper || iconKey(s.customIcons) !== iconKey(customIcons)
          || iconKey(s.wallpaperFiles) !== iconKey(wallpaperFiles);
        customWallpaper = s.customWallpaper;
        customIcons = s.customIcons || {};
        wallpaperFiles = s.wallpaperFiles || {};
        const next = catalog.sanitize(s.settings);
        const withoutRecents = (x) => JSON.stringify({ ...x, recents: null, lastScreen: null });
        if (!imagesChanged && withoutRecents(next) === withoutRecents(settings)) {
          // nur die Seitenleiste (zuletzt benutzte Apps) hat sich geändert – nicht alles neu aufbauen
          settings = next;
          renderSidebar();
          return;
        }
        // nur Einstellungen des Kombiinstruments (z. B. Design per Displaytaste I): der Truck-Bildschirm zeigt davon nichts –
        // nicht alles neu aufbauen (sonst flackert Navi und Karte bei jedem Tastendruck); offen ist nur die Einstellungsseite
        const changedKeys = Object.keys({ ...next, ...settings }).filter((k) => k !== 'recents' && k !== 'lastScreen' && JSON.stringify(next[k]) !== JSON.stringify(settings[k]));
        if (!imagesChanged && changedKeys.length && changedKeys.every((k) => k.startsWith('cluster'))) {
          settings = next;
          if (screen === 'settings') render();
          return;
        }
        settings = next;
        render();
      });
      // Andere Mods aktiv oder Einstellung geändert: Orte mit den passenden Namen neu laden
      api.onPlacesChanged?.(() => api.loadPlaces().then((p) => p && CarMap.setPlaces(p)).catch(() => {}));
      api.onTelemetry(onTelemetry);
      // AI-Sprachassistent: Status holen; auf dem Truck-Bildschirm schon vorladen (erste Antwort sonst ~10 s).
      // Erst, wenn das Spiel fertig geladen ist und läuft (Telemetrie, nicht pausiert) und noch 15 s später: Vom
      // Spiel gestartet kam das Vorladen sonst mitten in den Ladebildschirm – Sprachmodell (~3 GB) und Spiel luden
      // gleichzeitig auf die Grafikkarte.
      const whenGameRuns = (fn) => {
        let since = 0;
        const check = () => {
          const ok = demoMode || (telemetry?.available && !telemetry.paused);
          since = ok ? since || Date.now() : 0;
          if (since && Date.now() - since >= (demoMode ? 0 : 15000)) fn();
          else setTimeout(check, 1000);
        };
        check();
      };
      const loadAi = (tries) => api.aiStatus?.().then((s) => {
        aiStatus = s;
        if (role !== 'game') return;
        whenGameRuns(() => {
          if (s?.installed && settings.aiAssistant) {
            api.aiLog?.('game screen: preloading AI');
            api.aiWarm({ gpu: settings.aiGpu });
          }
          // AI-Stimme (Supertonic) vorladen: der erste Satz kommt dann ohne ~0,7 s Ladezeit
          if (s?.supertonic && /^st-/.test(settings.voiceName || '')) api.aiTtsWarm?.();
        });
      }).catch((e) => {
        api.aiLog?.(`status not loaded: ${e?.message || e}`);
        if (tries > 0) setTimeout(() => loadAi(tries - 1), 5000);
      });
      loadAi(6);
      api.onMedia((m) => onMedia(m));
      api.onRadio?.(onRadio);
      api.onSportsEvent?.(onSportsEvent);
      api.onRadioStations?.(onRadioStations);
      api.radioStations?.().then(onRadioStations).catch(() => {});
      api.radioState?.().then(onRadio).catch(() => {});
      api.onConnection(setConnection);
      setConnection(connection); // Balken gleich als Handy-Empfang zeigen, bis der Stand aus dem Hauptprozess kommt
      api.onNav(handleNav);
      api.onMediaKey((cmd) => demo?.command(cmd));
      api.onRoute(onRoute);
      api.onScreen((s) => {
        if (s && s.fps > 0) screenFps = Math.max(10, Math.min(60, s.fps));
      });
      api.onOpen?.((id) => showScreen(id));
      const onPlugin = (info) => {
        const before = pluginInfo;
        pluginInfo = info;
        if (info && !info.ok && (!before || before.version !== info.version)) {
          showToast({ icon: 'warning', color: 'red', title: 'Plugin passt nicht zur App', text: `Plugin ${info.version} – bitte das Plugin neu installieren (plugin\\build.ps1 -Install)`, open: 'settings' });
        }
        if (screen === 'settings') rerenderSettings();
      };
      api.onPlugin?.(onPlugin);
      api.pluginInfo?.().then((info) => info && onPlugin(info));
      api.onVideoCmd?.(videoCommand);
      api.onTest?.((what) => {
        if (what === 'voice') speak('So klingen die Ansagen. Gute Fahrt!');
        else if (what === 'alert') beep('camera');
        else if (what === 'announce') busAnnounceTest(); // Durchsage im Bus
      });
      api.onSpotify?.((st) => {
        spotifyStatus = st;
        spotifyLib = null;
        if (screen === 'settings') rerenderSettings();
        if (screen === 'music' && musicTab === 'library') loadLibrary(true);
      });
      api.spotifyStatus?.().then((st) => (spotifyStatus = st));
      api.onHotkeys((h) => {
        hotkeys = h;
        if (screen === 'settings') rerenderSettings();
      });
      // Laufendes Spiel (ETS2/ATS): Einheiten „wie im Spiel“, Währung, US-Schilder (CSS über data-game)
      const onGame = (info) => {
        if (!info?.id) return;
        const changed = info.id !== currentGame.id || JSON.stringify(info.units) !== JSON.stringify(currentGame.units);
        currentGame = info;
        document.body.dataset.game = info.id;
        if (changed) render();
      };
      api.onGame?.(onGame);
      api.gameInfo?.().then(onGame).catch(() => {});
      try {
        // Kartendatei direkt streamen (cpdata://map); klappt das nicht, über den IPC-Kanal wie früher
        const mapBytes = fetch('cpdata://map/europe-map.bin')
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
          .then((b) => new Uint8Array(b))
          .catch(() => api.loadMap());
        const [bytes, placesData, status, info, keys] = await Promise.all([mapBytes, api.loadPlaces(), api.mapStatus(), api.appInfo(), api.getHotkeys()]);
        if (bytes) CarMap.loadMap(bytes);
        if (placesData) CarMap.setPlaces(placesData);
        setCountries(placesData?.countries);
        mapStatus = status;
        api.mapStatusOther?.().then((s) => (mapStatusOther = s)).catch(() => {});
        appVersion = info?.version || '';
        appDataDir = info?.dataDir || '';
        hotkeys = keys?.app || keys || {};
        pluginHotkeys = keys?.plugin || null;
      } catch (e) {
        console.error('Daten nicht lesbar', e);
      }
      // Kommen Spuren, Fahrkurven und Höhen kurz nacheinander an, die Route nur einmal neu berechnen (bei langen Routen
      // dauert ein Durchgang über eine Sekunde – fünf hintereinander ließen die Oberfläche beim Start hängen)
      let routeRedo = 0;
      const redoRoute = () => {
        clearTimeout(routeRedo);
        routeRedo = setTimeout(() => routeItems && onRoute(routeItems), 50);
      };
      api.loadLanes?.().then((loaded) => applyLaneData(loaded, redoRoute));
      // Fahrkurven der Kreuzungen (Routenlinie); ältere Karten haben das nicht
      api.loadCurves?.().then((data) => {
        setCurves(typeof data === 'string' ? JSON.parse(data) : data);
        if (routeItems && curveData) redoRoute();
      });
      // Höhe und Land je Knoten (Grenzen, Steigungen); ältere Karten haben das nicht
      api.loadNodeInfo?.().then((bytes) => {
        setNodeInfo(bytes);
        if (routeItems && nodeInfo) redoRoute();
      });
      if (routeItems) onRoute(routeItems);
    }

    // Spuren und Kreuzungsdaten (europe-lanes.json, europe-junctions.json) übernehmen – aus der App und im Browser-Test
    function applyLaneData(loaded, redo) {
      // kommt als Text (der Hauptprozess parst nicht mehr selbst); ältere Hauptprozesse schicken fertige Objekte
      const data = loaded?.raw ? { roads: JSON.parse(loaded.lanes).roads, ...(loaded.junctions ? JSON.parse(loaded.junctions) : {}) } : loaded;
      lanesData = data?.roads || null;
      junctionData = data?.junctions || null;
      // Kreuzungen mit Abzweigung: neu je Kreuzung eine Knotenliste (Knoten -> Nummer der Kreuzung, an zwei
      // Kreuzungen eine Liste), ältere Kartendaten nur eine Knotenliste
      branchNodes = null;
      branchGrouped = Array.isArray(data?.branch?.[0]);
      if (Array.isArray(data?.branch)) {
        branchNodes = new Map();
        data.branch.forEach((group, id) => {
          for (const uid of Array.isArray(group) ? group : [group]) {
            const had = branchNodes.get(uid);
            branchNodes.set(uid, had === undefined ? id : [].concat(had, id));
          }
        });
      }
      roundaboutExits = data?.roundabout || null;
      continuations = Array.isArray(data?.cont) ? new Set(data.cont) : null;
      turnSignals = data?.blink || null;
      laneLinks = expandLaneRules(data?.laneRules, data?.placed);
      turnLinks = expandTurnRules(data?.turnRules, data?.placed);
      if (routeItems && lanesData) redo();
    }

    // Test im Browser: ?mapfile lädt die echten Kartendaten (Server mit Projektordner als Wurzel)
    if (!api && params.has('mapfile')) {
      Promise.all([fetch('/mapdata/europe-map.bin').then((r) => r.arrayBuffer()), fetch('/mapdata/europe-places.json').then((r) => r.json())])
        .then(([bytes, placesData]) => {
          CarMap.loadMap(new Uint8Array(bytes));
          CarMap.setPlaces(placesData);
          // Spuren, Kreuzungsdaten (Abbiegungen) und Fahrkurven wie in der App – fehlen die Dateien, bleibt es bei der Geometrie
          const redo = () => routeItems && onRoute(routeItems);
          const text = (name) => fetch(`/mapdata/${name}`).then((r) => (r.ok ? r.text() : null)).catch(() => null);
          Promise.all([text('europe-lanes.json'), text('europe-junctions.json'), text('europe-curves.json')]).then(([lanes, junctions, curves]) => {
            if (curves) setCurves(JSON.parse(curves));
            if (lanes) applyLaneData({ raw: true, lanes, junctions }, redo);
            else if (curves) redo();
          });
          // ?routefile[=name.json]: Testroute aus mapdata/test-route.json oder einer anderen Datei dort (Knoten-IDs), die Demo-Fahrt folgt ihr
          if (params.has('routefile')) {
            fetch(`/mapdata/${/^[\w-]+\.json$/.test(params.get('routefile') || '') ? params.get('routefile') : 'test-route.json'}`).then((r) => r.json()).then((uids) => onRoute(uids.map((uid) => ({ uid: String(uid), distance: 0 }))));
          }
        })
        .catch((e) => console.error('Kartendaten', e));
    }
    if (params.get('page')) settingsStack = ['main', ...params.get('page').split('/')];
    if (params.has('mapsheet')) mapSheetOpen = true; // Test
    // Test: --musictab=library|now|recent zeigt Spotify mit Beispieldaten
    if (params.get('icontheme')) settings.iconTheme = params.get('icontheme'); // Test
    if (params.get('wallpaper')) settings.wallpaper = params.get('wallpaper'); // Test/Aufnahmen: eigener Hintergrund
    if (params.get('units')) settings.units = params.get('units'); // Test
    if (params.get('clock')) settings.clock = params.get('clock'); // Test
    if (params.get('phonetab')) phoneTab = params.get('phonetab'); // Test
    if (params.has('videos')) settings.video = { ...settings.video, current: 0, items: [{ kind: 'yt', id: 'x', title: 'ETS2 – Nachtfahrt durch die Alpen' }, { kind: 'tw', id: 'x', title: 'Truck-Stream mit Freunden' }, { kind: 'ytl', id: 'x', title: 'Lofi zum Fahren' }] }; // Test
    if (params.get('chat')) chatOpen = params.get('chat'); // Test
    if (params.get('musictab')) {
      musicTab = params.get('musictab');
      settings.spotify = true;
      spotifyStatus = { connected: true };
      const img = (c) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="${c}"/></svg>`)}`;
      const colors = ['#e05a47', '#3b6fd8', '#d8a43b', '#4cb07a', '#9b59d0', '#d04f8f', '#2fa5b8', '#c7c03a', '#7a8c99', '#e07b2f', '#5b5bd6', '#3fa35b'];
      spotifyLib = { playlists: [{ name: 'Lieblingssongs', uri: 'liked', liked: true, owner: '' }, ...['Truck Hits', 'Autobahn Nachts', 'Deutschrap', 'Chill Drive', 'Rock Classics', 'Fokus', 'Sommer 2026', 'Podcast-Mix', 'Roadtrip'].map((n, i) => ({ name: n, uri: 'spotify:playlist:x' + i, image: img(colors[i]), owner: 'Nik' }))],
        recent: ['Song A', 'Song B', 'Song C', 'Song D', 'Song E', 'Song F'].map((n, i) => ({ name: n, artist: 'Künstler ' + (i + 1), uri: 'spotify:track:x' + i, image: img(colors[11 - i]) })) };
      setTimeout(() => {
        const sec = stage.querySelector('[data-screen="music"]');
        if (sec) sec.dataset.tab = musicTab;
        renderLibrary();
      }, 300);
    }
    if (params.has('dumpturns')) setTimeout(() => { const d = CarMap.debugTurns(); console.error('TURNS ' + JSON.stringify({ points: (d.points || []).map((q) => q && [Math.round(q.x), Math.round(q.y)]), turns: d.turns.map((t) => ({ i: t.index, kind: t.kind, side: t.side, a: Math.round(t.angle * 180 / Math.PI), cum: Math.round(t.cum), j: t.junction, l: t.lanes, ex: t.exit, tw: t.sign?.towards || '', rd: t.sign?.road || '', nb: params.has('dumpnear') ? d.points.slice(Math.max(0, t.index - 45), t.index + 30).map((q) => (q ? (q.branch ? 'B' : '') + (Array.isArray(q.jt) ? q.jt.join('') : q.jt || '') + (q.junction ? 'J' : '') : '_')).join(',') : undefined })) })); }, 4000);
    if (params.has('dumpnear')) setTimeout(() => { const m = CarMap.hasRoute() && CarMap.onRoute() ? CarMap.maneuvers(pose.current()?.h) : null; console.error('MANEUVER ' + JSON.stringify(m && { turn: m.turns[0], hint: m.laneHint && { ...m.laneHint, at: undefined } })); }, 7000); // Test: Hinweis an der Startstelle
    // Test: --testlight setzt eine rote Ampel ~150 m voraus auf die Route
    if (params.has('testlight')) setInterval(() => {
      const p = pose.current();
      const d = CarMap.debugTurns();
      if (!p || !d.points) return;
      let bi = 0, bd = Infinity;
      d.points.forEach((q, i) => { if (q) { const dd = Math.hypot(q.x - p.x, q.y - p.z); if (dd < bd) { bd = dd; bi = i; } } });
      let acc = 0, j = bi;
      while (j < d.points.length - 2 && acc < 150) { const a1 = d.points[j], b1 = d.points[j + 1]; if (!a1 || !b1) break; acc += Math.hypot(b1.x - a1.x, b1.y - a1.y); j++; }
      const a1 = d.points[j - 1], b1 = d.points[j];
      if (!a1 || !b1) return;
      const h = Math.atan2(-(b1.x - a1.x), -(b1.y - a1.y));
      // je eine Ampel rechts und links der Fahrbahn (wie im Spiel), dazu eine Kreuzung 40 m daneben
      const len = Math.hypot(b1.x - a1.x, b1.y - a1.y) || 1;
      const nx = -(b1.y - a1.y) / len, nz = (b1.x - a1.x) / len;
      gameLights = [
        { x: b1.x + nx * 6, z: b1.y + nz * 6, y: telemetry?.y ?? 0, h, t: 1, s: 2, r: 12 },
        { x: b1.x - nx * 6, z: b1.y - nz * 6, y: telemetry?.y ?? 0, h: h + Math.PI, t: 1, s: 2, r: 12 },
        { x: b1.x + nx * 40, z: b1.y + nz * 40, y: telemetry?.y ?? 0, h: h + Math.PI / 2, t: 1, s: 8, r: 12 },
      ];
      lightsAt = performance.now();
      updateLightIcons();
    }, 500);
    const initial = params.get('view');
    const start = settings.startScreen === 'last' ? settings.lastScreen || 'dashboard' : settings.startScreen;
    screen = catalog.APPS[initial] || initial === 'home' ? initial : start;
    render();
    maybeStartSetup(); // Einrichtung beim ersten Start (nur im Fenster am PC)

    if (demoMode) {
      // Kombiinstrument-Demo: der Truck-Bildschirm reicht die Werte weiter (mit Assistenz, damit ACC/Spurhalte zu sehen sind)
      const toCluster = kombiHere && api?.clusterTelemetry ? (t) => clusterActive && api.clusterTelemetry({ ...t, assist: t.assist || { lane: true, lanePassive: 2, acc: 30 } }) : () => {};
      demo = createDemo((t) => { onTelemetry(t); toCluster(t); }, (m) => onMedia(m));
      window.__demoSkip = (m) => demo.skip(m); // Test: Demo-Truck auf der Route vorsetzen
      window.__demoMedia = (m) => onMedia({ available: true, playing: true, ...m }); // Test: bestimmten Song anzeigen
      if (routePath) demo.followPath(routePath);
      setConnection('demo');
    }
    if (mapStatus && mapStatus.stale && !(mapStatus.auto && settings.mapAutoUpdate)) {
      setTimeout(() => showToast({ kind: 'System', icon: 'maps', color: 'red', title: 'Kartendaten veraltet', text: 'Spiel-Update erkannt – Karte neu erzeugen (Einstellungen › Info)', open: 'settings' }), 2500);
    }
    // Test: --toast / --call zeigen Mitteilung bzw. Anruf sofort
    if (params.has('toast')) setTimeout(() => showToast({ icon: 'maps', color: 'blue', title: 'Google Maps öffnen?', text: 'Route nach München', open: 'maps' }), 400);
    if (params.has('call')) setTimeout(() => showCall('Test', { contact: 'dispatcher' }), 400);
    if (params.has('overview')) setTimeout(() => setOverview(true), 3000);
    if (params.has('voicetest')) setTimeout(() => voiceShow('Ich höre zu …', 'z. B. „Nächste Tankstelle“, „Wie weit noch?“', 'listening'), 400);
    requestAnimationFrame(frame);
  }

  start();
})();
