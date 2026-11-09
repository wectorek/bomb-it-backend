# Reimplementacja: każda runda na serwerze

Plan przejścia na opcję B. Solo i gra z innymi ludźmi to ten sam pokój. Proces Node w tym repozytorium liczy stan. `bomb-it` zostaje widokiem: rysuje snapshot, wysyła intencje, gra muzykę.

Decyzja jest opisana w rozmowie o architekturze. Ten plan kończy się na lokalnym froncie i backendzie w jednej sieci Wi-Fi. EC2 i Cloudflare Pages zostają poza nim.

Dwa repozytoria:

| Repo | Rola |
|---|---|
| `bomb-it` | Next.js na maszynie deweloperskiej: plansza, HUD, sprite'y, muzyka, sterowanie |
| `bomb-it-backend` (to repozytorium) | czysta maszyna stanów `game/` i proces WebSocket |

Frontend nie importuje paczki zasad i nie woła `step`.

---

## Cel zachowania

Runda ma wyglądać jak dziś:

- labirynt 15×15, trzy boty, życia, ściany (`solid`, `destructible`, `bonus`, `hedge`),
- bomba, granat, bonusy, strefa włączana z menu,
- wygrana, gdy żyje gracz i nie żyje żaden bot; przegrana, gdy gracz zginął, a bot został; remis, gdy wszyscy zginęli naraz,
- animacja kroku, motywy planszy i muzyka bez zmian.

Jedyna zamierzona różnica odczuwalna: pozycja przychodzi ze stanu serwera. Krok trwa około 300 ms (`PLAYER_MOVE_INTERVAL_MS`), tick serwera 50 ms (`GAME_TICK_MS`). Klient nie przewiduje ruchu.

---

## Maszyna stanów

W `game/` tego repozytorium ląduje jedna funkcja bez Reacta, bez `setTimeout` i bez `Math.random`:

```js
step(state, inputs, now) → state
```

Czas i losowość wchodzą argumentem. Timer to pole w stanie, nie uchwyt zegara. `step` bierze zdarzenia, których `at <= now`, i zwraca nowy stan. Proces serwera woła ją co 50 ms.

Zdarzenia, które dziś są `setTimeout` w `useBomb.js` i `setInterval` w `useGameLoop.js` w `bomb-it`:

| Dziś | W stanie |
|---|---|
| wybuch bomby po `BOMB_TIMER_MS` | `bomb.explodeAt` |
| lot granatu `GRENADE_FLIGHT_MS`, potem `GRENADE_TIMER_MS` | `grenade.landAt`, po lądowaniu `explodeAt` |
| odrastanie żywopłotu `HEDGE_REGROW_MS`, ponowienie co 1 s gdy pole zajęte | `hedge.regrowAt` |
| zniknięcie ognia `EXPLOSION_DURATION_MS` | `explosion.until` |
| koniec efektu bonusu | `actor.effects[id].until` |
| następny krok postaci | `actor.nextMoveAt` |
| obrażenia strefy | `zone.since` (jak dziś `zoneSinceRef`) |

Losowanie labiryntu i typu bonusu idzie przez generator trzymany w stanie (`state.rng`), z ziarnem zapisanym przy tworzeniu pokoju. Dzięki temu tick jest powtarzalny dla tych samych wejść.

`inputs` w jednym ticku to lista `{ actorId, direction | null, action: "bomb" | null }`. Kierunek to przytrzymany stan (WASD), nie pojedyncze naciśnięcie: serwer rusza postać, gdy `now >= nextMoveAt` i kierunek jest ustawiony. `action` jest zboczem (jedno naciśnięcie Spacji). Serwer sam decyduje, czy to bomba, czy granat, na podstawie efektu `grenade`. Nielegalny krok i Spacja bez ładunku znikają w `step` i nie wracają jako osobny błąd do klienta.

Boty nie dostają `inputs`. W tym samym `step` każdy żywy bot woła obecną `nextBotTurn`, gdy nadejdzie jego `nextMoveAt`.

Funkcje czyste przenoszone z `bomb-it/src/app/` prawie bez zmian znaczenia:

- `maze.js` — generowanie, kolizje; `cellToPixels` i rozmiary w pikselach zostają we froncie
- `bomb.js` — zasięg, granat, wybuch
- `bot.js`
- `actors.js` — spawn, efekty prędkości, statystyki, status
- `bonus.js` — losowanie, zbieranie, obrażenia, zasięg; napisy toastów mogą zostać tu albo we froncie
- `zone.js`
- `border.js`
- `playerMovement.js` — `cellAfterStep`, `facingFromDirection` i sprawdzenie kroku po stronie serwera; mapowanie klawisza zostaje we froncie
- stałe zasad z `config.js` (`BOMB_*`, `BOARD_SIZE`, szanse ścian, bonusy, strefa, interwały)

Zostają we froncie, bo nie są zasadami: `ARENA_SIZE`, `MUSIC_VOLUME`, `TOAST_MS`, motywy, ścieżki grafik.

