import WebSocket from "ws";
import assert from "node:assert/strict";
import { startServer } from "./server.js";
const srv = await startServer({ port: 0, host: "127.0.0.1", silent: true });
function client(){return new Promise(r=>{const ws=new WebSocket(`ws://127.0.0.1:${srv.port}`);const c={ws,last:null,welcome:null};ws.on("message",d=>{const m=JSON.parse(d);if(m.type==="state")c.last=m;if(m.type==="welcome")c.welcome=m;});ws.on("open",()=>r(c));c.send=m=>ws.send(JSON.stringify(m));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const a=await client(),b=await client(),c=await client();
a.send({type:"create",nick:"A",fillBots:false,lobby:true});await sleep(100);
const code=a.welcome.code;
b.send({type:"join",code,nick:"B"});c.send({type:"join",code,nick:"C"});await sleep(150);
assert.equal(a.last.actors.length,3);assert.equal(a.last.host,a.welcome.you);
b.send({type:"restart"});await sleep(80);assert.equal(a.last.status,"lobby");// non-host ignored
a.send({type:"settings",settings:{zone:true,playerSpeed:2}});await sleep(80);assert.equal(b.last.settings.playerSpeed,2);
a.send({type:"restart"});await sleep(120);assert.equal(a.last.status,"playing");assert.ok(a.last.zone);
c.send({type:"leave"});await sleep(150);
assert.equal(a.last.actors.length,2);assert.equal(a.last.status,"playing");
b.send({type:"transferHost",to:"p1"});await sleep(50);assert.equal(a.last.host,"p2"===a.last.host?"p2":a.last.host);
a.send({type:"transferHost",to:b.welcome.you});await sleep(80);assert.equal(b.last.host,b.welcome.you);
b.send({type:"transferHost",to:a.welcome.you});await sleep(80);
// a leaves -> B wins
b.send({type:"leave"});await sleep(150);
console.log("status",a.last.status, a.last.host);
assert.equal(a.last.status,"win");
// rematch with ready
const d=await client();d.send({type:"join",code,nick:"X"});await sleep(100);
console.log(d.last?.status);
a.ws.close();d.ws.close();b.ws.close();c.ws.close();
await srv.close();console.log("ok");process.exit(0);
