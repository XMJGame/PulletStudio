CREATE TRIGGER generation_reference_image_worker_guard BEFORE UPDATE OF lease_id ON generation_jobs
WHEN NEW.lease_id IS NOT NULL AND json_type(NEW.snapshot_json, '$.referenceImages') = 'array'
 AND NEW.lease_id NOT LIKE 'free:media-v1:%' AND NEW.lease_id NOT LIKE 'pool:free:media-v1:%'
BEGIN SELECT RAISE(ABORT,'reference images require updated generation worker'); END;
