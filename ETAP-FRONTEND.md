# Etap frontendu — podłączenie `bomb-it`

Serwer w tym repozytorium już liczy rundę. Repo `bomb-it` nie było ruszane. Ten plik jest listą prac po tamtej stronie: najpierw solo (etap 3 planu), potem drugi człowiek (etap 4). Klient zostaje widokiem: rysuje snapshot, wysyła intencje, gra muzykę. Nie importuje `game/` i nie woła `step`.

Serwer na czas prac:

```bash
npm start
```

Proces słucha na `0.0.0.0:8787`. Sprawdzenie: `GET http://127.0.0.1:8787/health`. Skrypt `npm run accept` odtwarza rundę bez przeglądarki i przechodzi ten sam WebSocket, którego będzie używał front.

## Adres

Port gry jest zawsze `8787`. Front, tak jak dziś, ma iść na `next dev --hostname 0.0.0.0 --port 3000`.

- `localhost` → `ws://127.0.0.1:8787`
- strona otwarta jako `http://192.168.x.x:3000` → `ws://192.168.x.x:8787`
- nadpisanie: `window.BOMB_IT_WS_URL`

Na Windowsie zapora musi przepuścić przychodzące TCP `3000` i `8787` w sieci prywatnej. Tego nie ustawiałem.

## Protokół

JSON po WebSockecie. Jedno gniazdo najpierw wysyła `create` albo `join`.

Klient → serwer:

| Typ | Treść |
|---|---|
| `create` | `{ nick, zone, fillBots }`. Solo: `fillBots: true`. Pokój z kodem: `fillBots: false`. `zone` jest opcją pokoju, nie przełącznikiem w trakcie rundy. |
| `join` | `{ code, nick }`. Kod jest bez znaczenia wielkości liter. |
| `input` | `{ direction: { row, col } \| null, action: "bomb" \| null, seq }` |
| `restart` | Nowa runda w tym samym pokoju. W lobby ta sama wiadomość **zaczyna** pierwszą rundę i puste fotele obsadza botami. `start` jest tym samym typem. |
| `leave` | |

Serwer → klient:

| Typ | Treść |
|---|---|
| `welcome` | `{ roomId, code, you }`. `roomId` i `code` to ten sam napis, cztery znaki. |
| `state` | snapshot poniżej. W lobby `status` to `"lobby"`. |
| `error` | `{ message }` — nieznany kod albo brak miejsca. |
| `bye` | pokój zamknięty. |

`seq` rośnie o 1 na wiadomość tego gniazda. Powtórzone albo starsze `seq` serwer ignoruje w całości. Po `restart` licznik po stronie serwera wraca do zera, więc klient może zacząć znowu od 1. Nie wysyłaj ponownie starej akcji.

`direction` to przytrzymany stan, nie pojedyncze naciśnięcie. Puszczenie klawisza to `direction: null`. `action: "bomb"` to zbocze: tylko przy pierwszym wciśnięciu Spacji, nie przy autorepeat. Kierunek i Spacja mogą iść w jednej wiadomości (`direction` trzymany, `action: "bomb"`). Serwer sam stawia bombę albo granat. Nielegalny krok i Spacja bez ładunku znikają po cichu.

Dwa gniazda z tym samym `you`: kierunek bierze ostatnio podłączone, a bombę zdąży wysłać którekolwiek, zanim przyjdzie tick. Rozłączenie w trakcie rundy zostawia aktora na planszy (stoi, nie stawia bomb). Wejście tym samym kodem wraca pod to samo `you`: w solo zawsze, przy kilku ludziach tylko gdy `nick` się zgadza. Pusty pokój po meczu znika po 30 s. W trakcie rundy bez żadnego gniazda boty grają dalej, najwyżej 10 minut.

## Snapshot

`{ type: "state", ... }` i pola:

