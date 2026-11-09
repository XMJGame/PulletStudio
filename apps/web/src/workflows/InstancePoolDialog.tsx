import { useState } from 'react';
import { api, ApiError } from '../api';
import { Dialog } from '../components/Dialog';
import { DependencyView, type Inspection } from './DependencyView';
import type { GenerationConfig, Workflow } from './workflow-types';

type Instance = {
  id: string;
  name: string;
  enabled: boolean;
  maxRunning: number;
  maxPending: number;
  fresh: boolean;
  capacity: 'available' | 'busy' | 'unverified';
  check: {
    checkedAt: string;
    connectionVersion: number;
    reachable: boolean;
    running: number | null;
    pending: number | null;
    status: Inspection['status'];
    binding: 'passed' | 'failed' | 'unverified';
    report: Omit<Inspection, 'workflowId' | 'connectionVersion'> | null;
  } | null;
};

const dependencyLabels = { compatible: '声明匹配', incompatible: '依赖不匹配', unverified: '依赖未验证' };
const capacityLabels = { available: '负载低于阈值', busy: '已达到负载阈值', unverified: '容量未验证' };

export function InstancePoolDialog({
  config,
  theme,
  onRefresh,
  onClose,
}: {
  config: GenerationConfig;
  theme: 'light' | 'dark';
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [workflow, setWorkflow] = useState<Workflow>();
  const [instances, setInstances] = useState<Instance[]>();
  const [checkingId, setCheckingId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const workflowId = workflow?.id ?? '';
  const workflows = new Map(config.workflows.map((item) => [item.id, item]));
  for (const item of config.productionWorkflows) workflows.set(item.id, item);
  if (workflow && !workflows.has(workflow.id)) workflows.set(workflow.id, workflow);

  async function load(id = workflowId) {
    if (!id) return;
    const result = await api<{ items: Instance[] }>(`/generation-workflows/${id}/instance-checks`);
    setInstances(result.items);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await action();
    } catch (failure) {
      if (failure instanceof ApiError && [401, 403, 404].includes(failure.status)) setInstances(undefined);
      setError(failure instanceof Error ? failure.message : '实例池操作失败');
    } finally {
      setBusy(false);
      setCheckingId('');
    }
  }

  return (
    <Dialog
      title="工作流实例检查"
      className="studio-v2 v2-library v2-library-aux"
      theme={theme}
      description="按固定工作流修订检查各实例的依赖和负载。实例的地址与调度设置在「实例」Tab 管理。"
      busy={busy}
      onClose={onClose}
    >
      <div className="dialog-body workflow-instance-pool">
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice success" role="status">
            {message}
          </p>
        )}
        <section aria-label="实例检查">
          <h3>按工作流检查</h3>
          <p className="field-hint">
            检查结果是最近 15 分钟的观测。生成时按原自动或手动路由规则选择实例，历史任务保留实际使用的连接。
          </p>
          <label>
            工作流修订
            <select
              aria-label="检查工作流修订"
              value={workflowId}
              disabled={busy}
              onChange={(event) => {
                const id = event.target.value;
                setWorkflow(workflows.get(id));
                setInstances(undefined);
                void run(() => load(id));
              }}
            >
              <option value="">选择固定工作流修订</option>
              {[...workflows.values()].map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · v{item.revision ?? 1}
                  {item.releaseState === 'published' ? ' · 已发布' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await onRefresh();
                await load();
              })
            }
          >
            刷新实例池
          </button>
          {instances?.length === 0 && <p className="field-hint">工作区实例池为空。</p>}
          {instances?.map((item) => (
            <article className="panel" key={item.id}>
              <strong>{item.name}</strong>
              <p className="field-hint">
                {!item.enabled
                  ? '已停用'
                  : !item.check
                    ? '尚未检查'
                    : !item.fresh
                      ? '检查已过期'
                      : item.check.reachable
                        ? '健康检查通过'
                        : '健康检查未通过'}
              </p>
              {item.check && (
                <>
                  <p>
                    {!item.fresh && '上次检查 · '}
                    {dependencyLabels[item.check.status]} · {capacityLabels[item.capacity]}
                  </p>
                  {item.check.running !== null && (
                    <p className="field-hint">
                      运行 {item.check.running}/{item.maxRunning} · 等待 {item.check.pending}/
                      {item.maxPending}
                    </p>
                  )}
                  {item.check.binding === 'failed' && (
                    <p className="field-hint">工作流输入或输出绑定与此实例不匹配。</p>
                  )}
                  <p className="field-hint">{new Date(item.check.checkedAt).toLocaleString()}</p>
                  {item.check.report && (
                    <details>
                      <summary>查看依赖明细</summary>
                      <DependencyView
                        report={{
                          ...item.check.report,
                          workflowId,
                          connectionVersion: item.check.connectionVersion,
                        }}
                      />
                    </details>
                  )}
                </>
              )}
              <button
                disabled={busy || !item.enabled}
                onClick={() => {
                  setCheckingId(item.id);
                  void run(async () => {
                    const next = await api<Instance>(
                      `/generation-workflows/${workflowId}/instance-checks/${item.id}`,
                      'POST',
                      {},
                    );
                    setInstances((previous) =>
                      previous?.map((entry) => (entry.id === next.id ? next : entry)),
                    );
                    setMessage(`${next.name}的检查已记录。`);
                  });
                }}
              >
                {checkingId === item.id ? '正在检查…' : `检查 ${item.name}`}
              </button>
            </article>
          ))}
        </section>
      </div>
      <div className="dialog-footer">
        <button disabled={busy} onClick={onClose}>
          关闭兼容性检查
        </button>
      </div>
    </Dialog>
  );
}
