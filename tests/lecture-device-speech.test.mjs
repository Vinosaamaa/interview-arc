import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import test from 'node:test';
import { createDeviceLectureSpeech } from '../lib/lecture-device-speech.ts';
import { lecturePlayerHtml } from '../mcp-worker/lecture-player-widget.ts';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(chunks, extra={}) {
  const spoken=[],saved=[],states=[],queue=[];
  const speech={getVoices:()=>[{localService:true,lang:'en-US'}],speak:u=>{spoken.push(u.text);queue.push(u);},cancel(){}};
  const player=createDeviceLectureSpeech({speech,makeUtterance:text=>({text}),chunkCount:chunks.length,chunkIndex:0,characterOffset:0,loadChunk:async index=>chunks[index],savePosition:async(i,o)=>saved.push([i,o]),onChange:s=>states.push(s),...extra});
  return {player,spoken,saved,states,queue};
}
test('free device speech preserves every character across automatic section transitions',async()=>{
  const chunks=['First sentence. '+('original code and numbers 42; '.repeat(25)),'Last section, exactly preserved.'];
  const f=fixture(chunks);await f.player.play();await tick();
  for(let n=0;n<100&&f.states.at(-1)?.phase!=='finished';n++){const u=f.queue.shift();if(u)u.onend();await tick();}
  assert.equal(f.states.at(-1).phase,'finished');assert.equal(f.spoken.join(''),chunks.join(''));
  assert.deepEqual(f.saved.at(-1),[1,chunks[1].length]);
});
test('pause saves a reported word boundary; stale callbacks cannot advance the cursor',async()=>{
  const f=fixture(['First words here. Next sentence.']);await f.player.play();await tick();
  const old=f.queue.shift();old.onboundary({charIndex:6});await f.player.pause();
  old.onend();assert.deepEqual(f.saved.at(-1),[0,6]);
  await f.player.play();await tick();assert.ok(f.spoken.at(-1).startsWith('words here.'));
});
test('no local voice and failed saves stop without a remote speech fallback',async()=>{
  let speechCalls=0;
  const remote=fixture(['Source'],{speech:{getVoices:()=>[{localService:false,lang:'en-US'}],speak(){speechCalls++;},cancel(){}}});
  await remote.player.play();assert.equal(speechCalls,0);assert.equal(remote.states.at(-1).phase,'unavailable');
  const f=fixture(['Source'],{savePosition:async()=>{throw Error('Position changed elsewhere');}});
  await f.player.play();await tick();await assert.rejects(f.player.pause(),/changed elsewhere/);
  await tick();assert.equal(f.states.at(-1).phase,'error');const count=f.spoken.length;await f.player.play();assert.equal(f.spoken.length,count);
});
test('embedded widget contains parseable device controller and no automatic paid generation',()=>{
  new Script(lecturePlayerHtml.match(/<script>([\s\S]*)<\/script>/)[1]);
  assert.match(lecturePlayerHtml,/Play free on this device/);
  assert.match(lecturePlayerHtml,/id="generate" hidden disabled/);
});