```js
{
  roomId, you, status, startedAt, serverNow,
  zone: null | { startedAt, radius },
  actors: [{ id, kind, color, name, position, facing, lives, alive,
             moveIntervalMs, effects: [{ id, msLeft }], stats, diedAt? }],
  walls: [{ row, col, type }],
  bonuses: [{ id, row, col }],
  bombs: [{ id, row, col, kind, airborne, from }],
  explosions: [{ id, cells, until }],
  toasts: [{ id, text, until }],
}
```

`status` dla tego gniazda to `lobby`, `playing`, `win`, `lose` albo `draw`. Klient nie składa wyniku z listy żywych.

Czego w snapshocie nie ma i nie wolno odtwarzać lokalnie: typu bonusu na ziemi, ściany `bonus` (idzie jako `destructible`), ziarna RNG, `nextMoveAt`, kierunku bota. Leżący bonus jest już tajemnicą — `BonusPickup` i tak rysuje `mystery`. Toast („Szybkość!”) przychodzi gotowy.

`kind` bomby to `"bomb"` albo `"grenade"`. Granat w locie ma `airborne: true` i `from: { row, col }`. Po wylądowaniu `airborne` jest false. Dziś `GrenadeMarker` czyta `fromRow` / `fromCol` — albo czyta `from`, albo mapuje to w jednym miejscu przy snapshocie.

`effects` to tablica, nie mapa `{ speed: { until } }`. `msLeft === null` oznacza granat (ikona bez licznika). `moveIntervalMs` jest czasem kroku animacji; nie wołać `moveIntervalFor`.

`until` toastów i wybuchów oraz `diedAt` są w czasie serwera. Zegar lokalny: `serverNow + (Date.now() - receivedAt)`. Od tego liczyć zniknięcie ognia, toastu i `msLeft`. Nie porównywać `until` wprost z `Date.now()`.

`zone.radius` jest w polach planszy. Piksele burzy: `radius * (ARENA_SIZE / BOARD_SIZE)`. Nie kopiować `safeRadius`. Przy włączonej strefie snapshot przychodzi co 50 ms, więc promień się rusza. W lobby `zone` jest `null` — opcja jest już zapisana w pokoju, widać ją od startu rundy.

Obramowanie nie jedzie w snapshocie. Zostaje rysunkiem krawędzi 15×15 przy Arenie. Kolizji z ramką klient nie liczy.

Aktorzy: człowiek ma `kind: "player"` i id `p1`, `p2`, … Bot ma `kind: "bot"` i id `bot-1`, … Kolory foteli: niebieski, czerwony, zielony, fioletowy. Samotny gracz wysłany jako `nick: "Ty"` nazywa się tak jak dziś. Nie szukać aktora o id `"player"`. Swój pionek to `you`.

## Etap 3 — solo

Nowe pliki w `bomb-it/src/app/`:

- `net.js` — URL, łączenie, `create` / `join` / `input` / `restart` / `leave`, kolejny `seq`.
- `useRoom.js` — ostatni snapshot, `you`, status połączenia `connecting` | `live` | `closed`.

Ekran przed rundą, na ten etap: przycisk „Graj”. Wysyła `create` z `fillBots: true`, nickiem i stanem checkboxa strefy. „Pokój” może poczekać do etapu 4.

