import { useEffect, useRef, useState } from 'react';
import { api, type CursorPage } from '../api';
import { Dialog } from '../components/Dialog';
import { describeParameters } from '../components/GenerationParameters';
import { GenerationDialog, generationStates, type GenerationJob } from '../components/GenerationDialog';
import type { GenerationConfig, Workflow } from './workflow-types';

type TrialShot = { id: string; code: string; description: string };
type ReleaseEvent = {
  id: string;
  revision: number;
  sequence: number;
  action: 'publish' | 'revoke';
  testJobId: string;
  reason: string;
  actor: string;
  createdAt: string;
};
type ReleaseHistory = { items: ReleaseEvent[]; nextCursor: number | null };

function EvidencePreview({ job }: { job: GenerationJob }) {
  if (!job.result) return null;
  const { contentUrl, mediaType } = job.result;
  return (
    <details>
      <summary>预览试跑结果</summary>
      {mediaType === 'image' ? (
        <img src={contentUrl} alt="试跑结果" loading="lazy" />
      ) : (
        <video src={contentUrl} controls preload="none" playsInline />
      )}
      <a href={`${contentUrl}?download=1`} download>
        下载试跑结果
      </a>
      {job.image && (
        <p className="field-hint">
          首帧 {job.image.fileName} · v{job.image.version}
        </p>
      )}
      {Object.keys(job.parameterValues).length > 0 && (
        <p className="field-hint">{describeParameters(job.parameterValues)}</p>
      )}
      {job.creativeParameters.map(({ label, value }, index) => (
        <p className="field-hint" key={index}>
          {label} · {typeof value === 'boolean' ? (value ? '开启' : '关闭') : value}
        </p>
      ))}
    </details>
  );
}

