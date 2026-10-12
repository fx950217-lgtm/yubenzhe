import {providerName} from './device-ai-providers.js';

const timestamp = task => new Date(task.finishedAt || task.updatedAt || task.startedAt || task.createdAt).getTime() || 0;
export const newestFirst = tasks => [...tasks].sort((a, b) => timestamp(b) - timestamp(a));
export function ruleTasks(value) {
 if (!Array.isArray(value) || value.some(task => !task || typeof task.id !== 'string' || !task.id || typeof task.title !== 'string' || typeof task.status !== 'string')) return null;
 return value.map(task => ({...task, origin: 'rules', sourceLabel: '文件工具 · 固定规则'}));
}
export function computerTasks(value, device) {
 if (!Array.isArray(value) || value.some(task => !task || typeof task.id !== 'string' || !task.id || task.deviceId !== device.id || typeof task.status !== 'string')) return null;
 return value.map(task => ({...task, origin: 'device', title: typeof task.prompt === 'string' && task.prompt.trim() ? task.prompt.trim().slice(0, 80) : '电脑 AI 任务', sourceLabel: device.name + ' · ' + providerName(task.provider)}));
}
export function taskProgress(task) {
 // A provider completing its CLI process is not evidence of a percentage or accepted delivery.
 if (task.origin !== 'rules' || !Number.isSafeInteger(task.step) || !Number.isSafeInteger(task.remainingSteps) || task.step < 0 || task.remainingSteps < 0) return null;
 const total = task.step + task.remainingSteps;
 return total > 0 ? {done: task.step, total, percent: Math.floor(task.step * 100 / total)} : null;
}
export function overviewSections(tasks) {
 const ordered = newestFirst(tasks);
 return {
  running: ordered.filter(task => ['running', 'queued'].includes(task.status)),
  decisions: ordered.filter(task => task.origin === 'rules' && ['awaiting-confirmation', 'awaiting-user', 'budget-paused', 'paused'].includes(task.status)),
  completed: ordered.filter(task => task.status === 'succeeded' || task.origin === 'device' && task.status === 'completed').slice(0, 3),
 };
}
