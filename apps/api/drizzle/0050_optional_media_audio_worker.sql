CREATE TRIGGER generation_optional_media_audio_worker_guard BEFORE UPDATE OF lease_id ON generation_jobs
WHEN NEW.lease_id IS NOT NULL
  AND (json_extract(NEW.snapshot_json, '$.optionalReferenceMedia') = 1
       OR json_extract(NEW.snapshot_json, '$.audioOutput') = 1)
  AND NEW.lease_id NOT LIKE '%:b4'
BEGIN SELECT RAISE(ABORT,'optional media and audio output require updated generation worker'); END;