export function WorkflowReleaseDialog({
  workflow,
  projectId,
  onClose,
  onChanged,
}: {
  workflow: Workflow;
  projectId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const testPath = `/generation-workflows/${workflow.id}`;
  const releasePath = `/workflow-catalogs/${workflow.familyId}/releases`;
  const [config, setConfig] = useState<GenerationConfig>();
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [history, setHistory] = useState<ReleaseHistory>();
  const [historicalEvidence, setHistoricalEvidence] = useState<{ eventId: string; job: GenerationJob }>();
  const [shots, setShots] = useState<CursorPage<TrialShot>>();
  const [shotId, setShotId] = useState('');
  const [trialOpen, setTrialOpen] = useState(false);
  const [freeTrial, setFreeTrial] = useState(false);
  const [evidence, setEvidence] = useState('');
  const [action, setAction] = useState<'publish' | 'revoke'>('publish');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const attempt = useRef({ body: '', key: '' });
  const current = config?.workflows.find((item) => item.familyId === workflow.familyId);
  const production = config?.productionWorkflows.find((item) => item.familyId === workflow.familyId);
  const currentHead = current?.id === workflow.id;
  const canPublish = currentHead && current?.enabled && current.releaseState !== 'published';
  const canRevoke = Boolean(current?.publishedWorkflowId);
  const reviewAction = canRevoke && (!canPublish || action === 'revoke') ? 'revoke' : 'publish';

  async function load() {
    const [settings, results, releases] = await Promise.all([
      api<GenerationConfig>(`/projects/${projectId}/generation-config`),
      api<GenerationJob[]>(`${testPath}/test-jobs`),
      api<ReleaseHistory>(releasePath),
    ]);
    setConfig(settings);
    setJobs(results);
    setHistory(releases);
  }
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(load);
  }, [testPath, releasePath, projectId]);
  async function loadShots() {
    const more = await api<CursorPage<TrialShot>>(
      `${testPath}/test-shots${shots?.nextCursor ? `?cursor=${shots.nextCursor}` : ''}`,
    );
    setShots({ ...more, items: [...(shots?.items ?? []), ...more.items] });
  }
  const selectedEvidence = jobs.find((job) => job.id === evidence && job.evidenceCurrent);

  return (
    <Dialog
      title="试跑与发布"
      description={`${workflow.name} · 固定修订 v${workflow.revision ?? 1}`}
      busy={busy}
      onClose={onClose}
    >
      <div className="dialog-body workflow-release">
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="notice success">
            {message}
          </p>
        )}
        {production?.enabled && (
          <p className="field-hint">
            项目生产使用 {production.name} · v{production.revision ?? 1}
          </p>
        )}
        <button disabled={busy} onClick={() => void run(load)}>
          刷新试跑与发布状态
        </button>
        {config && !currentHead && (
          <p className="field-hint">项目已有新修订。返回工作流列表可打开最新版本。</p>
        )}
        {config?.canConfigure && currentHead && current?.enabled && (
          <section aria-label="提示词试跑">
            <h3>直接试跑</h3>
            <p className="field-hint">粘贴提示词验证当前工作流，结果仅保留为试跑证据。</p>
            <button disabled={busy} onClick={() => setFreeTrial(true)}>
              粘贴提示词试跑
            </button>
          </section>
        )}
        {config?.canConfigure && currentHead && current?.enabled && (
          <details>
            <summary>使用旧镜头试跑（兼容）</summary>
            <section aria-label="选择试跑镜头">
              <h3>使用项目镜头试跑</h3>
              {shots && (
                <label>
                  试跑镜头
                  <select
                    aria-label="试跑镜头"
                    value={shotId}
                    onChange={(event) => setShotId(event.target.value)}
                    disabled={busy}
                  >
                    <option value="">选择已有镜头</option>
                    {shots.items.map((shot) => (
                      <option key={shot.id} value={shot.id}>
                        {shot.code} · {shot.description.slice(0, 90)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(!shots || shots.nextCursor) && (
                <button disabled={busy} onClick={() => void run(loadShots)}>
                  {shots ? '更多镜头' : '读取项目镜头'}
                </button>
              )}
              {shots?.items.length === 0 && (
                <p className="field-hint">请先在项目制作结构中创建镜头并保存提示词。</p>
              )}
              {shots && (
                <button disabled={busy || !shotId} onClick={() => setTrialOpen(true)}>
                  打开试跑表单
                </button>
              )}
            </section>
          </details>
        )}
        <section aria-label="试跑证据">
          <h3>试跑证据</h3>
          {!jobs.length && <p className="field-hint">暂无试跑记录。</p>}
          {jobs.map((job) => (
            <article className="panel" key={job.id}>
              <strong>
                {job.shotCode ? `${job.shotCode} · 制作卡 v${job.shotVersion}` : '项目提示词试跑'}
              </strong>
              <p className="field-hint">
                {new Date(job.createdAt).toLocaleString()} · {generationStates[job.state] ?? job.state}
              </p>
              {job.state === 'test_completed' && !job.evidenceCurrent && (
                <p className="field-hint">当前连接需要重新试跑。</p>
              )}
              <EvidencePreview job={job} />
              {config?.canReview && canPublish && job.evidenceCurrent && (
                <label className="checkbox-label">
                  <input
                    type="radio"
                    name="release-evidence"
                    checked={evidence === job.id}
                    onChange={() => {
                      setEvidence(job.id);
                      setAction('publish');
                    }}
                    disabled={busy}
                  />
                  选为发布依据
                </label>
              )}
            </article>
          ))}
        </section>
        {config?.canReview && (canPublish || canRevoke) && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !current ||
                (reviewAction === 'publish' && (!canPublish || !selectedEvidence)) ||
                (reviewAction === 'revoke' && !canRevoke)
              )
                return;
              const body = {
                expectedVersion: current.catalogVersion,
                action: reviewAction,
                reason: reason.trim(),
                ...(reviewAction === 'publish' ? { workflowId: workflow.id, testJobId: evidence } : {}),
              };
              const serialized = JSON.stringify(body);
              if (attempt.current.body !== serialized)
                attempt.current = { body: serialized, key: crypto.randomUUID() };
              void run(async () => {
                await api(releasePath, 'POST', body, { 'Idempotency-Key': attempt.current.key });
                setReason('');
                setEvidence('');
                setAction('publish');
                await load();
                await onChanged();
                setMessage(reviewAction === 'publish' ? '工作流已发布给项目团队。' : '工作流发布已撤回。');
              });
            }}
          >
            <fieldset className="plain-fieldset" disabled={busy}>
              <h3>项目发布审核</h3>
              <label>
                审核操作
                <select
                  value={reviewAction}
                  onChange={(event) => setAction(event.target.value === 'revoke' ? 'revoke' : 'publish')}
                >
                  {canPublish && <option value="publish">发布此修订</option>}
                  {canRevoke && <option value="revoke">撤回当前发布版</option>}
                </select>
              </label>
              <label>
                审核意见
                <textarea
                  aria-label="审核意见"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  maxLength={1000}
                  rows={2}
                />
              </label>
              <button
                className="primary"
                disabled={!reason.trim() || (reviewAction === 'publish' && !selectedEvidence)}
              >
                {reviewAction === 'publish' ? '确认发布' : '确认撤回'}
              </button>
            </fieldset>
          </form>
        )}
        <section aria-label="发布历史">
          <h3>发布历史</h3>
          {!history?.items.length && <p className="field-hint">暂无发布记录。</p>}
          {history?.items.map((item) => (
            <article className="panel" key={item.id}>
              <strong>
                {item.action === 'publish' ? '发布' : '撤回'} v{item.revision}
              </strong>
              <p className="field-hint">
                {item.actor} · {new Date(item.createdAt).toLocaleString()}
              </p>
              <p>{item.reason}</p>
              {historicalEvidence?.eventId === item.id ? (
                <EvidencePreview job={historicalEvidence.job} />
              ) : (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const job = await api<GenerationJob>(`/generation-jobs/${item.testJobId}`);
                      setHistoricalEvidence({ eventId: item.id, job });
                    })
                  }
                >
                  查看发布依据
                </button>
              )}
            </article>
          ))}
          {history?.nextCursor && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const next = await api<ReleaseHistory>(`${releasePath}?before=${history.nextCursor}`);
                  setHistory({ ...next, items: [...history.items, ...next.items] });
                })
              }
            >
              更多发布记录
            </button>
          )}
        </section>
      </div>
      <div className="dialog-footer">
        <button onClick={onClose} disabled={busy}>
          关闭
        </button>
      </div>
      {freeTrial && (
        <GenerationDialog
          creation={{ projectId }}
          testWorkflow={workflow}
          onClose={() => {
            setFreeTrial(false);
            void run(load);
          }}
        />
      )}
      {trialOpen && (
        <GenerationDialog
          shotId={shotId}
          testWorkflow={workflow}
          onClose={() => {
            setTrialOpen(false);
            void run(load);
          }}
        />
      )}
    </Dialog>
  );
}
