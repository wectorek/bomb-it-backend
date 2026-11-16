import { randomInt } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { initialStats } from "./game/actors.js";
import { createMatch } from "./game/createMatch.js";
import {
  GAME_TICK_MS,
  PLAYER_MOVE_INTERVAL_MS,
  SEAT_COLORS,
  SEAT_COUNT,
  STARTING_LIVES,
} from "./game/config.js";
import { hashSeed } from "./game/rng.js";
import { snapshot } from "./game/snapshot.js";
import { step } from "./game/step.js";
import { unitDirection } from "./game/playerMovement.js";

export const DEFAULT_HOST = "0.0.0.0";
export const DEFAULT_PORT = 8787;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const EMPTY_ENDED_MS = 30_000;
const EMPTY_PLAYING_MS = 10 * 60_000;

const rooms = new Map();

export function cleanNick(nick) {
  if (typeof nick !== "string") {
    return "Ty";
  }
  const trimmed = nick.replace(/\s+/g, " ").trim().slice(0, 16);
  return trimmed || "Ty";
}

export function noteInput(conn, message) {
  if (!message || typeof message.seq !== "number" || message.seq <= conn.lastSeq) {
    return false;
  }
  conn.lastSeq = message.seq;
  conn.direction = unitDirection(message.direction);
  if (message.action === "bomb") {
    conn.pendingAction = "bomb";
  }
  return true;
}

function send(conn, payload) {
  if (!conn.ws || conn.ws.readyState !== WebSocket.OPEN) {
    return;
  }
  conn.ws.send(JSON.stringify(payload));
}

function makeCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = "";
    for (let index = 0; index < 4; index += 1) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) {
      return code;
    }
  }
  throw new Error("Nie udało się wylosować kodu pokoju");
}

function stopTick(room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
}

function destroyRoom(room) {
  stopTick(room);
  if (room.expire) {
    clearTimeout(room.expire);
    room.expire = null;
  }
  for (const conn of [...room.conns]) {
    send(conn, { type: "bye" });
    conn.room = null;
    conn.you = null;
    try {
      conn.ws.close();
    } catch {
      // Gniazdo mogło już być zamknięte.
    }
  }
  room.conns = [];
  rooms.delete(room.code);
}

function scheduleExpiry(room) {
  if (room.expire) {
    clearTimeout(room.expire);
  }
  const playing = room.state?.status === "playing";
  room.expire = setTimeout(() => {
    if (room.conns.length === 0 && rooms.get(room.code) === room) {
      destroyRoom(room);
    }
  }, playing ? EMPTY_PLAYING_MS : EMPTY_ENDED_MS);
}

function lobbySnapshot(room, you, now) {
  return {
    roomId: room.code,
    you,
    status: "lobby",
    startedAt: null,
    serverNow: now,
    zone: null,
    fillBots: room.fillBots === true,
    actors: room.seats.map((seat) => ({
      id: seat.id,
      kind: "player",
      color: seat.color,
      name: seat.name,
      position: null,
      facing: "down",
      lives: STARTING_LIVES,
      alive: true,
      moveIntervalMs: PLAYER_MOVE_INTERVAL_MS,
      effects: [],
      stats: initialStats(),
    })),
    walls: [],
    bonuses: [],
    bombs: [],
    explosions: [],
    toasts: [],
  };
}

function broadcast(room, now) {
  for (const conn of room.conns) {
    const body = room.state
      ? snapshot(room.state, { roomId: room.code, you: conn.you, now })
      : lobbySnapshot(room, conn.you, now);
    send(conn, { type: "state", ...body });
  }
}

function pullInput(room, actorId) {
  const conns = room.conns.filter((conn) => conn.you === actorId);
  const chosen = conns[conns.length - 1] ?? null;
  let action = null;
  for (const conn of conns) {
    if (conn.pendingAction) {
      action = conn.pendingAction;
    }
    conn.pendingAction = null;
  }
  return {
    actorId,
    direction: chosen?.direction ?? null,
    action,
  };
}

function tick(room, now) {
  if (!room.state || room.state.status !== "playing") {
    stopTick(room);
    if (room.conns.length === 0) {
      scheduleExpiry(room);
    }
    return;
  }

  const inputs = room.state.actors
    .filter((actor) => actor.kind === "player")
    .map((actor) => pullInput(room, actor.id));
  const next = step(room.state, inputs, now);
  const changed = JSON.stringify(next) !== JSON.stringify(room.state);
  room.state = next;
  if (changed || next.zone) {
    broadcast(room, now);
  }
  if (next.status !== "playing") {
    stopTick(room);
    if (room.conns.length === 0) {
      scheduleExpiry(room);
    }
  }
}

function ensureTick(room) {
  if (room.timer || room.state?.status !== "playing") {
    return;
  }
  room.timer = setInterval(() => tick(room, Date.now()), GAME_TICK_MS);
}

function beginMatch(room, now) {
  const humans =
    room.roster ??
    room.seats.map((seat) => ({
      id: seat.id,
      kind: "player",
      name: seat.name,
      color: seat.color,
    }));
  room.round += 1;
  room.state = createMatch({
    zone: room.zone,
    humans,
    fillBots: room.fillBots === true,
    seed: hashSeed(`${room.code}:${room.round}:${now}`),
    now,
  });
  room.roster = room.state.actors.map((actor) => ({
    id: actor.id,
    kind: actor.kind,
    name: actor.name,
    color: actor.color,
  }));
  for (const conn of room.conns) {
    conn.pendingAction = null;
    conn.lastSeq = 0;
  }
  if (room.expire) {
    clearTimeout(room.expire);
    room.expire = null;
  }
  ensureTick(room);
  broadcast(room, now);
}

