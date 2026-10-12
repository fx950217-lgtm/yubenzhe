import test from 'node:test';
import assert from 'node:assert/strict';
import {ruleTasks,computerTasks,taskProgress,overviewSections} from '../src/workbench-overview.js';

test('progress requires actual integer step metadata and never applies to an AI process',()=>{
 assert.deepEqual(taskProgress({origin:'rules',step:2,remainingSteps:1}),{done:2,total:3,percent:66});
 for(const task of [{origin:'device',step:2,remainingSteps:1},{origin:'rules',step:2},{origin:'rules',step:-1,remainingSteps:2},{origin:'rules',step:1.5,remainingSteps:1},{origin:'rules',step:0,remainingSteps:0}])assert.equal(taskProgress(task),null);
});
test('task normalization rejects partial or cross-device payloads rather than inventing a task source',()=>{
 assert.equal(ruleTasks([{id:'x',status:'running'}]),null);
 assert.equal(computerTasks([{id:'x',deviceId:'other',status:'running'}],{id:'own',name:'自己的电脑'}),null);
 const [task]=computerTasks([{id:'x',deviceId:'own',status:'running',provider:'codex',prompt:'  我的任务  '}],{id:'own',name:'自己的电脑'});
 assert.equal(task.title,'我的任务');assert.equal(task.sourceLabel,'自己的电脑 · Codex');assert.equal(task.origin,'device');
 assert.equal(computerTasks([{id:'x',deviceId:'own',status:'completed'}],{id:'own',name:'电脑'})[0].title,'电脑 AI 任务');
});
test('approval cards only represent existing rule task approval states; failed or cancelled work is not completed',()=>{
 const result=overviewSections([{id:'ai',origin:'device',status:'awaiting-user'},{id:'old',origin:'rules',status:'budget-paused'},{id:'failed',origin:'rules',status:'failed'},{id:'cancelled',origin:'device',status:'cancelled'},{id:'done',origin:'device',status:'completed'}]);
 assert.deepEqual(result.decisions.map(task=>task.id),['old']);assert.deepEqual(result.completed.map(task=>task.id),['done']);assert.deepEqual(result.running,[]);
});
