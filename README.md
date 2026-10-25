# audio-feedback

Laat gebruikers van een webapp inspreken wat ze zien of ervaren. Een zwevend kaartje in de
hoek neemt audio op (met pauzeren en hervatten) en stuurt die naar onze server, samen met het
adres van de pagina waar ze naar keken. De pagina zelf wordt niet opgeslagen.

```html
<script src="https://audio-feedback.hetzner.bobreijnders.nl/widget.js" data-project="mijn-app" data-hosts="mijn-app.example.nl" defer></script>
```

Meer is er niet nodig om het in een app te zetten. De widget heeft geen afhankelijkheden, is
33 kB groot (ongecomprimeerd), plus Montserrat (38 kB, van onze eigen server) en raakt de CSS en de sneltoetsen van de app niet.

## Inbouwen in je app

1. **Laat je site toe.** Voeg in [`/admin/sites`](#sites-beheren) de origin en de projectnaam van
   je app toe. Kies welke queryparameters en of de hash mee mogen. Standaard gaat alleen het pad
   mee. Zonder deze stap weigert de server je opnames.
2. **Zet de scripttag in `index.html`**, vóór het script van je app:
   ```html
   <script src="https://audio-feedback.hetzner.bobreijnders.nl/widget.js"
     data-project="mijn-app" data-hosts="mijn-app.example.nl" defer></script>
   ```
   Paginawissels (`pushState`, hash, gewone links) volgt de widget zelf.
   Mag je app niet op de widgethost wachten, laad dan met `async` en buffer vroege events zelf
   (zie [Events uit de app](#events-uit-de-app)).
3. **Meld wat niet in de URL staat**, zoals schermen, dialogen, levels, modi en fouten:
   ```js
   window.AudioFeedback?.event('screen', 'Instellingen');
   window.AudioFeedback?.event('level', 'Level 3: Nuuk', { moeilijkheid: 'zwaar' });
   window.AudioFeedback?.event('error', 'Opslaan mislukt', { status: 500 });
   ```
   - Roep het aan op het moment dat het scherm of de toestand wisselt, niet per frame of
     per toetsaanslag.
   - `type` is een vaste, korte naam om op te filteren. `label` is wat een mens in `/admin`
     leest. In `data` horen een paar losse velden.
   - Geen persoonsgegevens, tokens of ingevoerde tekst. Alles wat je meldt, gaat met de opname mee.
   - Schrijf `?.`: zonder widget (tests, localhost) doet de aanroep dan niets.
4. **Heeft je app een login, roep dan bij uitloggen `AudioFeedback.clear()` aan**, zodat de
   volgende gebruiker geen opname van een ander aangeboden krijgt.
5. **Controleer het resultaat.** Klik rond, neem iets op, verstuur het, en kijk in
   [`/admin`](#server) of de pagina's en events in de tijdlijn staan.

Er gaat niets naar de server tot de gebruiker op **Versturen** drukt. Events van de halve minuut
vóór **Opnemen** gaan ook mee. Meer opties staan bij [Integreren](#integreren) en
[Events uit de app](#events-uit-de-app).

## Voorstel

### Wat de gebruiker ziet

1. **Kaartje rechtsonder** met een korte uitleg en de knop **Opnemen**. Het is te verslepen en
   te minimaliseren tot een pil; positie en stand worden onthouden. Wie het kaartje niet
   gebruikt, krijgt het steeds minder in beeld: zonder klik of toets klapt het na 30 seconden in
   tot een pil, en de pil zakt na nog eens 30 seconden weg tot een doorzichtig bolletje. Dat
   wordt bij de muis weer helemaal zichtbaar, en een klik klapt het kaartje uit. Tijdens een
   opname, met een opname die klaarstaat of bij een foutmelding gebeurt dit niet.
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
| audio | Opus in WebM (Chrome, Firefox) of AAC in MP4 (Safari), 32 kbit/s: ~240 kB per minuut. In `/admin` ook als mp3 te downloaden, voor tools die WebM weigeren |
| `url`, `title` | de pagina waar de opname begon. Standaard alleen het pad, zonder query en hash: daarin staan vaak tokens, zoektermen of ids. Per site in te stellen in [`/admin/sites`](#sites-beheren) |
| `timeline` | events met hun positie in de opname. Dat zijn de paginawissels (`pushState`, gewone navigatie, en de hash als die meegaat), pauze en hervat, en wat de app met [`AudioFeedback.event()`](#events-uit-de-app) meldt. Ook de events van de halve minuut vóór **Opnemen** gaan mee, met een negatieve tijd. In de beheerpagina klik je op een tijd en hoor je wat er op dat moment gezegd werd |
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
| URL-wissels | alleen in de editor (`/editor#<tab>`). Het spel zelf verandert de URL nooit | `?proef=` | hash-routes `#/ontwerp/<id>/<tab>` |
| in de tijdlijn | editor ✔. Spel: alleen met `AudioFeedback.event()` | ✔ | ✔ elke tabwissel |
| toetsen lekken niet | ✔ spatie, Enter, Escape, Ctrl+Z bereiken het spel niet. Tegenproef: dezelfde Escape buiten het kaartje sluit de ranglijst wel | ✔ Ctrl+Z/Y bereikt de kast-editor niet | ✔ Ctrl+Z bereikt de undo niet |
| fouten van de widget | geen | geen | geen |

Per app, om op te letten. De instellingen voor query en hash staan in `/admin/sites`, niet op
de scripttag:

- **defend-greenland**: zet de tag in `index.html` **vóór** de `<script type="module">`. Beide
  worden uitgesteld uitgevoerd, in volgorde, dus dan bestaat `AudioFeedback.event()` al als het
  spel start. Menu's, levels, pauze en game over zijn overlays en canvas zonder eigen URL. Ze
  komen dus alleen in de tijdlijn als het spel ze meldt met `AudioFeedback.event()`, bijvoorbeeld
  bij `loadScenario` en bij het openen van een menu. In `/admin/sites`: alleen parameter
  `quality`, en de hash meesturen voor de tabs van de editor. De z-index van het kaartje (2147483000) ligt boven het startscherm (40). De e2e-test
  `webgl.spec.ts` faalt op elke `console.error`, maar onder Playwright laat de widget zich niet
  zien, dus dat blijft groen. `deploy:check` en de buildtests kijken alleen naar `dist/`, en daar
  komt de widget niet in.
- **elektra-ontwerper**: zet de tag in `apps/web/src/index.html` na `<app-root>`. In
  `/admin/sites`: alleen parameter `proef`. Op 1280×720
  bedekt het kaartje de onderkant van de sneltoetsenlijst rechts. Gebruikers kunnen het
  verslepen of minimaliseren. Wie het standaard klein wil: `data-minimized`.
- **meterkast**: zet de tag in `index.html` na de `<script type="module">`. Het kaartje staat
  er ook op het inlogscherm. Bij afdrukken (groepenlijst) verdwijnt het. De app routeert met de
  hash (`#/ontwerp/<id>/<tab>`), dus zet in `/admin/sites` de hash aan. Dan is in de feedback te zien
  over welk ontwerp en welke tab het ging. Roep bij uitloggen `AudioFeedback.clear()` aan.

## Integreren

```html
<script
  src="https://audio-feedback.hetzner.bobreijnders.nl/widget.js"
  data-project="meterkast"
  data-position="bottom-right"
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
| `data-minimized` | uit | begint als pil (die na 30 seconden zonder gebruik een bolletje wordt) |
| `data-privacy-url` | — | link "Hoe we hiermee omgaan" in het kaartje |
| `data-context` | — | JSON-object met extra velden |
| `data-allow-webdriver` | uit | ook tonen onder Playwright/Selenium |
| `data-manual` | uit | niet vanzelf starten; roep `AudioFeedback.init()` aan |

Vanuit de app zelf:

```js
AudioFeedback.setContext({ gebruiker: 'tester-3', ontwerp: id }); // gaat mee met de volgende opname
AudioFeedback.event('level', 'Nuuk', { golf: 3 }); // zie hieronder
AudioFeedback.open();      // kaartje openklappen
AudioFeedback.minimize();
AudioFeedback.clear();     // alle opnames die nog in deze browser staan weggooien, bij uitloggen
AudioFeedback.destroy();   // weghalen
AudioFeedback.init({ project: 'x', position: 'top-left' }); // met data-manual
```

Instellingen kunnen ook in `window.AudioFeedbackConfig = {...}` vóór het script.

### Events uit de app

Niet alles wat een gebruiker ziet, staat in de URL. Een spel of editor wisselt van scherm,
level of modus zonder dat het adres verandert. De app meldt dat zelf:

```js
window.AudioFeedback?.event('level', 'Level 3: Nuuk', { moeilijkheid: 'zwaar' });
window.AudioFeedback?.event('screen', 'Pauzemenu');
window.AudioFeedback?.event('game-over');
```

- **`type`**: een eigen naam, zoals `screen`, `level` of `error`. Begint met een letter, met
  daarna letters, cijfers of `. _ : -`, hooguit 50 tekens. `start`, `navigate`, `pause`, `resume`
  en `stop` zijn van de widget. Een ongeldig type geeft een waarschuwing in de console en gaat
  niet mee.
- **`label`**: korte omschrijving voor de beheerpagina, hooguit 200 tekens.
- **`data`**: hooguit 20 sleutel-waardeparen. Getallen en booleans worden tekst.

Het event gaat niet meteen naar de server. Het blijft in de browser bij de opname, en gaat pas
mee als de gebruiker op **Versturen** drukt. Een paginawissel loopt via hetzelfde pad: het is
een event met type `navigate`, dat de widget zelf meldt.

- **Tijdens een opname** krijgt het event de huidige positie in de opname. Valt het in een
  pauze, dan ligt het op het punt waar de opname stilstaat. Het staat in IndexedDB, dus het
  overleeft herladen of een crash, net als de audio.
- **Buiten een opname** houdt de widget alleen in het geheugen de events van de laatste 30
  seconden bij (hooguit 50). Drukt de gebruiker op **Opnemen**, dan gaan die mee met een
  negatieve tijd. Mensen drukken vaak pas op **Opnemen** nadat er iets misging. Paginawissels
  van vóór de start gaan ook zo mee.
- **Wat de gebruiker ziet**: het kaartje vermeldt het vooraf zodra de app iets gemeld heeft, en
  bij het terugluisteren staan de events in een lijst.
- **Grenzen**: hooguit 500 events van de app per opname. De server controleert het schema nog
  eens.
- **Zonder widget**: met `?.` doet de aanroep niets als de widget er niet is, bijvoorbeeld
  onder Playwright of op een host die niet in `data-hosts` staat. Een aanroep van vóórdat
  het script van de widget gedraaid heeft, gaat verloren.
- **Vóór het laden**: er zijn twee routes.
  - `defer`, met de tag vóór het script van de app. De widget staat er dan altijd eerst. Hangt
    de widgethost, dan wacht je app wel.
  - `async`, en de app buffert zelf. Geef de tag een `id` en bewaar events zolang
    `window.AudioFeedback` ontbreekt. Geef ze door bij `load` van de tag, en gooi ze weg bij
    `error`. Een grotere buffer dan die van de widget (50 events, 30 seconden) heeft geen zin.
    `event()` kent geen tijdparameter: een gebufferd event krijgt het moment van doorgeven.
    Voorbeeld: `src/audioFeedback.ts` in Defend Greenland.
- **Geen voorloper**: zet zelf geen `window.AudioFeedback` neer. De widget installeert zich alleen
  als die nog niet bestaat, dus een stub sluit hem buiten.

Het schema staat in [`/openapi.yaml`](public/openapi.yaml) (`TimelineEntry`), samen met de
upload, voor wie een eigen client bouwt.

## Server

Node zonder runtime-dependencies (`node:http`, TypeScript via de ingebouwde type stripping). Alleen de mp3-download heeft een systeemprogramma nodig: ffmpeg, dat in de Docker-image zit.

| Route | |
|---|---|
| `GET /widget.js` | het script |
| `POST /api/recordings` | upload: multipart met `meta` (JSON) en `audio`. Controleert de origin en het project dat daarbij hoort, het formaat (aan de eerste bytes, niet aan wat de client zegt), de grootte, het aantal per IP en in totaal, en de ruimte op schijf. Dezelfde id twee keer is geen dubbele |
| `GET /admin` | beheerpagina: luisteren, per pagina of event naar de tijd springen, filteren per project, verwijderen, en audio en events downloaden. Elk is één knop: klikken geeft mp3 resp. JSON, het carret klapt de andere formaten uit (audio zoals opgenomen, events als Markdown) |
| `GET /admin/sites` | sites beheren: toevoegen, wijzigen, verwijderen, en per site query en hash instellen |
| `GET`/`POST /api/sites`, `PUT`/`DELETE /api/sites/:id` | hetzelfde als JSON. Alleen `application/json`, en alleen vanaf de eigen origin |
| `GET /api/sites/config` | de URL-instellingen van de site die het vraagt (`Origin`). De widget vraagt dit bij **Opnemen** |
| `GET /api/recordings[?project=]` | lijst als JSON |
| `GET /api/recordings/:id/audio` | audio zoals opgenomen (`<project>-<kenmerk>.webm`, `.ogg` of `.m4a`), met Range-requests |
| `GET /api/recordings/:id/audio.mp3` | dezelfde audio als mp3-download (`<project>-<kenmerk>.mp3`), mono op 64 kbit/s, door ffmpeg omgezet terwijl het binnenkomt. Veel verwerkingstools lezen geen WebM met alleen audio, mp3 wel. Er is geen lengte vooraf en geen Range: dit is om te downloaden, niet om af te spelen. Zonder ffmpeg: 501. Te veel tegelijk: 503 met `Retry-After` |
| `GET /api/recordings/:id/events` | de events van een opname als JSON-bestand (`<project>-<kenmerk>.json`), om te delen of verder te verwerken. Met project, start, duur, beginpagina, context en browser; elk event met `time` zoals de speler hem toont (`1:05`, `−0:03`). Bestandsnaam, grootte en origin van de opslag gaan niet mee |
| `GET /api/recordings/:id/events.md` | dezelfde events en gegevens als Markdown (`<project>-<kenmerk>.md`): een kop, de gegevens van de opname, de context en per event een regel met `time`, type en omschrijving, met de `data` eronder. Om te lezen of in een ticket of chat te plakken. Wat een client instuurt komt op één regel en zonder eigen opmaak in het bestand; een adres wordt een klikbare link |
| `DELETE /api/recordings/:id` | verwijderen |
| `GET /` | demopagina met de widget, alleen met `DEMO` aan |
| `GET /openapi.yaml` | OpenAPI-spec van de upload en het eventschema |
| `GET /health` | `{ ok, version }` |

Wat je van één opname downloadt heet hetzelfde, op de extensie na: `<project>-<kenmerk>.webm` (of `.ogg`, `.m4a`), `.mp3`, `.json` en `.md`. Bij een verzameling op schaal in één map staan ze zo naast elkaar en vind je bij elkaar wat bij elkaar hoort. Het kenmerk is de eerste 8 tekens van het id, hetzelfde als dat de widget na het versturen toont.

`/admin`, `/admin/sites`, `/api/sites` en de `GET`/`DELETE` op `/api/recordings` vragen Basic
auth: een willekeurige naam, en `ADMIN_PASSWORD` als wachtwoord.

### Sites beheren

Alleen websites in de sitelijst mogen opnames insturen. De lijst staat in
`<DATA_DIR>/sites.json` en beheer je in `/admin/sites`. Per site stel je in:

- **Website**: de origin (`https://app.example.nl`, of `https://*.example.nl` voor alle
  subdomeinen). Een geplakt adres met pad wordt vanzelf een origin.
- **Projectnaam**: welke `data-project` die site mag gebruiken. Meerdere met komma's; leeg is
  elke naam.
- **Query**: weglaten (standaard), alleen bepaalde parameters, of alles.
- **Hash**: weglaten (standaard) of meesturen, voor apps met hash-routes.

Een voorbeeldveld laat meteen zien wat er van een adres overblijft. Wijzigingen gelden bij de
volgende opname: de widget vraagt de instellingen op als iemand op **Opnemen** klikt, dus de app
hoeft niet opnieuw te worden uitgerold. De server past dezelfde regels toe bij ontvangst, zodat
ook een oude widget niet meer opslaat dan ingesteld. Lukt het opvragen niet, dan stuurt de widget
alleen het pad mee.

| Variabele | Standaard | |
|---|---|---|
| `ALLOWED_ORIGINS` | leeg | **alleen bij de eerste start**: vult de sitelijst als `sites.json` nog niet bestaat. Komma-gescheiden, met `=project` (of `=a\|b`) erachter. Daarna beheer je de sites in `/admin/sites` |
| `ADMIN_PASSWORD` | leeg: beheer staat uit | |
| `DATA_DIR` | `./data` | opnames in `recordings/<id>.webm` en `<id>.json`, de sitelijst in `sites.json` |
| `RETENTION_DAYS` | `90` | ouder wordt verwijderd. `0` bewaart alles |
| `MAX_UPLOAD_MB` | `9.5` | onder de 10 MB van de host-Caddy |
| `MAX_STORAGE_MB` | `2048` | alle opnames samen. Past een nieuwe opname er niet meer bij, dan gaan de oudste weg: nieuwe feedback gaat voor. Let op: een vloed aan nep-uploads verdringt zo ook echte feedback. Hoe snel dat kan, bepalen de rate limits. `0` is geen grens |
| `MAX_CONCURRENT_UPLOADS` | `4` | daarboven 503 met `Retry-After`; een upload staat even in het geheugen |
| `MAX_CONCURRENT_MP3` | `2` | mp3-omzettingen tegelijk (elk een ffmpeg-proces); daarboven 503 met `Retry-After`. De container heeft maar een halve CPU en 256 MB |
| `FFMPEG_PATH` | `ffmpeg` | het programma voor de mp3-download; een kale naam wordt in `PATH` gezocht |
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

De test van de mp3-download met echte audio draait alleen als `ffmpeg` in `PATH` staat en slaat zichzelf anders over; de rest van die tests gebruikt een nep-ffmpeg. In de Docker-image zit ffmpeg altijd, dus daar draaien ze allemaal:
`docker run --rm -v "$PWD":/work:ro -w /work <image> node --test tests/server.test.ts`.

Niet automatisch getest: Safari en Firefox. De code kiest per browser een formaat dat
`MediaRecorder` kan (WebM/Opus, Ogg/Opus, MP4/AAC), en de server accepteert alle drie. Een
handmatige proef op een iPhone is nog nodig voordat dit breed uitgaat.

## Uitrollen

`Dockerfile` bouwt de widget in de container, dus er hoeft vooraf niets op de host gebouwd te
worden. Hij installeert ook ffmpeg (Debian-pakket, voor de mp3-download); dat maakt het image zo'n
640 MB groter, maar die laag staat boven de code en blijft dus bij een herbouw in de cache. De build
faalt als ffmpeg zonder mp3-encoder komt. `compose.yaml` zet de app op poort 3029, met `./data` als volume en geheimen uit `.env`.

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

Een nieuwe app laten insturen: voeg hem toe in `/admin/sites`. Opnieuw uitrollen is niet nodig.
