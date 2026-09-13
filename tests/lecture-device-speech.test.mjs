import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import test from 'node:test';
import { createDeviceLectureSpeech } from '../lib/lecture-device-speech.ts';
import { lecturePlayerHtml } from '../mcp-worker/lecture-player-widget.ts';
import { lectureTranscriptSegments } from '../lib/lecture-transcript.ts';

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

test('transcript segments preserve original whitespace, code and punctuation',()=>{
  for(const text of ['Hello. Next!\n\nKeep  spaces,\ttabs and code: x += 1;\nlast line','...','No punctuation','\n\n','']){
    const segments=lectureTranscriptSegments(text);assert.equal(segments.map(s=>s.text).join(''),text);
    for(const s of segments)assert.equal(text.slice(s.start,s.end),s.text);
  }
});
test('transcript seek starts at selected original text, rejects stale callbacks and replays after finish',async()=>{
  const f=fixture(['First sentence. Selected passage.']);await f.player.play();await tick();const old=f.queue.shift();
  await f.player.seek(0,16,true);await tick();assert.equal(f.spoken.at(-1),'Selected passage.');
  old.onend();assert.deepEqual(f.saved.at(-1),[0,16]);f.queue.shift().onend();await tick();
  assert.equal(f.states.at(-1).phase,'finished');await f.player.play();await tick();assert.equal(f.spoken.at(-1),'First sentence. ');
});
test('estimated skips cross chunk boundaries and clamp to the original text',async()=>{
  const f=fixture(['one two three four five ','six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen']);
  await f.player.skip(5);assert.deepEqual(f.saved.at(-1),[1,25]);
  await f.player.skip(-5);assert.deepEqual(f.saved.at(-1),[0,0]);
  await f.player.skip(-5);assert.deepEqual(f.saved.at(-1),[0,0]);
  await f.player.skip(60);assert.deepEqual(f.saved.at(-1),[1,72]);
});
test('speed and voice changes immediately restart at the reported boundary',async()=>{
  const available=[{voiceURI:'default',name:'Default',lang:'en-US',localService:true},{voiceURI:'enhanced',name:'Enhanced',lang:'en-US',localService:true}];
  const queued=[];const f=fixture(['First words here.'],{speech:{getVoices:()=>available,speak:u=>queued.push(u),cancel(){}}});
  await f.player.play();await tick();assert.equal(queued.at(-1).voice.voiceURI,'enhanced');queued.at(-1).onboundary({charIndex:6});
  f.player.setRate(2);await tick();assert.equal(queued.at(-1).rate,2);assert.equal(queued.at(-1).text,'words here.');
  f.player.setRate(1.25);await tick();assert.equal(queued.at(-1).rate,1.25);
  f.player.setVoice('default');await tick();assert.equal(queued.at(-1).voice.voiceURI,'default');
});
