# Testscript: Push-meldingen testen (Android en Mac)

Doel: met eigen ogen zien dat de meldingen aankomen, er goed uitzien en nooit bij andere ouders terechtkomen.
Duur: ongeveer 30 minuten per toestel. Alles gebeurt met jouw coördinatoraccount; echte ouders merken niets.

## Voorbereiding (eenmalig)
- [ ] De nieuwe regels staan in de Firebase-console (Rules) en de app is gedeployd (versie **v81** onder Instellingen).
- [ ] De cron-regel staat in DirectAdmin: `* * * * * bash ~/azcarpool-cron/run.sh push > /dev/null`.
- [ ] Je bent ingelogd als coördinator. Open **Beheer → Berichten → Push-meldingen testen** (tik op de kaart om hem open te klappen).
- [ ] Zet **Test aan**. Wacht tot 1–2 minuten: er verschijnt **Server actief**. Blijft dat "Server nog niet gezien"? Stop hier en meld het (de cron draait dan niet).

**Android:** gebruik Chrome. De app hoeft niet op het beginscherm.
**Mac:** gebruik Chrome, Edge of Firefox (Safari kan, maar test eerst met Chrome). Zet in macOS *Systeeminstellingen → Meldingen* de browser op "Toestaan" en zet *Niet storen* uit.

Per stap: kruis aan als het klopt (✔) of schrijf op wat je zag (✘).

## Deel A. Toestel aanmelden
| # | Doe | Verwacht | ✔/✘ |
|---|---|---|---|
| A1 | Tik **Meldingen aanzetten op dit toestel** | De browser vraagt toestemming. Kies **Toestaan** | |
| A2 | Kijk in de lijst "Mijn toestellen" | Je ziet je toestel (bijv. "Chrome op Android") met het label **dit toestel** | |
| A3 | Kies bij "Ik ben…" **Ouder van Saar** | De vijf knoppen onder "Situaties afspelen" worden actief | |

## Deel B. De vijf situaties
Kies telkens "Het is: nu", tik op de knop en wacht maximaal 2 minuten. Doe dit met **de app open** bij B1 en B2, en met **de app weggeswiped of het scherm vergrendeld** bij B3 t/m B5.

Elke melding moet beginnen met de titel **Test · Ouder van Saar** en eronder de gewone tekst.

| # | Situatie | Verwachte tekst (ongeveer) | Push binnen 2 min | Voorbeeld in de kaart klopt |
|---|---|---|---|---|
| B1 | Een rit komt vrij waar ik back-up voor ben | "Rit vrij: …" + "… biedt een rit aan…" | | |
| B2 | Iemand neemt mijn aangeboden rit over | "… neemt je rit over" | | |
| B3 | Een back-up meldt zich voor mijn rit | "Er is een back-up voor je rit" | | |
| B4 | Mijn aangeboden rit is niet gedekt (18:00) | "Rit … nog niet gedekt" | | |
| B5 | Ik ben dagcoördinator en een rit is overgenomen | "Wijziging …" + "Jij bent dagcoördinator…" | | |

Controleer ook:
- [ ] Onder "Zo ziet Ouder van Saar het" staat per melding **Bezorgd**, **test**, en **Naar jouw toestel gestuurd** (kan een minuut duren).
- [ ] Je krijgt elke melding **één keer** (wacht 5 minuten: geen herhaling).
- [ ] Onder "Wie krijgt dit?" staat wie de melding zou krijgen en waarom.

## Deel C. Tikken op een melding
| # | Doe | Verwacht | ✔/✘ |
|---|---|---|---|
| C1 | App volledig gesloten. Tik op een melding | De app opent in **Testweergave als: Saar** (zwarte balk bovenin), tab **Wijzigen**, scherm Ritten ruilen, naar beneden gescrold bij **Meldingen** met de melding en het label **test** | |
| C2 | Tik **Stoppen** in de zwarte balk | Je bent terug als coördinator | |
| C3 | App open (als coördinator). Speel een situatie af en tik op de melding | De app komt naar voren en opent in Testweergave als Saar, zoals bij C1 | |
| C4 | Speel een situatie af voor een ander gezin ("Ik ben…" wisselen) en tik op die melding | Testweergave als **dat** gezin | |

