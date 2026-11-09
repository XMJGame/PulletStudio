ALTER TABLE generation_connections ADD COLUMN provider TEXT NOT NULL DEFAULT 'comfyui'
  CHECK (provider IN ('comfyui', 'modelscope'));
--> statement-breakpoint
CREATE UNIQUE INDEX generation_modelscope_workspace ON generation_connections (workspace_id)
  WHERE provider = 'modelscope';
--> statement-breakpoint
CREATE TRIGGER generation_modelscope_worker_guard BEFORE UPDATE OF lease_id ON generation_jobs
WHEN NEW.lease_id IS NOT NULL AND NEW.lease_id NOT LIKE 'free:api-v1:%'
  AND EXISTS (
    SELECT 1 FROM generation_workflows w
    JOIN generation_connections c ON c.id = w.connection_id
    WHERE w.id = NEW.workflow_id AND c.provider = 'modelscope'
  )
BEGIN
  SELECT RAISE(ABORT, 'MODEL_SCOPE_WORKER_UPGRADE_REQUIRED');
END;
