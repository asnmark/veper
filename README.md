# Veper

Veper je uredniški radar za slovenske radijske novinarje. Združuje javne RSS/Atom vire, povezuje samo dovolj podobne naslove in ob vsaki objavi ohrani izvirno povezavo. Ko je nastavljen ključ Gemini, v ozadju pripravi slovenski povzetek, primerjavo, razvoj zgodbe in vprašanja za preverjanje. Vsaka prikazana trditev vsebuje dobeseden navedek iz zajetega naslova ali izseka ter prestane ločen pregled podpore v Gemini. To je uredniški predlog, ne neodvisna potrditev; pred oddajo preverite izvirnik.

## Zagon

Zahteva Node.js 24 ali novejši.

```sh
npm ci
cp .env.example .env
npm run dev
```

Odprite `http://127.0.0.1:5173`. Vire je mogoče osvežiti ročno; sicer se preverjajo vsakih 90 sekund. Podatkovna zbirka SQLite je v `.data/veper.sqlite`.

Za Gemini nastavite `GEMINI_API_KEY` v `.env`. Brez ključa Veper še vedno prikazuje izvorne članke in odkrito opozori, da analiza ni na voljo. Ključ se ne pošilja brskalniku.

## Preverjanje in produkcijski zagon

```sh
npm run check
npm run build
npm start
```

Produkcijski strežnik privzeto posluša samo na `127.0.0.1:4179`. To ni internetna namestitev: pred javno izpostavitvijo je treba dodati prijavo uporabnikov in operativni nadzor. Nastavitve sprejemajo `HOST`, `PORT`, `DATABASE_PATH` in `POLL_INTERVAL_MS`.

## Viri in omejitve

Začetni katalog vsebuje javne RSS/Atom vire RTV Slovenija, N1 Slovenija, Siol.net, BBC World in The Guardian World. Vsi viri lahko spremenijo ali ukinejo feed; Veper napake pokaže in obdrži prej zajete podatke. Naslove združuje konzervativno, zato bo kak čezjezični dogodek ostal v ločenih zgodbah, če ni dovolj dokazov za varno združitev.

Veper bere samo javne metapodatke in izseke iz RSS/Atom; ne strga celih člankov. Zajeti izsek ni neodvisna potrditev resničnosti. Urednik preveri citat in kontekst pri izvirniku.
