// Fixed metadata SQL for current 021/025 and agreed F4 027 schema.
// No AI prompt, reply, decision question, option label, title or file content is read.
export function createCriticalSourceAdapter({database,decisionAvailable=()=>false}){
 const db=database.raw,one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args);
 const unseen=(kind,id,event)=>!one('SELECT 1 FROM critical_notification_events WHERE source_kind=? AND source_id=? AND kind=?',kind,id,event);
 const deviceOwned=(owner,id)=>Boolean(one('SELECT 1 FROM personal_devices WHERE id=? AND owner_id=? AND revoked_at IS NULL AND token_hash IS NOT NULL',id,owner));
 function rosterCurrent(session){
   if(!session||session.owner_revision!==session.current_revision||typeof session.roster_ids!=='string'||session.roster_ids.length>1000)return false;
   let ids;try{ids=JSON.parse(session.roster_ids);}catch{return false;}
   if(!Array.isArray(ids)||ids.length<1||ids.length>3||new Set(ids).size!==ids.length)return false;
   return ids.every(id=>typeof id==='string'&&one('SELECT 1 FROM conversation_ai_roster WHERE id=? AND conversation_id=? AND owner_id=? AND device_id=? AND removed_at IS NULL',id,session.conversation_id,session.owner_id,session.device_id));
 }
 function current({sourceKind,sourceId,kind}){
   if(sourceKind==='ai-task'){
     const task=one('SELECT owner_id,device_id,status,workspace_task_id FROM ai_channel_tasks WHERE id=?',sourceId);
     const segment=one('SELECT 1 FROM ai_task_decisions WHERE task_id=?',sourceId),group=one('SELECT 1 FROM device_ai_rounds WHERE task_id=?',task?.workspace_task_id||sourceId);
     const occurred=!!task&&!segment&&!group&&task.status===(kind==='task-completed'?'succeeded':'failed');
     return {ownerId:task?.owner_id,occurred,eligible:occurred&&deviceOwned(task.owner_id,task.device_id)};
   }
   if(sourceKind==='workbench-task'){
     const task=one('SELECT owner_id,status FROM workbench_tasks WHERE id=?',sourceId);
     const occurred=!!task&&task.status===(kind==='task-completed'?'succeeded':'failed');return {ownerId:task?.owner_id,occurred,eligible:occurred};
   }
   if(sourceKind==='decision'){
     const decision=one('SELECT owner_id,device_id,state FROM ai_task_decisions WHERE id=?',sourceId);
     const occurred=kind==='decision-required'&&decision?.state==='pending';return {ownerId:decision?.owner_id,occurred,eligible:occurred&&deviceOwned(decision.owner_id,decision.device_id)&&decisionAvailable(sourceId)===true};
   }
   if(sourceKind==='group-session'){
     const session=one('SELECT s.owner_id,s.device_id,s.status,s.anchor_id,s.conversation_id,s.roster_ids,s.owner_revision,c.ai_owner_revision current_revision,c.owner_id group_owner,c.allow_device_ai,cm.history_start_id FROM device_ai_sessions s LEFT JOIN conversations c ON c.id=s.conversation_id LEFT JOIN conversation_members cm ON cm.conversation_id=s.conversation_id AND cm.account_id=s.owner_id WHERE s.id=?',sourceId);
     const failed=kind==='task-failed'&&one("SELECT 1 FROM device_ai_rounds r JOIN ai_channel_tasks t ON COALESCE(t.workspace_task_id,t.id)=r.task_id WHERE r.session_id=? AND t.status='failed' LIMIT 1",sourceId);
     const stateOK=kind==='task-completed'?session?.status==='finished':session?.status==='stopped'&&!!failed;
     return {ownerId:session?.owner_id,occurred:!!session&&stateOK,eligible:!!session&&stateOK&&session.owner_id===session.group_owner&&session.allow_device_ai===1&&session.history_start_id!==null&&session.anchor_id>session.history_start_id&&rosterCurrent(session)&&deviceOwned(session.owner_id,session.device_id)};
   }
   return {eligible:false};
 }
 function collect({since,until,limit}){
   const candidates=[];
   const add=(sourceKind,sourceId,ownerId,kind,occurredAt,expiresAt)=>{if(unseen(sourceKind,sourceId,kind))candidates.push({sourceKind,sourceId,ownerId,kind,occurredAt,...(expiresAt?{expiresAt}:{})});};
   for(const row of all("SELECT d.id,d.owner_id,d.created_at,d.expires_at FROM ai_task_decisions d JOIN accounts a ON a.id=d.owner_id AND a.deleted_at=0 WHERE d.state='pending' AND d.created_at>=? AND d.created_at<=? AND d.expires_at>? AND NOT EXISTS(SELECT 1 FROM critical_notification_events e WHERE e.source_kind='decision' AND e.source_id=d.id AND e.kind='decision-required') ORDER BY d.created_at,d.id LIMIT ?",since,until,until,limit))add('decision',row.id,row.owner_id,'decision-required',row.created_at,row.expires_at);
   for(const row of all("SELECT t.id,t.owner_id,t.status,t.finished_at FROM ai_channel_tasks t JOIN accounts a ON a.id=t.owner_id AND a.deleted_at=0 WHERE t.status IN('succeeded','failed') AND t.finished_at>=? AND t.finished_at<=? AND NOT EXISTS(SELECT 1 FROM ai_task_decisions d WHERE d.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM device_ai_rounds r WHERE r.task_id=COALESCE(t.workspace_task_id,t.id)) AND NOT EXISTS(SELECT 1 FROM critical_notification_events e WHERE e.source_kind='ai-task' AND e.source_id=t.id AND e.kind=CASE t.status WHEN 'succeeded' THEN 'task-completed' ELSE 'task-failed' END) ORDER BY t.finished_at,t.id LIMIT ?",since,until,limit))add('ai-task',row.id,row.owner_id,row.status==='succeeded'?'task-completed':'task-failed',row.finished_at);
   for(const row of all("SELECT t.id,t.owner_id,t.status,t.updated_at FROM workbench_tasks t JOIN accounts a ON a.id=t.owner_id AND a.deleted_at=0 WHERE t.status IN('succeeded','failed') AND t.updated_at>=? AND t.updated_at<=? AND NOT EXISTS(SELECT 1 FROM critical_notification_events e WHERE e.source_kind='workbench-task' AND e.source_id=t.id AND e.kind=CASE t.status WHEN 'succeeded' THEN 'task-completed' ELSE 'task-failed' END) ORDER BY t.updated_at,t.id LIMIT ?",since,until,limit))add('workbench-task',row.id,row.owner_id,row.status==='succeeded'?'task-completed':'task-failed',row.updated_at);
   for(const row of all("SELECT s.id,s.owner_id,s.status,max(t.finished_at) occurred_at FROM device_ai_sessions s JOIN accounts a ON a.id=s.owner_id AND a.deleted_at=0 JOIN device_ai_rounds r ON r.session_id=s.id JOIN ai_channel_tasks t ON COALESCE(t.workspace_task_id,t.id)=r.task_id WHERE (s.status='finished' OR (s.status='stopped' AND EXISTS(SELECT 1 FROM device_ai_rounds fr JOIN ai_channel_tasks ft ON COALESCE(ft.workspace_task_id,ft.id)=fr.task_id WHERE fr.session_id=s.id AND ft.status='failed'))) AND NOT EXISTS(SELECT 1 FROM critical_notification_events e WHERE e.source_kind='group-session' AND e.source_id=s.id AND e.kind=CASE s.status WHEN 'finished' THEN 'task-completed' ELSE 'task-failed' END) GROUP BY s.id HAVING occurred_at>=? AND occurred_at<=? ORDER BY occurred_at,s.id LIMIT ?",since,until,limit))add('group-session',row.id,row.owner_id,row.status==='finished'?'task-completed':'task-failed',row.occurred_at);
   return candidates.sort((a,b)=>a.occurredAt-b.occurredAt||a.sourceId.localeCompare(b.sourceId)).slice(0,limit);
 }
 return {current,collect};
}