| Plik | Po zmianie |
|---|---|
| `GameBoard.js` | czyta snapshot z `useRoom`. Nie trzyma ścian, bomb, aktorów, bonusów ani statusu jako źródła prawdy. |
| `GameSession.js` | Enter / restart wysyła `restart`. Nie podbija `key`, bo to zostałoby lokalną rundą, a stara bomba żyłaby tylko w starym drzewie Reacta. |
| `usePlayerControls.js` | klawisz i przytrzymanie → `input`. Zostaje `preventDefault` i mapowanie WASD / strzałek. Znika kolizja, `placeBomb`, `throwGrenade`. |
| `TouchControls.js` | ten sam `input` co klawiatura. |
| `useWalkAnimation.js` | `position`, `facing`, `moveIntervalMs` ze snapshotu. Nie importować `actors.js`. |
| `EndScreen.js` | `status`, `actors`, `startedAt` ze snapshotu. Enter woła `restart`. `diedAt` na aktorze już jest. |
| `Hud.js` | efekty z tablicy `{ id, msLeft }`, nie z `activeEffectIds` na wewnętrznym stanie. |
| `Storm.js` | `zone.radius` ze snapshotu, nie `safeRadius(Date.now() - startedAt)`. |
| `Arena.js` | te same sprite’y. Bomby i granaty rozdzielić po `kind`. Wybuchy z `explosions[].cells`. |
| `GameFrame.js` | motyw zostaje lokalny. Checkbox strefy wchodzi w `create`, nie w środek trwającej rundy. Dziś `useEffect` w `GameBoard` przełącza strefę w locie — tego serwer nie zrobi. |

Do usunięcia, gdy widok stoi na snapshocie: `useGameLoop.js`, `useBomb.js`, `useOpeningLayout.js`, oraz `maze.js`, `bomb.js`, `bot.js`, `actors.js`, `bonus.js`, `zone.js`, `border.js`. Z `playerMovement.js` zostawić tylko mapowanie klawisza (może wylądować przy sterowaniu). Z `config.js` zostają stałe obrazu: `ARENA_SIZE`, `MUSIC_VOLUME`, `TOAST_MS` tylko jeśli coś jeszcze liczy czas napisu lokalnie — serwer i tak przysyła `until`. Zasady (`BOMB_*`, szanse ścian, strefa, interwały ruchu) znikają.

Zostają widokiem: `Arena.js`, `WallBlock.js`, `ActorSprite.js`, `Hud.js`, `EndScreen.js`, `Storm.js`, `assets.js`, `MusicToggle.js`, `useBackgroundMusic.js`, `api/music/route.js`, CSS, `public/`. `gameStats.js` zostaje formatowaniem ekranu końcowego.

Zamknięcie procesu Node, `bye` albo zerwanie gniazda → status `closed` i komunikat. Nie zostawiać planszy liczonej w przeglądarce.

Sprawdzenie przy `next dev` i `npm start`:

- ruch, bomba, granat, bonus, żywopłot, strefa,
- krok animuje się z `moveIntervalMs` (szybszy z bonusem szybkości),
- restart daje nowy labirynt i zerowe statystyki,
- stara bomba nie wybucha w nowej rundzie,
- padnięcie procesu pokazuje `closed`.

## Etap 4 — drugi człowiek

Ten sam protokół. „Pokój” robi `create` z `fillBots: false` i pokazuje `welcome.code`. Drugie urządzenie w tym Wi-Fi otwiera front po adresie LAN (`http://192.168.x.x:3000`) i wysyła `join`. W lobby widać ludzi (`status: "lobby"`, puste pozycje). `restart` (albo `start`) zaczyna rundę: wolne fotele z czterech dostają boty. Pełne cztery fotele to runda bez botów.

Każdy dostaje swój `status`. Ostatni żywy człowiek wygrywa, pozostali przegrywają, wspólna śmierć w jednym momencie to remis, boty nie wygrywają. Ekran końcowy nie powtarza tej reguły. `gameStats.survivorSummary` dziś traktuje każdego `kind: "player"` jak „ty” — przy dwóch ludziach zdanie o ocalałych trzeba oprzeć o `you` i `status`, nie o „jest jakiś żywy człowiek”.

Bomba jednego rani drugiego, bo to jeden stan. Ruch idzie po `ws://` na porcie `8787` tego komputera, bez EC2 i bez Cloudflare.

## Poza tym etapem

EC2, `wss`, Cloudflare, ranking, konta, przewidywanie ruchu i wznawianie pokoju po restarcie procesu. Pokój żyje tylko w RAM.
