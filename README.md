# audio-feedback

Laat gebruikers van een webapp inspreken wat ze zien of ervaren. Een zwevend kaartje in de
hoek neemt audio op (met pauzeren en hervatten) en stuurt die naar onze server, samen met de
URL van de pagina waar ze naar keken. De pagina zelf wordt niet opgeslagen.

```html
<script src="https://audio-feedback.hetzner.bobreijnders.nl/widget.js" data-project="mijn-app" defer></script>
```

Meer is er niet nodig om het in een app te zetten. De widget heeft geen afhankelijkheden, is
26 kB groot (ongecomprimeerd) en raakt de CSS en de sneltoetsen van de app niet.

## Voorstel

### Wat de gebruiker ziet

1. **Kaartje rechtsonder** met een korte uitleg en de knop **Opnemen**. Het is te verslepen en
   te minimaliseren tot een pil; positie en stand worden onthouden.
2. **Opnemen**: een lopende tijd, een niveaumeter en de knoppen **Pauzeren/Hervatten** en
   **Stoppen**. Geminimaliseerd toont de pil de lopende tijd.
3. **Terugluisteren**: een speler, en de lijst met pagina's die meegaan, zodat de gebruiker ziet
   wat er verstuurd wordt. Daarna **Versturen** of **Weggooien**.
4. **Bedankt**, en daarna weer klaar voor een nieuwe opname.

### Wat er meegaat

| Veld | Inhoud |
|---|---|
| audio | Opus in WebM (Chrome, Firefox) of AAC in MP4 (Safari), 32 kbit/s: ~240 kB per minuut |
| `url`, `title` | de pagina waar de opname begon |
| `timeline` | elke pagina-wissel tijdens de opname (`pushState`, hash, gewone navigatie), plus pauze en hervat, met de positie in de opname. In de beheerpagina klik je op een tijd en hoor je wat er bij die pagina gezegd werd |
| `context` | vrije sleutel-waardeparen van de app zelf, bijvoorbeeld versie of omgeving |
| `client` | user agent, taal, venstergrootte |

Wat er niet meegaat: de inhoud van de pagina, schermafbeeldingen, cookies of IP-adres in de
opslag.

### Keuzes

- **Eén scripttag, Shadow DOM.** Werkt in elke stack (vanilla, Angular, React). De Shadow DOM
  houdt de CSS van de app buiten en die van ons binnen.
- **Toetsen en klikken blijven in het kaartje.** Apps met sneltoetsen op `window` (spatie in
  het spel, Ctrl+Z in de editors) zien bij een Shadow DOM alleen de host als target en kunnen
  dus niet zien dat de toets voor een knop van ons was. De widget stopt daarom `keydown`,
  `keyup`, `click`, `pointerdown` en dergelijke bij de host. `pointerup` en `pointermove` gaan
  wel door, anders blijft een sleepactie van de app hangen. Na een muisklik laat het kaartje de
  focus los, zodat de volgende spatie weer voor de app is.
- **Niets gaat verloren.** Elke seconde audio gaat meteen naar IndexedDB. Laadt de pagina
  opnieuw tijdens een opname, crasht de tab, of mislukt de upload, dan biedt het kaartje de
  opname bij het volgende bezoek aan om alsnog te versturen. Een Web Lock bepaalt welke tab
  eigenaar is, zodat een tweede tab geen lopende opname overneemt.
- **Geen CORS-preflight.** De upload is een multipart `POST` zonder eigen headers. De server
  controleert de `Origin` tegen een lijst.
- **Geen tests verstoren.** Onder `navigator.webdriver` (Playwright, Selenium) toont de widget
  zich niet, tenzij je `data-allow-webdriver` zet. Zo blijven e2e-tests en schermafdrukken van
  de apps zoals ze waren.
- **Privacy.** Spraak is een persoonsgegeven. Het kaartje zegt vooraf wat er meegaat, er wordt
  pas opgenomen na een klik, in een pauze staat de microfoon uit, en de server verwijdert
  opnames na 90 dagen (`RETENTION_DAYS`). Een privacyverklaring per app blijft wel nodig.

## De drie apps: kunnen ze ermee overweg?

