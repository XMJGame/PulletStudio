CREATE TRIGGER analysis_revision_scope BEFORE INSERT ON analysis_runs BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM script_revisions r WHERE r.id=NEW.revision_id AND r.project_id=NEW.project_id AND r.workspace_id=NEW.workspace_id) THEN RAISE(ABORT, 'analysis revision scope mismatch') END; END;
--> statement-breakpoint
CREATE TRIGGER analysis_input_immutable BEFORE UPDATE OF workspace_id,project_id,revision_id,model_profile_id,created_by,idempotency_key,request_hash,input_json,connection_snapshot_json ON analysis_runs BEGIN SELECT RAISE(ABORT, 'analysis input is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER analysis_proposal_no_update BEFORE UPDATE ON analysis_proposals BEGIN SELECT RAISE(ABORT, 'analysis proposal is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER analysis_proposal_no_delete BEFORE DELETE ON analysis_proposals BEGIN SELECT RAISE(ABORT, 'analysis proposal is immutable'); END;
