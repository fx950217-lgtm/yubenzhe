import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, FileText, Loader2, LockKeyhole, RefreshCw, Search, Server, ShieldCheck, Sparkles, X } from 'lucide-react';
import { actionEnabled, actionLabels, auditLabels, aiAPI, availableActions, createActionRequest, mutationOutcome, safeText, shortId, taskLabels, workspaceLabels, type ActionRequest, type AIAudit, type Capabilities, type Workspace, type WorkspaceAction, type WorkspaceDetail, type WorkspaceStatus } from './ai-admin-client';
import './ai-admin.css';

const date = (value: string | number | null | undefined) => value == null ? '—' : new Date(value).toLocaleString('zh-CN', { hour12: false });
const message = (error: unknown) => safeText(error instanceof Error ? error.message : '暂时无法读取，请重试。', 250);
function Status({ status }: { status: string }) {
  const label = (workspaceLabels as Record<string, string>)[status] || (taskLabels as Record<string, string>)[status] || status;
  const color = ['active', 'succeeded'].includes(status) ? 'green' : ['rejected', 'failed'].includes(status) ? 'red' : ['pending_review', 'awaiting_configuration', 'running'].includes(status) ? 'amber' : 'gray';
  return <span className={`badge ${color}`}>{label}</span>;
}