Ja, alle drie, zonder dat er in de apps iets anders hoeft te veranderen dan de scripttag. Dat
is geproefd met `scripts/try-hosts.ts`. Dat script laadt de echte app in Chromium, voegt de
widget toe, neemt met een nep-microfoon op terwijl het in de app navigeert, en controleert wat
er bij de server aankomt.

| | defend-greenland (wings of fury) | elektra-ontwerper | meterkast (elektra-quick-designer) |
|---|---|---|---|
| geproefd op | live site | live site | lokale build, ingelogd, met een nieuw ontwerp |
| CSP / Permissions-Policy | geen (alleen de headers van de host-Caddy) | geen | geen |
| URL-wissels | `?quality=`, `/editor`, `#level` | `?proef=` | hash-routes `#/ontwerp/<id>/<tab>` |
| in de tijdlijn | ✔ | ✔ | ✔ elke tabwissel |
| toetsen lekken niet | ✔ spatie, Enter, Escape, Ctrl+Z bereiken het spel niet. Tegenproef: dezelfde Escape buiten het kaartje sluit de ranglijst wel | ✔ Ctrl+Z/Y bereikt de kast-editor niet | ✔ Ctrl+Z bereikt de undo niet |
| fouten van de widget | geen | geen | geen |

Per app, om op te letten:

- **defend-greenland**: zet de tag in `index.html` na de `<script type="module">` (regel ~2554).
  De z-index van het kaartje (2147483000) ligt boven het startscherm (40). De e2e-test
  `webgl.spec.ts` faalt op elke `console.error`, maar onder Playwright laat de widget zich niet
  zien, dus dat blijft groen. `deploy:check` en de buildtests kijken alleen naar `dist/`, en daar
  komt de widget niet in.
- **elektra-ontwerper**: zet de tag in `apps/web/src/index.html` na `<app-root>`. Op 1280×720
  bedekt het kaartje de onderkant van de sneltoetsenlijst rechts. Gebruikers kunnen het
  verslepen of minimaliseren. Wie het standaard klein wil: `data-minimized`.
- **meterkast**: zet de tag in `index.html` na de `<script type="module">`. Het kaartje staat
  er ook op het inlogscherm. Bij afdrukken (groepenlijst) verdwijnt het. De ontwerp-id staat in
  de URL, dus in de feedback is te zien over welk ontwerp het ging. Wil je dat niet:
  `data-strip-hash`.

## Integreren

```html
<script
  src="https://audio-feedback.hetzner.bobreijnders.nl/widget.js"
  data-project="meterkast"
  data-position="bottom-right"
  data-context='{"versie": "1.4.0"}'
  defer></script>
```

| Attribuut | Standaard | Betekenis |
|---|---|---|
| `data-project` | hostnaam | naam waaronder de opnames binnenkomen (`[A-Za-z0-9._-]`) |
| `data-endpoint` | origin van `widget.js` | waar de server staat |
| `data-position` | `bottom-right` | `bottom-left`, `top-right`, `top-left` |
| `data-max-duration` | `600` | maximale opnameduur in seconden (hooguit 1800) |
| `data-minimized` | uit | begint als pil |
| `data-strip-query` / `data-strip-hash` | uit | laat query of hash weg uit de opgeslagen URL's |
| `data-context` | — | JSON-object met extra velden |
| `data-allow-webdriver` | uit | ook tonen onder Playwright/Selenium |
| `data-manual` | uit | niet vanzelf starten; roep `AudioFeedback.init()` aan |

Vanuit de app zelf:

```js
AudioFeedback.setContext({ gebruiker: 'tester-3', ontwerp: id }); // gaat mee met de volgende opname
AudioFeedback.open();      // kaartje openklappen
AudioFeedback.minimize();
AudioFeedback.destroy();   // weghalen
AudioFeedback.init({ project: 'x', position: 'top-left' }); // met data-manual
```

Instellingen kunnen ook in `window.AudioFeedbackConfig = {...}` vóór het script.

Krijgt een app ooit een Content-Security-Policy, dan zijn nodig: `script-src` en `connect-src`
voor de server, en `media-src blob:` voor het terugluisteren. Een `Permissions-Policy` moet
`microphone=(self)` toelaten. In een iframe is `allow="microphone"` nodig. Opnemen kan alleen
via https of op localhost.

