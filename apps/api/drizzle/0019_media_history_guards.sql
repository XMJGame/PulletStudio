CREATE TRIGGER media_versions_no_update BEFORE UPDATE ON media_versions BEGIN SELECT RAISE(ABORT, 'media versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER media_versions_no_delete BEFORE DELETE ON media_versions BEGIN SELECT RAISE(ABORT, 'media versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER storage_connections_no_update BEFORE UPDATE ON storage_connections BEGIN SELECT RAISE(ABORT, 'storage identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER storage_connections_no_delete BEFORE DELETE ON storage_connections BEGIN SELECT RAISE(ABORT, 'storage identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER takes_no_update BEFORE UPDATE ON takes BEGIN SELECT RAISE(ABORT, 'take identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER takes_no_delete BEFORE DELETE ON takes BEGIN SELECT RAISE(ABORT, 'take identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER media_assets_no_delete BEFORE DELETE ON media_assets BEGIN SELECT RAISE(ABORT, 'media asset history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER media_asset_identity BEFORE UPDATE ON media_assets WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.name<>OLD.name OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT, 'media identity or version transition invalid'); END;
--> statement-breakpoint
CREATE TRIGGER upload_intent_immutable BEFORE UPDATE ON media_uploads WHEN OLD.state='complete' OR NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.created_by<>OLD.created_by OR NEW.asset_id<>OLD.asset_id OR NEW.media_version_id<>OLD.media_version_id OR NEW.expected_asset_version<>OLD.expected_asset_version OR NEW.storage_id<>OLD.storage_id OR NEW.file_name<>OLD.file_name OR NEW.declared_mime<>OLD.declared_mime OR NEW.expected_bytes<>OLD.expected_bytes OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.request_hash<>OLD.request_hash OR NEW.created_at<>OLD.created_at BEGIN SELECT RAISE(ABORT, 'upload intent is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER upload_state_transition BEFORE UPDATE ON media_uploads WHEN NOT (NEW.state=OLD.state OR (OLD.state IN ('created','failed','needs_reconciliation') AND NEW.state='uploading') OR (OLD.state='uploading' AND NEW.state IN ('failed','needs_reconciliation','complete'))) BEGIN SELECT RAISE(ABORT, 'upload state transition invalid'); END;