export default function AIAdmin({ refresh, onLockChange }: { refresh: number; onLockChange: (locked: boolean) => void }) {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null), [capError, setCapError] = useState(''), [checking, setChecking] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]), [listLoading, setListLoading] = useState(true), [listError, setListError] = useState('');
  const [status, setStatus] = useState<WorkspaceStatus | ''>(''), [query, setQuery] = useState(''), [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Workspace | null>(null), [detail, setDetail] = useState<WorkspaceDetail | null>(null), [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState('');
  const [audit, setAudit] = useState<AIAudit[]>([]), [auditError, setAuditError] = useState(''), [tab, setTab] = useState<'application' | 'tasks' | 'audit'>('application');
  const [action, setAction] = useState<WorkspaceAction | ''>(''), [reason, setReason] = useState(''), [saving, setSaving] = useState(false), [uncertain, setUncertain] = useState(false), [needsRefresh, setNeedsRefresh] = useState(false), [operationError, setOperationError] = useState(''), [notice, setNotice] = useState('');
  const pending = useRef<ActionRequest | null>(null), readinessId = useRef<string | null>(null), drawer = useRef<HTMLElement>(null), returnFocus = useRef<HTMLElement | null>(null), detailSequence = useRef(0), listSequence = useRef(0), capsSequence = useRef(0), mounted = useRef(true), locked = useRef(false);
  locked.current = saving || uncertain;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; detailSequence.current++; listSequence.current++; capsSequence.current++; }; }, []);
  useEffect(() => { onLockChange(saving || uncertain); return () => onLockChange(false); }, [saving, uncertain, onLockChange]);
  useEffect(() => { if (!saving && !uncertain) return; const preventLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', preventLeave); return () => window.removeEventListener('beforeunload', preventLeave); }, [saving, uncertain]);

  const reloadCapabilities = useCallback(async () => {
    const sequence = ++capsSequence.current; setCapError('');
    try { const next = await aiAPI.capabilities(); if (mounted.current && sequence === capsSequence.current) setCapabilities(next); }
    catch (error) { if (mounted.current && sequence === capsSequence.current) { setCapError(message(error)); setCapabilities(null); } }
  }, []);
  const reloadList = useCallback(async () => {
    const sequence = ++listSequence.current; setListLoading(true); setListError('');
    try { const items = await aiAPI.workspaces(); if (mounted.current && sequence === listSequence.current) setWorkspaces(items.sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)))); }
    catch (error) { if (mounted.current && sequence === listSequence.current) setListError(message(error)); }
    finally { if (mounted.current && sequence === listSequence.current) setListLoading(false); }
  }, []);
  const reloadDetail = useCallback(async (id: string) => {
    const sequence = ++detailSequence.current; setDetailLoading(true); setDetailError(''); setAuditError('');
    const [workspaceResult, auditResult] = await Promise.allSettled([aiAPI.detail(id), aiAPI.audit(id)]);
    if (!mounted.current || sequence !== detailSequence.current) return;
    if (workspaceResult.status === 'fulfilled') { setDetail(workspaceResult.value); setSelected(workspaceResult.value.workspace); setNeedsRefresh(false); }
    else { setDetailError(message(workspaceResult.reason)); setNeedsRefresh(true); }
    if (auditResult.status === 'fulfilled') setAudit(auditResult.value);
    else setAuditError(message(auditResult.reason));
    setDetailLoading(false);
  }, []);
  useEffect(() => { void reloadCapabilities(); void reloadList(); }, [refresh, reloadCapabilities, reloadList]);
  const selectedId = selected?.id;
  useEffect(() => { if (selectedId) void reloadDetail(selectedId); return () => { detailSequence.current++; }; }, [selectedId, refresh, reloadDetail]);
  useEffect(() => { setPage(1); }, [status, query]);
  useEffect(() => {
    if (!selectedId) return;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const focusable = () => [...(drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]') || [])];
    (focusable()[0] || drawer.current)?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked.current) { detailSequence.current++; setSelected(null); }
      if (event.key !== 'Tab') return;
      const targets = focusable(), first = targets[0], last = targets[targets.length - 1];
      if (!first) { event.preventDefault(); drawer.current?.focus(); }
      else if (!drawer.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); returnFocus.current?.focus(); };
  }, [selectedId]);

  function open(workspace: Workspace) {
    if (locked.current) return;
    returnFocus.current = document.activeElement as HTMLElement;
    setSelected(workspace); setDetail(null); setAudit([]); setTab('application'); setAction(''); setReason(''); setOperationError(''); setNotice(''); setNeedsRefresh(true); pending.current = null;
  }
  function close() { if (locked.current) return; detailSequence.current++; setSelected(null); setAction(''); setReason(''); pending.current = null; }
  async function checkReadiness() {
    if (checking || !capabilities?.cloud.configured) return;
    setChecking(true); setCapError(''); const sequence = ++capsSequence.current;
    readinessId.current ||= crypto.randomUUID();
    try { const next = await aiAPI.readiness(readinessId.current); if (mounted.current && sequence === capsSequence.current) { setCapabilities(next); readinessId.current = null; } }
    catch (error) { if (mounted.current && sequence === capsSequence.current) { setCapError(message(error)); setCapabilities(previous => previous ? { ...previous, cloud: { ...previous.cloud, ready: false, status: 'configured_unverified' } } : null); } }
    finally { if (mounted.current) setChecking(false); }
  }
  async function submit() {
    if (!selected || !detail || saving || (!pending.current && (!action || needsRefresh || detailLoading || checking || !actionEnabled(action, capabilities)))) return;
    let body: ActionRequest;
    try { body = pending.current || createActionRequest(detail.workspace, action as WorkspaceAction, reason, crypto.randomUUID()); }
    catch (error) { setOperationError(message(error)); return; }
    pending.current = body; setSaving(true); setOperationError(''); setNotice('');
    const id = selected.id; detailSequence.current++;
    try {
      const workspace = await aiAPI.action(id, body);
      if (!mounted.current) return;
      setDetail(previous => previous ? { ...previous, workspace } : previous); setSelected(workspace); setUncertain(false); pending.current = null; setAction(''); setReason(''); setNeedsRefresh(false);
      setNotice(`${actionLabels[body.action]}已完成，已记录处理理由。`);
      void reloadList(); await reloadDetail(id); void reloadCapabilities();
    } catch (error) {
      if (!mounted.current) return;
      const outcome = mutationOutcome(error);
      if (outcome === 'uncertain') setUncertain(true);
      else { pending.current = null; setUncertain(false); if (outcome === 'conflict') { setNeedsRefresh(true); setAction(''); } }
      setOperationError(outcome === 'conflict' ? '记录已被更新。请刷新最新状态，再决定是否处理。' : message(error));
      if (outcome === 'rejected') void reloadCapabilities();
    } finally { if (mounted.current) setSaving(false); }
  }

  const needle = query.trim().toLowerCase();
  const matches = workspaces.filter(w => (!status || w.status === status) && (!needle || [w.id, w.name, w.ownerId, w.purpose].some(value => value.toLowerCase().includes(needle))));
  const maxPage = Math.max(1, Math.ceil(matches.length / 15)), currentPage = Math.min(page, maxPage), visible = matches.slice((currentPage - 1) * 15, currentPage * 15);
  const current = detail?.workspace;
  const ready = capabilities?.cloud.ready === true;
  const cloudTitle = ready ? '模型连接已验证' : capabilities?.cloud.configured ? '等待验证连接' : capabilities ? '等待配置服务' : '正在读取服务状态';
  const displayedAction = pending.current?.action || action;

  return <div className="ai-admin">
    <section className="ai-service-card">
      <div className={`ai-service-icon ${ready ? 'ready' : ''}`}><Server size={25}/></div>
      <div className="ai-service-copy"><div><h2>{cloudTitle}</h2><span className={`badge ${ready ? 'green' : 'gray'}`}>{ready ? '可开通工作区' : '暂不可开通'}</span></div><p>{capabilities ? safeText(capabilities.cloud.message, 220) : capError || '正在获取服务器连接状态…'}</p><small><LockKeyhole size={12}/>密钥仅保存在服务器 · 此处不能查看或修改{capabilities?.cloud.lastCheckedAt ? ` · 检查于 ${date(capabilities.cloud.lastCheckedAt)}` : ''}</small></div>
      <div className="ai-service-actions"><button className="button" disabled={checking || saving || uncertain || !capabilities?.cloud.configured} onClick={() => void checkReadiness()}>{checking ? <Loader2 size={16}/> : <RefreshCw size={16}/>} {checking ? '验证中…' : '验证连接'}</button>{capError && <button className="button subtle" disabled={checking} onClick={() => void reloadCapabilities()}>重新读取</button>}</div>
    </section>
    {capError && <div className="error-banner" role="alert"><AlertCircle size={17}/>{capError}</div>}
    <div className="ai-summary">{[{ label: '待审核', value: workspaces.filter(w => w.status === 'pending_review').length, icon: ShieldCheck }, { label: '已开通', value: workspaces.filter(w => w.status === 'active').length, icon: Sparkles }, { label: '暂停 / 待开通', value: workspaces.filter(w => ['paused', 'awaiting_configuration'].includes(w.status)).length, icon: Clock3 }].map(({ label, value, icon: Icon }) => <div key={label}><Icon size={18}/><span>{label}</span><strong>{listLoading || listError ? '—' : value}</strong></div>)}<p>最近 100 条提交记录<br/><span>与 1,000 人合成样本分开管理</span></p></div>
    <section className="panel ai-applications"><div className="panel-header"><div><h2>申请与工作区</h2><p>最近 100 条服务端申请，来自当前验收账号。</p></div><span className="badge blue">服务端记录</span></div><div className="toolbar"><label className="search-field"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} maxLength={120} placeholder="搜索工作区、申请编号" aria-label="搜索 AI 申请"/></label><div className="filters"><select aria-label="筛选 AI 申请状态" value={status} onChange={e => setStatus(e.target.value as WorkspaceStatus | '')}><option value="">全部状态</option>{Object.entries(workspaceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="button subtle" disabled={listLoading} onClick={() => void reloadList()}><RefreshCw size={16}/>刷新</button></div></div>
      {listError ? <div className="error-banner" role="alert"><AlertCircle size={17}/>{listError}<button className="button subtle" onClick={() => void reloadList()}>重试</button></div> : listLoading ? <div className="loading" role="status"><Loader2 size={22}/>读取申请中…</div> : !visible.length ? <div className="empty ai-empty"><FileText size={34}/><h3>{workspaces.length ? '没有符合条件的申请' : '还没有工作区申请'}</h3><p>{workspaces.length ? '试试其他状态或关键词。' : '用户提交后会出现在这里，再由你审核开通。'}</p></div> : <div className="table-wrap"><table><thead><tr><th>工作区 / 编号</th><th>用途</th><th>申请身份</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead><tbody>{visible.map(w => <tr key={w.id}><td><div className="record-name"><span className="avatar"><Sparkles size={17}/></span><div><strong>{safeText(w.name, 60)}</strong><small>{shortId(w.id)}</small></div></div></td><td>{capabilities?.useCases.find(use => use.id === w.purpose)?.label || safeText(w.purpose, 80)}</td><td><span className="ai-owner">验收身份</span><small>{shortId(w.ownerId)}</small></td><td><Status status={w.status}/></td><td>{date(w.createdAt)}</td><td><button className="button subtle" onClick={() => open(w)}>查看<ChevronRight size={16}/></button></td></tr>)}</tbody></table></div>}
      <div className="pagination"><span>{listError ? '列表未读取完成' : `共 ${matches.length} 条 · 每页 15 条`}</span><div><button className="icon-button" aria-label="上一页 AI 申请" disabled={currentPage <= 1 || listLoading} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18}/></button><span>{currentPage} / {maxPage}</span><button className="icon-button" aria-label="下一页 AI 申请" disabled={currentPage >= maxPage || listLoading} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18}/></button></div></div>
    </section>
    <p className="ai-billing-note">{capabilities ? `每个工作区每日最多 ${capabilities.limits.dailyTasks} 次尝试，按 UTC 日期重置。${capabilities.billing.realBalanceDeduction ? '计费状态已变化，请先核对服务设置。' : '当前不扣平台余额。'}` : '额度与计费状态以服务器返回为准。'}</p>

    {selected && <div className="detail-backdrop ai-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><aside ref={drawer} className="detail-panel ai-detail" role="dialog" aria-modal="true" aria-labelledby="ai-detail-title" tabIndex={-1}><header className="detail-header"><div><span className="eyebrow">AI 服务 · 申请详情</span><h2 id="ai-detail-title">{safeText(selected.name, 80)}</h2></div><button className="icon-button" aria-label="关闭 AI 详情" disabled={saving || uncertain} onClick={close}><X size={21}/></button></header><div className="detail-body"><div className="detail-meta"><Status status={selected.status}/><span>{shortId(selected.id)}</span><span>版本 {selected.version}</span></div>
      {detailError && <div className="error-banner" role="alert">{detailError}<button className="button subtle" disabled={saving || detailLoading} onClick={() => void reloadDetail(selected.id)}>重新读取</button></div>}
      {detailLoading && <div className="loading" role="status"><Loader2 size={18}/>正在核对最新记录…</div>}
      {notice && <div className="success-banner" role="status"><CheckCircle2 size={17}/>{notice}</div>}
      {detail && <><div className="ai-detail-tabs" role="tablist" aria-label="工作区详情"><button role="tab" aria-selected={tab === 'application'} className={tab === 'application' ? 'active' : ''} onClick={() => setTab('application')}>申请与管理</button><button role="tab" aria-selected={tab === 'tasks'} className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>任务记录 <small>{detail.tasks.length}</small></button><button role="tab" aria-selected={tab === 'audit'} className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>操作日志</button></div>
        {tab === 'application' && <div className="ai-tab-body"><dl className="detail-grid"><div className="detail-row"><dt>申请身份</dt><dd>验收身份 · {shortId(detail.workspace.ownerId)}</dd></div><div className="detail-row"><dt>使用方向</dt><dd>{capabilities?.useCases.find(use => use.id === detail.workspace.purpose)?.label || safeText(detail.workspace.purpose, 120)}</dd></div><div className="detail-row"><dt>具体需求</dt><dd className="ai-wrap">{safeText(detail.workspace.requirements, 2000) || '未补充说明'}</dd></div><div className="detail-row"><dt>提交时间</dt><dd>{date(detail.workspace.createdAt)}</dd></div><div className="detail-row"><dt>最近更新</dt><dd>{date(detail.workspace.updatedAt)}</dd></div>{detail.workspace.reviewNote && <div className="detail-row"><dt>最近处理理由</dt><dd>{safeText(detail.workspace.reviewNote, 300)}</dd></div>}</dl>
          <div className="ai-quota"><div><span>今日尝试次数</span><strong>{detail.quota.used}<small> / {detail.quota.limit}</small></strong></div><div><span>本工作区剩余</span><strong>{detail.quota.remaining}<small> 次</small></strong></div><p>{detail.quota.date} · UTC<br/>失败和取消也计入尝试次数</p></div>
          {current && availableActions(current.status).length > 0 && <section className="action-box ai-action-box"><h3>管理工作区</h3><p className="muted">{current.status === 'pending_review' ? '批准后进入待开通；模型连接验证通过后，才能开通。' : current.status === 'active' ? '暂停或关闭会停止未完成任务。关闭后不能恢复。' : current.status === 'closed' ? '工作区已关闭。' : '每次变更都保存处理理由和操作记录。'}</p><div className="ai-action-options">{availableActions(current.status).map(value => <button key={value} className={`button ${action === value ? 'primary' : ''}`} disabled={saving || uncertain || needsRefresh || detailLoading || checking || !actionEnabled(value, capabilities)} onClick={() => { setAction(value); setOperationError(''); pending.current = null; }}>{actionLabels[value]}</button>)}</div>{availableActions(current.status).some(value => ['activate', 'resume'].includes(value)) && !ready && <p className="ai-inline-note"><LockKeyhole size={14}/>模型连接尚未就绪，暂不能开通或恢复。请先在服务状态中验证连接。</p>}
          </section>}
          {!availableActions(detail.workspace.status).length && <p className="ai-inline-note">当前状态没有可执行的管理操作，历史记录继续保留。</p>}
        </div>}
        {tab === 'tasks' && <div className="ai-tab-body"><div className="ai-section-heading"><span>最近 100 条实际任务</span><button className="button subtle" disabled={saving || detailLoading} onClick={() => void reloadDetail(selected.id)}><RefreshCw size={15}/>刷新</button></div>{!detail.tasks.length ? <div className="empty ai-empty"><FileText size={29}/><p>还没有任务。开通后由用户主动提交。</p></div> : detail.tasks.map(task => <details className="ai-task" key={task.id}><summary><div><Status status={task.status}/><strong>{safeText(task.prompt, 62) || '未填写任务摘要'}</strong></div><small>{date(task.createdAt)}</small></summary><dl><div><dt>任务编号</dt><dd>{shortId(task.id)}</dd></div><div><dt>任务需求</dt><dd className="ai-wrap">{safeText(task.prompt, 1800)}</dd></div><div><dt>最近更新</dt><dd>{date(task.updatedAt)}</dd></div>{task.usage && <div><dt>模型用量</dt><dd>输入 {task.usage.inputTokens} / 输出 {task.usage.outputTokens} tokens</dd></div>}{task.status === 'failed' && <div><dt>失败原因</dt><dd>{safeText(task.errorMessage, 300) || '服务器没有提供额外说明'}{task.errorCode ? <small className="muted"> · {safeText(task.errorCode, 80)}</small> : null}</dd></div>}{task.output && <div><dt>生成结果</dt><dd><pre>{safeText(task.output, 4000)}</pre></dd></div>}{task.status === 'cancelled' && <div><dt>处理状态</dt><dd>任务已取消，未继续生成。</dd></div>}</dl></details>)}</div>}
        {tab === 'audit' && <div className="ai-tab-body"><div className="ai-section-heading"><span>最近 200 条操作 · 只读</span><button className="button subtle" disabled={saving || detailLoading} onClick={() => void reloadDetail(selected.id)}><RefreshCw size={15}/>刷新</button></div>{auditError ? <div className="error-banner" role="alert">{auditError}<button className="button subtle" onClick={() => void reloadDetail(selected.id)}>重试</button></div> : !audit.length ? <div className="empty ai-empty"><Clock3 size={27}/><p>暂无操作记录</p></div> : <div className="ai-audit">{audit.map(item => <article key={item.id}><div><strong>{auditLabels[item.action] || safeText(item.action, 60)}</strong><time>{date(item.createdAt)}</time></div><p>{safeText(item.reason, 300) || '—'}</p><small>{item.actorRole === 'admin' || item.actorRole === 'owner' ? '管理员' : item.actorRole === 'system' ? '系统' : '验收身份'} · {shortId(item.actorId)}</small><div className="ai-audit-status">{item.fromStatus && <Status status={item.fromStatus}/>}<ChevronRight size={13}/>{item.toStatus && <Status status={item.toStatus}/>}{item.requestId && <small>{shortId(item.requestId)}</small>}</div></article>)}</div>}</div>}
      </>}
      {(displayedAction || uncertain) && <section className="ai-action-confirm"><label className="field">{displayedAction ? actionLabels[displayedAction as WorkspaceAction] : '处理'}的理由<textarea value={reason} minLength={4} maxLength={300} disabled={saving || uncertain} placeholder="请说明处理依据，4–300 字" onChange={e => { setReason(e.target.value); pending.current = null; }}/></label><small className="muted">{reason.trim().length} / 300 · 理由会写入操作日志</small>{displayedAction === 'close' && <p className="ai-inline-note">关闭后不可恢复，未完成的任务将取消。</p>}</section>}
      {operationError && <div className="error-banner" role="alert"><AlertCircle size={17}/>{operationError}</div>}
      {needsRefresh && !detailLoading && detail && <button className="button" disabled={saving} onClick={() => void reloadDetail(selected.id)}><RefreshCw size={16}/>刷新最新状态</button>}
      {uncertain && <div className="banner ai-uncertain"><AlertCircle size={18}/><span>暂未确认处理结果。请使用同一操作编号重试核对，避免重复操作。<small>操作编号：{pending.current?.requestId}</small></span></div>}
      {(displayedAction || uncertain) && <button className={`button ai-submit ${['reject', 'close', 'pause'].includes(displayedAction) ? 'danger' : 'primary'}`} disabled={saving || (!uncertain && (reason.trim().length < 4 || needsRefresh || detailLoading || checking || !actionEnabled(displayedAction as WorkspaceAction, capabilities)))} onClick={() => void submit()}>{saving ? <Loader2 size={17}/> : <CheckCircle2 size={17}/>} {saving ? '正在处理…' : uncertain ? '重试同一次操作并核对' : `确认${actionLabels[displayedAction as WorkspaceAction]}`}</button>}
    </div></aside></div>}
  </div>;
}