## Server

Node zonder runtime-dependencies (`node:http`, TypeScript via de ingebouwde type stripping).

| Route | |
|---|---|
| `GET /widget.js` | het script |
| `POST /api/recordings` | upload: multipart met `meta` (JSON) en `audio`. Controleert de origin, het formaat (aan de eerste bytes, niet aan wat de client zegt), de grootte en het aantal per IP. Dezelfde id twee keer is geen dubbele |
| `GET /admin` | beheerpagina: luisteren, per pagina naar de tijd springen, filteren per project, downloaden, verwijderen |
| `GET /api/recordings[?project=]` | lijst als JSON |
| `GET /api/recordings/:id/audio` | audio, met Range-requests |
| `DELETE /api/recordings/:id` | verwijderen |
| `GET /` | demopagina met de widget |
| `GET /health` | `{ ok, version }` |

`/admin` en de `GET`/`DELETE` op `/api/recordings` vragen Basic auth: een willekeurige naam, en
`ADMIN_PASSWORD` als wachtwoord.

| Variabele | Standaard | |
|---|---|---|
| `ALLOWED_ORIGINS` | leeg: alleen de eigen origin | komma-gescheiden. Mag `https://*.example.nl` of `*` bevatten |
| `ADMIN_PASSWORD` | leeg: beheer staat uit | |
| `DATA_DIR` | `./data` | opnames in `recordings/<id>.webm` en `<id>.json` |
| `RETENTION_DAYS` | `90` | ouder wordt verwijderd. `0` bewaart alles |
| `MAX_UPLOAD_MB` | `9.5` | onder de 10 MB van de host-Caddy |
| `RATE_LIMIT_PER_HOUR` | `60` | uploads per IP |
| `TRUST_PROXY` | `true` | IP uit `X-Forwarded-For` (Caddy) |
| `PORT`, `HOST` | `8080`, `0.0.0.0` | |

## Ontwikkelen

```bash
npm install
npm run dev              # widget bouwen bij wijzigingen + server op :8080, demo op http://localhost:8080/
npm run check            # typecheck, servertests, browsertests
node scripts/try-hosts.ts [defend-greenland|elektra-ontwerper|meterkast]   # proef op de echte apps
```

De browsertests (`e2e/`) gebruiken de nep-microfoon van Chromium en draaien de hostpagina op een
andere origin dan de server, zodat de upload echt cross-origin is. Op deze machine mist Chromium
systeembibliotheken. `BROWSER_SYSROOT` wijst naar een map met uitgepakte libs. Standaard is dat
de `.browser-deps` van wings of fury (`npm run setup:browser` daar).

Niet automatisch getest: Safari en Firefox. De code kiest per browser een formaat dat
`MediaRecorder` kan (WebM/Opus, Ogg/Opus, MP4/AAC), en de server accepteert alle drie. Een
handmatige proef op een iPhone is nog nodig voordat dit breed uitgaat.

## Uitrollen

`Dockerfile` bouwt de widget in de container, dus er hoeft vooraf niets op de host gebouwd te
worden. `compose.yaml` zet de app op poort 3029, met `./data` als volume en geheimen uit `.env`.

Eenmalig een wachtwoord voor `/admin`:

```bash
echo "ADMIN_PASSWORD=$(openssl rand -base64 24)" > .env && chmod 600 .env
```

Uitrollen (MCP-tool van release-scripting; een build vooraf is niet nodig, dat doet de `Dockerfile`):

```
run_app(project_dir="/home/botrey/projects/audio-feedback", app="audio-feedback", kind="node", rebuild=true)
```

Verifiëren: de live `widget.js` hoort byte-gelijk te zijn aan een verse lokale build
(esbuild is deterministisch).

```bash
npm run build && curl -fsS https://audio-feedback.hetzner.bobreijnders.nl/widget.js | cmp - dist/widget.js && echo live == build
```

Een nieuwe app laten insturen: voeg zijn origin toe aan `ALLOWED_ORIGINS` in `compose.yaml` en
rol opnieuw uit.
