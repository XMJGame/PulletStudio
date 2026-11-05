CREATE TRIGGER asset_decision_no_update BEFORE UPDATE ON asset_revision_decisions BEGIN SELECT RAISE(ABORT, 'asset decisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER asset_decision_no_delete BEFORE DELETE ON asset_revision_decisions BEGIN SELECT RAISE(ABORT, 'asset decisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER asset_decision_sequence BEFORE INSERT ON asset_revision_decisions
WHEN NEW.version <> COALESCE((SELECT MAX(version) FROM asset_revision_decisions WHERE revision_id = NEW.revision_id), 0) + 1
OR NEW.action = COALESCE((SELECT action FROM asset_revision_decisions WHERE revision_id = NEW.revision_id ORDER BY version DESC LIMIT 1), 'revoke')
BEGIN SELECT RAISE(ABORT, 'invalid asset decision transition'); END;