function addHuman(room, name) {
  if (room.seats.length >= SEAT_COUNT) {
    return null;
  }
  const used = new Set(room.seats.map((seat) => seat.color));
  const color =
    SEAT_COLORS.find((entry) => !used.has(entry)) ??
    SEAT_COLORS[room.seats.length % SEAT_COLORS.length];
  const seat = {
    id: `p${room.nextSeat}`,
    name,
    color,
  };
  room.nextSeat += 1;
  room.seats.push(seat);
  return seat;
}

function humansOf(room) {
  if (room.state) {
    return room.state.actors
      .filter((actor) => actor.kind === "player")
      .map((actor) => ({ id: actor.id, name: actor.name }));
  }
  return room.seats.map((seat) => ({ id: seat.id, name: seat.name }));
}

function claimYou(room, nick) {
  const people = humansOf(room);
  if (room.state) {
    if (people.length === 1) {
      return people[0].id;
    }
    return people.find((person) => person.name === nick)?.id ?? null;
  }
  const existing = people.find((person) => person.name === nick);
  if (existing) {
    return existing.id;
  }
  return addHuman(room, nick)?.id ?? null;
}

function removeConn(room, conn) {
  room.conns = room.conns.filter((item) => item !== conn);
  if (!room.state) {
    const stillThere = room.conns.some((item) => item.you === conn.you);
    if (!stillThere) {
      room.seats = room.seats.filter((seat) => seat.id !== conn.you);
    }
  }
  if (room.conns.length === 0) {
    scheduleExpiry(room);
  }
}

function bind(room, conn, you) {
  if (conn.room && conn.room !== room) {
    removeConn(conn.room, conn);
  }
  conn.room = room;
  conn.you = you;
  conn.direction = null;
  conn.pendingAction = null;
  conn.lastSeq = 0;
  if (!room.conns.includes(conn)) {
    room.conns.push(conn);
  }
  if (room.expire) {
    clearTimeout(room.expire);
    room.expire = null;
  }
}

function welcome(conn) {
  send(conn, {
    type: "welcome",
    roomId: conn.room.code,
    code: conn.room.code,
    you: conn.you,
  });
}

function leave(conn, now) {
  const room = conn.room;
  if (!room) {
    return;
  }
  const you = conn.you;
  removeConn(room, conn);
  conn.room = null;
  conn.you = null;
  conn.direction = null;
  conn.pendingAction = null;
  if (!room.state && rooms.get(room.code) === room && room.conns.length > 0) {
    broadcast(room, now);
  }
  return you;
}

function onCreate(conn, message, now) {
  leave(conn, now);
  const code = makeCode();
  const room = {
    code,
    zone: Boolean(message.zone),
    fillBots: message.fillBots === true,
    seats: [],
    nextSeat: 1,
    roster: null,
    state: null,
    conns: [],
    timer: null,
    expire: null,
    round: 0,
  };
  rooms.set(code, room);
  const seat = addHuman(room, cleanNick(message.nick));
  bind(room, conn, seat.id);
  welcome(conn);
  if (message.fillBots === true && message.lobby !== true) {
    beginMatch(room, now);
    return;
  }
  broadcast(room, now);
}

function onJoin(conn, message, now) {
  const code =
    typeof message.code === "string" ? message.code.trim().toUpperCase() : "";
  const room = rooms.get(code);
  if (!room) {
    send(conn, { type: "error", message: "Nie ma takiego pokoju." });
    return;
  }
  const you = claimYou(room, cleanNick(message.nick));
  if (!you) {
    send(conn, { type: "error", message: "Brak wolnego miejsca w tym pokoju." });
    return;
  }
  leave(conn, now);
  bind(room, conn, you);
  welcome(conn);
  broadcast(room, now);
}

function onRestart(conn, now) {
  if (!conn.room) {
    send(conn, { type: "error", message: "Najpierw wejdź do pokoju." });
    return;
  }
  beginMatch(conn.room, now);
}

function onInput(conn, message) {
  if (!conn.room || !conn.you) {
    return;
  }
  noteInput(conn, message);
}

function onLeave(conn, now) {
  leave(conn, now);
  try {
    conn.ws.close();
  } catch {
    // Już zamknięte.
  }
}

function handleMessage(conn, message, now) {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "create") {
    onCreate(conn, message, now);
  } else if (message.type === "join") {
    onJoin(conn, message, now);
  } else if (message.type === "input") {
    onInput(conn, message);
  } else if (message.type === "restart" || message.type === "start") {
    onRestart(conn, now);
  } else if (message.type === "leave") {
    onLeave(conn, now);
  }
}

export function startServer({
  port = DEFAULT_PORT,
  host = DEFAULT_HOST,
  silent = false,
} = {}) {
  const httpServer = http.createServer((request, response) => {
    if (request.method === "GET" && (request.url === "/" || request.url === "/health")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    const conn = {
      ws,
      room: null,
      you: null,
      lastSeq: 0,
      direction: null,
      pendingAction: null,
    };
    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      handleMessage(conn, message, Date.now());
    });
    ws.on("close", () => leave(conn, Date.now()));
  });

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      const address = httpServer.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      if (!silent) {
        console.log(`bomb-it nasłuchuje na ws://${host}:${actualPort}`);
      }
      resolve({
        host,
        port: actualPort,
        async close() {
          for (const room of [...rooms.values()]) {
            destroyRoom(room);
          }
          rooms.clear();
          await new Promise((done) => wss.close(() => done()));
          if (httpServer.listening) {
            await new Promise((done) => httpServer.close(() => done()));
          }
        },
      });
    });
  });
}

const isDirect =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirect) {
  startServer({
    port: Number(process.env.PORT) || DEFAULT_PORT,
    host: process.env.HOST || DEFAULT_HOST,
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
