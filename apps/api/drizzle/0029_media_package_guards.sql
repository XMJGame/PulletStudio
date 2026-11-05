-- Custom SQL migration file, put your code below! --
CREATE TRIGGER media_package_no_update BEFORE UPDATE ON media_package_exports BEGIN SELECT RAISE(ABORT,'media packages are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER media_package_no_delete BEFORE DELETE ON media_package_exports BEGIN SELECT RAISE(ABORT,'media packages are immutable'); END;
