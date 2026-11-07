ALTER TABLE `generation_outputs` ADD `primary_index` integer;
--> statement-breakpoint
CREATE TRIGGER generation_primary_batch_worker_guard BEFORE UPDATE OF lease_id ON generation_jobs
WHEN NEW.lease_id IS NOT NULL AND json_extract(NEW.snapshot_json,'$.primaryBatch')=1
 AND NEW.lease_id NOT LIKE '%:b7:b6' AND NEW.lease_id NOT LIKE '%:b7:b6:b4'
BEGIN SELECT RAISE(ABORT,'primary batch requires updated generation worker'); END;
--> statement-breakpoint
CREATE TRIGGER generation_primary_output_insert BEFORE INSERT ON generation_outputs
WHEN NOT EXISTS (
 SELECT 1 FROM generation_jobs j, json_each(j.result_json,'$.outputs') f
 WHERE j.id=NEW.job_id AND json_extract(f.value,'$.slotId')=NEW.slot_id
 AND json_extract(f.value,'$.index')=NEW.position
 AND json_extract(f.value,'$.primaryIndex') IS NEW.primary_index
 AND (NEW.primary_index IS NULL OR (
   json_extract(j.snapshot_json,'$.primaryBatch')=1 AND NEW.primary_index BETWEEN 1 AND 7
   AND NEW.primary_index=NEW.position AND NEW.role='intermediate' AND NEW.label='主结果'
   AND EXISTS(SELECT 1 FROM generation_workflows w WHERE w.id=j.workflow_id
     AND json_extract(w.definition_json,'$.output.batch.id')=NEW.slot_id))))
BEGIN SELECT RAISE(ABORT,'primary output must match frozen batch'); END;
--> statement-breakpoint
CREATE TRIGGER generation_primary_output_identity BEFORE UPDATE OF primary_index ON generation_outputs
WHEN NEW.primary_index IS NOT OLD.primary_index
BEGIN SELECT RAISE(ABORT,'primary output identity is immutable'); END;
--> statement-breakpoint
DROP TRIGGER generation_output_completion;
--> statement-breakpoint
CREATE TRIGGER generation_output_completion BEFORE UPDATE OF state ON generation_jobs
WHEN NEW.state IN ('completed','test_completed') AND json_extract(NEW.snapshot_json,'$.extendedOutputs')=1 AND (
 json_extract(NEW.result_json,'$.version') IS NOT 'studio.generation-outputs.v1'
 OR json_array_length(NEW.result_json,'$.outputs') NOT BETWEEN
   CASE WHEN json_extract(NEW.snapshot_json,'$.primaryBatch')=1 THEN 0 ELSE 1 END AND 39
 OR (SELECT count(*) FROM generation_outputs o WHERE o.job_id=NEW.id)<>json_array_length(NEW.result_json,'$.outputs')
 OR (SELECT count(*) FROM generation_outputs o WHERE o.job_id=NEW.id AND o.primary_index IS NULL)>32
 OR (SELECT count(*) FROM generation_outputs o WHERE o.job_id=NEW.id AND o.primary_index IS NOT NULL)>7
 OR EXISTS(SELECT 1 FROM generation_outputs o WHERE o.job_id=NEW.id AND o.media_version_id IS NULL))
BEGIN SELECT RAISE(ABORT,'all generation outputs must be archived before completion'); END;
