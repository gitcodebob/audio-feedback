# audio-feedback

Laat gebruikers van een webapp inspreken wat ze zien of ervaren. Een zwevend kaartje in de
hoek neemt audio op (met pauzeren en hervatten) en stuurt die naar onze server, samen met het
adres van de pagina waar ze naar keken. De pagina zelf wordt niet opgeslagen.

```html
<script src="https://audio-feedback.hetzner.bobreijnders.nl/widget.js" data-project="mijn-app" data-hosts="mijn-app.example.nl" defer></script>
```

Meer is er niet nodig om het in een app te zetten. De widget heeft geen afhankelijkheden, is
31 kB groot (ongecomprimeerd), plus Montserrat (38 kB, van onze eigen server) en raakt de CSS en de sneltoetsen van de app niet.

## Voorstel

### Wat de gebruiker ziet

1. **Kaartje rechtsonder** met een korte uitleg en de knop **Opnemen**. Het is te verslepen en
   te minimaliseren tot een pil; positie en stand worden onthouden.
2. **Opnemen**: een lopende tijd, een niveaumeter en de knoppen **Pauzeren/Hervatten** en
   **Stoppen**. Geminimaliseerd toont de pil de lopende tijd.
3. **Terugluisteren**: een speler, en de lijst met pagina's die meegaan, zodat de gebruiker ziet
   wat er verstuurd wordt. Daarna **Versturen** of **Weggooien**.
4. **Bedankt**, met een kenmerk (de eerste 8 tekens van het id) en de bewaartermijn. Met dat
   kenmerk is de opname in `/admin` terug te vinden als iemand hem wil laten inzien of
   verwijderen. Na 30 seconden is het kaartje weer klaar voor een nieuwe opname.

### Wat er meegaat

| Veld | Inhoud |
|---|---|
| audio | Opus in WebM (Chrome, Firefox) of AAC in MP4 (Safari), 32 kbit/s: ~240 kB per minuut |
| `url`, `title` | de pagina waar de opname begon. Standaard alleen het pad, zonder query en hash: daarin staan vaak tokens, zoektermen of ids. Zie `data-keep-params` en `data-strip-hash` |
| `timeline` | elke pagina-wissel tijdens de opname (`pushState`, gewone navigatie, en de hash als die meegaat), plus pauze en hervat, met de positie in de opname. In de beheerpagina klik je op een tijd en hoor je wat er bij die pagina gezegd werd |
| `context` | vrije sleutel-waardeparen van de app zelf, bijvoorbeeld versie of omgeving |
| `client` | user agent, taal, venstergrootte |

Wat er niet meegaat: de inhoud van de pagina, schermafbeeldingen, cookies of IP-adres in de
opslag. Ook de serverlog bevat alleen project, id en duur, geen URL.

### Keuzes

- **Huisstijl van topicus.nl**: geel `#f8e800` en donkerblauw `#242f36`, Montserrat, pilvormige
  knoppen die bij hover van onderen vollopen. Volgt het donkere thema van het systeem. Montserrat
  (OFL) komt van onze eigen server, via de FontFace-API met een eigen familienaam: geen verzoek
  naar Google Fonts, en de lettertypen van de app blijven ongemoeid.

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
- **Privacy.** Spraak is een persoonsgegeven. Het kaartje zegt vooraf wat er meegaat, en
  linkt met `data-privacy-url` naar de privacyverklaring van de app. Opnemen begint pas na een
  klik, en in een pauze wordt niets opgenomen. De server verwijdert opnames na 90 dagen
  (`RETENTION_DAYS`). Een opname die niet verstuurd is, blijft hooguit een dag in de browser
  staan. Anders krijgt de volgende gebruiker van een gedeelde computer hem nog aangeboden. Apps
  met een login roepen bij uitloggen `AudioFeedback.clear()` aan. Een privacyverklaring per app
  blijft nodig.

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

- **defend-greenland**: zet de tag in `index.html` na de `<script type="module">` (regel ~2554),
  met `data-keep-params="quality" data-strip-hash="false"`, anders ontbreken kwaliteit en level
  in de tijdlijn. De z-index van het kaartje (2147483000) ligt boven het startscherm (40). De e2e-test
  `webgl.spec.ts` faalt op elke `console.error`, maar onder Playwright laat de widget zich niet
  zien, dus dat blijft groen. `deploy:check` en de buildtests kijken alleen naar `dist/`, en daar
  komt de widget niet in.
- **elektra-ontwerper**: zet de tag in `apps/web/src/index.html` na `<app-root>`, met
  `data-keep-params="proef"`. Op 1280×720
  bedekt het kaartje de onderkant van de sneltoetsenlijst rechts. Gebruikers kunnen het
  verslepen of minimaliseren. Wie het standaard klein wil: `data-minimized`.
- **meterkast**: zet de tag in `index.html` na de `<script type="module">`. Het kaartje staat
  er ook op het inlogscherm. Bij afdrukken (groepenlijst) verdwijnt het. De app routeert met de
  hash (`#/ontwerp/<id>/<tab>`), dus zet `data-strip-hash="false"`. Dan is in de feedback te zien
  over welk ontwerp en welke tab het ging. Roep bij uitloggen `AudioFeedback.clear()` aan.

