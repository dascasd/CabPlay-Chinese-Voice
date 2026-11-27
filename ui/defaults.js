// Standard-Einstellungen und Kataloge – wird von der Oberfläche UND vom Hauptprozess geladen.
(function (root) {
  // kind: nav | audio | other – die Seitenleiste zeigt wie CarPlay die zuletzt benutzte App je Art
  const APPS = {
    maps: { name: 'Karten', color: 'blue', kind: 'nav' },
    music: { name: 'Musik', color: 'green', kind: 'audio' },
    radio: { name: 'Radio', color: 'red', kind: 'audio' },
    nowplaying: { name: 'Jetzt läuft', color: 'pink', kind: 'system' }, // wie CarPlay: öffnet die laufende Audio-App (kein eigener Bildschirm)
    dashboard: { name: 'Dashboard', color: 'graphite', kind: 'system' },
    standby: { name: 'Display aus', color: 'graphite', kind: 'system' }, // nur die Uhr auf dem Navi (kein eigener Bildschirm)
    truck: { name: 'Fahrzeug', color: 'teal', kind: 'other' },
    job: { name: 'Auftrag', color: 'orange', kind: 'other' },
    messages: { name: 'Mitteilungen', color: 'red', kind: 'other' },
    chat: { name: 'Nachrichten', color: 'green', kind: 'other' },
    stops: { name: 'Tanken & Rasten', color: 'blue', kind: 'other' },
    logbook: { name: 'Fahrtenbuch', color: 'yellow', kind: 'other' },
    ultra: { name: 'CabPlay Ultra', color: 'blue', kind: 'other' }, // Kombiinstrument anpassen (Vorschau, Design, Schnellschalter)
    assist: { name: 'Assistenz', color: 'graphite', kind: 'other' }, // Karte + Straßenszene der Fahrassistenz nebeneinander (Issue #9)
    calendar: { name: 'Kalender', color: 'red', kind: 'other' },
    phone: { name: 'Telefon', color: 'green', kind: 'other' },
    weather: { name: 'Wetter', color: 'blue', kind: 'other' },
    sports: { name: 'Sport', color: 'green', kind: 'other' },
    radar: { name: 'Blitzer', color: 'green', kind: 'other' },
    video: { name: 'Video', color: 'indigo', kind: 'other' },
    browser: { name: 'Browser', color: 'blue', kind: 'other' }, // Webseiten mit Tabs, Favoriten und Anmeldung (Issue #9) – nur im Truck-Bildschirm
    settings: { name: 'Einstellungen', color: 'gray', kind: 'other' },
  };

  const COLORS = {
    blue: ['#5ac8fa', '#0a84ff'],
    indigo: ['#8e8cff', '#4b44e0'],
    cyan: ['#7fe3ff', '#18a7d8'],
    green: ['#3ae374', '#1db954'],
    mint: ['#8ff0d0', '#1fbf8f'],
    teal: ['#64e3d4', '#00a3a3'],
    yellow: ['#ffe066', '#f5b800'],
    orange: ['#ffb340', '#ff7a00'],
    red: ['#ff6b6b', '#e0312b'],
    pink: ['#ff8fb8', '#ff2d78'],
    purple: ['#c38bff', '#7d3cff'],
    graphite: ['#5b5b60', '#2c2c2e'],
    gray: ['#a1a1a6', '#636366'],
  };

  // iOS-Hintergründe als Bilder (im Datenordner %APPDATA%\CabPlay\wallpapers), je ein helles und ein dunkles Motiv
  // App: Datenordner (cpdata://), Browser-Test: ui/wallpapers. Die Datei läuft auch im Hauptprozess (ohne window).
  const hasBridge = () => { try { return !!(window.carplay || (window.parent !== window && window.parent.carplay)); } catch { return false; } };
  const WP_BASE = typeof window !== 'undefined' && hasBridge() ? 'cpdata://wallpapers/' : 'wallpapers/';
  const img = (file) => `url('${WP_BASE}${file}') center / cover`;
  // Darunter je ein eigener Verlauf in derselben Farbe: Das Release-Paket für andere enthält die Bilder nicht
  // (Apple-Motive), dort sieht man nur den Verlauf. Farben: [Licht, Mitte, Rand]
  const soft = ([l, m, e]) => `radial-gradient(85% 75% at 28% 18%, ${l} 0%, transparent 62%), radial-gradient(70% 70% at 88% 82%, ${m} 0%, transparent 65%), linear-gradient(155deg, ${m}, ${e})`;
  const pair = (name, base, ext, light, dark) => ({
    name,
    css: `${img(`${base}-light.${ext}`)}, ${soft(light)}`,
    dark: `${img(`${base}-dark.${ext}`)}, ${soft(dark)}`,
  });

  const WALLPAPERS = {
    // wie die iOS-26-Hintergründe: wechseln mit Hell/Dunkel
    'ios-blue': pair('Blau', 'blue', 'webp', ['#cfe0f5', '#8fb1dd', '#5d86bd'], ['#2c5490', '#132a52', '#060d1c']),
    'ios-lavender': pair('Lavendel', 'lavender', 'webp', ['#e6def6', '#b7a8e0', '#8a78bf'], ['#4a4280', '#231f45', '#0c0a1c']),
    'ios-rose': pair('Rosé', 'rose', 'webp', ['#f3e1de', '#d7aba6', '#a87a76'], ['#6e2a2a', '#3a1414', '#140606']),
    'ios-aqua': pair('Aqua', 'aqua', 'webp', ['#e0f0f3', '#9fc7cf', '#6a98a3'], ['#2f5a63', '#14292e', '#050c0e']),
    'ios-green': pair('Grün', 'green', 'webp', ['#e5f0d8', '#aac698', '#7a9a68'], ['#4a6b3a', '#1f3018', '#080f06']),
    'ios-gold': pair('Gold', 'gold', 'webp', ['#f2e6d2', '#c8a77d', '#7d7f9c'], ['#4d4a78', '#24223f', '#0b0a16']),
    'ios-slate': pair('Silber', 'silver', 'webp', ['#eef2f6', '#b7c4d1', '#8796a6'], ['#3c4a5c', '#1a222d', '#07090d']),
    'ios-mauve': pair('Mauve', 'mauve', 'jpg', ['#efdfe3', '#c7a6b4', '#8e7690'], ['#6a5679', '#352a40', '#140f19']),
    liquid: { name: 'Fluss', css: 'radial-gradient(70% 90% at 15% 20%, #3a7bd5 0%, transparent 60%), radial-gradient(60% 80% at 85% 75%, #b24bd8 0%, transparent 60%), radial-gradient(50% 60% at 60% 15%, #2fd1c5 0%, transparent 60%), linear-gradient(160deg, #0a1030, #120822)' },
    aurora: { name: 'Polarlicht', css: 'radial-gradient(120% 90% at 15% 10%, #2b6f6a 0%, transparent 55%), radial-gradient(90% 80% at 85% 30%, #3b2a7a 0%, transparent 60%), linear-gradient(160deg, #06121c, #0b0b1a)' },
    ocean: { name: 'Ozean', css: 'radial-gradient(100% 80% at 80% 0%, #1b6fb5 0%, transparent 60%), linear-gradient(180deg, #062644, #020b16)' },
    sunset: { name: 'Abendrot', css: 'radial-gradient(110% 80% at 50% 110%, #ff7a3d 0%, transparent 55%), linear-gradient(180deg, #2a1240, #5a1e3a 60%, #8a3b2a)' },
    dune: { name: 'Düne', css: 'radial-gradient(90% 70% at 20% 100%, #e0894a 0%, transparent 60%), radial-gradient(80% 70% at 90% 10%, #7a4bb0 0%, transparent 55%), linear-gradient(170deg, #2a1a2e, #160d14)' },
    forest: { name: 'Wald', css: 'radial-gradient(100% 90% at 20% 100%, #1f6b3a 0%, transparent 60%), linear-gradient(170deg, #0b1f14, #050c08)' },
    graphite: { name: 'Graphit', css: 'linear-gradient(160deg, #2c2c2e, #0c0c0d)' },
    night: { name: 'Nacht', css: '#000000' },
    dawn: { name: 'Morgen', css: 'radial-gradient(120% 90% at 70% 0%, #ffd9a8 0%, transparent 60%), linear-gradient(180deg, #a8c8f0, #e8eef8)' },
  };

  const WIDGETS = { map: 'Karte', nav: 'Navigation', places: 'Ziele', music: 'Musik', calendar: 'Kalender', weather: 'Wetter', radar: 'Blitzer', truck: 'Fahrzeug', job: 'Auftrag', messages: 'Mitteilungen', stops: 'Tanken & Rasten', trip: 'Fahrtenbuch', sport: 'Live-Ticker' };
  // Widget-Seite links vom Dashboard (wie CarPlay ab iOS 26): Stapel nebeneinander, je Stapel senkrecht blättern
  const PAGE_WIDGETS = { clock: 'Uhr II', clock1: 'Uhr I', clockdigital: 'Uhr digital', date: 'Datum', calendar: 'Termine', weather: 'Wetter', forecast: 'Tägliche Vorhersage', sun: 'Sonnenaufgang und -untergang', music: 'Jetzt läuft', fuel: 'Tank', levels: 'Füllstände', messages: 'Mitteilungen', sport: 'Meine Teams', job: 'Auftrag', trip: 'Diese Fahrt' };
  const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'hidden'];
  // Erlaubte Positionen der Karten-Overlays
  const OVERLAYS = {
    banner: ['top-left', 'top-right', 'hidden'],
    eta: ['bottom', 'hidden'],
    speed: CORNERS,
    compass: CORNERS,
  };
  const POSITION_NAMES = {
    'top-left': 'Oben links', 'top-right': 'Oben rechts', 'bottom-left': 'Unten links', 'bottom-right': 'Unten rechts',
    bottom: 'Unten', hidden: 'Aus',
  };
  const MAP_STYLES = { google: 'Google', apple: 'Apple Karten', standard: 'Standard', mono: 'Graphit', contrast: 'Kontrast' };

  const DEFAULTS = {
    version: 6,
    wallpaper: 'ios-blue',
    appearance: 'auto', // dark | light | auto (nach Uhrzeit im Spiel) | lights (nach Scheinwerfer)
    glass: 'full',      // alt (bis 1.21): full | clear | reduced | off – nur noch zur Übernahme in glassTint/glassReduce
    glassTint: 50,      // Liquid Glass wie iOS 27: 0 Ultraklar … 50 Normal (Standard) … 100 Voll getönt
    glassReduce: false, // Unschärfe reduzieren: über Karte und Dashboard ohne Weichzeichner (spart Rechenzeit)
    iconTheme: 'brands', // Symbol-Set: brands (wie die echten Apps) | classic – bis 1.22: apple (Karten, Musik)
    // Navi- und Musik-Symbol unabhängig voneinander (26.11.): vorher hingen sie am Kartenstil – Apple Karten brachte
    // immer auch das Apple-Musik-Symbol, obwohl Spotify lief
    gameDirs: { ets2: '', ats: '' }, // selbst gewählte Spielordner (nur wenn Steam das Spiel nicht kennt)
    mapsIcon: 'auto',  // auto (passend zum Kartenstil) | google | apple
    musicIcon: 'auto', // auto (nach der App, die gerade spielt) | spotify | apple
    iconStyle: 'color', // color | dark | clear
    sidebar: 'left',
    sidebarMode: 'auto', // auto = zuletzt benutzte Navi-, Audio- und andere App; fixed = feste Auswahl
    iconSize: 'normal',
    textScale: 'normal', // Größe der ganzen Oberfläche: small | normal | large | xlarge
    clusterAreas: {}, // Kombiinstrument: sichtbarer Bereich je Fahrzeug-ID { l, t, r, b } Rand in % (wie displayAreas)
    displayAreas: {}, // sichtbarer Bereich je Lkw-ID: { l, t, r, b } Rand in % (ältere Lkw zeigen nur einen Teil des Navi-Bilds)
    displayFormats: {}, // Displayformat je Lkw-ID ("scania.r": "4:3") – fehlt einer: automatisch (Spieldateien, sonst 16:9)
    mapZoom: 0,          // 0 = automatisch nach Tempo, 1 (nah) … 5 (weit)
    mapTilt: true,       // 3D-Ansicht (geneigt) statt 2D
    mapTruckSize: 'medium', // Größe des Truck-Symbols auf der Karte: small | medium | large (Issue #9)
    assistLayout: 'split', // App „Assistenz“: split (Karte + Szene) | scene (nur die Szene, mit Navi-Anzeigen darüber)
    mapNorth: false,     // Norden oben statt Fahrtrichtung oben
    mapAlong: false,     // Rastplätze und Tankstellen entlang der Route als Liste auf der Karte
    setupDone: false,     // Einrichtung beim ersten Start erledigt (bestehende Einstellungen: ja)
    setupControl: '',     // dort gewählte Bedienung: touch | keys | phone
    navVoice: true,      // Abbiegungen selbst ansagen (Olivia), Zeitpunkte nach Tempo – das Spiel sagt sonst schon an
    mapBorder: true,      // Hinweis vor Grenzen: Lkw-Tempolimits, Maut, Diesel, Zeitzone des nächsten Landes
    mapBorderVoice: false, // … auch ansagen
    mapGrade: true,       // Hinweis vor steilen Abschnitten (Steigung/Gefälle)
    mapGradeVoice: true,  // … auch ansagen
    busVoice: false,      // Buslinie: Haltestellen ansagen („Nächster Halt“, „Wir erreichen gleich …“) – wie die anderen Ansagen ab Werk aus
    gradeMin: 6,          // ab dieser Steigung in Prozent
    mapLights: true,     // nächste Ampel auf der Route (Zustand, Restzeit) im Abbiege-Banner – vom Plugin aus dem Spiel gelesen
    mapTheme: 'system',  // Farbschema der Karte wie bei Google Maps: system (wie Darstellung) | light | dark | lights (nach Scheinwerfer)
    // Lautstärken in Prozent
    volumeVoice: 70,     // Sprachansagen (Disponent, Siri-Antworten) – 100 war zu laut (Rückmeldung 15.11.)
    volumeAnnounce: 60,  // Durchsagen im Bus (Haltestellen mit Gong)
    volumeAlerts: 80,    // Warntöne (Blitzer, Tempo, Grenze)
    volumeSiri: 60,      // Töne beim Sprachbefehl
    volumeVideo: 80,     // Video (YouTube)
    volumeRadio: 80,     // Radio (in 1er-Schritten)
    radioView: 'grid',   // Radio-Sender als Kacheln oder Liste
    mapStyle: 'google',
    mapAreas: true,      // Grünflächen, Orts- und Gewerbeflächen aus den Spieldaten
    mapBuildings: true,  // Gebäude-Umrisse (nah herangezoomt)
    mapWater: true,      // Meer
    mapInlandWater: true, // Flüsse & Seen (unabhängig vom Meer)
    mapTrail: false,     // gefahrene Strecke als blaue Spur (nur ohne Route)
    mapDriven: false,    // Fahrtenbuch: alle gefahrenen Strecken als lila Ebene
    tracking: false,     // Fahrtenbuch: Fahrten mit Strecke aufzeichnen (main/trips.js) – ab Werk aus
    mapForest: true,     // Wälder und Baumgruppen
    mapMeadow: true,     // Wiesen & Büsche (Bepflanzung ohne Wald, hellgrün)
    mapTowns: false,      // kleine Orte auf der Karte (fürs Navi werden sie immer genutzt)
    mapViewpoints: false, // Aussichtspunkte des Spiels auf der Karte
    map3dBuildings: false,
    mediaPauseWithGame: false, // Spotify/Radio anhalten, solange das Spiel pausiert
    nightDim: false,      // Display im Truck nachts dunkler // Gebäude als 3D-Klötze (geneigte Karte, nah herangezoomt)
    mapGround: true,     // Bodenmaterial: Felder, Fels, Sand, Schnee (aus dem Gelände des Spiels)
    mapSites: true,      // Firmen-, Werkstatt- und Händlergelände, Steinbrüche
    mapSiteNames: true,  // Firmennamen auf dem Gelände (nah herangezoomt)
    mapBusStops: true,   // Bushaltestellen (nah herangezoomt)
    mapModNames: true,   // Firmen-/Städtenamen aus aktiven Mods übernehmen
    mapHiddenRoads: false, // Versteckte Straßen (im Spiel nicht auf der Karte, meist Kulisse oder nur für KI-Verkehr)
    mapLaneMarkings: true, // Fahrbahnmarkierungen, nur nah herangezoomt
    mapSecretRoads: false, // Geheime Abkürzungen (Geheimstrecken) – Standard aus, damit nichts verraten wird
    mapRails: false,      // Bahnlinien auf der Karte
    mapRoadClasses: false, // Straßen nach Art einfärben (Google: Stadtstraßen weiß, große Straßen graublau)
    mapShields: true,    // Straßennummern-Schilder (A1, E45 …)
    mapLightIcons: true, // Ampel-Symbole auf der Karte (wie Google Maps)
    mapHighways: false,  // Autobahnen farbig – aus = alle Straßen einheitlich
    mapLabels: true,     // Städtenamen
    mapPois: true,       // Tankstellen und Rastplätze
    dispatcher: 'calls', // Disponent: calls (wichtige Meldungen als Anruf) | messages | off
    voice: true,         // Meldungen vorlesen (Windows-Sprachausgabe)
    voiceName: 'Microsoft Katja', // Windows-Stimme; 'system' = einfache Browser-Stimme
    voiceLang: 'ui',     // Sprache der Ansagen: 'ui' = wie die Oberfläche, sonst de/en/pl/tr/zh/zh-hant
    voiceZh: 'K28',      // chinesische Stimme: Kokoro-Sprecher (K28 = zf_044, empfohlen) oder 'win' (Windows-Stimme)
    aiAssistant: true,   // KI-Sprachassistent nutzen, wenn geladen (Einstellungen › Sprachassistent)
    aiCalls: true,       // KI: freie Gespräche am Telefon
    aiGpu: true,         // KI auf der Grafikkarte (sonst Prozessor)
    weather: true,       // echtes Wetter aus dem Internet (Open-Meteo) für die Stadt im Spiel
    remote: false,       // Handy-Steuerung über den Browser im Heimnetz
    // Blitzer-App: Warnungen vor Blitzern, Waagen, Mautstellen; Tempo-Warnung ab Limit + Toleranz
    radar: true,
    radarSound: true,
    radarTolerance: 5,   // km/h über dem Limit, ab dann warnt die App (-1 = aus)
    radarWeigh: true,
    radarToll: true,
    radarBorder: true,
    mirrorCam: true,      // Spiegelkamera beim Blinken als Bild im Bild (nur Trucks mit Kameraspiegeln, Innenansicht)
    mirrorReplace: true,  // läuft ein Video als Bild im Bild: an seiner Stelle zeigen, danach kommt das Video zurück
    mirrorFps: 20,        // Bildrate der Spiegelkamera: 20 | 30 | 60 (mehr Last für Spiel und App)
    mirrorArrow: false,   // grüner Blinkerpfeil im Spiegelbild
    mirrorView: 'wide',   // welcher Spiegel: wide (Weitwinkel, wo es ihn gibt – sonst der Hauptspiegel) | main
    cameras: [],         // gemeldete/gelernte Blitzer: { x, z, src: 'fine' | 'user', at, game?: 'ats' }
    // Video-App: YouTube- und Twitch-Links; driving = Bild beim Fahren zeigen (sonst nur Ton)
    video: { items: [], current: -1, driving: true, pip: true, pipCorner: 'br', pipSize: 'm', pauseOnCall: true, web: false },
    // App „Browser“: Video-Bild beim Fahren (wie die Video-App, eigene Einstellung), Zoom ab Werk in %, Favoriten und zuletzt
    // besuchte Seiten ({ url, title }), offene Tabs (Adressen, höchstens 5), Zoom je Seite (Host → %), Seiten in Handy-Ansicht
    browser: { driving: true, fullUrl: false, adblock: true, popups: true, editor: false, zoom: 125, favorites: [], recent: [], tabs: [], siteZoom: {}, mobileSites: [] }, // editor: auch im PC-Fenster (Test)
    spotify: false,      // Spotify-Mediathek (Playlists) in der Musik-App – braucht eine Client-ID
    keyboard: 'auto',    // Bildschirmtastatur: auto = wie die App-Sprache, sonst de | en | pl | tr | zh | zh-hant (Weltkugel-Taste)
    kbdSuggest: true,    // Wortvorschläge über der Bildschirmtastatur
    kbdAutocorrect: true, // Autokorrektur (nur sichere Tippfehler)
    kbdAutoCap: true,    // Auto-Großschreibung (Satzanfang) wie iOS
    kbdPeriod: true,     // Kurzbefehl „.“: zweimal Leertaste = Punkt und Leerzeichen
    mapFps: 30,          // Bildrate der Karte: 30 | 20 | 15 – weniger spart Rechenzeit beim Fahren
    gamma: 'balanced',   // Bildkorrektur nur für das Truck-Display (das Spiel hellt es auf): off | light | balanced | strong | dim | custom
    gammaValue: 1.6,     // eigene Kurve: Gamma 1,0–2,4
    whiteLevel: 86,      // eigene Kurve: Weißpunkt in Prozent (gedimmtes Weiß strahlt weniger)
    showLabels: true,
    startScreen: 'dashboard',
    home: Object.keys(APPS),
    dock: ['maps', 'music', 'truck'],
    recents: { nav: 'maps', audio: 'music', other: 'truck', other2: 'phone', next: 'other2' },
    units: 'auto',   // auto (wie im Spiel, Optionen › Gameplay) | metric | us (mph, mi, ft, °F, gal, lb) | uk (mph, mi, yd, °C, gal, lb)
    clock: 'auto',   // auto (wie im Spiel) | 24 | 12 (AM/PM)
    language: 'auto', // Oberfläche: auto (wie Windows), de, en, pl, tr, zh (vereinfachtes Chinesisch), zh-hant (traditionelles Chinesisch)
    updateAuto: true, // einmal am Tag nach einer neuen Version suchen (GitHub)
    updateInstall: true, // gefundene Updates selbst laden und beim Beenden der App einspielen
    // Mitteilungen als Banner (in der Mitteilungen-App landen sie immer)
    notifyDispatcher: true, notifyJobs: true, notifyMoney: true, notifyWarnings: true, notifyBorder: true, notifyRadar: true, notifySystem: true, notifySport: true,
    mapAutoUpdate: true, // Karte nach Spiel-Updates selbst erneuern (braucht den einmal eingerichteten Kartenparser)
    sportsLeague: 'bl1', // zuletzt gewählte Liga in der Sport-App (f1 = Formel 1)
    sportsTeams: [], // Lieblingsteams "liga:teamId" – Live-Ticker als Mitteilung
    sportsOrder: [], // Reihenfolge der Ligen in der Sport-App (leer = Standard)
    sportsHidden: [], // ausgeblendete Ligen
    sportsMatches: [], // einzeln angetippte Spiele "liga:spielId" – Live-Ticker nur für dieses Spiel
    sportsPush: true, // Live-Ticker für Lieblingsteams
    sportsF1: false, // Formel 1: Rennstart und Ergebnis als Mitteilung
    // Kombiinstrument (CabPlay Ultra, einschalten im Ingame-Menü des Plugins)
    clusterDesign: 'dials',    // dials (Rundinstrumente) | bars (Balken) | music (Cover groß) | map (Karte über das Display) | mapdials (Karte hinter den Rundinstrumenten) | service (Fahrzeugzustand) | trip (Bordcomputer) | job (Auftrag bzw. Buslinie) | tesla (Fahrassistenz: Straße mit Verkehr)
    clusterAccent: 'blue',     // blue | green | orange | red | teal | white | yellow | pink | purple | multi (je Anzeige eigene Farbe)
    clusterBackground: 'black', // black | blue | graphite | light | gradient | topo | solid | mountains | waves | aurora | stars (in clusterTint) | wallpaper (Bild des Navis)
    clusterCenter: 'auto',     // auto (Navi bei Route, sonst Musik) | nav | media | map (kleine Karte) | off
    clusterArrows: 'small',    // Blinkerpfeile oben: small | large
    clusterBlinkers: 'auto',   // Blinkerpfeile im Display: auto (wie das Original-Display, CLUSTER_NO_BLINKERS aus) | on | off
    clusterCycle: ['dials', 'tesla', 'mapdials', 'map', 'music', 'bars', 'service', 'trip', 'job'], // Designs, die die Displaytaste (I) durchschaltet
    clusterDialInfo: true,     // Werte unten im Rundinstrument / zweiter Balken (wie CarPlay Ultra): links Reichweite, rechts clusterDialRight
    clusterDialRight: 'water', // rechts: water (Kühlwasser) | adblue | air (Luftdruck)
    clusterInfoStyle: 'classic', // Leiste unten: classic (Uhrzeit, Temperatur, Tank, AdBlue) | apple (nur Kilometerstand, Uhrzeit oben rechts)
    clusterWidgets: true,      // Widget-Stapel in der Mitte (Rundinstrumente, Balken, Karte mit Rundinstrumenten, Fahrassistenz)
    clusterWidgetList: ['rest', 'delivery', 'range', 'fuel'], // Widgets im Stapel: Pause, Lieferfrist, Reichweite, Verbrauch
    clusterWidgetMode: 'auto', // auto (alle 12 s das nächste) | fixed (immer das erste) – Warnungen springen immer nach vorn
    clusterLeadDist: true,     // Fahrassistenz: Abstand zum Vordermann in Metern
    clusterLeadColor: true,    // Fahrassistenz: Vordermann und Fahrzeuge im geplanten Weg blau getönt (sonst grau wie alle)
    clusterBlindSpot: true,    // Fahrassistenz: beim Blinken Fahrzeuge im toten Winkel rot, Nebenspur rot
    clusterReverseAid: true,   // Fahrassistenz: im Rückwärtsgang Hilfslinien am Auflieger und Knickwinkel
    clusterReversePath: true,  // Rangierhilfe: Hilfslinien gekrümmt nach Lenkeinschlag (Plugin ab 1.12), sonst gerade
    clusterNextLimit: true,    // Fahrassistenz: nächstes Tempolimit voraus neben dem aktuellen
    clusterWorks: true,        // Fahrassistenz: Baustellen (Baken, Pylonen, Fässer, Leuchten)
    clusterLightTimer: true,   // Fahrassistenz: Restzeit unter der Ampel
    clusterBuildings: false,   // Fahrassistenz: Gebäude ringsum (aus der Kartendatei)
    clusterLaneWarn: false,    // Fahrassistenz: Spurlinie rot, wenn man ohne Blinker auf sie zufährt (braucht eine Route)
    clusterFocus: 'nav',       // Navi und Musik zusammen in der Mitte: nav (Navi groß) | media (Musik groß, Navi kompakt)
    clusterBoth: true,         // bei Route zusätzlich die Musik klein darunter
    clusterCover: true,        // Albumcover zeigen
    clusterInfo: true,         // Leiste unten (Uhrzeit, Temperatur, Reichweite, AdBlue)
    clusterFps: 15,            // Bilder pro Sekunde fürs Instrument: 10 | 15 | 20 | 30
    clusterNotes: false,       // Hinweis-Karten im Kombiinstrument (Mitteilungen des Navis gleiten oben ein)
    clusterBoot: true,         // Start-Sequenz bei Zündung an (Logo, Zeiger-Lauf)
    clusterBootStyle: 'logo',  // Start: logo (Marke) | hello („hello“ in Schreibschrift, wird geschrieben)
    clusterGauge: 'standard',  // Form der Rundinstrumente: standard | thin | thick | needle (mit Zeiger) | classic (heller Ring wie CarPlay Ultra) | sport (rot)
    clusterTint: 'accent',     // Farbe der Hintergründe Farbverlauf, Höhenlinien, Farbfläche, Berge: accent (wie die Farbe) | copper | teal | …
    clusterShiftHint: true,    // Schaltempfehlung (Pfeil am Gang) – nur mit Handschaltung
    mirrorTarget: 'gps',       // Spiegelkamera beim Blinken zeigen: gps (Navi) | cluster (Kombiinstrument) | both
    curveWarn: true, // Warnung vor engen Kurven (Rampen, Schleifen) mit empfohlener Geschwindigkeit
    mapNextLimit: true, // Navi: nächstes Tempolimit klein beim aktuellen Schild (Idee von KloseY)
    mapNextLimitStyle: 'side', // side: neben dem Schild | below: als Leiste darunter (wie MBUX)
    laneMarker: true, // Marker unter der Spur, auf der der Truck gerade fährt
    mirrorCamTrucks: [], // Lkw mit Kameraspiegeln aus einer Mod (Fahrzeug-IDs): Blinker-Kamera trotzdem erlauben
    stackJump: true, // Dashboard-Stapel springt bei neuen Mitteilungen (Strafen, Maut, Aufträge) zum Mitteilungen-Widget
    brandIcon: true, // Fahrzeug-Icon zeigt das Logo der gefahrenen Marke (aus Wikimedia geladen)
    laneShare: false, // Spur-Durchfahrten zählen, um die Spurempfehlung zu verbessern (nur nach Einschalten, Teilen per Knopf)
    mapLearn: true, // gefahrene Strecke merken: beim nächsten Neubau wird Wasser, wo der Truck gefahren ist, zu Land
    gpuTransfer: true, // GPU-Übertragung ans Plugin (fällt bei Fehlern für die Sitzung automatisch zurück; im Spiel getestet)
    phoneSignal: 'auto', // Mobilfunk neben den Balken: auto (5G in Städten, sonst LTE) | 5g | off
    logoStore: 'save', // Vereins- und Markenlogos: save (auf dem PC, nach 30 Tagen ohne Anzeige gelöscht, höchstens 40 MB) | stream (nur laden, braucht Internet)
    phoneBattery: 'charging', // Handy-Akku in der Statusleiste: off | on (entlädt sich) | charging (am Ladekabel)
    sidebarCount: 'auto', // Apps in der Seitenleiste: auto (nach Bildschirmformat) | 3 | 4
    apps: {}, // { appId: { name, color } } – nur Abweichungen; eigene Icons liegen als Datei in data/icons
    // wie CarPlay: Musik unten rechts. stacks: weitere Widgets je Platz (Stapel zum Durchwischen)
    dashboard: { widgets: ['map', 'places', 'music'], stacks: [[], ['nav', 'calendar', 'messages'], []] },
    // wie iOS: je Stapel bis zu fünf, dasselbe Widget darf in beiden Stapeln liegen; smart = Smart-Reihenfolge
    // cols: Stapel nebeneinander (wie CarPlay je nach Display 2 oder 3); der dritte Stapel liegt bereit
    widgetPage: { on: true, smart: false, cols: 2, stacks: [['clock', 'date', 'music', 'forecast'], ['weather', 'messages', 'clockdigital', 'levels', 'sport'], ['music', 'sun', 'fuel', 'calendar']] },
    musicArt: 'right', // Cover rechts (CarPlay) oder links (Spotify)
    overlays: { banner: 'top-left', eta: 'bottom', speed: 'bottom-left', compass: 'top-right' },
    overlayFree: { banner: false, speed: false }, // Kartenstil Google/Apple: eigene Position statt „fest wie im Original“
    overlaysByStyle: {}, // gemerkte overlays/overlayFree je Kartenstil (beim Stilwechsel getauscht, Issue #9)
  };

  // Video-Einträge: yt (Video), ytl (Playlist), tw (Twitch-Kanal), twv (Twitch-Video), twc (Twitch-Clip)
  function cleanVideo(v) {
    // tw = Twitch-Kanal (live), twv = Twitch-Video (Aufzeichnung), twc = Twitch-Clip, tt = TikTok-Video,
    // web = andere Webseite mit eingebautem Player (id = die Adresse)
    if (!v || typeof v !== 'object' || !['yt', 'ytl', 'tw', 'twv', 'twc', 'tt', 'web'].includes(v.kind)) return null;
    if (v.kind === 'web') {
      let url;
      try {
        url = new URL(String(v.id));
      } catch {
        return null;
      }
      if (url.protocol !== 'https:' || url.href.length > 500 || url.username || url.password) return null;
      const host = url.hostname.replace(/^www\./, '');
      const title = typeof v.title === 'string' && v.title.trim() ? v.title.trim().slice(0, 60) : host;
      return { kind: 'web', id: url.href, title };
    }
    const ok = v.kind === 'tw' ? /^[a-zA-Z0-9_]{2,25}$/.test(v.id) : v.kind === 'twv' ? /^\d{5,15}$/.test(v.id)
      : v.kind === 'tt' ? /^\d{8,25}$/.test(v.id) : /^[\w-]{6,100}$/.test(v.id);
    if (!ok) return null;
    const fallback = { tw: v.id, twv: 'Twitch-Video', twc: 'Twitch-Clip', tt: 'TikTok-Video' }[v.kind] || 'YouTube-Video';
    const title = typeof v.title === 'string' && v.title.trim() ? v.title.trim().slice(0, 60) : fallback;
    return { kind: v.kind, id: v.id, title };
  }

  // Link oder Eingabe erkennen: youtube.com/watch?v=…, youtu.be/…, /shorts/, /live/, ?list=…, twitch.tv/kanal, „twitch:kanal“.
  // web: andere Seiten erlaubt (Einstellung „Andere Webseiten“) – dann wird jeder sonstige https-Link zur Webseite
  function parseVideo(text, { web = false } = {}) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const short = raw.match(/^twitch:([a-zA-Z0-9_]{2,25})$/);
    if (short) return cleanVideo({ kind: 'tw', id: short[1].toLowerCase(), title: `Twitch: ${short[1]}` });
    let url;
    try {
      url = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return /^[\w-]{11}$/.test(raw) ? cleanVideo({ kind: 'yt', id: raw }) : null;
    }
    const host = url.hostname.replace(/^(www|m|music)\./, '');
    // Twitch: Kanal, Video (Aufzeichnung) oder Clip – Zusätze wie „?sr=a“ beim Teilen stören nicht
    if (host === 'clips.twitch.tv') {
      const slug = url.pathname.split('/').filter(Boolean)[0];
      return slug ? cleanVideo({ kind: 'twc', id: slug }) : null;
    }
    if (host === 'twitch.tv') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'videos' && parts[1]) return cleanVideo({ kind: 'twv', id: parts[1] });
      if (parts[1] === 'clip' && parts[2]) return cleanVideo({ kind: 'twc', id: parts[2] });
      // Seiten von Twitch selbst sind keine Kanäle
      if (parts.length === 1 && !/^(directory|videos|settings|downloads|search|p|jobs|turbo|subscriptions|wallet|inventory|drops)$/i.test(parts[0])) {
        return cleanVideo({ kind: 'tw', id: parts[0].toLowerCase(), title: `Twitch: ${parts[0]}` });
      }
      return null;
    }
    // TikTok: tiktok.com/@name/video/123…, Einbett-Links (/embed/v2/…, /player/v1/…); Kurzlinks löst die App vorher auf
    if (host === 'tiktok.com') {
      const m = url.pathname.match(/^\/(?:@[^/]+\/video|embed(?:\/v2)?|player\/v1|v)\/(\d{8,25})/);
      const user = url.pathname.match(/^\/(@[\w.]{2,30})\//); // Kanal als Titel (TikTok liefert ihn per oEmbed nicht mehr)
      return m ? cleanVideo({ kind: 'tt', id: m[1], title: user ? `TikTok: ${user[1]}` : undefined }) : null;
    }
    if (host === 'youtu.be') return cleanVideo({ kind: 'yt', id: url.pathname.slice(1).split('/')[0] });
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = url.searchParams.get('v');
      const list = url.searchParams.get('list');
      const path = url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/);
      if (v || path) return cleanVideo({ kind: 'yt', id: v || path[1] });
      if (list) return cleanVideo({ kind: 'ytl', id: list, title: 'YouTube-Playlist' });
    }
    if (web && /^https?:$/.test(url.protocol) && url.hostname.includes('.')) {
      url.protocol = 'https:'; // im Truck nur verschlüsselt (die Sicherheitsregel lässt nur https-Rahmen zu)
      return cleanVideo({ kind: 'web', id: url.href });
    }
    return null;
  }

  // Seiten mit eigenem Einbett-Player: der sieht im Truck sauberer aus als die ganze Seite (ohne Menüs, Kommentare …)
  const EMBEDS = [
    [/(^|\.)pornhub\.(com|org)$/, (url) => (url.searchParams.get('viewkey') ? `https://www.pornhub.com/embed/${encodeURIComponent(url.searchParams.get('viewkey'))}` : '')],
  ];
  function webEmbedUrl(href) {
    try {
      const url = new URL(href);
      for (const [re, make] of EMBEDS) if (re.test(url.hostname)) return make(url) || href;
      return href;
    } catch {
      return href;
    }
  }

  // Kurzlink, der erst aufgelöst werden muss (vm.tiktok.com/…, vt.tiktok.com/…, tiktok.com/t/…)
  function isShortVideoLink(text) {
    try {
      const raw = String(text || '').trim();
      const url = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`);
      const host = url.hostname.replace(/^www\./, '');
      return /^(vm|vt)\.tiktok\.com$/.test(host) || (host === 'tiktok.com' && /^\/t\/\w+/.test(url.pathname));
    } catch {
      return false;
    }
  }
  // Nacht im Spiel (wie die Leuchten der KI im Kombiinstrument): 20:00 bis 6:30 Spielzeit
  const isGameNight = (gameTimeMin) => {
    if (gameTimeMin === null || gameTimeMin === undefined || gameTimeMin === '') return false; // unbekannt: Tag
    const m = Number(gameTimeMin);
    if (!Number.isFinite(m)) return false;
    const day = ((m % 1440) + 1440) % 1440;
    return day >= 20 * 60 || day < 6 * 60 + 30;
  };
  // Design, das das Kombiinstrument gerade zeigt. Das frühere „Design nachts“ ist entfernt (08.11.2026) – hell/dunkel regelt
  // „Hintergrund“; gameTimeMin bleibt in der Schnittstelle, damit alle Aufrufer unverändert bleiben
  const clusterDesignNow = (s, gameTimeMin) => { void gameTimeMin; return (s && s.clusterDesign) || 'dials'; };
  // Sichtbarer Bereich des Navi-Displays (Rand in % der Textur) für Lkw, die vom quadratischen Navi-Bild des Spiels nur einen
  // Ausschnitt zeigen. Berechnet aus den Cockpit-Modellen (13.11.2026, Issue #6): UV-Koordinaten der Fläche mit gps.tobj, oben =
  // 1 − v. Scania R/Streamline sind im Spiel gemessen (12.11.) und decken sich mit der Rechnung (1,9 / 22,7 / 1,9 / 29,1).
  // Nur Lkw, bei denen alle Innenausstattungen mit Navi denselben Ausschnitt haben – das Spiel meldet die Ausstattung nicht.
  // Lkw mit verschiedenen Cockpits stehen als „lkw@familie“: Instrumenten-Familie der Innenausstattung (Materialordner unter
  // /material/ui/dashboard/, das Plugin liest sie ab 1.18.6 aus dem Spiel). Ohne erkannte Familie gilt der Eintrag des Lkw – bei
  // diesen keiner (ganzes Bild wie früher): Scania R/S 2016 normal (scania_2016) Streifen, Smartdash (scania_2025) volle Fläche;
  // Renault T 2019 (renault_t) Streifen, 2024 voll; Cascadia mit Zeigern (…_2019, …_2024_gauge) Streifen, digital voll.
  // S 2024e hat nur Ausstattungen mit Ausschnitt.
  // Eigene Werte: displayAreas
  const DISPLAY_AREAS = {
    'scania.r': { l: 1, t: 23, r: 2, b: 29 },
    'scania.streamline': { l: 1, t: 23, r: 2, b: 29 },
    // ETS2
    'daf.xf': { l: 0, t: 14, r: 0, b: 31 },
    'daf.xf_euro6': { l: 1, t: 17, r: 1, b: 23 },
    'iveco.hiway': { l: 2, t: 17, r: 2, b: 24 },
    'iveco.stralis': { l: 2, t: 24, r: 2, b: 31 },
    'man.tgx': { l: 2, t: 23, r: 2, b: 31 },
    'man.tgx_euro6': { l: 1, t: 8, r: 1, b: 34 },
    'mercedes.actros2014': { l: 1, t: 14, r: 1, b: 21 },
    'scania.s_2024e': { l: 1, t: 12, r: 1, b: 27 },
    'scania.r_2016@scania_2016': { l: 1, t: 12, r: 1, b: 27 },
    'scania.s_2016@scania_2016': { l: 1, t: 12, r: 1, b: 27 },
    'renault.t@renault_t': { l: 0, t: 12, r: 0, b: 21 }, // EU 12,8/22,4, UK 11,4/20,7
    'volvo.fh16': { l: 2, t: 19, r: 2, b: 26 },
    'volvo.fh16_2012': { l: 0, t: 23, r: 0, b: 23 },
    // ATS
    'intnational.lonestar': { l: 0, t: 23, r: 0, b: 23 },
    'intnational.lt': { l: 0, t: 23, r: 0, b: 23 },
    'kenworth.t680': { l: 0, t: 20, r: 0, b: 20 },
    'kenworth.w900': { l: 1, t: 17, r: 1, b: 17 },
    'mack.anthem': { l: 1, t: 23, r: 0, b: 23 },
    'mack.pinnacle': { l: 1, t: 23, r: 0, b: 23 },
    'peterbilt.389': { l: 0, t: 21, r: 0, b: 21 },
    'peterbilt.579': { l: 1, t: 16, r: 1, b: 16 },
    'volvo.vnl': { l: 0, t: 25, r: 0, b: 25 },
    'westernstar.49x': { l: 0, t: 15, r: 0, b: 15 },
    'freightliner.cascadia2019@freightliner_cascadia_2019': { l: 0, t: 15, r: 0, b: 15 },
    'freightliner.cascadia2024@freightliner_cascadia_2024_gauge': { l: 0, t: 15, r: 0, b: 15 },
  };
  // Kombiinstrument: Fahrzeuge, deren Display einen Teil der Fläche nicht zeigt – MAN Lion's Coach (Bus-DLC): unten fehlten ~4 %
  // (Leiste mit Temperatur, Reichweite und AdBlue; aus dem Spielbild 12.11.2026 zurückgerechnet). MAN TGX 2020 genauso
  // (Spielbild 13.11.2026; gleiches Instrumenten-Layout wie der Lion's Coach, der Rahmen verdeckt unten). Eigene Werte: clusterAreas
  const CLUSTER_AREAS = {
    'man.lions_24': { l: 0, t: 0, r: 0, b: 6 },
    'man.tgx_2020': { l: 0, t: 0, r: 0, b: 6 },
  };
  // Kombiinstrument mit stark abgerundeten Ecken: Blinkerpfeile und die Enden der Leiste unten rücken nach innen
  // (Lion's Coach: die Pfeile oben in den Ecken lagen hinter dem Rahmen)
  const CLUSTER_ROUND = new Set(['man.lions_24', 'man.tgx_2020']); // TGX 2020: schräge Ecken wie der Lion's Coach; Volvo 9700 nicht: rechteckiges Display (Spielbild 12.11.2026)
  // Kombiinstrument ohne Blinkerpfeile im Original-Display (echte Leuchten daneben): ui/dashboard/*.sii ohne lblinkr/lblink/
  // blinker_l/l_blk (ETS2/ATS 1.62, 13.11.2026). Mit Pfeilen: Volvo FH 2021/2024, 9700, Renault T 2024/E-Tech, Scania Smartdash,
  // Cascadia digital, Western Star 57X, Ford F-150 – dort bleiben sie (Einstellung clusterBlinkers: auto)
  const CLUSTER_NO_BLINKERS = new Set(['man.tgx_2020', 'man.lions_24', 'daf.2021', 'daf.xd', 'daf.xf_electric', 'iveco.sway', 'kenworth.t680_2022', 'volvo.vnl2025', 'ford.bronco_24']);
  const catalog = { CLUSTER_AREAS, CLUSTER_ROUND, CLUSTER_NO_BLINKERS, DISPLAY_AREAS, isGameNight, clusterDesignNow, APPS, COLORS, WALLPAPERS, WIDGETS, PAGE_WIDGETS, CORNERS, OVERLAYS, POSITION_NAMES, MAP_STYLES, DEFAULTS, parseVideo, cleanVideo, isShortVideoLink, webEmbedUrl };

  // Apps in der Seitenleiste (oben Navi, Mitte Audio, unten zuletzt benutzte andere App)
  // count: 3 oder 4 – bei „zuletzt benutzt“ kommt als vierte die vorletzte andere App dazu (wie CarPlay auf hohen Displays)
  catalog.sidebarApps = (s, count = 3) => (s.sidebarMode === 'auto'
    ? [...new Set([s.recents.nav, s.recents.audio, s.recents.other, s.recents.other2].filter(Boolean))].slice(0, count)
    : s.dock.slice(0, count));

  // Fremde/alte Einstellungen auf gültige Werte bringen
  // Schlüssel wirklich im Katalog (nicht geerbt): „toString“, „constructor“, „__proto__“ hielten sonst als gültige Farbe,
  // Hintergrund oder Widget – die Oberfläche stürzte danach bei jedem Zeichnen ab (Durchsicht 25.11.)
  const own = (map, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key);
  catalog.sanitize = function sanitize(input) {
    const s = JSON.parse(JSON.stringify(DEFAULTS));
    const src = input && typeof input === 'object' ? input : {};
    const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
    const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
    const appIds = Object.keys(APPS);

    s.wallpaper = src.wallpaper === 'custom' || own(WALLPAPERS, src.wallpaper) || /^file:[\w .()-]{1,80}$/.test(src.wallpaper || '') ? src.wallpaper : s.wallpaper;
    s.appearance = pick(src.appearance, ['dark', 'light', 'auto', 'lights'], s.appearance);
    s.glass = pick(src.glass, ['full', 'clear', 'reduced', 'off'], s.glass);
    // Liquid-Glass-Regler (22.11.): ohne gespeicherten Wert aus der alten Wahl übernehmen – Klar 20, Normal/Sparsam 50, Aus 100
    const oldTint = { clear: 20, full: 50, reduced: 50, off: 100 }[s.glass];
    s.glassTint = Number.isFinite(Number(src.glassTint)) && src.glassTint !== null && src.glassTint !== '' ? Math.max(0, Math.min(100, Math.round(Number(src.glassTint)))) : oldTint;
    s.glassReduce = typeof src.glassReduce === 'boolean' ? src.glassReduce : s.glass === 'reduced' || s.glass === 'off';
    s.iconTheme = pick(src.iconTheme, ['brands', 'apple', 'classic'], s.iconTheme);
    // Übernahme: wer bis 1.22 das Apple-Set gewählt hatte, behält das Apple-Musik-Symbol
    s.musicIcon = pick(src.musicIcon, ['auto', 'spotify', 'apple'], s.iconTheme === 'apple' ? 'apple' : s.musicIcon);
    s.mapsIcon = pick(src.mapsIcon, ['auto', 'google', 'apple'], s.mapsIcon);
    if (src.gameDirs && typeof src.gameDirs === 'object') {
      for (const id of ['ets2', 'ats']) {
        const v = src.gameDirs[id];
        s.gameDirs[id] = typeof v === 'string' && v.length < 400 && !/[\u0000-\u001f]/.test(v) ? v : '';
      }
    }
    if (s.iconTheme === 'apple') s.iconTheme = 'brands';
    s.iconStyle = pick(src.iconStyle, ['color', 'dark', 'clear'], s.iconStyle);
    s.sidebar = pick(src.sidebar, ['left', 'right', 'top', 'bottom'], s.sidebar);
    s.sidebarMode = pick(src.sidebarMode, ['auto', 'fixed'], s.sidebarMode);
    s.sidebarCount = pick(String(src.sidebarCount), ['auto', '3', '4'], s.sidebarCount);
    s.logoStore = pick(src.logoStore, ['save', 'stream'], s.logoStore);
    s.phoneBattery = pick(src.phoneBattery, ['off', 'on', 'charging'], s.phoneBattery);
    s.phoneSignal = pick(src.phoneSignal, ['auto', '5g', 'off'], s.phoneSignal);
    s.gpuTransfer = bool(src.gpuTransfer, s.gpuTransfer);
    s.mapAutoUpdate = bool(src.mapAutoUpdate, s.mapAutoUpdate);
    s.mapLearn = bool(src.mapLearn, s.mapLearn);
    s.laneShare = bool(src.laneShare, s.laneShare);
    s.brandIcon = bool(src.brandIcon, s.brandIcon);
    s.laneMarker = bool(src.laneMarker, s.laneMarker);
    s.stackJump = bool(src.stackJump, s.stackJump);
    s.mirrorCamTrucks = Array.isArray(src.mirrorCamTrucks)
      ? [...new Set(src.mirrorCamTrucks.filter((id) => typeof id === 'string' && /^[a-z0-9_.]{1,60}$/.test(id)))].slice(0, 40) : s.mirrorCamTrucks;
    s.curveWarn = bool(src.curveWarn, s.curveWarn);
    s.mapNextLimit = bool(src.mapNextLimit, s.mapNextLimit);
    s.mapNextLimitStyle = pick(src.mapNextLimitStyle, ['side', 'below'], s.mapNextLimitStyle);
    const SPORT_IDS = ['bl1', 'bl2', 'bl3', 'dfb', 'ffb1', 'ucl', 'uel', 'uecl', 'pl', 'ech', 'la1', 'ita', 'fra', 'ned', 'por', 'aut', 'sui', 'tur', 'unl', 'intl', 'nfl', 'f1'];
    s.sportsLeague = pick(src.sportsLeague, SPORT_IDS, s.sportsLeague);
    // eigene Reihenfolge und ausgeblendete Ligen der Sport-App (nur bekannte Kürzel, jedes einmal)
    const sportIds = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => SPORT_IDS.includes(x)))] : []);
    s.sportsOrder = sportIds(src.sportsOrder ?? s.sportsOrder);
    s.sportsHidden = sportIds(src.sportsHidden ?? s.sportsHidden);
    s.sportsTeams = Array.isArray(src.sportsTeams) ? src.sportsTeams.filter((t) => typeof t === 'string' && /^[a-z0-9]{2,4}:\d{1,7}$/.test(t)).slice(0, 12) : s.sportsTeams;
    s.sportsMatches = Array.isArray(src.sportsMatches) ? src.sportsMatches.filter((t) => typeof t === 'string' && /^[a-z0-9]{2,4}:\d{1,9}$/.test(t)).slice(-10) : s.sportsMatches;
    s.sportsPush = bool(src.sportsPush, s.sportsPush);
    s.sportsF1 = bool(src.sportsF1, s.sportsF1);
    s.updateAuto = bool(src.updateAuto, s.updateAuto);
    s.updateInstall = bool(src.updateInstall, s.updateInstall);
    for (const k of ["Dispatcher","Jobs","Money","Warnings","Border","Radar","System","Sport"]) s['notify' + k] = bool(src['notify' + k], s['notify' + k]);
    s.language = ['auto', 'de', 'en', 'pl', 'tr', 'zh', 'zh-hant'].includes(src.language) ? src.language : s.language;
    s.units = ['auto', 'metric', 'us', 'uk'].includes(src.units) ? src.units : s.units;
    s.clock = ['auto', '24', '12'].includes(String(src.clock)) ? String(src.clock) : s.clock;
    // bis Version 4 gab es kein „wie im Spiel“: die alten Vorgaben (metrisch, 24 h) werden dazu – ETS2 ist so
    // eingestellt, ATS folgt dann seinen eigenen Optionen. Selbst gewählte andere Einheiten bleiben.
    if (!(src.version >= 5)) {
      if (s.units === 'metric') s.units = 'auto';
      if (s.clock === '24') s.clock = 'auto';
    }
    // bis Version 5: Installationen vor dem 17.10. hatten die GPU-Übertragung ab Werk aus – und damit auch keine
    // Hardware-Beschleunigung (main.js). Gemessen 22.11.: doppelte Prozessorlast, Bilder als Pixel über die Leitung ins Spiel.
    // Einmalig an; bei Problemen fällt die App für die Sitzung selbst zurück, ausschalten bleibt danach (Version 6) erhalten.
    // main.js (gpuSettingAtStart) prüft dieselbe Version, weil es vor dem Laden der Einstellungen entscheidet.
    if (!(src.version >= 6)) s.gpuTransfer = true;
    s.iconSize = pick(src.iconSize, ['normal', 'large'], s.iconSize);
    s.textScale = pick(src.textScale, ['small', 'normal', 'large', 'xlarge'], s.textScale);
    s.displayAreas = {};
    if (src.displayAreas && typeof src.displayAreas === 'object') {
      for (const [id, a] of Object.entries(src.displayAreas)) {
        if (!/^[a-z0-9_.]{1,60}$/.test(id) || !a || typeof a !== 'object') continue;
        const v = ['l', 't', 'r', 'b'].map((k) => Math.max(0, Math.min(45, Math.round(Number(a[k]) || 0))));
        s.displayAreas[id] = { l: v[0], t: v[1], r: v[2], b: v[3] };
      }
    }
    s.clusterAreas = {};
    if (src.clusterAreas && typeof src.clusterAreas === 'object') {
      for (const [id, a] of Object.entries(src.clusterAreas)) {
        if (!/^[a-z0-9_.]{1,60}$/.test(id) || !a || typeof a !== 'object') continue;
        const v = ['l', 't', 'r', 'b'].map((k) => Math.max(0, Math.min(45, Math.round(Number(a[k]) || 0))));
        s.clusterAreas[id] = { l: v[0], t: v[1], r: v[2], b: v[3] };
      }
    }
    s.displayFormats = {};
    if (src.displayFormats && typeof src.displayFormats === 'object') {
      for (const [id, f] of Object.entries(src.displayFormats)) {
        if (/^[a-z0-9_.]{1,60}$/.test(id) && ['16:9', '16:10', '4:3', '5:4', '2:1', '8:3'].includes(f)) s.displayFormats[id] = f;
      }
    }
    s.gamma = pick(src.gamma, ['off', 'light', 'balanced', 'strong', 'dim', 'custom'], s.gamma);
    s.gammaValue = [1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2.0, 2.2].includes(Number(src.gammaValue)) ? Number(src.gammaValue) : s.gammaValue;
    s.whiteLevel = [100, 95, 90, 86, 82, 78, 74, 70].includes(Number(src.whiteLevel)) ? Number(src.whiteLevel) : s.whiteLevel;
    s.mapZoom = Number.isInteger(src.mapZoom) && src.mapZoom >= 0 && src.mapZoom <= 5 ? src.mapZoom : s.mapZoom;
    s.mapTilt = bool(src.mapTilt, s.mapTilt);
    s.mapNorth = bool(src.mapNorth, s.mapNorth);
    s.mapAlong = bool(src.mapAlong, s.mapAlong);
    s.mapLights = bool(src.mapLights, s.mapLights);
    // Einrichtung: nur bei neuen Installationen (noch keine Einstellungen) – wer schon Einstellungen hat, sieht sie nicht
    s.setupDone = typeof src.setupDone === 'boolean' ? src.setupDone : Object.keys(src).length > 0;
    s.setupControl = pick(src.setupControl, ['touch', 'keys', 'phone'], '');
    s.navVoice = bool(src.navVoice, s.navVoice);
    s.mapBorder = bool(src.mapBorder, s.mapBorder);
    s.mapBorderVoice = bool(src.mapBorderVoice, s.mapBorderVoice);
    s.mapGrade = bool(src.mapGrade, s.mapGrade);
    s.mapGradeVoice = bool(src.mapGradeVoice, s.mapGradeVoice);
    s.busVoice = bool(src.busVoice, s.busVoice);
    s.gradeMin = [5, 6, 8, 10].includes(Number(src.gradeMin)) ? Number(src.gradeMin) : s.gradeMin;
    s.mapTheme = pick(src.mapTheme, ['system', 'light', 'dark', 'auto', 'lights'], s.mapTheme);
    for (const key of ['volumeVoice', 'volumeAnnounce', 'volumeAlerts', 'volumeSiri', 'volumeVideo', 'volumeRadio']) {
      const v = Number(src[key]);
      if (Number.isFinite(v) && v >= 0 && v <= 100) s[key] = Math.round(v); // alle Lautstärken in 1er-Schritten
    }
    s.mapStyle = pick(src.mapStyle, Object.keys(MAP_STYLES), s.mapStyle);
    s.mapTruckSize = pick(src.mapTruckSize, ['small', 'medium', 'large'], s.mapTruckSize);
    s.assistLayout = pick(src.assistLayout, ['split', 'scene'], s.assistLayout);
    s.mapHighways = bool(src.mapHighways, s.mapHighways);
    s.mapAreas = bool(src.mapAreas, s.mapAreas);
    s.mapBuildings = bool(src.mapBuildings, s.mapBuildings);
    s.mapWater = bool(src.mapWater, s.mapWater);
    s.mapInlandWater = bool(src.mapInlandWater, s.mapInlandWater);
    s.mapTrail = bool(src.mapTrail, s.mapTrail);
    s.mapDriven = bool(src.mapDriven, s.mapDriven);
    s.tracking = bool(src.tracking, s.tracking);
    s.aiAssistant = bool(src.aiAssistant, s.aiAssistant);
    s.radioView = pick(src.radioView, ['grid', 'list'], s.radioView);
    s.aiCalls = bool(src.aiCalls, s.aiCalls);
    s.aiGpu = bool(src.aiGpu, s.aiGpu);
    s.mapForest = bool(src.mapForest, s.mapForest);
    s.mapMeadow = bool(src.mapMeadow, s.mapMeadow);
    s.mapGround = bool(src.mapGround, s.mapGround);
    s.map3dBuildings = bool(src.map3dBuildings, s.map3dBuildings);
    s.mediaPauseWithGame = bool(src.mediaPauseWithGame, s.mediaPauseWithGame);
    s.nightDim = bool(src.nightDim, s.nightDim);
    s.mapViewpoints = bool(src.mapViewpoints, s.mapViewpoints);
    s.mapTowns = bool(src.mapTowns, s.mapTowns);
    s.mapSites = bool(src.mapSites, s.mapSites);
    s.mapSiteNames = bool(src.mapSiteNames, s.mapSiteNames);
    s.mapHiddenRoads = bool(src.mapHiddenRoads, s.mapHiddenRoads);
    s.mapLaneMarkings = bool(src.mapLaneMarkings, s.mapLaneMarkings);
    s.mapSecretRoads = bool(src.mapSecretRoads, s.mapSecretRoads);
    s.mapRails = bool(src.mapRails, s.mapRails);
    s.mapRoadClasses = bool(src.mapRoadClasses, s.mapRoadClasses);
    s.mapBusStops = bool(src.mapBusStops, s.mapBusStops);
    s.mapModNames = bool(src.mapModNames, s.mapModNames);
    s.mapShields = bool(src.mapShields, s.mapShields);
    s.mapLightIcons = bool(src.mapLightIcons, s.mapLightIcons);
    s.mapLabels = bool(src.mapLabels, s.mapLabels);
    s.mapPois = bool(src.mapPois, s.mapPois);
    s.dispatcher = pick(src.dispatcher, ['calls', 'messages', 'off'], s.dispatcher);
    // „auto“ (bis 1.14.11 vor dem Release: nach Tempo) gibt es nicht mehr – wird zum Weitwinkel
    s.mirrorView = pick(src.mirrorView === 'auto' ? 'wide' : src.mirrorView, ['wide', 'main'], s.mirrorView);
    s.mirrorFps = [20, 30, 60].includes(Number(src.mirrorFps)) ? Number(src.mirrorFps) : s.mirrorFps;
    s.voice = bool(src.voice, s.voice);
    s.voiceName = typeof src.voiceName === 'string' && src.voiceName.length < 60 ? src.voiceName : s.voiceName;
    if (s.voiceName === 'piper') s.voiceName = 'st-F4'; // Kerstin gibt es nicht mehr
    s.voiceLang = pick(src.voiceLang, ['ui', 'de', 'en', 'pl', 'tr', 'zh', 'zh-hant'], s.voiceLang);
    s.voiceZh = pick(src.voiceZh, ['K28', 'K13', 'K70', 'K90', 'win'], s.voiceZh);
    s.weather = bool(src.weather, s.weather);
    s.remote = bool(src.remote, s.remote);
    for (const key of ['radar', 'radarSound', 'radarWeigh', 'radarToll', 'radarBorder', 'spotify', 'mirrorCam', 'mirrorReplace', 'mirrorArrow']) s[key] = bool(src[key], s[key]);
    s.radarTolerance = [-1, 0, 3, 5, 10, 15].includes(Number(src.radarTolerance)) ? Number(src.radarTolerance) : s.radarTolerance;
    if (Array.isArray(src.cameras)) {
      s.cameras = src.cameras
        .filter((c) => c && Number.isFinite(c.x) && Number.isFinite(c.z))
        .slice(-400)
        // game: Spiel des Blitzers (ältere Einträge ohne Angabe sind aus ETS2) – die Koordinaten gelten nur dort
        .map((c) => ({ x: Math.round(c.x), z: Math.round(c.z), src: c.src === 'fine' ? 'fine' : 'user', at: Number(c.at) || 0, ...(c.game === 'ats' ? { game: 'ats' } : {}) }));
    }
    if (src.video && typeof src.video === 'object') {
      const items = Array.isArray(src.video.items) ? src.video.items.map(cleanVideo).filter(Boolean).slice(0, 20) : s.video.items;
      s.video = {
        items,
        current: Number.isInteger(src.video.current) && src.video.current >= -1 && src.video.current < items.length ? src.video.current : (items.length ? 0 : -1),
        driving: bool(src.video.driving, s.video.driving),
        // Bild im Bild: Video läuft beim Verlassen der Video-App klein in einer Ecke weiter (Ecke per Ziehen)
        pip: bool(src.video.pip, s.video.pip),
        pauseOnCall: bool(src.video.pauseOnCall, s.video.pauseOnCall),
        web: bool(src.video.web, s.video.web),
        pipCorner: pick(src.video.pipCorner, ['tl', 'tr', 'bl', 'br'], s.video.pipCorner),
        pipSize: pick(src.video.pipSize, ['s', 'm', 'l'], s.video.pipSize),
      };
    }
    if (src.browser && typeof src.browser === 'object') {
      const b = src.browser;
      const https = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' ? x.href.slice(0, 600) : null; } catch { return null; } };
      // Seitensymbol: nur kleines eingebettetes Bild (vom Hauptprozess geholt, main/browser-ipc.js)
      const icon = (v) => typeof v === 'string' && v.length < 33000 && /^data:image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(v);
      const pages = (list, max) => (Array.isArray(list) ? list : [])
        .map((p) => (p && https(p.url) ? { url: https(p.url), title: String(p.title || '').slice(0, 80), ...(icon(p.icon) ? { icon: p.icon } : {}) } : null)).filter(Boolean).slice(0, max);
      const zoom = {};
      for (const [host, pct] of Object.entries(b.siteZoom && typeof b.siteZoom === 'object' ? b.siteZoom : {}).slice(0, 200)) {
        if (/^[\w.-]{1,120}$/.test(host) && Number(pct) >= 50 && Number(pct) <= 250) zoom[host] = Math.round(Number(pct));
      }
      s.browser = {
        driving: bool(b.driving, s.browser.driving),
        editor: bool(b.editor, s.browser.editor),
        fullUrl: bool(b.fullUrl, s.browser.fullUrl),
        adblock: bool(b.adblock, s.browser.adblock),
        popups: bool(b.popups, s.browser.popups),
        zoom: [100, 110, 125, 150].includes(Number(b.zoom)) ? Number(b.zoom) : s.browser.zoom,
        favorites: pages(b.favorites, 24),
        recent: pages(b.recent, 12),
        tabs: (Array.isArray(b.tabs) ? b.tabs : []).map(https).filter(Boolean).slice(0, 5),
        siteZoom: zoom,
        mobileSites: (Array.isArray(b.mobileSites) ? b.mobileSites : []).filter((h) => typeof h === 'string' && /^[\w.-]{1,120}$/.test(h)).slice(0, 50),
      };
    }
    s.keyboard = ['auto', 'de', 'en', 'pl', 'tr', 'zh', 'zh-hant'].includes(src.keyboard) ? src.keyboard : 'auto';
    s.kbdSuggest = bool(src.kbdSuggest, s.kbdSuggest);
    s.kbdAutocorrect = bool(src.kbdAutocorrect, s.kbdAutocorrect);
    s.kbdAutoCap = bool(src.kbdAutoCap, s.kbdAutoCap);
    s.kbdPeriod = bool(src.kbdPeriod, s.kbdPeriod);
    s.mapFps = [30, 20, 15].includes(Number(src.mapFps)) ? Number(src.mapFps) : s.mapFps;
    s.showLabels = bool(src.showLabels, s.showLabels);
    s.clusterDesign = pick(src.clusterDesign, ['dials', 'bars', 'music', 'map', 'mapdials', 'service', 'trip', 'job', 'tesla'], s.clusterDesign);
    s.clusterAccent = pick(src.clusterAccent, ['blue', 'green', 'orange', 'red', 'teal', 'white', 'yellow', 'pink', 'purple', 'multi'], s.clusterAccent);
    s.clusterBackground = pick(src.clusterBackground, ['black', 'blue', 'graphite', 'light', 'gradient', 'topo', 'solid', 'mountains', 'waves', 'aurora', 'stars', 'wallpaper'], s.clusterBackground);
    s.clusterCenter = pick(src.clusterCenter, ['auto', 'nav', 'media', 'map', 'off'], s.clusterCenter);
    s.clusterArrows = pick(src.clusterArrows, ['small', 'large'], s.clusterArrows);
    s.clusterBlinkers = pick(src.clusterBlinkers, ['auto', 'on', 'off'], s.clusterBlinkers);
    {
      const all = ['dials', 'tesla', 'mapdials', 'map', 'music', 'bars', 'service', 'trip', 'job'];
      const list = Array.isArray(src.clusterCycle) ? all.filter((d) => src.clusterCycle.includes(d)) : s.clusterCycle;
      s.clusterCycle = list.length ? list : all;
    }
    s.clusterWidgets = src.clusterWidgets !== false;
    s.clusterDialInfo = src.clusterDialInfo !== false;
    s.clusterDialRight = pick(src.clusterDialRight, ['water', 'adblue', 'air'], s.clusterDialRight);
    s.clusterInfoStyle = pick(src.clusterInfoStyle, ['classic', 'apple'], s.clusterInfoStyle);
    s.clusterWidgetMode = pick(src.clusterWidgetMode, ['auto', 'fixed'], s.clusterWidgetMode);
    {
      const known = ['rest', 'delivery', 'range', 'fuel'];
      s.clusterWidgetList = Array.isArray(src.clusterWidgetList) ? known.filter((w) => src.clusterWidgetList.includes(w)) : s.clusterWidgetList;
    }
    s.clusterLaneWarn = bool(src.clusterLaneWarn, s.clusterLaneWarn);
    s.clusterBuildings = bool(src.clusterBuildings, s.clusterBuildings);
    s.clusterLightTimer = bool(src.clusterLightTimer, s.clusterLightTimer);
    s.clusterWorks = bool(src.clusterWorks, s.clusterWorks);
    s.clusterLeadDist = bool(src.clusterLeadDist, s.clusterLeadDist);
    s.clusterLeadColor = bool(src.clusterLeadColor, s.clusterLeadColor);
    s.clusterBlindSpot = bool(src.clusterBlindSpot, s.clusterBlindSpot);
    s.clusterReverseAid = bool(src.clusterReverseAid, s.clusterReverseAid);
    s.clusterReversePath = bool(src.clusterReversePath, s.clusterReversePath);
    s.clusterNextLimit = bool(src.clusterNextLimit, s.clusterNextLimit);
    s.clusterFocus = pick(src.clusterFocus, ['nav', 'media'], s.clusterFocus);
    s.clusterBoth = bool(src.clusterBoth, s.clusterBoth);
    s.clusterCover = bool(src.clusterCover, s.clusterCover);
    s.clusterInfo = bool(src.clusterInfo, s.clusterInfo);
    s.clusterFps = [10, 15, 20, 30].includes(Number(src.clusterFps)) ? Number(src.clusterFps) : s.clusterFps;
    s.clusterBoot = bool(src.clusterBoot, s.clusterBoot);
    s.clusterNotes = bool(src.clusterNotes, s.clusterNotes);
    s.clusterBootStyle = pick(src.clusterBootStyle, ['logo', 'hello'], s.clusterBootStyle);
    s.clusterGauge = pick(src.clusterGauge, ['standard', 'thin', 'thick', 'needle', 'classic', 'sport'], s.clusterGauge);
    s.clusterTint = pick(src.clusterTint, ['accent', 'copper', 'teal', 'olive', 'red', 'gold', 'sand', 'slate', 'rose', 'midnight'], s.clusterTint);
    s.clusterShiftHint = bool(src.clusterShiftHint, s.clusterShiftHint);
    s.mirrorTarget = pick(src.mirrorTarget, ['gps', 'cluster', 'both'], s.mirrorTarget);
    s.musicArt = pick(src.musicArt, ['right', 'left'], s.musicArt);
    s.startScreen = pick(src.startScreen, ['last', 'home', ...appIds.filter((id) => id !== 'standby')], s.startScreen);
    s.lastScreen = pick(src.lastScreen, ['home', 'widgets', ...appIds.filter((id) => id !== 'settings' && id !== 'standby')], 'dashboard');

    if (Array.isArray(src.home)) {
      const home = [...new Set(src.home.filter((id) => appIds.includes(id)))];
      for (const id of appIds) if (!home.includes(id)) home.push(id); // keine App geht verloren
      s.home = home;
    }
    if (Array.isArray(src.dock)) s.dock = [...new Set(src.dock.filter((id) => appIds.includes(id)))].slice(0, 4);

    if (src.recents && typeof src.recents === 'object') {
      for (const kind of ['nav', 'audio', 'other']) {
        const id = src.recents[kind];
        if (own(APPS, id) && APPS[id].kind === kind) s.recents[kind] = id;
      }
      const second = src.recents.other2;
      if (own(APPS, second) && APPS[second].kind === 'other' && second !== s.recents.other) s.recents.other2 = second;
      s.recents.next = src.recents.next === 'other' ? 'other' : 'other2';
    }

    if (src.apps && typeof src.apps === 'object') {
      for (const id of appIds) {
        const o = src.apps[id];
        if (!o || typeof o !== 'object') continue;
        const entry = {};
        if (typeof o.name === 'string' && o.name.trim()) entry.name = o.name.trim().slice(0, 20);
        if (own(COLORS, o.color)) entry.color = o.color;
        if (Object.keys(entry).length) s.apps[id] = entry;
      }
    }

    const widgets = src.dashboard && Array.isArray(src.dashboard.widgets) ? src.dashboard.widgets : null;
    if (widgets) {
      const valid = [...new Set(widgets.filter((w) => own(WIDGETS, w)))];
      for (const w of DEFAULTS.dashboard.widgets) if (valid.length < 3 && !valid.includes(w)) valid.push(w);
      s.dashboard.widgets = valid.slice(0, 3);
      // Bis Version 2 lag Musik oben rechts – bei CarPlay liegt sie unten rechts
      if (!(src.version >= 3) && s.dashboard.widgets[1] === 'music') {
        [s.dashboard.widgets[1], s.dashboard.widgets[2]] = [s.dashboard.widgets[2], 'music'];
      }
    }

    // Widget-Seite: zwei Stapel mit je bis zu fünf Widgets, im Stapel jedes nur einmal; ein leerer Stapel bleibt leer
    const wp = src.widgetPage && typeof src.widgetPage === 'object' ? src.widgetPage : null;
    if (wp) {
      s.widgetPage = {
        on: typeof wp.on === 'boolean' ? wp.on : true,
        smart: typeof wp.smart === 'boolean' ? wp.smart : false,
        cols: Number(wp.cols) === 3 ? 3 : 2,
        stacks: [0, 1, 2].map((i) => [...new Set((Array.isArray(wp.stacks?.[i]) ? wp.stacks[i] : DEFAULTS.widgetPage.stacks[i]).filter((w) => own(PAGE_WIDGETS, w)))].slice(0, 5)),
      };
    }

    const stacks = src.dashboard && Array.isArray(src.dashboard.stacks) ? src.dashboard.stacks : null;
    if (stacks) {
      s.dashboard.stacks = [0, 1, 2].map((i) => (Array.isArray(stacks[i]) ? [...new Set(stacks[i].filter((w) => own(WIDGETS, w)))].slice(0, 6) : []));
    } else if (widgets) {
      s.dashboard.stacks = [[], [], []]; // ältere Einstellungen: keine Stapel
    }
    // Version 4: Navigations-Widget neu – oben rechts in den Stapel legen (kommt bei aktiver Route nach vorne)
    if (widgets && !(src.version >= 4)) {
      const all = [...s.dashboard.widgets, ...s.dashboard.stacks.flat()];
      if (!all.includes('nav')) s.dashboard.stacks[1] = ['nav', ...s.dashboard.stacks[1]].slice(0, 6);
    }

    const cleanOverlays = (o, fallback) => {
      const banner = { top: 'top-left', bottom: 'top-left' }[o.banner] || o.banner;
      return {
        banner: pick(banner, OVERLAYS.banner, fallback.banner),
        eta: pick(o.eta, OVERLAYS.eta, fallback.eta),
        speed: pick(o.speed, CORNERS, fallback.speed),
        compass: pick(o.compass, CORNERS, fallback.compass),
      };
    };
    const cleanFree = (f) => ({ banner: bool(f.banner, false), speed: bool(f.speed, false) });
    if (src.overlays && typeof src.overlays === 'object') s.overlays = cleanOverlays(src.overlays, s.overlays);
    if (src.overlayFree && typeof src.overlayFree === 'object') s.overlayFree = cleanFree(src.overlayFree);
    // Positionen je Kartenstil (Issue #9): beim Wechsel des Stils gemerkt und wiederhergestellt (02-einstellungen.js)
    s.overlaysByStyle = {};
    if (src.overlaysByStyle && typeof src.overlaysByStyle === 'object') {
      for (const style of Object.keys(MAP_STYLES)) {
        const saved = src.overlaysByStyle[style];
        if (!saved || typeof saved !== 'object' || !saved.overlays || typeof saved.overlays !== 'object') continue;
        s.overlaysByStyle[style] = {
          overlays: cleanOverlays(saved.overlays, DEFAULTS.overlays),
          overlayFree: cleanFree(saved.overlayFree && typeof saved.overlayFree === 'object' ? saved.overlayFree : {}),
        };
      }
    }
    return s;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = catalog;
  else root.CarPlayCatalog = catalog;
})(typeof window !== 'undefined' ? window : globalThis);
