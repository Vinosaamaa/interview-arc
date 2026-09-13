import test from 'node:test';
import assert from 'node:assert/strict';
import {attachLectureGestures} from '../lib/lecture-player-gestures.ts';
test('single tap, double tap, hold, scroll cancellation and keyboard remain distinct',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const previousWindow=globalThis.window,previousDocument=globalThis.document;
  globalThis.window=new EventTarget();globalThis.document=new EventTarget();
  const surface=new EventTarget();surface.getBoundingClientRect=()=>({left:0,width:400});
  const events=[];const cleanup=attachLectureGestures(surface,{toggle:()=>events.push('toggle'),skip:s=>events.push(s),boost:v=>events.push(v?'boost':'restore')});
  const emit=(target,type,extra={})=>{const e=new Event(type,{cancelable:true});Object.assign(e,{isPrimary:true,button:0,pointerId:1,clientX:50,clientY:20,...extra});target.dispatchEvent(e);};
  const tap=x=>{emit(surface,'pointerdown',{clientX:x});emit(window,'pointerup',{clientX:x});};
  try{
    tap(50);t.mock.timers.tick(281);assert.deepEqual(events,['toggle']);events.length=0;
    tap(50);t.mock.timers.tick(100);tap(50);t.mock.timers.tick(500);assert.deepEqual(events,[-5]);events.length=0;
    tap(350);t.mock.timers.tick(100);tap(350);t.mock.timers.tick(500);assert.deepEqual(events,[5]);events.length=0;
    emit(surface,'pointerdown');t.mock.timers.tick(451);emit(window,'pointerup');t.mock.timers.tick(500);assert.deepEqual(events,['boost','restore']);events.length=0;
    emit(surface,'pointerdown');emit(window,'pointermove',{clientY:70});emit(window,'pointerup');t.mock.timers.tick(500);assert.deepEqual(events,[]);
    emit(surface,'pointerdown');t.mock.timers.tick(451);emit(window,'blur');assert.deepEqual(events,['boost','restore']);events.length=0;
    emit(surface,'click',{detail:0});emit(surface,'keydown',{key:'ArrowRight'});assert.deepEqual(events,['toggle',5]);
  }finally{cleanup();globalThis.window=previousWindow;globalThis.document=previousDocument;}
});