## Integreren

```html
<script
  src="https://audio-feedback.hetzner.bobreijnders.nl/widget.js"
  data-project="meterkast"
  data-position="bottom-right"
  data-strip-hash="false"
  data-privacy-url="https://meterkast.example.nl/privacy"
  data-context='{"versie": "1.4.0"}'
  defer></script>
```

| Attribuut | Standaard | Betekenis |
|---|---|---|
| `data-project` | hostnaam | naam waaronder de opnames binnenkomen (`[A-Za-z0-9._-]`) |
| `data-endpoint` | origin van `widget.js` | waar de server staat |
| `data-position` | `bottom-right` | `bottom-left`, `top-right`, `top-left` |
| `data-max-duration` | `600` | maximale opnameduur in seconden (hooguit 1800) |
| `data-hosts` | alle | komma-gescheiden hostnamen waarop de widget verschijnt, bijvoorbeeld alleen productie |
| `data-minimized` | uit | begint als pil |
| `data-strip-query` / `data-strip-hash` | aan | laat query of hash weg uit de opgeslagen URL's. Zet `="false"` om ze te houden |
| `data-keep-params` | — | komma-gescheiden queryparameters die ondanks `data-strip-query` meegaan, zoals `tab,proef` |
| `data-privacy-url` | — | link "Hoe we hiermee omgaan" in het kaartje |
| `data-context` | — | JSON-object met extra velden |
| `data-allow-webdriver` | uit | ook tonen onder Playwright/Selenium |
| `data-manual` | uit | niet vanzelf starten; roep `AudioFeedback.init()` aan |

Vanuit de app zelf:

```js
AudioFeedback.setContext({ gebruiker: 'tester-3', ontwerp: id }); // gaat mee met de volgende opname
AudioFeedback.open();      // kaartje openklappen
AudioFeedback.minimize();
AudioFeedback.clear();     // alle opnames die nog in deze browser staan weggooien, bij uitloggen
AudioFeedback.destroy();   // weghalen
AudioFeedback.init({ project: 'x', position: 'top-left' }); // met data-manual
```

Instellingen kunnen ook in `window.AudioFeedbackConfig = {...}` vóór het script.

## Server

Node zonder runtime-dependencies (`node:http`, TypeScript via de ingebouwde type stripping).

| Route | |
|---|---|
| `GET /widget.js` | het script |
| `POST /api/recordings` | upload: multipart met `meta` (JSON) en `audio`. Controleert de origin en het project dat daarbij hoort, het formaat (aan de eerste bytes, niet aan wat de client zegt), de grootte, het aantal per IP en in totaal, en de ruimte op schijf. Dezelfde id twee keer is geen dubbele |
| `GET /admin` | beheerpagina: luisteren, per pagina naar de tijd springen, filteren per project, downloaden, verwijderen |
| `GET /api/recordings[?project=]` | lijst als JSON |
| `GET /api/recordings/:id/audio` | audio, met Range-requests |
| `DELETE /api/recordings/:id` | verwijderen |
| `GET /` | demopagina met de widget, alleen met `DEMO` aan |
| `GET /health` | `{ ok, version }` |

`/admin` en de `GET`/`DELETE` op `/api/recordings` vragen Basic auth: een willekeurige naam, en
`ADMIN_PASSWORD` als wachtwoord.

| Variabele | Standaard | |
|---|---|---|
| `ALLOWED_ORIGINS` | leeg: alleen de eigen origin (met `DEMO` aan) | komma-gescheiden. Mag `https://*.example.nl` of `*` bevatten. Met `=project` (of `=a\|b`) erachter mag die origin alleen onder die projecten insturen |
| `ADMIN_PASSWORD` | leeg: beheer staat uit | |
| `DATA_DIR` | `./data` | opnames in `recordings/<id>.webm` en `<id>.json` |
| `RETENTION_DAYS` | `90` | ouder wordt verwijderd. `0` bewaart alles |
| `MAX_UPLOAD_MB` | `9.5` | onder de 10 MB van de host-Caddy |
| `MAX_STORAGE_MB` | `2048` | alle opnames samen. Past een nieuwe opname er niet meer bij, dan gaan de oudste weg: nieuwe feedback gaat voor. Let op: een vloed aan nep-uploads verdringt zo ook echte feedback. Hoe snel dat kan, bepalen de rate limits. `0` is geen grens |
| `MAX_CONCURRENT_UPLOADS` | `4` | daarboven 503 met `Retry-After`; een upload staat even in het geheugen |
| `RATE_LIMIT_PER_HOUR` | `60` | uploads per IP, en per /64 bij IPv6 |
| `RATE_LIMIT_GLOBAL_PER_HOUR` | `600` | uploads van alle IP's samen |
| `TRUST_PROXY` | `true` | IP uit `X-Forwarded-For`, het laatste adres (dat van Caddy) |
| `DEMO` | `true` | demopagina op `/`. Uploads vanaf de eigen origin mogen dan, maar alleen onder project `demo` |
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

Een nieuwe app laten insturen: voeg `<origin>=<project>` toe aan `ALLOWED_ORIGINS` in
`compose.yaml` en rol opnieuw uit.
