CREATE TRIGGER generation_reference_media_worker_guard BEFORE UPDATE OF lease_id ON generation_jobs
WHEN NEW.lease_id IS NOT NULL AND json_type(NEW.snapshot_json, '$.referenceMedia') = 'array'
  AND NEW.lease_id NOT LIKE 'free:media-v1:disconnect:multimodal:%'
  AND NEW.lease_id NOT LIKE 'pool:free:media-v1:disconnect:multimodal:%'
BEGIN SELECT RAISE(ABORT,'reference media require updated generation worker'); END;
