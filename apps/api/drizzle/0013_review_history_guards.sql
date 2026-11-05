CREATE TRIGGER proposal_revisions_no_update BEFORE UPDATE ON proposal_revisions BEGIN SELECT RAISE(ABORT, 'proposal_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER proposal_revisions_no_delete BEFORE DELETE ON proposal_revisions BEGIN SELECT RAISE(ABORT, 'proposal_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER script_spans_no_update BEFORE UPDATE ON script_spans BEGIN SELECT RAISE(ABORT, 'script_spans are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER script_spans_no_delete BEFORE DELETE ON script_spans BEGIN SELECT RAISE(ABORT, 'script_spans are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER shot_card_revisions_no_update BEFORE UPDATE ON shot_card_revisions BEGIN SELECT RAISE(ABORT, 'shot_card_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER shot_card_revisions_no_delete BEFORE DELETE ON shot_card_revisions BEGIN SELECT RAISE(ABORT, 'shot_card_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER shot_script_spans_no_update BEFORE UPDATE ON shot_script_spans BEGIN SELECT RAISE(ABORT, 'shot_script_spans are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER shot_script_spans_no_delete BEFORE DELETE ON shot_script_spans BEGIN SELECT RAISE(ABORT, 'shot_script_spans are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER proposal_adoptions_no_update BEFORE UPDATE ON proposal_adoptions BEGIN SELECT RAISE(ABORT, 'proposal_adoptions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER proposal_adoptions_no_delete BEFORE DELETE ON proposal_adoptions BEGIN SELECT RAISE(ABORT, 'proposal_adoptions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER accepted_proposal_locked BEFORE UPDATE ON proposal_reviews WHEN OLD.state = 'accepted' BEGIN SELECT RAISE(ABORT, 'accepted proposal is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER proposal_reviews_no_delete BEFORE DELETE ON proposal_reviews BEGIN SELECT RAISE(ABORT, 'proposal review history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER adoption_revision_scope BEFORE INSERT ON proposal_adoptions BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM proposal_revisions r WHERE r.id=NEW.proposal_revision_id AND r.proposal_id=NEW.proposal_id AND r.action='accepted') THEN RAISE(ABORT, 'adoption revision scope mismatch') END; END;