### Widok wysyłany do przeglądarki

Snapshot jest modelem do rysowania, nie kopią wewnętrznego stanu. Nie wysyłamy typu bonusu leżącego na mapie, ziarna RNG, `nextMoveAt` ani pełnych ścian `bonus` odróżnialnych od `destructible`.

```js
{
  roomId, you, status, startedAt, serverNow,
  zone: null | { startedAt, radius },
  actors: [{ id, kind, color, name, position, facing, lives, alive,
             moveIntervalMs, effects: [{ id, msLeft }], stats }],
  walls: [{ row, col, type }], // type bonusu na ziemi nie ujawnia nagrody
  bonuses: [{ id, row, col }],
  bombs: [{ id, row, col, kind, airborne, from }],
  explosions: [{ id, cells, until }],
  toasts: [{ id, text, until }],
}
```

`moveIntervalMs` jest po to, żeby animacja kroku przyspieszała z bonusem szybkości bez liczenia zasad w przeglądarce. `from` przy granacie w locie jest po to, żeby CSS mógł narysować lot. Toast („Szybkość!”) składa serwer, bo tylko on zna wylosowany typ.

`walls[].type` dla ściany z bonusem wysyłamy jako `destructible`. Inaczej klient odczyta nagrodę przed zniszczeniem skrzynki.

### Status przy wielu ludziach

Dziś `computeGameStatus` szuka aktora `"player"`. W pokoju każdy człowiek ma własne `id`. Zasada:

- solo (jeden człowiek i boty): jak dziś, wygrana / przegrana / remis względem tego człowieka,
- kilku ludzi: ostatni żywy człowiek wygrywa, pozostali przegrywają; wszyscy ludzie martwi w tym samym wybuchu to remis; boty nie wygrywają,
- snapshot niesie `status` już policzony dla `you`, więc ekran końcowy nie odtwarza tej reguły.

---

## Protokół

WebSocket, JSON, jeden pokój w pamięci procesu. Po meczu stan znika z RAM.

Klient → serwer:

| Typ | Treść |
|---|---|
| `create` | `{ nick, zone, fillBots }`. Solo: `fillBots: true` od razu. |
| `join` | `{ code, nick }` |
| `input` | `{ direction: { row, col } \| null, action: "bomb" \| null, seq }` |
| `restart` | nowa runda w tym samym pokoju (nowy labirynt, te same miejsca) |
| `leave` | |

Serwer → klient:

| Typ | Treść |
|---|---|
| `welcome` | `{ roomId, code, you }` |
| `state` | snapshot co tick, tylko gdy stan się zmienił albo minęło 50 ms od ostatniego przy zmianie |
| `bye` | pokój zamknięty |

Serwer trzyma ostatni `input` każdego połączenia. Puszczenie klawisza to `direction: null`. Powtórzone `seq` ignoruje. Rozłączenie w trakcie rundy zostawia aktora na planszy do końca tury (stoi, nie stawia bomb). Wejście tym samym kodem w trakcie rundy podpina połączenie z powrotem pod to samo `you`, dopóki pokój żyje.

Adres wybiera przeglądarka z hosta, z którego otwarto stronę. Port gry to zawsze `8787`.

- ta sama maszyna (`localhost`) → `ws://127.0.0.1:8787`
- inne urządzenie w Wi-Fi, strona otwarta jako `http://192.168.x.x:3000` → `ws://192.168.x.x:8787` (ten sam host, port gry)
- nadpisanie na czas prób: `window.BOMB_IT_WS_URL`

---

## Proces serwera

W tym repozytorium:

```
game/          step, maze, bomb, bot, actors, bonus, zone, border, config zasad
server.js      HTTP + WebSocket na 0.0.0.0:8787, pokoje, tick
```

`0.0.0.0`, nie samo `127.0.0.1`: inaczej telefon w tym samym Wi-Fi nie połączy się z procesem. Na Windowsie zapora musi przepuścić przychodzące TCP `3000` i `8787` w sieci prywatnej. Front nasłuchuje tak samo szeroko: `next dev --hostname 0.0.0.0 --port 3000`.

Tick pokoju:

1. Zbierz ostatnie intencje ludzi.
2. `state = step(state, inputs, Date.now())`.
3. Wyślij snapshot każdemu połączeniu.

Tworzenie pokoju solo od razu woła generowanie labiryntu i spawn (to, co dziś robi `useOpeningLayout` w `bomb-it`) i dopisuje trzech botów. Pokój towarzyski tworzy się z kodem i czeka; pusty fotel przy starcie albo przy `fillBots` dostaje bota. Limit czterech miejsc.

Strefa jest opcją pokoju z `create`, nie przełącznikiem w trakcie rundy. Motyw planszy nie idzie na serwer.

---

## Zmiany w `bomb-it`

### Nowe

