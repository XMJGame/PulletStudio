CREATE TRIGGER generation_optional_reference_worker_guard BEFORE UPDATE OF lease_id ON generation_jobs
WHEN NEW.lease_id IS NOT NULL AND json_extract(NEW.snapshot_json, '$.optionalReferenceImages') = 1
  AND NEW.lease_id NOT LIKE 'free:media-v1:disconnect:%'
  AND NEW.lease_id NOT LIKE 'pool:free:media-v1:disconnect:%'
BEGIN SELECT RAISE(ABORT,'optional reference images require updated generation worker'); END;
