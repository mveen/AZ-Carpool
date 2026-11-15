# Wachttijd speelsters (Beheer, onder Gereden shifts)

De coördinator ziet hoe lang elke speelster wacht, per week, maand of jaar, om te beoordelen of klachten over meer wachten dan anderen terecht zijn. Alleen Beheer; de kaart staat direct onder *Gereden shifts*.

**Wat telt als wachten** (dezelfde maat als het advies, `evaluateCars` in `weekrooster-impact.js`): heen komt de auto aan op vertrektijd + rijtijd (`travelLeadMinutes`) en wacht ze op wat er overblijft tot haar eigen tijd; terug wacht ze vanaf haar eigen tijd tot de auto vertrekt. Te laat (min) telt als 0: wie te laat is, heeft niet gewacht. De vertrektijd is die op de auto staat (ook als de coördinator hem met de hand heeft gezet), anders de berekende.

**Hoe het wordt vastgelegd.** Bij het loggen van een shift (`ride-log.js`, `buildRideLogDoc`) krijgt elke auto in `rideLog/<datum>_<richting>` het extra, optionele veld `waits: { speelsterId: minuten }`. De app (`logPassedShifts` in `data.js`) en de servertaak (`cron/purge.mjs`) gebruiken dezelfde code, `carWaits` in `rides.js`, dus ze schrijven identieke documenten. Het is een nieuw optioneel veld: er wordt niets hernoemd of verwijderd.

**Geen terugwerkende kracht.** Shifts die al gelogd zijn hebben geen `waits` (de weekdata waaruit het te berekenen zou zijn, is na vrijdag 19:00 verwijderd). Zulke ritten tellen nergens mee, ook niet in een gemiddelde: de cijfers beginnen bij de eerste shift die na deze functie is gelogd. De kaart zegt dat. Een shift die de coördinator bij Gereden shifts verwijdert (`removed`), telt ook hier niet meer mee.

**Wat de kaart toont** (`wait-log.js`, `ui-wait-log.js`): per speelster het aantal ritten, het totaal en het gemiddelde per rit (met heen en terug apart eronder), de langste wachter bovenaan. Daarboven een samenvatting (ritten, gemiddelde per rit van het hele team, gemiddeld totaal per speelster) en één zin die de vraag beantwoordt: wacht iemand *duidelijk langer* dan de rest? Dat is zo als haar gemiddelde per rit minstens 10 minuten boven het teamgemiddelde ligt, vanaf 3 ritten (`WAIT_MARGIN_MIN`, `WAIT_MIN_RIDES`), zodat een klein verschil of één rit geen klacht "bewijst". Die speelsters staan in de tabel in de waarschuwingskleur.

**Afwegingen.** Volgens het planningsprincipe (CLAUDE.md) mag langer wachten als de speelster op tijd is; de kaart verandert de planning niet en geeft alleen inzicht. Het gemiddelde per rit is eerlijker dan het totaal, omdat een speelster met meer ritten vanzelf meer totaal heeft; het totaal staat er toch bij omdat dat is wat een speelster over een week of maand ervaart.