- `src/app/net.js` — adres WebSocketa, łączenie, `create` / `join` / `input` / `restart`.
- `src/app/useRoom.js` — snapshot, `you`, status połączenia (`connecting`, `live`, `closed`).

### Przestają liczyć grę

| Plik | Po zmianie |
|---|---|
| `GameBoard.js` | czyta snapshot z `useRoom`; nie trzyma ścian, bomb, aktorów ani bonusów jako źródła prawdy |
| `GameSession.js` | `restart` wysyła `restart` zamiast zmieniać `key` planszy |
| `usePlayerControls.js` | klawisz i przytrzymanie → `input`; bez kolizji, bez `placeBomb` |
| `TouchControls.js` | ten sam `input` co klawiatura |
| `useGameLoop.js` | do usunięcia |
| `useBomb.js` | do usunięcia |
| `useOpeningLayout.js` | do usunięcia |

Czyste moduły zasad (`maze.js`, `bomb.js`, `bot.js`, `actors.js`, `bonus.js`, `zone.js`, `border.js`, reguły z `config.js`) znikają z `bomb-it` po przeniesieniu do `game/`. Zostaje cienki `config` prezentacji albo stałe wprost w komponentach (`ARENA_SIZE`, głośność, czas toastu).

### Zostają widokiem

`Arena.js`, `WallBlock.js`, `ActorSprite.js`, `useWalkAnimation.js`, `Hud.js`, `EndScreen.js`, `Storm.js`, `assets.js`, `MusicToggle.js`, `useBackgroundMusic.js`, `api/music/route.js`, CSS, `public/`.

`useWalkAnimation` czyta `position`, `facing` i `moveIntervalMs` ze snapshotu. `EndScreen` dostaje `status`, `actors` i `startedAt` ze snapshotu. Enter woła `restart`.

`GameFrame` dalej trzyma motyw lokalnie. Przełącznik strefy przy tworzeniu pokoju idzie w `create`, nie do środka trwającej rundy.

Ekran przed rundą: „Graj” (solo, `fillBots: true`) i „Pokój” (kod do podania drugiemu graczowi). Do czasu wieloosobowego etapu wystarczy sam „Graj”.

---

## Kolejność

Każdy etap kończy się działającą grą. Nie ma etapu, w którym solo jest localne, a sieć „obok”.

### Etap 1. `step` w tym repozytorium

Przenieść czyste moduły z `bomb-it/src/app/` i skleić z nich `step` oraz `createMatch({ zone, humans, fillBots, rng })`. Bomba, żywopłot, granat i efekty wygasają polami czasu, nie timerami przeglądarki.

Akceptacja: skrypt Node rozgrywa rundę bez przeglądarki. Boty chodzą, bomba wybucha po 3 s, żywopłot odrasta po 8 s, bonus znika z planszy po zebraniu, status schodzi z `"playing"`. Dwukrotne wywołanie `step` z tym samym stanem, wejściem i `now` daje ten sam wynik.

### Etap 2. Jeden pokój solo po WebSockecie

`server.js`: `create` z `fillBots: true`, tick, snapshot. Lokalnie `127.0.0.1:8787`.

Akceptacja: klient testowy (nawet `websocat` albo krótki skrypt) stawia bombę wiadomością `input` i dostaje wybuch w snapshocie. Drugie połączenie do tego samego kodu w trakcie rundy wraca jako to samo `you`.

### Etap 3. Frontend solo

W `bomb-it` podmienić `GameBoard` na snapshot. Klawiatura, krzyżak i Spacja wysyłają `input`. Rysowanie, animacja, HUD, ekran końcowy, muzyka i motyw działają na danych z serwera.

Akceptacja przy `next dev` i lokalnym procesie Node:

- ruch, bomba, granat, bonus, żywopłot, strefa,
- restart daje nowy labirynt i zerowe statystyki,
- stara bomba nie wybucha w nowej rundzie,
- zamknięcie procesu Node pokazuje stan `closed`, a nie planszę liczoną lokalnie.

### Etap 4. Drugi człowiek

`join` kodem, do czterech miejsc, wolne fotele botami albo ludźmi. Status liczony per `you`.

Akceptacja: drugie urządzenie w tym samym Wi-Fi (telefon albo laptop) otwiera front po adresie LAN komputera, na przykład `http://192.168.x.x:3000`, i wchodzi kodem pokoju. Bomba jednego rani drugiego. Każdy widzi swój ekran końcowy. Ruch idzie po `ws://` na porcie `8787` tego samego komputera, bez EC2 i bez Cloudflare.

---

## Poza zakresem

- EC2, Caddy, `wss`, Cloudflare Pages i poprawki `bomb-it/HOSTING.md`,
- przewidywanie ruchu po stronie klienta,
- ranking i konta,
- wznawianie rundy po restarcie procesu (pokój żyje tylko w RAM),
- przenoszenie listy utworów poza `bomb-it` (`api/music/route.js` zostaje przy lokalnym froncie).