## Deel D. Stille uren
| # | Doe | Verwacht | ✔/✘ |
|---|---|---|---|
| D1 | Kies "Het is: midden in de nacht (stille uren)" en speel "Iemand neemt mijn aangeboden rit over" | In het voorbeeld staat **Wacht op stille uren, bezorgd om 06:00** (gestreepte rand). Er komt **geen** push | |
| D2 | Tik bij die melding **Stuur naar mijn toestel** | Binnen 2 minuten komt de push alsnog | |
| D3 | Kijk in Testweergave als Saar (via C-stappen) naar Meldingen | De nachtmelding staat daar pas vanaf 06:00 (nu nog niet) | |

## Deel E. Uitzetten en opruimen
| # | Doe | Verwacht | ✔/✘ |
|---|---|---|---|
| E1 | Zet bij je toestel **Ritten ruilen** uit en speel een situatie af | Geen push. Zet hem daarna weer aan | |
| E2 | Zet bovenaan **Test** uit en speel een situatie af | Het voorbeeld werkt, maar er komt geen push en het zegt "Zet eerst de test aan" bij verzenden | |
| E3 | Zet **Test** weer aan. Tik **Testmeldingen opruimen** | Het voorbeeld is leeg | |
| E4 | Tik **Verwijder** (twee keer tikken) bij je toestel | Het toestel verdwijnt uit de lijst en er komt geen push meer | |
| E5 | Meld je toestel opnieuw aan (A1) | Werkt weer | |

## Deel F. Veiligheid: er mag niets naar anderen
- [ ] Open Instellingen → **Bekijk als: Ouder** (of laat een bekende ouder de app openen): er is **geen** Beheer-tab en nergens het woord "Push-meldingen testen".
- [ ] Vraag aan één ouder of die vandaag iets heeft ontvangen: het antwoord moet **nee** zijn.
- [ ] Zet na afloop **Test uit** (tenzij je nog verder test).

## Deel G. Echte push-meldingen (live), met twee telefoons van twee gezinnen
Doe dit pas als deel A t/m F goed zijn. Je hebt twee telefoons nodig van twee verschillende gezinnen (jouw gezin en een ander gezin dat meedoet).
| # | Doe | Verwacht | ✔/✘ |
|---|---|---|---|
| G1 | Beheer → Berichten → kaart **Ritten ruilen**: zet **Push-meldingen aan** | Er staat "Aan: 0 van N gezinnen hebben een telefoon aangemeld" en geen waarschuwing over de server | |
| G2 | Op beide telefoons: avatar → **Push-meldingen** → zet **Meldingen op deze telefoon** aan | De browser vraagt toestemming; na Toestaan staat de schakelaar aan | |
| G3 | Kijk op de Ritten-ruilen-kaart in Beheer | "2 van N gezinnen hebben een telefoon aangemeld" | |
| G4 | Gezin 1 biedt een rit aan waar gezin 2 back-up voor is | Gezin 2 krijgt een gewone melding (zonder "Test ·") binnen 2 minuten | |
| G5 | Tik op die melding | De app opent op **Ritten ruilen**, onderaan bij Meldingen | |
| G6 | Kijk op jouw testtoestel (als je niet gezin 2 bent) | Je krijgt **geen** extra kopie | |
| G7 | Zet **Push-meldingen aan** uit en laat gezin 1 nog een rit aanbieden | Er komt niets binnen. De melding staat wel in de app | |
| G8 | Zet live weer aan en zet op één telefoon de schakelaar uit (Instellingen → Push-meldingen) | Die telefoon krijgt niets meer; de andere wel | |

## Als iets niet werkt
| Wat je ziet | Wat te doen |
|---|---|
| "Server nog niet gezien" blijft staan | Cron controleren in DirectAdmin; kijk of er een foutmail kwam |
| Knop "Meldingen aanzetten" ontbreekt, melding "geblokkeerd" | Browser: sitegegevens → Meldingen → Toestaan, pagina herladen |
| Hint "Zet eerst de test aan en wacht een minuut" | Test aanzetten en 1–2 minuten wachten (de server maakt dan de sleutel) |
| Toestel aangemeld, geen push | Kijk bij het voorbeeld: staat er "In de wachtrij"? Dan wacht de server nog. Staat het toestel er nog? (kan zijn verwijderd door de pushdienst: opnieuw aanmelden) |
| Push komt dubbel | Noteer tijd en situatie en meld het |

## Resultaat
Datum: ______  Toestel: ______  Browser: ______  Alles ✔: ja / nee
Opmerkingen:
